import pLimit from "p-limit";
import { and, asc, eq, inArray, lt, notInArray } from "drizzle-orm";
import { db, huntListingsTable, huntsTable, listingsTable, runsTable, type RunStatusValue } from "@workspace/db";
import { REFRESH, RUN_BUDGET } from "../lib/config";
import { logger } from "../lib/logger";
import { searchPortalWithAgent } from "./agent";
import { AiBudgetError } from "./ai";
import { Collector, NEEDS_BROWSER, rankPostings, workdayQuery } from "./collect";
import { RunContext } from "./context";
import { classifyResults, emptyDiscovered, namedCompanyFor, type BoardLead, type PostingLead } from "./discover";
import { matchListings, scoreListing } from "./match";
import { planSearches, type SearchTask } from "./plan";
import { dedupeCandidates, storeResults, storeSources, type RankedCandidate } from "./store";
import { read, search, TinyFishUnavailableError, type ReadOutcome } from "./tinyfish";
import { canonicalizeUrl, detectAts } from "./urls";

const MAX_RESULTS = 60;
const HOUR = 3_600_000;

const plural = (n: number, word: string) => {
  if (n === 1) return `${n} ${word}`;
  if (/(s|x|z|ch|sh)$/.test(word)) return `${n} ${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${n} ${word.slice(0, -1)}ies`;
  return `${n} ${word}s`;
};

function describePlan(tasks: SearchTask[]): string {
  const count = (intent: SearchTask["intent"]) => tasks.filter((t) => t.intent === intent).length;
  const parts = [
    count("company") && plural(count("company"), "company search"),
    count("ats") && plural(count("ats"), "job-board search"),
    count("web") && plural(count("web"), "open-web search"),
    count("programs") && plural(count("programs"), "research-program search"),
  ].filter(Boolean);
  return `Planned ${plural(tasks.length, "search")}: ${parts.join(", ")}`;
}

function readSummary(outcomes: ReadOutcome[]): string {
  const read = outcomes.filter((o) => o.page).length;
  const attempted = outcomes.filter((o) => o.error !== NEEDS_BROWSER);
  const blocked = attempted.filter((o) => !o.page && o.error && /block|captcha|403/i.test(o.error)).length;
  const failed = attempted.filter((o) => !o.page && o.error !== "budget").length - blocked;
  const extras = [blocked && `${blocked} blocked`, failed > 0 && `${failed} failed`].filter(Boolean);
  return `Read ${plural(read, "page")} with Fetch${extras.length ? ` (${extras.join(", ")})` : ""}`;
}

async function readBoards(ctx: RunContext, collector: Collector, boards: BoardLead[]): Promise<void> {
  const withFeed = boards.filter((b) => b.ref.feedUrl);
  const workday = boards.filter((b) => b.ref.ats === "workday");
  // Workday has no feed; its search page lists 20 postings, so filter it to the seeker's level or role.
  const query = workdayQuery(ctx.prefs);
  const workdayUrl = (b: BoardLead) => `${b.ref.boardUrl}?q=${encodeURIComponent(query)}`;
  const [feedReads, workdayReads] = await Promise.all([
    read(ctx, withFeed.map((b) => b.ref.feedUrl as string), {
      links: false,
      ttlSeconds: 6 * 3600,
      purpose: "Read a company's public job board feed to list its open positions",
    }),
    read(ctx, workday.map(workdayUrl), {
      links: true,
      ttlSeconds: 6 * 3600,
      purpose: "List open positions on a company's Workday job board",
    }),
  ]);
  const byUrl = new Map([...feedReads, ...workdayReads].map((o) => [o.url, o]));
  await Promise.all(
    [...withFeed, ...workday].map((board) => {
      const outcome = byUrl.get(board.ref.feedUrl ?? workdayUrl(board));
      return outcome && outcome.error !== "budget" ? collector.takeFeed(board, outcome) : Promise.resolve();
    }),
  );
}

async function readPostings(ctx: RunContext, collector: Collector, leads: PostingLead[]): Promise<ReadOutcome[]> {
  if (leads.length === 0) return [];
  const readable = leads.filter((l) => l.ats?.readable !== false);
  const outcomes = [
    ...(await read(
      ctx,
      readable.map((l) => l.url),
      { links: true, ttlSeconds: 24 * 3600, purpose: "Read a job or program posting to extract its details" },
    )),
    ...leads.filter((l) => l.ats?.readable === false).map((l) => ({ url: l.url, page: null, error: NEEDS_BROWSER })),
  ];
  const byUrl = new Map(outcomes.map((o) => [o.url, o]));
  await Promise.all(
    leads.map((lead) => {
      const outcome = byUrl.get(lead.url);
      return outcome ? collector.takePosting(lead, outcome) : Promise.resolve();
    }),
  );
  return outcomes;
}

const CLOSED_TEXT =
  /(no longer (accepting|available|open|active)|position (has been |is )?filled|(job|posting|position|vacancy) (has )?(expired|closed)|applications? (are |is )?(now )?closed|not accepting applications|page (was )?not found|job not found)/i;

/** Re-reads listings this hunt showed before but didn't see this run, and marks closed ones. */
async function recheckOldListings(ctx: RunContext, seenKeys: string[]): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * HOUR);
  const conditions = [
    eq(huntListingsTable.huntId, ctx.hunt.id),
    eq(listingsTable.status, "open"),
    lt(listingsTable.lastCheckedAt, cutoff),
  ];
  if (seenKeys.length) conditions.push(notInArray(listingsTable.canonicalUrl, seenKeys));
  const stale = await db
    .select({ id: listingsTable.id, url: listingsTable.sourceUrl })
    .from(huntListingsTable)
    .innerJoin(listingsTable, eq(listingsTable.id, huntListingsTable.listingId))
    .where(and(...conditions))
    .orderBy(asc(listingsTable.lastCheckedAt))
    .limit(RUN_BUDGET.maxRechecks);
  if (stale.length === 0) return;

  const outcomes = await read(
    ctx,
    stale.map((s) => s.url),
    { links: false, ttlSeconds: 3600, purpose: "Check whether a job posting is still open" },
  );
  const byUrl = new Map(outcomes.map((o) => [o.url, o]));
  const closed: number[] = [];
  const stillOpen: number[] = [];
  for (const s of stale) {
    const o = byUrl.get(s.url);
    if (!o || o.error === "budget") continue;
    const gone = o.page
      ? CLOSED_TEXT.test(o.page.text.slice(0, 6000)) || /[?&]error=true/.test(o.page.finalUrl ?? "")
      : /404|410|not.?found|gone/i.test(o.error ?? "");
    if (gone) closed.push(s.id);
    else if (o.page) stillOpen.push(s.id);
  }
  const now = new Date();
  if (closed.length) {
    await db.update(listingsTable).set({ status: "closed", lastCheckedAt: now }).where(inArray(listingsTable.id, closed));
  }
  if (stillOpen.length) {
    await db.update(listingsTable).set({ lastCheckedAt: now }).where(inArray(listingsTable.id, stillOpen));
  }
  await ctx.rec.event(
    "fetch",
    "fetch",
    `Re-checked ${plural(stale.length, "older listing")}: ${closed.length} closed since last time`,
  );
}

async function pipeline(ctx: RunContext): Promise<void> {
  const prefs = ctx.prefs;
  const collector = new Collector(ctx);

  // 1. Plan and search.
  const tasks = planSearches(prefs).slice(0, ctx.budget.searches);
  await ctx.rec.event("plan", "system", describePlan(tasks));

  const found = emptyDiscovered();
  let searchFailures = 0;
  const searchSlots = pLimit(4);
  await Promise.all(
    tasks.map((task) =>
      searchSlots(async () => {
        if (ctx.shouldStop()) return;
        try {
          const results = await search(ctx, task);
          if (!results) return;
          classifyResults(found, task, results);
          await ctx.rec.event("search", "search", `Searched ${task.label}: "${task.query}" → ${plural(results.length, "result")}`);
        } catch (err) {
          if (err instanceof TinyFishUnavailableError) throw err;
          searchFailures++;
          logger.warn({ err, query: task.query }, "Search failed");
          await ctx.rec.event("warning", "search", `Search failed: "${task.query}"`);
        }
      }),
    ),
  );
  if (tasks.length > 0 && searchFailures === tasks.length) throw new Error("Every search failed");
  if (searchFailures > 0) ctx.problems.push("search");
  await ctx.rec.event(
    "search",
    "system",
    `Spotted ${plural(found.postings.size, "posting")}, ${plural(found.boards.size, "company job board")} and ${plural(found.pages.size, "careers or program page")}`,
  );
  if (ctx.shouldStop()) return;

  // 2. First wave of reads: board feeds, postings from search, careers and program pages.
  const allBoards = [...found.boards.values()];
  for (const b of allBoards) {
    // Boards of named companies can also turn up in general searches.
    b.company ??= namedCompanyFor(b.ref, prefs.companies);
    collector.seenBoards.add(b.key);
    if (!b.ref.readable) collector.browserOnlyBoard(b.ref, b.company);
  }
  // Boards of companies the seeker named come first, then the ones search pointed at most often.
  const boards = allBoards
    .filter((b) => b.ref.readable)
    .sort((a, b) => Number(b.company !== null) - Number(a.company !== null) || b.hits - a.hits)
    .slice(0, RUN_BUDGET.maxBoards);
  const searchPostings = rankPostings(
    prefs,
    [...found.postings.values()].filter((p) => p.ats?.readable !== false),
  ).slice(0, 15);
  for (const p of searchPostings) collector.markSeen(p.key);
  const pageOrder = { company: 0, programs: 1, web: 2, ats: 3 } as const;
  const pages = [...found.pages.values()].sort((a, b) => pageOrder[a.intent] - pageOrder[b.intent]).slice(0, 10);
  for (const p of pages) collector.markSeen(p.key);

  const [, postingReads, pageReads] = await Promise.all([
    readBoards(ctx, collector, boards),
    readPostings(ctx, collector, searchPostings),
    read(ctx, pages.map((p) => p.url), {
      links: true,
      ttlSeconds: 12 * 3600,
      purpose: "Read a careers or program page to find open positions and their details",
    }).then(async (outcomes) => {
      const byUrl = new Map(outcomes.map((o) => [o.url, o]));
      await Promise.all(
        pages.map((page, i) => {
          const outcome = byUrl.get(page.url);
          return outcome ? collector.takePage(page, outcome, i) : Promise.resolve();
        }),
      );
      return outcomes;
    }),
  ]);
  await ctx.rec.event("fetch", "fetch", readSummary([...postingReads, ...pageReads]));
  await ctx.rec.event(
    "extract",
    "ai",
    `AI read ${plural(collector.extracted, "page")}: ${plural(collector.candidates.length, "opening")} so far, ${plural(collector.nextPostings.length, "link")} to follow`,
  );

  // 3. Second wave: postings picked from boards, links found on careers pages, boards linked from careers pages.
  if (!ctx.pastSoftDeadline() && !ctx.shouldStop()) {
    const wave = rankPostings(prefs, collector.nextPostings.splice(0)).slice(0, RUN_BUDGET.maxPostingsPerBoard * 3);
    const newBoards = collector.nextBoards.splice(0, 4);
    const before = collector.candidates.length;
    const [reads] = await Promise.all([readPostings(ctx, collector, wave), readBoards(ctx, collector, newBoards)]);
    if (reads.length) {
      await ctx.rec.event("fetch", "fetch", readSummary(reads));
      await ctx.rec.event("extract", "ai", `AI found ${plural(collector.candidates.length - before, "more opening")}`);
    }
  }

  // 4. Agent: careers portals Fetch couldn't read, for companies the user named.
  const agentLeads: PostingLead[] = [];
  const agentTargets = collector.agentCandidates
    .sort((a, b) => a.priority - b.priority)
    .filter((c, i, all) => all.findIndex((x) => x.organization === c.organization) === i)
    .slice(0, RUN_BUDGET.maxAgentRuns);
  if (agentTargets.length && !ctx.pastSoftDeadline() && !ctx.shouldStop()) {
    const results = await Promise.all(
      agentTargets.map(async (target) => ({
        target,
        openings: await searchPortalWithAgent(ctx, target.url, target.organization),
      })),
    );
    for (const { target, openings } of results) {
      if (!openings) {
        ctx.problems.push("agent");
        continue;
      }
      ctx.noteSource(canonicalizeUrl(target.url) ?? target.url, {
        url: target.url,
        label: `${target.organization} careers`,
        kind: "careers_page",
        readMethod: "agent",
        status: openings.length ? "ok" : "empty",
        listingsFound: 0,
        note: `Agent found ${plural(openings.length, "matching opening")}`,
      });
      for (const o of openings) {
        const key = canonicalizeUrl(o.url);
        if (!key || !collector.markSeen(key)) continue;
        agentLeads.push({
          key,
          url: o.url,
          title: o.title,
          snippet: o.location,
          ats: detectAts(o.url),
          organization: target.organization,
          via: "agent",
          sourceUrl: target.url,
          sourceLabel: "Found by Agent",
        });
      }
    }
  }

  // 5. Third wave: openings Agent found, plus postings picked from boards discovered in wave two.
  const remaining = ctx.pastSoftDeadline() ? [] : rankPostings(prefs, collector.nextPostings.splice(0)).slice(0, 6);
  if ((agentLeads.length || remaining.length) && !ctx.shouldStop()) {
    const reads = await readPostings(ctx, collector, [...agentLeads, ...remaining]);
    if (reads.length) await ctx.rec.event("fetch", "fetch", readSummary(reads));
    // Openings Agent saw whose pages Fetch then couldn't read are kept, marked unverified.
    const unread = new Set(reads.filter((r) => !r.page).map((r) => r.url));
    for (const lead of agentLeads.filter((l) => unread.has(l.url))) {
      collector.candidates.push({
        title: lead.title,
        organization: lead.organization ?? "Unknown",
        kind: "job",
        locations: lead.snippet ? [lead.snippet] : [],
        workMode: "unknown",
        seniority: "unknown",
        employmentType: null,
        postedAt: null,
        deadline: null,
        visa: { status: "unknown", note: null },
        funding: { level: "unknown", stipend: null, travel: null, housing: null, note: null },
        eligibility: null,
        summary: null,
        isOpen: true,
        applyUrl: lead.url,
        canonicalUrl: lead.key,
        sourceUrl: lead.sourceUrl,
        sourceLabel: lead.sourceLabel,
        foundVia: "agent",
        sourceKey: canonicalizeUrl(lead.sourceUrl),
      });
    }
  }

  // 6. Freshness: re-read listings shown before but not seen in this run.
  const closed = new Set(collector.closedUrls);
  const candidates = dedupeCandidates(collector.candidates.filter((c) => !closed.has(c.canonicalUrl)));
  if (!ctx.shouldStop()) {
    await recheckOldListings(ctx, candidates.map((c) => c.canonicalUrl));
  }
  if (closed.size) {
    await db.update(listingsTable).set({ status: "closed", lastCheckedAt: new Date() }).where(inArray(listingsTable.canonicalUrl, [...closed]));
  }

  // 7. Match, score, store.
  if (ctx.rec.isDeleted) return;
  const verdicts = await matchListings(prefs, candidates);
  const today = new Date().toISOString().slice(0, 10);
  const ranked: RankedCandidate[] = [];
  candidates.forEach((c, i) => {
    const verdict = verdicts[i];
    if (!verdict) return;
    const scored = scoreListing(prefs, c, verdict, today);
    if (scored.keep) ranked.push({ ...c, score: scored.score, reasons: scored.reasons });
  });
  ranked.sort((a, b) => b.score - a.score);
  const kept = ranked.slice(0, MAX_RESULTS);
  await ctx.rec.event("match", "ai", `Ranked ${plural(candidates.length, "opening")} against your preferences; kept ${kept.length}`);

  // Credit each source with the listings it contributed that made the final cut.
  const keptBySource = new Map<string, number>();
  for (const c of kept) if (c.sourceKey) keptBySource.set(c.sourceKey, (keptBySource.get(c.sourceKey) ?? 0) + 1);
  for (const [key, source] of ctx.sources) source.listingsFound = keptBySource.get(key) ?? 0;
  const newCount = await storeResults(ctx, kept);
  await storeSources(ctx);
  ctx.rec.bump({ listingsFound: kept.length, newListings: newCount });
  await ctx.rec.event("done", "system", `Done: ${plural(kept.length, "opening")}, ${newCount} new`);
}

function userMessage(err: unknown): string {
  if (err instanceof TinyFishUnavailableError) {
    return "Scout couldn't reach TinyFish (the service it uses to search and read the web). Try again later.";
  }
  if (err instanceof AiBudgetError) return "Scout has used today's reading budget. Try again tomorrow.";
  return "Something went wrong during this search. Try again in a few minutes.";
}

/** Executes one claimed run end to end. Never throws. */
export async function executeRun(runId: number): Promise<void> {
  const [run] = await db.select().from(runsTable).where(eq(runsTable.id, runId));
  if (!run) return;
  const [hunt] = await db.select().from(huntsTable).where(eq(huntsTable.id, run.huntId));
  if (!hunt) return;

  const ctx = new RunContext(runId, hunt, run.reviewer);
  let status: RunStatusValue = "completed";
  let error: string | null = null;
  try {
    await pipeline(ctx);
    if (ctx.problems.length > 0) status = "partial";
  } catch (err) {
    status = "failed";
    error = userMessage(err);
    logger.error({ err, runId }, "Run failed");
    await ctx.rec.event("error", "system", error);
  }
  if (ctx.rec.isDeleted) return;

  try {
    await db
      .update(runsTable)
      .set({ status, finishedAt: new Date(), stats: ctx.rec.stats, error })
      .where(eq(runsTable.id, runId));
    const hours = status === "failed" ? REFRESH.retryAfterFailureHours : hunt.showcaseKey ? REFRESH.showcaseHours : REFRESH.userHours;
    await db
      .update(huntsTable)
      .set({
        nextRefreshAt: new Date(Date.now() + hours * HOUR),
        ...(status === "failed" ? {} : { lastRunAt: new Date() }),
      })
      .where(eq(huntsTable.id, hunt.id));
  } catch (err) {
    logger.error({ err, runId }, "Could not record run result");
  }
}
