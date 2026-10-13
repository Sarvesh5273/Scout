import { eq, sql } from "drizzle-orm";
import { db, emptyRunStats, runsTable, type Run, type RunTriggerValue } from "@workspace/db";
import { LIMITS } from "../lib/config";
import { logger } from "../lib/logger";
import { executeRun } from "./run";

let active = 0;

/** True when the insert hit the one-active-run-per-hunt unique index. */
export function isActiveRunConflict(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } } | null;
  const code = e?.code ?? e?.cause?.code;
  const constraint = e?.constraint ?? e?.cause?.constraint;
  return code === "23505" && constraint === "runs_one_active_per_hunt_idx";
}

/** Queues a run; throws an active-run conflict (see isActiveRunConflict) if the hunt already has one. */
export async function enqueueRun(
  huntId: number,
  trigger: RunTriggerValue,
  clientId: string | null,
  options: { reviewer?: boolean } = {},
): Promise<Run> {
  const [run] = await db
    .insert(runsTable)
    .values({ huntId, trigger, clientId, reviewer: options.reviewer ?? false, status: "queued", stats: emptyRunStats() })
    .returning();
  if (!run) throw new Error("Run insert returned no row");
  void pump();
  return run;
}

export async function queuedCount(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(runsTable)
    .where(eq(runsTable.status, "queued"));
  return row?.n ?? 0;
}

async function claimNext(): Promise<number | null> {
  const result = await db.execute(sql`
    update runs set status = 'running', started_at = now()
    where id = (select id from runs where status = 'queued' order by reviewer desc, id limit 1 for update skip locked)
    returning id`);
  const row = result.rows[0] as { id?: unknown } | undefined;
  return typeof row?.id === "number" ? row.id : null;
}

/** Starts queued runs while there are free slots. Safe to call any time. */
export async function pump(): Promise<void> {
  while (active < LIMITS.maxConcurrentRuns) {
    active++; // reserve the slot before awaiting so concurrent pumps can't overfill
    let runId: number | null = null;
    try {
      runId = await claimNext();
    } catch (err) {
      logger.error({ err }, "Could not claim a queued run");
    }
    if (runId === null) {
      active--;
      return;
    }
    const id = runId;
    void executeRun(id)
      .catch((err: unknown) => logger.error({ err, runId: id }, "Run crashed"))
      .finally(() => {
        active--;
        void pump();
      });
  }
}

/** Runs left "running" by a previous process can't finish; fail them and resume the queue. */
export async function recoverRuns(): Promise<void> {
  const failed = await db
    .update(runsTable)
    .set({ status: "failed", finishedAt: new Date(), error: "Interrupted because Scout restarted. Run it again." })
    .where(eq(runsTable.status, "running"))
    .returning({ id: runsTable.id });
  if (failed.length) logger.warn({ count: failed.length }, "Marked interrupted runs as failed");
  void pump();
}
