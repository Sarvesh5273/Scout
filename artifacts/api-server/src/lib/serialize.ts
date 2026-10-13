import type { Hunt, HuntListing, Listing, Run, RunEventRow, Source } from "@workspace/db";

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export interface HuntCountsData {
  total: number;
  new: number;
  saved: number;
}

export function toRunSummary(run: Run) {
  return {
    id: run.id,
    huntId: run.huntId,
    status: run.status,
    trigger: run.trigger,
    startedAt: run.startedAt.toISOString(),
    finishedAt: iso(run.finishedAt),
    stats: run.stats,
    error: run.error,
  };
}

export function toRun(run: Run, events: RunEventRow[]) {
  return {
    ...toRunSummary(run),
    events: events.map((e) => ({
      id: e.id,
      at: e.at.toISOString(),
      stage: e.stage,
      tool: e.tool,
      message: e.message,
      url: e.url,
    })),
  };
}

export function toHunt(hunt: Hunt, counts: HuntCountsData, latestRun: Run | null) {
  const isShowcase = hunt.showcaseKey !== null;
  return {
    id: hunt.id,
    name: hunt.name,
    preferences: hunt.preferences,
    readOnly: isShowcase,
    isShowcase,
    createdAt: hunt.createdAt.toISOString(),
    updatedAt: hunt.updatedAt.toISOString(),
    lastRunAt: iso(hunt.lastRunAt),
    nextRefreshAt: iso(hunt.nextRefreshAt),
    ...(latestRun ? { latestRun: toRunSummary(latestRun) } : {}),
    counts,
  };
}

export function toListing(listing: Listing, link: HuntListing, latestRunId: number | null) {
  return {
    id: listing.id,
    title: listing.title,
    organization: listing.organization,
    kind: listing.kind,
    locations: listing.locations,
    workMode: listing.workMode,
    seniority: listing.seniority,
    employmentType: listing.employmentType,
    applyUrl: listing.applyUrl,
    sourceUrl: listing.sourceUrl,
    sourceLabel: listing.sourceLabel,
    foundVia: listing.foundVia,
    postedAt: listing.postedAt,
    deadline: listing.deadline,
    visa: listing.visa,
    funding: listing.funding,
    eligibility: listing.eligibility,
    summary: listing.summary,
    score: link.score,
    reasons: link.reasons,
    isNew: latestRunId !== null && link.firstSeenRunId === latestRunId,
    saved: link.saved,
    hidden: link.hidden,
    status: listing.status,
    firstSeenAt: link.firstSeenAt.toISOString(),
    lastSeenAt: link.lastSeenAt.toISOString(),
  };
}

export function toSource(source: Source) {
  return {
    id: source.id,
    label: source.label,
    url: source.url,
    kind: source.kind,
    readMethod: source.readMethod,
    status: source.status,
    listingsFound: source.listingsFound,
    lastCheckedAt: iso(source.lastCheckedAt),
    note: source.note,
  };
}
