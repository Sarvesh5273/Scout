import {
  TinyFish,
  RunStatus,
  BrowserProfile,
  RateLimitError,
  type CompleteEvent,
  type FetchError,
  type OutputSchema,
  type RunError,
  type SearchResult,
} from "@tiny-fish/sdk";

export { RateLimitError };
export type { FetchError, OutputSchema, RunError, SearchResult };

/** Published Agent price (pricing page, Oct 2026). Estimates only; the wallet is the source of truth. */
export const AGENT_STEP_COST_USD = 0.016;

/** TinyFish allows 2 concurrent Agent runs per account; extra runs queue here instead of failing. */
const AGENT_CONCURRENCY = 2;

/** Client timeouts follow the "Expected Latency" table in the TinyFish docs. */
const SEARCH_TIMEOUT_MS = 15_000;
const FETCH_TIMEOUT_MS = 150_000;
const AGENT_TIMEOUT_MS = 300_000;

/**
 * Phrases the docs list as signs that a COMPLETED run did not achieve its goal.
 * Only top-level string fields are scanned, so role titles in nested arrays can't trigger it.
 */
const FAILURE_SIGNAL = /\b(captcha|access denied|blocked|verify you are human)\b/i;

export interface SearchOptions {
  /** Why we're searching; TinyFish uses it to improve ranking. */
  purpose?: string;
  location?: string;
  language?: string;
  /** Restrict results to these domains (e.g. ATS hosts). */
  includeDomains?: string[];
  excludeDomains?: string[];
}

export interface SearchOutcome {
  results: SearchResult[];
  ms: number;
}

export interface FetchOptions {
  /** 0 forces a live fetch; omit to accept TinyFish's default cache. */
  ttl?: number;
  purpose?: string;
  links?: boolean;
  /** Per-URL budget; a slow URL becomes a per-URL timeout error instead of blocking the batch. */
  perUrlTimeoutMs?: number;
  /** "json" returns the page as a JSON object in `json` (used for public ATS feeds). */
  format?: "markdown" | "json";
}

export interface FetchedPage {
  url: string;
  finalUrl: string | null;
  title: string | null;
  /** Markdown text; empty for `format: "json"`. */
  text: string;
  /** Parsed body for `format: "json"`; null otherwise. */
  json: Record<string, unknown> | null;
  links: string[];
}

export interface FetchOutcome {
  pages: FetchedPage[];
  /** Per-URL failures, e.g. `bot_blocked`. A failed URL never appears in `pages`. */
  errors: FetchError[];
  ms: number;
}

export interface AgentTask {
  url: string;
  goal: string;
  /** Required: an uncapped run can use the full 150-step default (~$2.40). */
  maxDurationSeconds: number;
  /** Hard step cap; bounds the cost at maxSteps x AGENT_STEP_COST_USD. */
  maxSteps?: number;
  /**
   * JSON Schema subset. Allowed keywords: type, properties, required, propertyOrdering, items,
   * minItems, maxItems, enum, format, minimum, maximum, nullable, anyOf. Anything else
   * (description, additionalProperties, const, oneOf, ...) is rejected with a 400 before the run.
   * Put field guidance in the goal text instead.
   */
  outputSchema?: OutputSchema;
  stealth?: boolean;
  /** Called once with the live browser URL (used for demo footage). */
  onStreamingUrl?: (url: string) => void;
}

export interface AgentOutcome {
  /** True only if the run COMPLETED and the result carries no failure signal. */
  ok: boolean;
  status: RunStatus | "NO_COMPLETE_EVENT";
  runId: string | null;
  result: Record<string, unknown> | null;
  error: RunError | null;
  /** Why `ok` is false; null when ok. */
  failureReason: string | null;
  steps: number | null;
  seconds: number;
  estimatedCostUsd: number | null;
  streamingUrl: string | null;
}

export interface WalletBalance {
  available: number;
  currency: string;
}

class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active < this.max) {
      this.active++;
    } else {
      // The releasing task hands its slot straight to us, so `active` is unchanged.
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    try {
      return await fn();
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    }
  }
}

export class TinyFishClient {
  private readonly searchClient: TinyFish;
  private readonly fetchClient: TinyFish;
  private readonly agentClient: TinyFish;
  private readonly agentSlots = new Semaphore(AGENT_CONCURRENCY);

  constructor(apiKey: string) {
    this.searchClient = new TinyFish({ apiKey, timeout: SEARCH_TIMEOUT_MS });
    this.fetchClient = new TinyFish({ apiKey, timeout: FETCH_TIMEOUT_MS });
    this.agentClient = new TinyFish({ apiKey, timeout: AGENT_TIMEOUT_MS });
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchOutcome> {
    const started = Date.now();
    const { includeDomains, excludeDomains, ...rest } = options;
    const response = await this.searchClient.search.query({
      query,
      ...rest,
      ...(includeDomains?.length ? { include_domains: includeDomains.join(",") } : {}),
      ...(excludeDomains?.length ? { exclude_domains: excludeDomains.join(",") } : {}),
    });
    return { results: response.results, ms: Date.now() - started };
  }

  async fetch(urls: string[], options: FetchOptions = {}): Promise<FetchOutcome> {
    const started = Date.now();
    const { perUrlTimeoutMs, format = "markdown", ...rest } = options;
    const response = await this.fetchClient.fetch.getContents({
      urls,
      format,
      ...rest,
      ...(perUrlTimeoutMs ? { per_url_timeout_ms: perUrlTimeoutMs } : {}),
    });
    const pages = response.results.map((page): FetchedPage => {
      const body: unknown = "text" in page ? page.text : null;
      return {
        url: page.url,
        finalUrl: page.final_url,
        title: page.title,
        text: typeof body === "string" ? body : "",
        json: body !== null && typeof body === "object" ? (body as Record<string, unknown>) : null,
        links: page.links ?? [],
      };
    });
    return { pages, errors: response.errors, ms: Date.now() - started };
  }

  async runAgent(task: AgentTask): Promise<AgentOutcome> {
    return this.agentSlots.run(() => this.runAgentNow(task));
  }

  async getWalletBalance(): Promise<WalletBalance> {
    const wallet = await this.agentClient.wallet.get();
    return { available: Number(wallet.available_balance), currency: wallet.currency };
  }

  private async runAgentNow(task: AgentTask): Promise<AgentOutcome> {
    const started = Date.now();
    let runId: string | null = null;
    let streamingUrl: string | null = null;
    let complete: CompleteEvent | null = null;

    const stream = await this.agentClient.agent.stream(
      {
        url: task.url,
        goal: task.goal,
        agent_config: {
          max_duration_seconds: task.maxDurationSeconds,
          ...(task.maxSteps ? { max_steps: task.maxSteps } : {}),
        },
        ...(task.outputSchema ? { output_schema: task.outputSchema } : {}),
        ...(task.stealth ? { browser_profile: BrowserProfile.STEALTH } : {}),
      },
      // Local backstop in case the server-side duration cap is not honoured.
      { signal: AbortSignal.timeout((task.maxDurationSeconds + 90) * 1000) },
    );

    try {
      for await (const event of stream) {
        if (event.type === "STARTED") {
          runId = event.run_id;
        } else if (event.type === "STREAMING_URL" && streamingUrl === null) {
          streamingUrl = event.streaming_url;
          task.onStreamingUrl?.(event.streaming_url);
        } else if (event.type === "COMPLETE") {
          runId = event.run_id;
          complete = event;
        }
      }
    } finally {
      await stream.close();
    }

    const steps = runId ? await this.getSteps(runId) : null;
    const failureReason = judgeRun(complete);
    return {
      ok: failureReason === null,
      status: complete?.status ?? "NO_COMPLETE_EVENT",
      runId,
      result: complete?.result ?? null,
      error: complete?.error ?? null,
      failureReason,
      steps,
      seconds: Math.round((Date.now() - started) / 100) / 10,
      estimatedCostUsd: steps === null ? null : round2(steps * AGENT_STEP_COST_USD),
      streamingUrl,
    };
  }

  /** The COMPLETE event has no step count, so read it from the run record. */
  private async getSteps(runId: string): Promise<number | null> {
    try {
      const run = await this.agentClient.runs.get(runId);
      return run.num_of_steps;
    } catch {
      return null;
    }
  }
}

/** Returns why a run should be treated as failed, or null if it succeeded. */
export function judgeRun(complete: CompleteEvent | null): string | null {
  if (!complete) return "stream ended without a COMPLETE event";
  if (complete.status !== RunStatus.COMPLETED) {
    return complete.error?.message ?? `run ended with status ${complete.status}`;
  }
  const result = complete.result;
  if (!result) return "run completed with an empty result";
  if (result["success"] === false) {
    const reason = result["failure_reason"];
    return typeof reason === "string" && reason ? reason : "agent reported success=false";
  }
  for (const value of Object.values(result)) {
    if (typeof value === "string") {
      const match = FAILURE_SIGNAL.exec(value);
      if (match) return `result mentions "${match[0]}"`;
    }
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Builds a client from TINYFISH_API_KEY. Throws if the key is missing. */
export function createTinyFishFromEnv(): TinyFishClient {
  const apiKey = process.env["TINYFISH_API_KEY"];
  if (!apiKey) {
    throw new Error("TINYFISH_API_KEY is not set. Add it in Replit Secrets.");
  }
  return new TinyFishClient(apiKey);
}
