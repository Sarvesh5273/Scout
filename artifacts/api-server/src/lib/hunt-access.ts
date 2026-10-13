import type { Request, Response } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, huntListingsTable, huntsTable, listingsTable, runsTable, type Hunt, type Run } from "@workspace/db";
import { getClientId } from "./client-id";
import type { HuntCountsData } from "./serialize";

export function sendError(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

/**
 * Loads a hunt the caller may see: Scout's showcase hunts, or hunts created by this browser.
 * Other people's hunts are reported as missing rather than forbidden, so ids can't be probed.
 */
export async function loadVisibleHunt(req: Request, huntId: number): Promise<Hunt | null> {
  const [hunt] = await db.select().from(huntsTable).where(eq(huntsTable.id, huntId));
  if (!hunt) return null;
  if (hunt.showcaseKey) return hunt;
  const clientId = getClientId(req);
  return clientId && hunt.clientId === clientId ? hunt : null;
}

/** Id of the hunt's latest finished run that produced results; listings first seen there are "new". */
export async function latestResultRunId(huntId: number): Promise<number | null> {
  const [row] = await db
    .select({ id: runsTable.id })
    .from(runsTable)
    .where(and(eq(runsTable.huntId, huntId), inArray(runsTable.status, ["completed", "partial"])))
    .orderBy(desc(runsTable.id))
    .limit(1);
  return row?.id ?? null;
}

export async function latestRuns(huntIds: number[]): Promise<Map<number, Run>> {
  if (huntIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([runsTable.huntId])
    .from(runsTable)
    .where(inArray(runsTable.huntId, huntIds))
    .orderBy(runsTable.huntId, desc(runsTable.id));
  return new Map(rows.map((r) => [r.huntId, r]));
}

/** Visible, saved and new counts per hunt in one query. */
export async function huntCounts(huntIds: number[]): Promise<Map<number, HuntCountsData>> {
  const out = new Map<number, HuntCountsData>(huntIds.map((id) => [id, { total: 0, new: 0, saved: 0 }]));
  if (huntIds.length === 0) return out;
  const latest = sql`(select max(r.id) from runs r where r.hunt_id = ${huntListingsTable.huntId} and r.status in ('completed', 'partial'))`;
  const visible = sql`not ${huntListingsTable.hidden} and ${listingsTable.status} <> 'closed'`;
  const rows = await db
    .select({
      huntId: huntListingsTable.huntId,
      total: sql<number>`count(*) filter (where ${visible})::int`,
      saved: sql<number>`count(*) filter (where ${huntListingsTable.saved})::int`,
      fresh: sql<number>`count(*) filter (where ${visible} and ${huntListingsTable.firstSeenRunId} = ${latest})::int`,
    })
    .from(huntListingsTable)
    .innerJoin(listingsTable, eq(listingsTable.id, huntListingsTable.listingId))
    .where(inArray(huntListingsTable.huntId, huntIds))
    .groupBy(huntListingsTable.huntId);
  for (const r of rows) out.set(r.huntId, { total: r.total, new: r.fresh, saved: r.saved });
  return out;
}
