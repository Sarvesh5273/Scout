import { Router, type IRouter } from "express";
import { inArray, ne, sql } from "drizzle-orm";
import { GetAccessResponse, GetUsageResponse, ListPresetsResponse } from "@workspace/api-zod";
import { db, listingsTable, runsTable } from "@workspace/db";
import { PRESETS } from "../lib/presets";
import { hasReviewerPass } from "../lib/reviewer-pass";

const router: IRouter = Router();

router.get("/presets", (_req, res) => {
  res.json(
    ListPresetsResponse.parse(
      PRESETS.map(({ id, title, description, preferences }) => ({ id, title, description, preferences })),
    ),
  );
});

/** Lets the web app show reviewers that their pass link worked. Doesn't touch the database. */
router.get("/access", (req, res) => {
  res.json(GetAccessResponse.parse({ reviewer: hasReviewerPass(req) }));
});

router.get("/usage", async (_req, res) => {
  const [runs] = await db
    .select({
      searches: sql<number>`coalesce(sum((${runsTable.stats}->>'searches')::int), 0)::int`,
      pagesRead: sql<number>`coalesce(sum((${runsTable.stats}->>'pagesRead')::int), 0)::int`,
      agentRuns: sql<number>`coalesce(sum((${runsTable.stats}->>'agentRuns')::int), 0)::int`,
      // Summed from the same rows as agentRuns so the two figures always agree; usage_daily also counts
      // spend from runs that were later deleted along with their hunts.
      agentCostUsd: sql<number>`coalesce(sum((${runsTable.stats}->>'estimatedCostUsd')::float), 0)::float`,
      completed: sql<number>`count(*) filter (where ${inArray(runsTable.status, ["completed", "partial"])})::int`,
      since: sql<Date | null>`min(${runsTable.startedAt})`,
    })
    .from(runsTable);
  const [listings] = await db
    .select({
      listings: sql<number>`count(*)::int`,
      organizations: sql<number>`count(distinct lower(${listingsTable.organization}))::int`,
    })
    .from(listingsTable)
    .where(ne(listingsTable.status, "closed"));

  const since = runs?.since ? new Date(runs.since) : null;
  res.json(
    GetUsageResponse.parse({
      searches: runs?.searches ?? 0,
      pagesRead: runs?.pagesRead ?? 0,
      agentRuns: runs?.agentRuns ?? 0,
      agentCostUsd: Math.round((runs?.agentCostUsd ?? 0) * 100) / 100,
      listingsTracked: listings?.listings ?? 0,
      organizationsTracked: listings?.organizations ?? 0,
      runsCompleted: runs?.completed ?? 0,
      since: since ? since.toISOString() : null,
    }),
  );
});

export default router;
