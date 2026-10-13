/** Model used for page extraction and match scoring (Replit AI Integrations, OpenAI-compatible). */
export const AI_MODEL = "gpt-5.6-luna";

/** OpenAI list price for AI_MODEL in USD per million tokens (developers.openai.com, checked Oct 7, 2026). */
export const AI_PRICE_PER_MILLION_TOKENS = { input: 0.2, cachedInput: 0.02, output: 1.2 } as const;

/** Abuse and cost guards. Scout is public and anonymous, so every expensive path is capped. */
export const LIMITS = {
  maxHuntsPerClient: 6,
  manualRunsPerClientPerHour: 6,
  /**
   * Browser ids are free to mint, so manual searches are also capped across everyone. Sized so a burst of
   * visitors (e.g. after a social post) doesn't lock out a reviewer for the rest of the hour.
   */
  manualRunsPerHour: 20,
  /** Global ceiling on AI spend per UTC day (~50 measured runs); this is billed to the owner's Replit credits. */
  dailyAiBudgetUsd: 1,
  /** Manual runs are refused once less than this much of today's AI budget remains (a measured run cost ~$0.014). */
  aiBudgetReservedPerRunUsd: 0.05,
  maxConcurrentRuns: 2,
  maxQueuedRuns: 8,
  /** Global ceiling on TinyFish Agent spend per UTC day (estimated from steps). */
  dailyAgentBudgetUsd: 1.5,
  /** TinyFish Fetch is free up to 1,000 URLs per day; stay under it. */
  dailyFetchUrlCap: 900,
  /** Manual runs are refused once fewer than this many Fetch URLs remain today. */
  fetchUrlsReservedPerRun: 40,
  dailyAiCallCap: 3000,
  /** TinyFish defaults per API key: Search 30 requests/min, Fetch 150 URLs/min. */
  searchesPerMinute: 25,
  fetchUrlsPerMinute: 120,
  /** Browsers with a reviewer pass skip the shared hourly cap and get roomier per-browser limits. */
  reviewerRunsPerHour: 12,
  maxHuntsPerReviewer: 12,
} as const;

/**
 * Held back from each daily budget for reviewers, who open Scout through a private pass link (see
 * lib/reviewer-pass.ts), so a burst of public visitors can't lock them out. Public searches and scheduled
 * refreshes stop short of it. Sized for about six searches, two of them with an Agent run (each Agent run
 * reserves $0.40 before starting). Nothing is held back while no reviewer pass is configured.
 */
export const REVIEWER_RESERVE = {
  fetchUrls: 240,
  aiCalls: 360,
  aiUsd: 0.3,
  agentUsd: 0.8,
} as const;

/** Per-run work caps; a run should finish in roughly 1–3 minutes. */
export const RUN_BUDGET = {
  maxSearches: 12,
  maxFetchUrls: 45,
  maxAgentRuns: 2,
  maxExtractions: 36,
  maxBoards: 8,
  maxPostingsPerBoard: 5,
  maxLeads: 10,
  maxRechecks: 6,
  agentMaxDurationSeconds: 120,
  /** Soft deadline: optional stages are skipped after this. */
  softDeadlineMs: 150_000,
  /** Hard deadline for the whole run. */
  hardDeadlineMs: 270_000,
} as const;

export const REFRESH = {
  showcaseHours: 12,
  userHours: 24,
  /** User hunts only auto-refresh if someone opened them within this many days. */
  userActiveDays: 3,
  retryAfterFailureHours: 2,
  tickMinutes: 10,
} as const;
