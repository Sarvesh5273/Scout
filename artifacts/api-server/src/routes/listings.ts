import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gte, ilike, inArray, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import {
  GetHuntSummaryParams,
  GetHuntSummaryResponse,
  ListHuntSourcesParams,
  ListHuntSourcesResponse,
  ListListingsQueryParams,
  ListListingsResponse,
  UpdateHuntListingBody,
  UpdateHuntListingParams,
  UpdateHuntListingResponse,
} from "@workspace/api-zod";
import { db, huntListingsTable, listingsTable, sourcesTable } from "@workspace/db";
import { latestResultRunId, loadVisibleHunt, sendError } from "../lib/hunt-access";
import { toListing, toSource } from "../lib/serialize";
import { describeZodError } from "../lib/validation";

const router: IRouter = Router();

const MAX_LISTINGS = 200;

router.get("/listings", async (req, res) => {
  const query = ListListingsQueryParams.safeParse(req.query);
  if (!query.success) return sendError(res, 400, describeZodError(query.error));
  const q = query.data;
  const hunt = await loadVisibleHunt(req, q.huntId);
  if (!hunt) return sendError(res, 404, "Hunt not found");
  const latestRunId = await latestResultRunId(hunt.id);

  const where: SQL[] = [eq(huntListingsTable.huntId, hunt.id)];
  const notClosed = ne(listingsTable.status, "closed");
  if (q.view === "saved") where.push(eq(huntListingsTable.saved, true));
  else if (q.view === "hidden") where.push(eq(huntListingsTable.hidden, true));
  else {
    where.push(eq(huntListingsTable.hidden, false), notClosed);
    if (q.view === "new") {
      if (latestRunId === null) return res.json([]);
      where.push(eq(huntListingsTable.firstSeenRunId, latestRunId));
    }
  }
  if (q.kind) where.push(eq(listingsTable.kind, q.kind));
  if (q.visa === "sponsors") where.push(sql`${listingsTable.visa}->>'status' = 'sponsors'`);
  if (q.visa === "not_restricted") {
    where.push(notInArray(sql<string>`${listingsTable.visa}->>'status'`, ["not_sponsored", "citizens_only"]));
  }
  if (q.funding === "paid") where.push(inArray(sql<string>`${listingsTable.funding}->>'level'`, ["paid", "fully_funded"]));
  if (q.funding === "fully_funded") where.push(sql`${listingsTable.funding}->>'level' = 'fully_funded'`);
  if (q.minScore !== undefined) where.push(gte(huntListingsTable.score, q.minScore));
  const text = q.q?.trim();
  if (text) {
    const pattern = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const textMatch = or(
      ilike(listingsTable.title, pattern),
      ilike(listingsTable.organization, pattern),
      ilike(sql<string>`${listingsTable.locations}::text`, pattern),
    );
    if (textMatch) where.push(textMatch);
  }

  const order =
    q.sort === "newest"
      ? [desc(huntListingsTable.firstSeenAt), sql`${listingsTable.postedAt} desc nulls last`, desc(huntListingsTable.score)]
      : q.sort === "deadline"
        ? [sql`${listingsTable.deadline} asc nulls last`, desc(huntListingsTable.score)]
        : [desc(huntListingsTable.score), sql`${listingsTable.deadline} asc nulls last`, asc(listingsTable.id)];

  const rows = await db
    .select({ listing: listingsTable, link: huntListingsTable })
    .from(huntListingsTable)
    .innerJoin(listingsTable, eq(listingsTable.id, huntListingsTable.listingId))
    .where(and(...where))
    .orderBy(...order)
    .limit(MAX_LISTINGS);
  res.json(ListListingsResponse.parse(rows.map((r) => toListing(r.listing, r.link, latestRunId))));
});

router.patch("/hunts/:huntId/listings/:listingId", async (req, res) => {
  const params = UpdateHuntListingParams.safeParse(req.params);
  if (!params.success) return sendError(res, 400, describeZodError(params.error));
  const body = UpdateHuntListingBody.safeParse(req.body);
  if (!body.success) return sendError(res, 400, describeZodError(body.error));
  const hunt = await loadVisibleHunt(req, params.data.huntId);
  if (!hunt) return sendError(res, 404, "Hunt not found");
  if (hunt.showcaseKey) return sendError(res, 403, "Example hunts are read-only. Start your own hunt to save listings.");

  const flags = {
    ...(body.data.saved !== undefined ? { saved: body.data.saved } : {}),
    ...(body.data.hidden !== undefined ? { hidden: body.data.hidden } : {}),
  };
  const match = and(eq(huntListingsTable.huntId, hunt.id), eq(huntListingsTable.listingId, params.data.listingId));
  if (Object.keys(flags).length > 0) await db.update(huntListingsTable).set(flags).where(match);
  const [row] = await db
    .select({ listing: listingsTable, link: huntListingsTable })
    .from(huntListingsTable)
    .innerJoin(listingsTable, eq(listingsTable.id, huntListingsTable.listingId))
    .where(match);
  if (!row) return sendError(res, 404, "Listing not found in this hunt");
  res.json(UpdateHuntListingResponse.parse(toListing(row.listing, row.link, await latestResultRunId(hunt.id))));
});

router.get("/hunts/:huntId/summary", async (req, res) => {
  const params = GetHuntSummaryParams.safeParse(req.params);
  if (!params.success) return sendError(res, 400, describeZodError(params.error));
  const hunt = await loadVisibleHunt(req, params.data.huntId);
  if (!hunt) return sendError(res, 404, "Hunt not found");
  const latestRunId = await latestResultRunId(hunt.id);

  const rows = await db
    .select({ listing: listingsTable, link: huntListingsTable })
    .from(huntListingsTable)
    .innerJoin(listingsTable, eq(listingsTable.id, huntListingsTable.listingId))
    .where(eq(huntListingsTable.huntId, hunt.id));
  const [sources] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sourcesTable)
    .where(eq(sourcesTable.huntId, hunt.id));

  const visible = rows.filter((r) => !r.link.hidden && r.listing.status !== "closed");
  const byKind = { job: 0, program: 0 };
  const byVisa = { sponsors: 0, not_sponsored: 0, citizens_only: 0, unknown: 0 };
  const byFunding = { fully_funded: 0, paid: 0, unpaid: 0, unknown: 0 };
  const orgs = new Map<string, number>();
  for (const { listing } of visible) {
    byKind[listing.kind]++;
    byVisa[listing.visa.status]++;
    byFunding[listing.funding.level]++;
    orgs.set(listing.organization, (orgs.get(listing.organization) ?? 0) + 1);
  }
  const today = new Date().toISOString().slice(0, 10);
  // Only good matches (the UI's 60+ band); low matches and ruled-out openings aren't worth a reminder.
  const upcomingDeadlines = visible
    .filter((r) => r.listing.deadline !== null && r.listing.deadline >= today && r.link.score >= 60)
    .sort((a, b) => (a.listing.deadline ?? "").localeCompare(b.listing.deadline ?? ""))
    .slice(0, 5)
    .map((r) => ({
      listingId: r.listing.id,
      title: r.listing.title,
      organization: r.listing.organization,
      deadline: r.listing.deadline as string,
    }));

  res.json(
    GetHuntSummaryResponse.parse({
      total: visible.length,
      new: latestRunId === null ? 0 : visible.filter((r) => r.link.firstSeenRunId === latestRunId).length,
      saved: rows.filter((r) => r.link.saved).length,
      hidden: rows.filter((r) => r.link.hidden).length,
      byKind,
      byVisa,
      byFunding,
      topOrganizations: [...orgs.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 6)
        .map(([organization, count]) => ({ organization, count })),
      upcomingDeadlines,
      sourcesChecked: sources?.n ?? 0,
      lastRunAt: hunt.lastRunAt ? hunt.lastRunAt.toISOString() : null,
    }),
  );
});

router.get("/hunts/:huntId/sources", async (req, res) => {
  const params = ListHuntSourcesParams.safeParse(req.params);
  if (!params.success) return sendError(res, 400, describeZodError(params.error));
  const hunt = await loadVisibleHunt(req, params.data.huntId);
  if (!hunt) return sendError(res, 404, "Hunt not found");
  const sources = await db
    .select()
    .from(sourcesTable)
    .where(eq(sourcesTable.huntId, hunt.id))
    .orderBy(desc(sourcesTable.listingsFound), desc(sourcesTable.lastCheckedAt), asc(sourcesTable.id));
  res.json(ListHuntSourcesResponse.parse(sources.map(toSource)));
});

export default router;
