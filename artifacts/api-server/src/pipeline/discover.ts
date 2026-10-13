import type { SearchResult } from "@workspace/tinyfish";
import type { SearchTask } from "./plan";
import { baseDomain, canonicalizeUrl, detectAts, hostOf, isExcluded, normalizeText, parseUrl, type AtsRef } from "./urls";

export interface PostingLead {
  key: string;
  url: string;
  title: string;
  snippet: string | null;
  ats: AtsRef | null;
  organization: string | null;
  /** How the posting was found, for the source label. */
  via: "search" | "board" | "page" | "agent";
  sourceUrl: string;
  sourceLabel: string;
}

export interface BoardLead {
  key: string;
  ref: AtsRef;
  /** Search hits pointing at this board; more hits means more relevant. */
  hits: number;
  company: string | null;
}

export interface PageLead {
  key: string;
  url: string;
  title: string;
  snippet: string | null;
  intent: SearchTask["intent"];
  company: string | null;
}

export interface Discovered {
  postings: Map<string, PostingLead>;
  boards: Map<string, BoardLead>;
  pages: Map<string, PageLead>;
}

export function emptyDiscovered(): Discovered {
  return { postings: new Map(), boards: new Map(), pages: new Map() };
}

const CAREERS_HINT = /(career|jobs?|join|work-with-us|opportunit|vacanc|recruit|hiring|position|intern|students?|graduate|university|early-?career)/i;
const PROGRAM_HINT = /(program|programme|intern|fellow|scholar|research|summer|reu|exchange|visiting|student)/i;

/**
 * The named company an ATS board belongs to, judged by its slug ("optiverus" is Optiver's). Search results
 * for one company can include other employers' boards, so the slug has to match.
 */
export function namedCompanyFor(ats: AtsRef, companies: string[]): string | null {
  const slug = ats.org.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const company of companies) {
    const token = normalizeText(company).replace(/\s+/g, "");
    if (token && (slug.includes(token) || (slug.length >= 4 && token.includes(slug)))) return company;
  }
  return null;
}

/** Sorts search results into ATS postings, ATS boards and other pages worth reading. */
export function classifyResults(found: Discovered, task: SearchTask, results: SearchResult[]): void {
  let pagesTaken = 0;
  const pageCap = task.intent === "company" ? 2 : task.intent === "programs" ? 4 : 3;
  const companyToken = task.company ? normalizeText(task.company).replace(/\s+/g, "") : null;
  const companyFor = (ats: AtsRef) => namedCompanyFor(ats, task.company ? [task.company] : []);

  for (const result of results) {
    const url = parseUrl(result.url);
    if (!url || isExcluded(url)) continue;
    const ats = detectAts(url.toString());

    if (ats) {
      const boardKey = `${ats.ats}:${ats.org}`;
      const board = found.boards.get(boardKey);
      const company = companyFor(ats);
      if (board) {
        board.hits++;
        board.company ??= company;
      } else {
        found.boards.set(boardKey, { key: boardKey, ref: ats, hits: 1, company });
      }

      if (ats.postingUrl && !found.postings.has(ats.postingUrl)) {
        found.postings.set(ats.postingUrl, {
          key: ats.postingUrl,
          url: ats.postingUrl,
          title: result.title,
          snippet: result.snippet ?? null,
          ats,
          organization: company,
          via: "search",
          sourceUrl: ats.postingUrl,
          sourceLabel: "Search result",
        });
      }
      continue;
    }

    if (pagesTaken >= pageCap) continue;
    const key = canonicalizeUrl(url.toString());
    if (!key || found.pages.has(key) || found.postings.has(key)) continue;
    const pathAndTitle = `${url.pathname} ${result.title}`;
    if (task.intent === "company") {
      const host = hostOf(url).replace(/[^a-z0-9]/g, "");
      const ownSite = companyToken !== null && host.includes(companyToken);
      if (!ownSite && !CAREERS_HINT.test(pathAndTitle)) continue;
    } else if (task.intent === "programs") {
      if (!PROGRAM_HINT.test(pathAndTitle) && !PROGRAM_HINT.test(result.snippet ?? "")) continue;
    } else if (!CAREERS_HINT.test(pathAndTitle)) {
      continue;
    }
    // Keep sources diverse: at most two pages per site across the whole run.
    const site = baseDomain(hostOf(url));
    const sameSite = [...found.pages.values()].filter((p) => {
      const u = parseUrl(p.url);
      return u !== null && baseDomain(hostOf(u)) === site;
    }).length;
    if (sameSite >= 2) continue;

    found.pages.set(key, {
      key,
      url: url.toString(),
      title: result.title,
      snippet: result.snippet ?? null,
      intent: task.intent,
      company: task.company ?? null,
    });
    pagesTaken++;
  }
}
