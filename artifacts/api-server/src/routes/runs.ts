import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import {
  GetRunParams,
  GetRunResponse,
  ListHuntRunsParams,
  ListHuntRunsResponse,
  StartHuntRunParams,
  StartHuntRunResponse,
} from "@workspace/api-zod";
import { db, runEventsTable, runsTable } from "@workspace/db";
import { getClientId } from "../lib/client-id";
import { LIMITS } from "../lib/config";
import { loadVisibleHunt, sendError } from "../lib/hunt-access";
import { hasReviewerPass } from "../lib/reviewer-pass";
import { toRun, toRunSummary } from "../lib/serialize";
import { aiBudgetLeftToday, aiCallsLeftToday, fetchUrlsLeftToday, heldForReviewers } from "../lib/usage";
import { describeZodError } from "../lib/validation";
import { enqueueRun, isActiveRunConflict, queuedCount } from "../pipeline/queue";

const router: IRouter = Router();

/** A run uses up to ~40 AI calls; refuse new ones before the daily cap is hit mid-run. */
const AI_CALLS_RESERVED_PER_RUN = 60;

router.get("/hunts/:huntId/runs", async (req, res) => {
  const params = ListHuntRunsParams.safeParse(req.params);
  if (!params.success) return sendError(res, 400, describeZodError(params.error));
  const hunt = await loadVisibleHunt(req, params.data.huntId);
  if (!hunt) return sendError(res, 404, "Hunt not found");
  const runs = await db
    .select()
    .from(runsTable)
    .where(eq(runsTable.huntId, hunt.id))
    .orderBy(desc(runsTable.id))
    .limit(20);
  res.json(ListHuntRunsResponse.parse(runs.map(toRunSummary)));
});

router.post("/hunts/:huntId/runs", async (req, res) => {
  const params = StartHuntRunParams.safeParse(req.params);
  if (!params.success) return sendError(res, 400, describeZodError(params.error));
  const clientId = getClientId(req);
  const hunt = await loadVisibleHunt(req, params.data.huntId);
  if (!hunt) return sendError(res, 404, "Hunt not found");
  if (hunt.showcaseKey) return sendError(res, 403, "Example hunts refresh automatically. Start your own hunt to search now.");
  if (!clientId) return sendError(res, 401, "Missing browser id. Reload the page and try again.");

  const reviewer = hasReviewerPass(req);
  const perClientLimit = reviewer ? LIMITS.reviewerRunsPerHour : LIMITS.manualRunsPerClientPerHour;
  const hourAgo = new Date(Date.now() - 3_600_000);
  const [recent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(runsTable)
    .where(and(eq(runsTable.clientId, clientId), eq(runsTable.trigger, "manual"), gte(runsTable.startedAt, hourAgo)));
  if ((recent?.n ?? 0) >= perClientLimit) {
    return sendError(res, 429, `You've started ${perClientLimit} searches in the last hour. Try again a bit later.`);
  }
  // Reviewers skip the shared limits below; their own budget share is checked with everyone else's.
  if (!reviewer) {
    const [everyone] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(runsTable)
      .where(and(eq(runsTable.trigger, "manual"), eq(runsTable.reviewer, false), gte(runsTable.startedAt, hourAgo)));
    if ((everyone?.n ?? 0) >= LIMITS.manualRunsPerHour) {
      return sendError(res, 429, "Scout has run a lot of searches in the last hour. Try again in a little while.");
    }
    if ((await queuedCount()) >= LIMITS.maxQueuedRuns) {
      return sendError(res, 429, "Scout is busy with other searches. Try again in a few minutes.");
    }
  }
  const held = heldForReviewers(reviewer);
  if (
    (await fetchUrlsLeftToday()) - held.fetchUrls < LIMITS.fetchUrlsReservedPerRun ||
    (await aiCallsLeftToday()) - held.aiCalls < AI_CALLS_RESERVED_PER_RUN ||
    (await aiBudgetLeftToday()) - held.aiUsd < LIMITS.aiBudgetReservedPerRunUsd
  ) {
    return sendError(res, 429, "Scout has used today's search budget. It resets at 00:00 UTC (5:30 AM IST).");
  }

  try {
    const run = await enqueueRun(hunt.id, "manual", clientId, { reviewer });
    res.status(202).json(StartHuntRunResponse.parse(toRunSummary(run)));
  } catch (err) {
    if (isActiveRunConflict(err)) return sendError(res, 409, "A search is already running for this hunt.");
    throw err;
  }
});

router.get("/runs/:runId", async (req, res) => {
  const params = GetRunParams.safeParse(req.params);
  if (!params.success) return sendError(res, 400, describeZodError(params.error));
  const [run] = await db.select().from(runsTable).where(eq(runsTable.id, params.data.runId));
  if (!run || !(await loadVisibleHunt(req, run.huntId))) return sendError(res, 404, "Run not found");
  const events = await db
    .select()
    .from(runEventsTable)
    .where(eq(runEventsTable.runId, run.id))
    .orderBy(asc(runEventsTable.id));
  res.json(GetRunResponse.parse(toRun(run, events)));
});

export default router;
