import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  CreateHuntBody,
  CreateHuntResponse,
  DeleteHuntParams,
  GetHuntParams,
  GetHuntResponse,
  ListHuntsResponse,
  UpdateHuntBody,
  UpdateHuntParams,
  UpdateHuntResponse,
} from "@workspace/api-zod";
import { db, huntListingsTable, huntsTable, runsTable, sourcesTable, type Hunt } from "@workspace/db";
import { getClientId } from "../lib/client-id";
import { LIMITS } from "../lib/config";
import { huntCounts, latestRuns, loadVisibleHunt, sendError } from "../lib/hunt-access";
import { logger } from "../lib/logger";
import { hasReviewerPass } from "../lib/reviewer-pass";
import { refreshIfDue } from "../lib/scheduler";
import { toHunt } from "../lib/serialize";
import { defaultHuntName, describeZodError, normalizePreferences, samePreferences } from "../lib/validation";

const router: IRouter = Router();

async function serializeHunts(hunts: Hunt[]) {
  const ids = hunts.map((h) => h.id);
  const [counts, runs] = await Promise.all([huntCounts(ids), latestRuns(ids)]);
  return hunts.map((h) => toHunt(h, counts.get(h.id) ?? { total: 0, new: 0, saved: 0 }, runs.get(h.id) ?? null));
}

router.get("/hunts", async (req, res) => {
  const clientId = getClientId(req);
  const showcases = await db
    .select()
    .from(huntsTable)
    .where(isNotNull(huntsTable.showcaseKey))
    .orderBy(asc(huntsTable.id));
  const own = clientId
    ? await db.select().from(huntsTable).where(eq(huntsTable.clientId, clientId)).orderBy(desc(huntsTable.createdAt))
    : [];
  res.json(ListHuntsResponse.parse(await serializeHunts([...own, ...showcases])));
});

router.post("/hunts", async (req, res) => {
  const clientId = getClientId(req);
  if (!clientId) return sendError(res, 401, "Missing browser id. Reload the page and try again.");
  const body = CreateHuntBody.safeParse(req.body);
  if (!body.success) return sendError(res, 400, describeZodError(body.error));

  const [owned] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(huntsTable)
    .where(eq(huntsTable.clientId, clientId));
  const maxHunts = hasReviewerPass(req) ? LIMITS.maxHuntsPerReviewer : LIMITS.maxHuntsPerClient;
  if ((owned?.n ?? 0) >= maxHunts) {
    return sendError(res, 429, `You can keep up to ${maxHunts} hunts. Delete one to start another.`);
  }

  const preferences = normalizePreferences(body.data.preferences);
  if (preferences.roles.length === 0) return sendError(res, 400, "preferences.roles: Add at least one role");
  const [hunt] = await db
    .insert(huntsTable)
    .values({ clientId, name: body.data.name?.trim() || defaultHuntName(preferences), preferences, lastViewedAt: new Date() })
    .returning();
  if (!hunt) return sendError(res, 500, "Could not create the hunt");
  const [serialized] = await serializeHunts([hunt]);
  res.status(201).json(CreateHuntResponse.parse(serialized));
});

router.get("/hunts/:huntId", async (req, res) => {
  const params = GetHuntParams.safeParse(req.params);
  if (!params.success) return sendError(res, 400, describeZodError(params.error));
  const hunt = await loadVisibleHunt(req, params.data.huntId);
  if (!hunt) return sendError(res, 404, "Hunt not found");

  const now = new Date();
  await db.update(huntsTable).set({ lastViewedAt: now }).where(eq(huntsTable.id, hunt.id));
  refreshIfDue({ ...hunt, lastViewedAt: now }).catch((err: unknown) =>
    logger.error({ err, huntId: hunt.id }, "Lazy refresh failed"),
  );
  const [serialized] = await serializeHunts([hunt]);
  res.json(GetHuntResponse.parse(serialized));
});

router.patch("/hunts/:huntId", async (req, res) => {
  const params = UpdateHuntParams.safeParse(req.params);
  if (!params.success) return sendError(res, 400, describeZodError(params.error));
  const body = UpdateHuntBody.safeParse(req.body);
  if (!body.success) return sendError(res, 400, describeZodError(body.error));
  const hunt = await loadVisibleHunt(req, params.data.huntId);
  if (!hunt) return sendError(res, 404, "Hunt not found");
  if (hunt.showcaseKey) return sendError(res, 403, "Example hunts can't be edited. Start your own hunt instead.");

  const preferences = body.data.preferences ? normalizePreferences(body.data.preferences) : null;
  if (preferences && preferences.roles.length === 0) return sendError(res, 400, "preferences.roles: Add at least one role");
  const prefsChanged = preferences !== null && !samePreferences(preferences, hunt.preferences);

  if (prefsChanged) {
    const [active] = await db
      .select({ id: runsTable.id })
      .from(runsTable)
      .where(and(eq(runsTable.huntId, hunt.id), inArray(runsTable.status, ["queued", "running"])))
      .limit(1);
    if (active) return sendError(res, 409, "Wait for the current search to finish before changing preferences.");
  }

  const updated = await db.transaction(async (tx) => {
    if (prefsChanged) {
      // Results matched to the old preferences no longer apply; saved listings are kept.
      await tx
        .delete(huntListingsTable)
        .where(and(eq(huntListingsTable.huntId, hunt.id), eq(huntListingsTable.saved, false)));
      await tx.delete(sourcesTable).where(eq(sourcesTable.huntId, hunt.id));
    }
    const [row] = await tx
      .update(huntsTable)
      .set({
        ...(body.data.name?.trim() ? { name: body.data.name.trim() } : {}),
        ...(prefsChanged && preferences ? { preferences, nextRefreshAt: null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(huntsTable.id, hunt.id))
      .returning();
    return row;
  });
  if (!updated) return sendError(res, 404, "Hunt not found");
  const [serialized] = await serializeHunts([updated]);
  res.json(UpdateHuntResponse.parse(serialized));
});

router.delete("/hunts/:huntId", async (req, res) => {
  const params = DeleteHuntParams.safeParse(req.params);
  if (!params.success) return sendError(res, 400, describeZodError(params.error));
  const hunt = await loadVisibleHunt(req, params.data.huntId);
  if (!hunt) return sendError(res, 404, "Hunt not found");
  if (hunt.showcaseKey) return sendError(res, 403, "Example hunts can't be deleted.");
  await db.delete(huntsTable).where(eq(huntsTable.id, hunt.id));
  res.status(204).end();
});

export default router;
