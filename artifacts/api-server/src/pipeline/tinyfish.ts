import pLimit from "p-limit";
import {
  createTinyFishFromEnv,
  type AgentOutcome,
  type AgentTask,
  type FetchedPage,
  type SearchResult,
  type TinyFishClient,
} from "@workspace/tinyfish";
import { LIMITS } from "../lib/config";
import { addUsage, fetchUrlsLeftToday, heldForReviewers } from "../lib/usage";
import { canonicalizeUrl } from "./urls";
import type { RunContext } from "./context";
import { WindowLimiter } from "./limiter";

let client: TinyFishClient | null = null;
function tinyfish(): TinyFishClient {
  client ??= createTinyFishFromEnv();
  return client;
}

const searchLimiter = new WindowLimiter(LIMITS.searchesPerMinute);
const fetchLimiter = new WindowLimiter(LIMITS.fetchUrlsPerMinute);
/** Fetch batches in flight across all runs. */
const fetchSlots = pLimit(4);

const FETCH_BATCH = 10; // TinyFish Fetch accepts up to 10 URLs per request
const PER_URL_TIMEOUT_MS = 45_000;

export class TinyFishUnavailableError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

function statusOf(err: unknown): number | null {
  const e = err as { status?: unknown; statusCode?: unknown } | null;
  const s = e?.status ?? e?.statusCode;
  return typeof s === "number" ? s : null;
}

/** Auth and account problems fail the whole run; other errors only fail the one call. */
function rethrowIfFatal(err: unknown): void {
  const status = statusOf(err);
  const message = err instanceof Error ? err.message : String(err);
  if (status === 401 || status === 402 || status === 403 || /invalid or expired api key|insufficient/i.test(message)) {
    throw new TinyFishUnavailableError(message, status);
  }
}

export interface SearchCall {
  query: string;
  purpose: string;
  includeDomains?: string[];
  excludeDomains?: string[];
}

/** One TinyFish Search call, counted against the run and the shared per-minute limit. Null if over budget. */
export async function search(ctx: RunContext, call: SearchCall): Promise<SearchResult[] | null> {
  if (ctx.budget.searches <= 0) return null;
  ctx.budget.searches--;
  await searchLimiter.take();
  try {
    const out = await tinyfish().search(call.query, {
      purpose: call.purpose,
      ...(call.includeDomains ? { includeDomains: call.includeDomains } : {}),
      ...(call.excludeDomains ? { excludeDomains: call.excludeDomains } : {}),
    });
    ctx.rec.bump({ searches: 1 });
    await addUsage({ searches: 1 });
    return out.results;
  } catch (err) {
    rethrowIfFatal(err);
    ctx.rec.bump({ searches: 1 });
    await addUsage({ searches: 1 });
    throw err;
  }
}

export interface ReadOutcome {
  url: string;
  page: FetchedPage | null;
  /** TinyFish per-URL error code (e.g. bot_blocked), "budget" if skipped, or a request error message. */
  error: string | null;
}

export interface ReadOptions {
  links: boolean;
  /** Accept TinyFish's cached copy if younger than this. */
  ttlSeconds: number;
  purpose: string;
}

/**
 * Reads URLs with TinyFish Fetch in batches of 10. Respects the run's URL budget, the daily free-tier cap
 * and the shared per-minute limit. Never throws for per-URL problems; they come back as `error`.
 */
export async function read(ctx: RunContext, urls: string[], options: ReadOptions): Promise<ReadOutcome[]> {
  const unique = [...new Set(urls)];
  const leftToday = Math.max(0, (await fetchUrlsLeftToday()) - heldForReviewers(ctx.reviewer).fetchUrls);
  // No await between reading and reserving the run budget, so parallel reads in one run can't overspend it.
  const allowed = Math.max(0, Math.min(unique.length, ctx.budget.fetchUrls, leftToday));
  ctx.budget.fetchUrls -= allowed;
  const toRead = unique.slice(0, allowed);
  const results: ReadOutcome[] = unique.slice(allowed).map((url) => ({ url, page: null, error: "budget" }));

  const batches: string[][] = [];
  for (let i = 0; i < toRead.length; i += FETCH_BATCH) batches.push(toRead.slice(i, i + FETCH_BATCH));

  const batchResults = await Promise.all(
    batches.map((batch) =>
      fetchSlots(async (): Promise<ReadOutcome[]> => {
        await fetchLimiter.take(batch.length);
        await addUsage({ fetchUrls: batch.length });
        try {
          const out = await tinyfish().fetch(batch, {
            links: options.links,
            ttl: options.ttlSeconds,
            purpose: options.purpose,
            perUrlTimeoutMs: PER_URL_TIMEOUT_MS,
          });
          const byKey = new Map<string, FetchedPage>();
          for (const page of out.pages) {
            byKey.set(page.url, page);
            const key = canonicalizeUrl(page.url);
            if (key) byKey.set(key, page);
          }
          const errors = new Map<string, string>();
          for (const e of out.errors) {
            errors.set(e.url, e.error);
            const key = canonicalizeUrl(e.url);
            if (key) errors.set(key, e.error);
          }
          ctx.rec.bump({ pagesRead: out.pages.length });
          return batch.map((url) => {
            const key = canonicalizeUrl(url) ?? url;
            const page = byKey.get(url) ?? byKey.get(key) ?? null;
            const error = page ? null : (errors.get(url) ?? errors.get(key) ?? "no_result");
            return { url, page, error };
          });
        } catch (err) {
          rethrowIfFatal(err);
          const message = statusOf(err) === 429 ? "rate_limited" : "request_failed";
          return batch.map((url) => ({ url, page: null, error: message }));
        }
      }),
    ),
  );
  for (const r of batchResults) results.push(...r);
  return results;
}

/** Runs a TinyFish Agent task (browser automation). The client queues beyond TinyFish's concurrency limit. */
export async function runAgent(task: AgentTask): Promise<AgentOutcome> {
  try {
    return await tinyfish().runAgent(task);
  } catch (err) {
    rethrowIfFatal(err);
    throw err;
  }
}
