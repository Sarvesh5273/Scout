import { and, asc, eq, gte, isNotNull, isNull, lte, or } from "drizzle-orm";
import { db, huntListingsTable, huntsTable, sourcesTable, type Hunt } from "@workspace/db";
import { enqueueRun, isActiveRunConflict, queuedCount } from "../pipeline/queue";
import { msSinceLastRequest } from "./activity";
import { LIMITS, REFRESH } from "./config";
import { logger } from "./logger";
import { PRESETS } from "./presets";
import { aiBudgetLeftToday, fetchUrlsLeftToday, heldForReviewers } from "./usage";
import { samePreferences } from "./validation";

const DAY = 86_400_000;

/** Scheduled refreshes keep room for three manual searches in each daily budget. */
const FETCH_URLS_RESERVED_FOR_MANUAL = LIMITS.fetchUrlsReservedPerRun * 3;
const AI_USD_RESERVED_FOR_MANUAL = LIMITS.aiBudgetReservedPerRunUsd * 3;

/** Showcase hunts always refresh; user hunts only after a first run and if opened recently. */
function isRefreshable(hunt: Hunt, now: Date): boolean {
  if (hunt.showcaseKey) return true;
  if (!hunt.lastRunAt || !hunt.lastViewedAt) return false;
  return now.getTime() - hunt.lastViewedAt.getTime() < REFRESH.userActiveDays * DAY;
}

async function canScheduleMore(): Promise<boolean> {
  const held = heldForReviewers(false);
  if ((await fetchUrlsLeftToday()) - held.fetchUrls < FETCH_URLS_RESERVED_FOR_MANUAL) return false;
  if ((await aiBudgetLeftToday()) - held.aiUsd < AI_USD_RESERVED_FOR_MANUAL) return false;
  return (await queuedCount()) < LIMITS.maxQueuedRuns / 2;
}

async function enqueueScheduled(hunt: Hunt): Promise<void> {
  try {
    await enqueueRun(hunt.id, "scheduled", null);
    logger.info({ huntId: hunt.id }, "Scheduled refresh queued");
  } catch (err) {
    if (!isActiveRunConflict(err)) throw err;
  }
}

/** Queues a refresh when someone opens a hunt that is due; lets refreshes work even if the timer slept. */
export async function refreshIfDue(hunt: Hunt): Promise<void> {
  const now = new Date();
  if (!isRefreshable(hunt, now)) return;
  if (hunt.nextRefreshAt && hunt.nextRefreshAt > now) return;
  if (!(await canScheduleMore())) return;
  await enqueueScheduled(hunt);
}

async function refreshDueHunts(): Promise<void> {
  const now = new Date();
  const activeSince = new Date(now.getTime() - REFRESH.userActiveDays * DAY);
  const due = await db
    .select()
    .from(huntsTable)
    .where(
      and(
        or(isNull(huntsTable.nextRefreshAt), lte(huntsTable.nextRefreshAt, now)),
        or(
          isNotNull(huntsTable.showcaseKey),
          and(isNotNull(huntsTable.lastRunAt), gte(huntsTable.lastViewedAt, activeSince)),
        ),
      ),
    )
    .orderBy(asc(huntsTable.nextRefreshAt))
    .limit(3);
  for (const hunt of due) {
    if (!(await canScheduleMore())) {
      logger.info("Skipping scheduled refreshes to keep budget for manual searches");
      return;
    }
    await enqueueScheduled(hunt);
  }
}

/** Creates or updates Scout's public showcase hunts from the presets. */
export async function seedShowcases(): Promise<void> {
  for (const preset of PRESETS.filter((p) => p.showcase)) {
    const [existing] = await db.select().from(huntsTable).where(eq(huntsTable.showcaseKey, preset.id));
    if (!existing) {
      await db.insert(huntsTable).values({ showcaseKey: preset.id, name: preset.title, preferences: preset.preferences });
      continue;
    }
    const changed = existing.name !== preset.title || !samePreferences(existing.preferences, preset.preferences);
    if (changed) {
      // Results found for the old preferences no longer apply.
      await db.transaction(async (tx) => {
        await tx.delete(huntListingsTable).where(eq(huntListingsTable.huntId, existing.id));
        await tx.delete(sourcesTable).where(eq(sourcesTable.huntId, existing.id));
        await tx
          .update(huntsTable)
          .set({ name: preset.title, preferences: preset.preferences, updatedAt: new Date(), nextRefreshAt: null })
          .where(eq(huntsTable.id, existing.id));
      });
    }
  }
}

/**
 * Ticks are skipped while nobody is using Scout. On Autoscale the server stays up for about 15 minutes after the
 * last request, and querying then would keep the database awake (and billed) for nothing. Due hunts still
 * refresh when someone next opens them (refreshIfDue).
 */
const IDLE_SKIP_MS = 5 * 60_000;

export function startScheduler(): () => void {
  const tick = () => {
    if (msSinceLastRequest() > IDLE_SKIP_MS) return;
    refreshDueHunts().catch((err: unknown) => logger.error({ err }, "Scheduled refresh tick failed"));
  };
  void tick();
  const timer = setInterval(() => void tick(), REFRESH.tickMinutes * 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
