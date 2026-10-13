import { date, doublePrecision, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * AI extraction results for a posting page, keyed by canonical URL and invalidated by content hash.
 * Postings rarely change between refreshes, so this keeps repeat runs cheap.
 */
export const extractionCacheTable = pgTable("extraction_cache", {
  url: text("url").primaryKey(),
  contentHash: text("content_hash").notNull(),
  result: jsonb("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** TinyFish Agent results for portals Fetch can't read, keyed by portal URL + goal. */
export const agentCacheTable = pgTable("agent_cache", {
  key: text("key").primaryKey(),
  url: text("url").notNull(),
  result: jsonb("result").notNull(),
  costUsd: doublePrecision("cost_usd").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Per-day (UTC) TinyFish and AI usage, used for budgets and the public usage numbers. */
export const usageDailyTable = pgTable("usage_daily", {
  day: date("day", { mode: "string" }).primaryKey(),
  searches: integer("searches").notNull().default(0),
  fetchUrls: integer("fetch_urls").notNull().default(0),
  agentRuns: integer("agent_runs").notNull().default(0),
  agentCostUsd: doublePrecision("agent_cost_usd").notNull().default(0),
  aiCalls: integer("ai_calls").notNull().default(0),
  /** Estimated from token usage at the model's list price (Replit AI Integrations bills at list price). */
  aiCostUsd: doublePrecision("ai_cost_usd").notNull().default(0),
});
