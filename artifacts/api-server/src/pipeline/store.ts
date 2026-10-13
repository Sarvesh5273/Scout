import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  huntListingsTable,
  listingsTable,
  sourcesTable,
  type FoundViaValue,
  type InsertListing,
} from "@workspace/db";
import type { RunContext } from "./context";
import type { ExtractedListing } from "./extract";
import { dedupeKeyFor, legacyDedupeKeyFor, normalizeText } from "./urls";

/** An extracted listing plus where Scout found it. */
export interface Candidate extends ExtractedListing {
  canonicalUrl: string;
  /** Page the facts were read from. */
  sourceUrl: string;
  sourceLabel: string;
  foundVia: FoundViaValue;
  /** ctx.sources key credited with this listing. */
  sourceKey: string | null;
}

export interface RankedCandidate extends Candidate {
  score: number;
  reasons: string[];
}

const known = <T>(a: T | null, b: T | null): T | null => (a !== null ? a : b);

/** Prefers "GoTo Group" over "Gotogroup", the same name rebuilt from a job-board URL without its spaces. */
function readableOrganization(a: string, b: string): string {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  return !na.includes(" ") && nb.includes(" ") && nb.replace(/ /g, "") === na ? b : a;
}

/** Fills gaps in `a` with facts from `b`, its duplicate found through another URL. */
function merge(a: Candidate, b: Candidate): Candidate {
  return {
    ...a,
    organization: readableOrganization(a.organization, b.organization),
    locations: a.locations.length ? a.locations : b.locations,
    workMode: a.workMode !== "unknown" ? a.workMode : b.workMode,
    seniority: a.seniority !== "unknown" ? a.seniority : b.seniority,
    employmentType: known(a.employmentType, b.employmentType),
    postedAt: known(a.postedAt, b.postedAt),
    deadline: known(a.deadline, b.deadline),
    visa: a.visa.status !== "unknown" ? a.visa : b.visa,
    funding: a.funding.level !== "unknown" ? a.funding : b.funding,
    eligibility: known(a.eligibility, b.eligibility),
    summary: known(a.summary, b.summary),
    isOpen: a.isOpen && b.isOpen,
  };
}

/** Removes duplicates within one run, by canonical URL and by organization + title + city. */
export function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const byUrl = new Map<string, Candidate>();
  for (const c of candidates) {
    const existing = byUrl.get(c.canonicalUrl);
    byUrl.set(c.canonicalUrl, existing ? merge(existing, c) : c);
  }
  const byKey = new Map<string, Candidate>();
  for (const c of byUrl.values()) {
    const key = dedupeKeyFor(c.organization, c.title, c.locations);
    const existing = byKey.get(key);
    byKey.set(key, existing ? merge(existing, c) : c);
  }
  return [...byKey.values()];
}

function rowFor(c: Candidate, now: Date): InsertListing {
  return {
    canonicalUrl: c.canonicalUrl,
    dedupeKey: dedupeKeyFor(c.organization, c.title, c.locations),
    title: c.title,
    organization: c.organization,
    kind: c.kind,
    locations: c.locations,
    workMode: c.workMode,
    seniority: c.seniority,
    employmentType: c.employmentType,
    applyUrl: c.applyUrl ?? c.sourceUrl,
    sourceUrl: c.sourceUrl,
    sourceLabel: c.sourceLabel,
    foundVia: c.foundVia,
    postedAt: c.postedAt,
    deadline: c.deadline,
    visa: c.visa,
    funding: c.funding,
    eligibility: c.eligibility,
    summary: c.summary,
    status: c.foundVia === "agent" && !c.summary ? "unverified" : "open",
    lastSeenAt: now,
    lastCheckedAt: now,
  };
}

/**
 * Upserts listings (shared across hunts) and links them to the hunt with this run's score.
 * Returns how many listings are new to this hunt.
 */
export async function storeResults(ctx: RunContext, ranked: RankedCandidate[]): Promise<number> {
  if (ranked.length === 0) return 0;
  const now = new Date();
  const huntId = ctx.hunt.id;

  const rows = ranked.map((c) => rowFor(c, now));
  const legacyKeys = ranked.map((c) => legacyDedupeKeyFor(c.organization, c.title, c.locations));
  const byKey = await db
    .select({ id: listingsTable.id, dedupeKey: listingsTable.dedupeKey, canonicalUrl: listingsTable.canonicalUrl })
    .from(listingsTable)
    .where(inArray(listingsTable.dedupeKey, [...new Set([...rows.map((r) => r.dedupeKey), ...legacyKeys])]));
  const existingByKey = new Map(byKey.map((r) => [r.dedupeKey, r]));

  const linked: Array<{ listingId: number; score: number; reasons: string[] }> = [];
  for (const [i, row] of rows.entries()) {
    const c = ranked[i] as RankedCandidate;
    // A listing stored under the older key format is matched too; the update below re-keys it.
    const sameOpening = existingByKey.get(row.dedupeKey) ?? existingByKey.get(legacyKeys[i] as string);
    // Same organization + title + city under a different URL: update that listing instead of adding a twin.
    const { canonicalUrl: _url, ...updatable } = row;
    const [saved] = sameOpening
      ? await db.update(listingsTable).set(updatable).where(eq(listingsTable.id, sameOpening.id)).returning({ id: listingsTable.id })
      : await db
          .insert(listingsTable)
          .values(row)
          .onConflictDoUpdate({ target: listingsTable.canonicalUrl, set: updatable })
          .returning({ id: listingsTable.id });
    if (saved) linked.push({ listingId: saved.id, score: c.score, reasons: c.reasons });
  }

  if (linked.length > 0) {
    await db
      .insert(huntListingsTable)
      .values(
        linked.map((l) => ({
          huntId,
          listingId: l.listingId,
          score: l.score,
          reasons: l.reasons,
          firstSeenRunId: ctx.runId,
          lastSeenRunId: ctx.runId,
          firstSeenAt: now,
          lastSeenAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [huntListingsTable.huntId, huntListingsTable.listingId],
        set: {
          score: sql`excluded.score`,
          reasons: sql`excluded.reasons`,
          lastSeenRunId: sql`excluded.last_seen_run_id`,
          lastSeenAt: sql`excluded.last_seen_at`,
        },
      });
  }

  const [counted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(huntListingsTable)
    .where(and(eq(huntListingsTable.huntId, huntId), eq(huntListingsTable.firstSeenRunId, ctx.runId)));
  return counted?.n ?? 0;
}

/** Records every source the run touched, so users can see where results came from. */
export async function storeSources(ctx: RunContext): Promise<void> {
  const now = new Date();
  for (const source of ctx.sources.values()) {
    const values = {
      huntId: ctx.hunt.id,
      url: source.url,
      label: source.label.slice(0, 160),
      kind: source.kind,
      readMethod: source.readMethod,
      status: source.status,
      listingsFound: source.listingsFound,
      lastCheckedAt: now,
      note: source.note,
    };
    await db
      .insert(sourcesTable)
      .values(values)
      .onConflictDoUpdate({
        target: [sourcesTable.huntId, sourcesTable.url],
        set: {
          label: values.label,
          kind: values.kind,
          readMethod: values.readMethod,
          status: values.status,
          listingsFound: values.listingsFound,
          lastCheckedAt: now,
          note: values.note,
        },
      });
  }
}
