import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { huntsTable } from "./hunts";

export type RunStatusValue = "queued" | "running" | "completed" | "partial" | "failed";
export type RunTriggerValue = "manual" | "scheduled";
export type RunEventStageValue =
  | "plan"
  | "search"
  | "fetch"
  | "agent"
  | "extract"
  | "match"
  | "done"
  | "warning"
  | "error";
export type RunEventToolValue = "search" | "fetch" | "agent" | "ai" | "system";

export interface RunStatsData {
  searches: number;
  pagesRead: number;
  agentRuns: number;
  sourcesChecked: number;
  listingsFound: number;
  newListings: number;
  estimatedCostUsd: number;
}

export const emptyRunStats = (): RunStatsData => ({
  searches: 0,
  pagesRead: 0,
  agentRuns: 0,
  sourcesChecked: 0,
  listingsFound: 0,
  newListings: 0,
  estimatedCostUsd: 0,
});

export const runsTable = pgTable(
  "runs",
  {
    id: serial("id").primaryKey(),
    huntId: integer("hunt_id")
      .notNull()
      .references(() => huntsTable.id, { onDelete: "cascade" }),
    /** Browser that started a manual run; used for per-browser rate limits. Null for scheduled runs. */
    clientId: text("client_id"),
    status: text("status").$type<RunStatusValue>().notNull(),
    trigger: text("trigger").$type<RunTriggerValue>().notNull(),
    /** Started with a reviewer pass: may use the budget held back for reviewers and runs ahead of other queued work. */
    reviewer: boolean("reviewer").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    stats: jsonb("stats").$type<RunStatsData>().notNull(),
    error: text("error"),
  },
  (t) => [
    index("runs_hunt_id_idx").on(t.huntId),
    index("runs_status_idx").on(t.status),
    index("runs_client_id_idx").on(t.clientId),
    // At most one queued/running run per hunt, enforced by the database so concurrent requests can't race.
    uniqueIndex("runs_one_active_per_hunt_idx")
      .on(t.huntId)
      .where(sql`status in ('queued', 'running')`),
  ],
);

export const runEventsTable = pgTable(
  "run_events",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => runsTable.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    stage: text("stage").$type<RunEventStageValue>().notNull(),
    tool: text("tool").$type<RunEventToolValue>().notNull(),
    message: text("message").notNull(),
    url: text("url"),
  },
  (t) => [index("run_events_run_id_idx").on(t.runId)],
);

export type Run = typeof runsTable.$inferSelect;
export type RunEventRow = typeof runEventsTable.$inferSelect;
