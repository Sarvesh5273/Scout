import type { Hunt, HuntPreferencesData, SourceKindValue, SourceStatusValue } from "@workspace/db";
import { RUN_BUDGET } from "../lib/config";
import { RunRecorder } from "./recorder";

export interface SourceRecord {
  url: string;
  label: string;
  kind: SourceKindValue;
  readMethod: "fetch" | "agent";
  status: SourceStatusValue;
  listingsFound: number;
  note: string | null;
}

/** Mutable state for one run: remaining budgets, deadlines and the sources it touched. */
export class RunContext {
  readonly startedAt = Date.now();
  readonly rec: RunRecorder;
  readonly prefs: HuntPreferencesData;
  readonly budget = {
    searches: RUN_BUDGET.maxSearches as number,
    fetchUrls: RUN_BUDGET.maxFetchUrls as number,
    agentRuns: RUN_BUDGET.maxAgentRuns as number,
    extractions: RUN_BUDGET.maxExtractions as number,
  };
  /** Keyed by canonical URL. */
  readonly sources = new Map<string, SourceRecord>();
  /** Problems that make the run "partial" rather than "completed". */
  readonly problems: string[] = [];

  constructor(
    readonly runId: number,
    readonly hunt: Hunt,
    /** Started with a reviewer pass, so it may use the budget held back for reviewers. */
    readonly reviewer: boolean = false,
  ) {
    this.rec = new RunRecorder(runId);
    this.prefs = hunt.preferences;
  }

  elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  pastSoftDeadline(): boolean {
    return this.elapsedMs() > RUN_BUDGET.softDeadlineMs;
  }

  pastHardDeadline(): boolean {
    return this.elapsedMs() > RUN_BUDGET.hardDeadlineMs;
  }

  /** Stop early if the hunt was deleted or the run ran out of time. */
  shouldStop(): boolean {
    return this.rec.isDeleted || this.pastHardDeadline();
  }

  noteSource(key: string, record: SourceRecord): void {
    const existing = this.sources.get(key);
    if (existing) {
      existing.listingsFound += record.listingsFound;
      if (record.readMethod === "agent") {
        // Agent retried a page Fetch couldn't read; its result is the one that counts.
        existing.readMethod = "agent";
        existing.status = record.status;
      } else if (record.status === "ok") {
        existing.status = "ok";
      }
      existing.note = record.note ?? existing.note;
      return;
    }
    this.sources.set(key, record);
    this.rec.bump({ sourcesChecked: 1 });
  }

  addFound(key: string, count: number): void {
    const source = this.sources.get(key);
    if (source) {
      source.listingsFound += count;
      if (count > 0 && source.status === "empty") source.status = "ok";
    }
  }
}
