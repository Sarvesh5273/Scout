import { eq, sql } from "drizzle-orm";
import { db, usageDailyTable } from "@workspace/db";
import { LIMITS, REVIEWER_RESERVE } from "./config";
import { logger } from "./logger";
import { reviewerPassConfigured } from "./reviewer-pass";

export type ReviewerReserve = { readonly [K in keyof typeof REVIEWER_RESERVE]: number };

const NOTHING_HELD: ReviewerReserve = { fetchUrls: 0, aiCalls: 0, aiUsd: 0, agentUsd: 0 };

/**
 * How much of today's budget a piece of work has to leave alone. Everything except reviewer searches treats
 * REVIEWER_RESERVE as already spent. Nothing is held back while no reviewer pass is configured.
 */
export function heldForReviewers(forReviewer: boolean): ReviewerReserve {
  return forReviewer || !reviewerPassConfigured() ? NOTHING_HELD : REVIEWER_RESERVE;
}

export interface DailyUsage {
  day: string;
  searches: number;
  fetchUrls: number;
  agentRuns: number;
  agentCostUsd: number;
  aiCalls: number;
  aiCostUsd: number;
}

export type UsageDelta = Partial<Omit<DailyUsage, "day">>;

export function utcDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Re-read today's row this often so budgets stay global if more than one server instance is running. */
const MIRROR_TTL_MS = 60_000;

/** In-memory mirror of today's row so budget checks don't hit the database on every call. */
let today: DailyUsage | null = null;
let loadedAt = 0;

async function loadToday(): Promise<DailyUsage> {
  const day = utcDay();
  if (today && today.day === day && Date.now() - loadedAt < MIRROR_TTL_MS) return today;
  const [row] = await db.select().from(usageDailyTable).where(eq(usageDailyTable.day, day));
  today = row
    ? { ...row }
    : { day, searches: 0, fetchUrls: 0, agentRuns: 0, agentCostUsd: 0, aiCalls: 0, aiCostUsd: 0 };
  loadedAt = Date.now();
  return today;
}

export async function getTodayUsage(): Promise<DailyUsage> {
  return { ...(await loadToday()) };
}

export async function addUsage(delta: UsageDelta): Promise<void> {
  const current = await loadToday();
  current.searches += delta.searches ?? 0;
  current.fetchUrls += delta.fetchUrls ?? 0;
  current.agentRuns += delta.agentRuns ?? 0;
  current.agentCostUsd += delta.agentCostUsd ?? 0;
  current.aiCalls += delta.aiCalls ?? 0;
  current.aiCostUsd += delta.aiCostUsd ?? 0;
  try {
    await db
      .insert(usageDailyTable)
      .values({
        day: current.day,
        searches: delta.searches ?? 0,
        fetchUrls: delta.fetchUrls ?? 0,
        agentRuns: delta.agentRuns ?? 0,
        agentCostUsd: delta.agentCostUsd ?? 0,
        aiCalls: delta.aiCalls ?? 0,
        aiCostUsd: delta.aiCostUsd ?? 0,
      })
      .onConflictDoUpdate({
        target: usageDailyTable.day,
        set: {
          searches: sql`${usageDailyTable.searches} + ${delta.searches ?? 0}`,
          fetchUrls: sql`${usageDailyTable.fetchUrls} + ${delta.fetchUrls ?? 0}`,
          agentRuns: sql`${usageDailyTable.agentRuns} + ${delta.agentRuns ?? 0}`,
          agentCostUsd: sql`${usageDailyTable.agentCostUsd} + ${delta.agentCostUsd ?? 0}`,
          aiCalls: sql`${usageDailyTable.aiCalls} + ${delta.aiCalls ?? 0}`,
          aiCostUsd: sql`${usageDailyTable.aiCostUsd} + ${delta.aiCostUsd ?? 0}`,
        },
      });
  } catch (err) {
    logger.error({ err }, "Failed to record usage");
  }
}

export async function fetchUrlsLeftToday(): Promise<number> {
  const usage = await loadToday();
  return Math.max(0, LIMITS.dailyFetchUrlCap - usage.fetchUrls);
}

export async function agentBudgetLeftToday(): Promise<number> {
  const usage = await loadToday();
  return Math.max(0, LIMITS.dailyAgentBudgetUsd - usage.agentCostUsd);
}

export async function aiCallsLeftToday(): Promise<number> {
  const usage = await loadToday();
  return Math.max(0, LIMITS.dailyAiCallCap - usage.aiCalls);
}

export async function aiBudgetLeftToday(): Promise<number> {
  const usage = await loadToday();
  return Math.max(0, LIMITS.dailyAiBudgetUsd - usage.aiCostUsd);
}
