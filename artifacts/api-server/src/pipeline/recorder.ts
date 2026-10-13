import { eq } from "drizzle-orm";
import {
  db,
  emptyRunStats,
  runEventsTable,
  runsTable,
  type RunEventStageValue,
  type RunEventToolValue,
  type RunStatsData,
} from "@workspace/db";
import { logger } from "../lib/logger";

function isForeignKeyViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23503" || e?.cause?.code === "23503";
}

/** Writes a run's live event log and counters; the UI polls these while the run is in progress. */
export class RunRecorder {
  readonly stats: RunStatsData = emptyRunStats();
  private deleted = false;

  constructor(readonly runId: number) {}

  /** True once the run's hunt was deleted mid-run; the pipeline stops doing work. */
  get isDeleted(): boolean {
    return this.deleted;
  }

  bump(delta: Partial<RunStatsData>): void {
    for (const [key, value] of Object.entries(delta) as Array<[keyof RunStatsData, number]>) {
      this.stats[key] = Math.round((this.stats[key] + value) * 1000) / 1000;
    }
  }

  async event(
    stage: RunEventStageValue,
    tool: RunEventToolValue,
    message: string,
    url: string | null = null,
  ): Promise<void> {
    if (this.deleted) return;
    try {
      await db.insert(runEventsTable).values({ runId: this.runId, stage, tool, message: message.slice(0, 400), url });
      await this.flush();
    } catch (err) {
      if (isForeignKeyViolation(err)) {
        this.deleted = true;
        return;
      }
      logger.warn({ err, runId: this.runId }, "Could not record run event");
    }
  }

  async flush(): Promise<void> {
    if (this.deleted) return;
    await db.update(runsTable).set({ stats: this.stats }).where(eq(runsTable.id, this.runId));
  }
}
