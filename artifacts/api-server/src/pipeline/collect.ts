import type { FoundViaValue, HuntPreferencesData, SourceKindValue, SourceStatusValue } from "@workspace/db";
import type { FetchedPage } from "@workspace/tinyfish";
import { RUN_BUDGET } from "../lib/config";
import type { RunContext } from "./context";
import type { BoardLead, PageLead, PostingLead } from "./discover";
import { extractPage, type Extraction } from "./extract";
import { parseFeed, workdayPostingsFromLinks, type FeedPosting } from "./feeds";
import { isPlausibleBoardPosting, titleRelevance } from "./relevance";
import type { Candidate } from "./store";
import type { ReadOutcome } from "./tinyfish";
import { ATS_LABEL, canonicalizeUrl, detectAts, hostOf, normalizeText, parseUrl, prettyOrg, type AtsRef } from "./urls";

/** Read outcome for pages on ATSs that Fetch can't read (see AtsRef.readable); no Fetch call is made. */
export const NEEDS_BROWSER = "needs_browser";

export function sourceStatusFor(error: string | null): SourceStatusValue {
  if (!error) return "ok";
  if (/block|captcha|forbidden|403|denied|challenge/i.test(error)) return "blocked";
  if (/empty/i.test(error)) return "empty";
  return "failed";
}

function noteFor(error: string): string {
  if (error === NEEDS_BROWSER) return "Only loads in a full browser";
  const status = sourceStatusFor(error);
  if (status === "blocked") return "The site blocked automated reading";
  if (status === "empty") return "The page loaded without readable content";
  if (/timeout/i.test(error)) return "The page took too long to load";
  return `Could not be read (${error.slice(0, 60)})`;
}

/** Search term for a Workday board: "intern" for internship seekers, else their first role. */
export function workdayQuery(prefs: HuntPreferencesData): string {
  return prefs.seniority.includes("internship") ? "intern" : (prefs.roles[0] ?? "");
}

function mostCommon(values: Array<string | null>): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * Context for extracting a posting page. Board feeds state the location even when the page text Fetch
 * returns omits its header, so it is passed along as a fact from the employer's own board.
 */
function postingHint(lead: PostingLead): string {
  if (lead.via === "board" && lead.snippet) {
    return `Posting at ${lead.organization ?? "this employer"}. The employer's job board lists its location as: ${lead.snippet}`;
  }
  if (lead.organization) return `Posting at ${lead.organization}`;
  return `Search snippet: ${lead.snippet ?? "(none)"}`;
}

/** Orders posting leads by how well their titles fit, dropping clear misfits. */
export function rankPostings(prefs: HuntPreferencesData, leads: PostingLead[]): PostingLead[] {
  return leads
    .map((lead) => ({ lead, rel: titleRelevance(prefs, lead.title, lead.snippet, null) }))
    .filter(({ rel }) => !rel.excluded && !rel.offTarget)
    .sort((a, b) => b.rel.score - a.rel.score)
    .map(({ lead }) => lead);
}

/** A page whose read failed or yielded nothing, which Agent may retry in a real browser. */
export interface AgentCandidate {
  url: string;
  organization: string;
  /** Lower runs first: companies the user named come before discovered portals. */
  priority: number;
}

/**
 * Accumulates everything a run learns: candidate listings, links worth reading next, boards discovered on
 * careers pages, and portals for Agent. Every URL is tracked so nothing is read twice in one run.
 */
export class Collector {
  readonly candidates: Candidate[] = [];
  readonly nextPostings: PostingLead[] = [];
  readonly nextBoards: BoardLead[] = [];
  readonly agentCandidates: AgentCandidate[] = [];
  /** Canonical URLs already read or queued. */
  readonly seen = new Set<string>();
  readonly seenBoards = new Set<string>();
  extracted = 0;
  closedUrls: string[] = [];

  constructor(private readonly ctx: RunContext) {}

  markSeen(key: string): boolean {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }

  queuePosting(lead: PostingLead): void {
    // Fetch can't read these; their boards go to Agent instead (see discoverBoards / browserOnlyBoard).
    if (lead.ats && !lead.ats.readable) return;
    if (this.markSeen(lead.key)) this.nextPostings.push(lead);
  }

  /** A board only a real browser can load: worth an Agent run if the user named the company. */
  browserOnlyBoard(ref: AtsRef, company: string | null): void {
    if (company) this.agentCandidates.push({ url: ref.boardUrl, organization: company, priority: 0 });
  }

  private addExtraction(
    extraction: Extraction,
    origin: { key: string; pageUrl: string; sourceKey: string; sourceLabel: string; foundVia: FoundViaValue; organization: string | null },
  ): number {
    this.extracted++;
    let added = 0;
    const single = extraction.pageType !== "index" && extraction.pageType !== "other";
    for (const listing of extraction.listings) {
      const organization =
        listing.organization && !/^(unknown|n\/a|none)$/i.test(listing.organization)
          ? listing.organization
          : (origin.organization ?? prettyOrg(hostOf(parseUrl(origin.pageUrl) ?? new URL("https://unknown"))));
      const canonicalUrl = single
        ? origin.key
        : ((listing.applyUrl && canonicalizeUrl(listing.applyUrl)) ??
          `${origin.key}#${normalizeText(listing.title).replace(/\s+/g, "-").slice(0, 80)}`);
      if (!listing.isOpen) {
        this.closedUrls.push(canonicalUrl);
        continue;
      }
      this.candidates.push({
        ...listing,
        organization,
        canonicalUrl,
        sourceUrl: origin.pageUrl,
        sourceLabel: origin.sourceLabel,
        foundVia: origin.foundVia,
        sourceKey: origin.sourceKey,
      });
      added++;
    }
    for (const lead of extraction.leads) {
      const key = canonicalizeUrl(lead.url);
      if (!key || this.seen.has(key)) continue;
      const ats = detectAts(lead.url);
      this.queuePosting({
        key,
        url: lead.url,
        title: lead.title,
        snippet: null,
        ats,
        organization: origin.organization,
        via: "page",
        sourceUrl: origin.pageUrl,
        sourceLabel: "Linked from a careers page",
      });
    }
    return added;
  }

  /** ATS boards linked from a careers page, e.g. a company site that links to its Greenhouse board. */
  private discoverBoards(page: FetchedPage, company: string | null): void {
    for (const link of page.links) {
      const ref = detectAts(link);
      if (!ref) continue;
      const key = `${ref.ats}:${ref.org}`;
      if (this.seenBoards.has(key)) continue;
      this.seenBoards.add(key);
      if (!ref.readable) this.browserOnlyBoard(ref, company);
      else if (ref.feedUrl || ref.ats === "workday") this.nextBoards.push({ key, ref, hits: 1, company });
    }
  }

  /** Feed of an ATS board: pick relevant openings; inline descriptions are extracted without another read. */
  async takeFeed(board: BoardLead, outcome: ReadOutcome): Promise<void> {
    const prefs = this.ctx.prefs;
    let org = board.company ?? prettyOrg(board.ref.org);
    let label = `${org} on ${ATS_LABEL[board.ref.ats]}`;
    const sourceKey = board.ref.boardUrl;
    if (!outcome.page) {
      this.ctx.noteSource(sourceKey, {
        url: board.ref.boardUrl,
        label,
        kind: "job_board",
        readMethod: "fetch",
        status: sourceStatusFor(outcome.error),
        listingsFound: 0,
        note: noteFor(outcome.error ?? "no_result"),
      });
      if (board.company) this.agentCandidates.push({ url: board.ref.boardUrl, organization: org, priority: 0 });
      return;
    }

    let postings: FeedPosting[] | null;
    if (board.ref.ats === "workday") {
      postings = workdayPostingsFromLinks(board.ref, outcome.page.links);
    } else {
      postings = parseFeed(board.ref, outcome.page);
    }
    if (!postings) {
      this.ctx.noteSource(sourceKey, {
        url: board.ref.boardUrl,
        label,
        kind: "job_board",
        readMethod: "fetch",
        status: "failed",
        listingsFound: 0,
        note: "The board's job feed was not in the expected format",
      });
      if (board.company) this.agentCandidates.push({ url: board.ref.boardUrl, organization: org, priority: 0 });
      return;
    }

    // Feeds that name the company (Greenhouse) give a better label than the board slug ("optiverus").
    const feedOrg = board.company ? null : mostCommon(postings.map((p) => p.organization));
    if (feedOrg) {
      org = feedOrg;
      label = `${org} on ${ATS_LABEL[board.ref.ats]}`;
    }
    const scope = board.ref.ats === "workday" ? `openings for "${workdayQuery(prefs)}"` : "open roles";
    const relevant = postings
      .map((p) => ({ p, rel: titleRelevance(prefs, p.title, p.description?.slice(0, 1500) ?? null, p.location) }))
      .filter(({ rel }) => isPlausibleBoardPosting(prefs, rel))
      .sort((a, b) => b.rel.score - a.rel.score)
      .slice(0, RUN_BUDGET.maxPostingsPerBoard);
    this.ctx.noteSource(sourceKey, {
      url: board.ref.boardUrl,
      label,
      kind: "job_board",
      readMethod: "fetch",
      status: postings.length ? "ok" : "empty",
      listingsFound: 0,
      note: `${postings.length} ${scope}, ${relevant.length} worth a closer look`,
    });
    await this.ctx.rec.event(
      "fetch",
      "fetch",
      `${label}: ${postings.length} ${scope}, ${relevant.length} worth a closer look`,
      board.ref.boardUrl,
    );

    const inline: Array<Promise<void>> = [];
    for (const { p } of relevant) {
      const key = canonicalizeUrl(p.url);
      if (!key || this.seen.has(key)) continue;
      const organization = p.organization ?? org;
      if (p.description && p.description.length > 200) {
        this.markSeen(key);
        inline.push(this.extractInline(key, p, organization, label, `${ATS_LABEL[board.ref.ats]} board`, sourceKey));
      } else {
        this.queuePosting({
          key,
          url: p.url,
          title: p.title,
          snippet: p.location,
          ats: detectAts(p.url),
          organization,
          via: "board",
          sourceUrl: board.ref.boardUrl,
          sourceLabel: `${ATS_LABEL[board.ref.ats]} board`,
        });
      }
    }
    await Promise.all(inline);
  }

  private async extractInline(
    key: string,
    p: FeedPosting,
    organization: string,
    label: string,
    sourceLabel: string,
    sourceKey: string,
  ): Promise<void> {
    const header = [
      `Title: ${p.title}`,
      `Organization: ${organization}`,
      p.location ? `Location: ${p.location}` : null,
      p.employmentType ? `Employment type: ${p.employmentType}` : null,
      p.postedAt ? `Posted: ${p.postedAt}` : null,
      p.remote ? "Remote: yes" : null,
    ]
      .filter(Boolean)
      .join("\n");
    const extraction = await extractPage(this.ctx, {
      key,
      pageUrl: p.url,
      title: p.title,
      text: `${header}\n\n${p.description ?? ""}`,
      links: [],
      hint: `Opening from ${label}'s public job feed`,
      cacheable: true,
    });
    if (!extraction) return;
    const added = this.addExtraction(extraction, {
      key,
      pageUrl: p.url,
      sourceKey,
      sourceLabel,
      foundVia: "fetch",
      organization,
    });
    this.ctx.addFound(sourceKey, added);
  }

  /** A single posting page (from search, a board, a careers page or Agent). */
  async takePosting(lead: PostingLead, outcome: ReadOutcome): Promise<void> {
    // Postings picked from a board or found by Agent are credited to that board or portal.
    const parentKey =
      lead.via === "board" ? lead.sourceUrl : lead.via === "agent" ? (canonicalizeUrl(lead.sourceUrl) ?? lead.sourceUrl) : null;
    const sourceKey = parentKey ?? lead.key;
    if (!outcome.page) {
      if (outcome.error === "budget" || outcome.error === NEEDS_BROWSER || parentKey) return;
      this.ctx.noteSource(lead.key, {
        url: lead.url,
        label: lead.title.slice(0, 120),
        kind: "posting",
        readMethod: "fetch",
        status: sourceStatusFor(outcome.error),
        listingsFound: 0,
        note: noteFor(outcome.error ?? "no_result"),
      });
      return;
    }
    if (outcome.page.finalUrl && /[?&]error=true/.test(outcome.page.finalUrl)) {
      // Greenhouse redirects closed postings to the board with ?error=true.
      this.closedUrls.push(lead.key);
      return;
    }
    const extraction = await extractPage(this.ctx, {
      key: lead.key,
      pageUrl: outcome.page.url,
      title: outcome.page.title,
      text: outcome.page.text,
      links: outcome.page.links,
      hint: postingHint(lead),
      cacheable: true,
    });
    const added = extraction
      ? this.addExtraction(extraction, {
          key: lead.key,
          pageUrl: outcome.page.url,
          sourceKey,
          sourceLabel: lead.sourceLabel,
          foundVia: lead.via === "agent" ? "agent" : lead.via === "search" ? "search" : "fetch",
          organization: lead.organization,
        })
      : 0;
    if (parentKey) {
      this.ctx.addFound(parentKey, added);
      return;
    }
    this.ctx.noteSource(lead.key, {
      url: lead.url,
      label: (extraction?.listings[0]?.title ?? lead.title).slice(0, 120),
      kind: "posting",
      readMethod: "fetch",
      status: added > 0 ? "ok" : "empty",
      listingsFound: added,
      note: extraction?.pageType === "closed" ? "Posting is closed" : null,
    });
  }

  /** A careers page, program page or list found by search. */
  async takePage(page: PageLead, outcome: ReadOutcome, priority: number): Promise<void> {
    const baseKind: SourceKindValue = page.intent === "programs" ? "program_page" : "careers_page";
    const label = (page.company ? `${page.company} careers` : page.title || hostOf(new URL(page.url))).slice(0, 120);
    if (!outcome.page) {
      if (outcome.error === "budget") return;
      this.ctx.noteSource(page.key, {
        url: page.url,
        label,
        kind: baseKind,
        readMethod: "fetch",
        status: sourceStatusFor(outcome.error),
        listingsFound: 0,
        note: noteFor(outcome.error ?? "no_result"),
      });
      if (page.company) this.agentCandidates.push({ url: page.url, organization: page.company, priority });
      return;
    }
    this.discoverBoards(outcome.page, page.company);
    const extraction = await extractPage(this.ctx, {
      key: page.key,
      pageUrl: outcome.page.url,
      title: outcome.page.title,
      text: outcome.page.text,
      links: outcome.page.links,
      hint: page.company ? `Careers site of ${page.company}` : `Search result: ${page.title}. ${page.snippet ?? ""}`.trim(),
      cacheable: true,
    });
    const added = extraction
      ? this.addExtraction(extraction, {
          key: page.key,
          pageUrl: outcome.page.url,
          sourceKey: page.key,
          sourceLabel: page.intent === "programs" ? "Program page" : "Careers page",
          foundVia: "fetch",
          organization: page.company,
        })
      : 0;
    const kind: SourceKindValue =
      page.intent === "programs" && extraction?.pageType === "index" ? "aggregator" : baseKind;
    const leads = extraction?.leads.length ?? 0;
    this.ctx.noteSource(page.key, {
      url: page.url,
      label,
      kind,
      readMethod: "fetch",
      status: added > 0 || leads > 0 ? "ok" : "empty",
      listingsFound: added,
      note: leads > 0 ? `${leads} links to openings followed` : null,
    });
    const nothing = !extraction || (added === 0 && leads === 0);
    if (nothing && page.company) this.agentCandidates.push({ url: page.url, organization: page.company, priority });
  }
}
