import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { agentCacheTable, db } from "@workspace/db";
import { AGENT_STEP_COST_USD } from "@workspace/tinyfish";
import { RUN_BUDGET } from "../lib/config";
import { logger } from "../lib/logger";
import { addUsage, agentBudgetLeftToday, heldForReviewers } from "../lib/usage";
import type { RunContext } from "./context";
import { runAgent } from "./tinyfish";
import { detectAts, parseUrl } from "./urls";

export interface AgentOpening {
  title: string;
  location: string | null;
  url: string;
}

const CACHE_HOURS = 24;
/**
 * TinyFish's `max_steps` is beta-gated (403 "not enabled for custom max steps", Oct 7, 2026), so a run is
 * bounded by `max_duration_seconds` instead. Measured runs take 11–18 s per step, so 25 steps is a safe
 * ceiling for the 120 s window; that much is reserved from the daily budget before starting.
 */
const EXPECTED_MAX_STEPS = 25;
const RESERVE_USD = EXPECTED_MAX_STEPS * AGENT_STEP_COST_USD;

const AgentResult = z.object({
  openings: z
    .array(z.object({ title: z.string(), location: z.string().nullable().optional(), url: z.string() }))
    .default([]),
});

/** Part of the cache key: bump it when the goal wording changes, so results from the old wording aren't reused. */
const GOAL_VERSION = 5;

const SENIORITY_WORDS: Record<string, string> = {
  internship: "internships",
  new_grad: "new-grad roles",
  entry_level: "entry-level roles",
  experienced: "experienced roles",
};

/** What to type into a portal's search box for each seniority. */
const SEARCH_WORDS: Record<string, string> = {
  internship: "intern",
  new_grad: "new grad",
  entry_level: "entry level",
};

/**
 * The instructions Agent gets on a careers portal. With a plain "find openings matching X" goal, Agent
 * often answered "nothing matches" on boards that had matches: it looked at only the first screen of a
 * long list (Notion's board lists 135 openings, internships far down) or narrowed it with a location
 * filter that has no country option. So it is told to search for the level word or read the whole list,
 * to stay away from location and team filters, and to judge titles loosely.
 */
export function agentGoal(prefs: RunContext["prefs"], organization: string, prefiltered = false): string {
  const roles = prefs.roles.slice(0, 3);
  const level = prefs.seniority.map((s) => SENIORITY_WORDS[s] ?? s).join(" or ") || "roles";
  const keyword = prefs.seniority.map((s) => SEARCH_WORDS[s]).find(Boolean) ?? roles[0] ?? "";
  const how = prefiltered
    ? [`This page already lists only ${level}. Do not use the search box or filters; read every opening on the page.`]
    : [
        `If the site has a text search box for jobs, type "${keyword}" into it. Do not use location or team filters.`,
        "If the openings are listed on one page, scroll to the bottom so the whole list loads, then read every title, not just the first screen.",
      ];
  return [
    `You are on the careers site of ${organization}.`,
    `Find the open ${level} that fit any of these roles: ${roles.map((r) => `"${r}"`).join(", ")}.`,
    "Wait for the list of openings to load.",
    ...how,
    `A title fits if it is about one of the roles, even worded differently (for example "Software Engineer Intern, Summer 2027" fits "software engineering intern").`,
    prefs.locations.length
      ? `Keep openings located in ${prefs.locations.join(" or ")}${prefs.remoteOk ? ", or remote" : ""}; a city inside one of these places counts (San Francisco counts for "United States").`
      : null,
    "Do not sign in, apply, or submit any form.",
    "Return up to 8 fitting openings. For each: the exact title, its location, and the full URL of the opening's own page.",
    "Return an empty list only if no title in the whole list fits.",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Where Agent starts. Ashby boards take an employment-type filter in the URL, so for an internship-only
 * brief Agent opens a list of a handful of internships instead of every opening (135 on Notion's board).
 */
export function agentStartUrl(portalUrl: string, prefs: RunContext["prefs"]): string {
  const internshipsOnly = prefs.seniority.length > 0 && prefs.seniority.every((s) => s === "internship");
  if (!internshipsOnly || detectAts(portalUrl)?.ats !== "ashby") return portalUrl;
  const url = parseUrl(portalUrl);
  if (!url || url.pathname.split("/").filter(Boolean).length !== 1) return portalUrl;
  url.searchParams.set("employmentType", "Intern");
  return url.toString();
}

/**
 * TinyFish Agent drives a real browser through a careers portal that Fetch can't read
 * (JavaScript-heavy or bot-protected), using the site's own search, and returns matching openings.
 * Capped per run and per day, and cached for 24 hours per portal and search.
 */
export async function searchPortalWithAgent(
  ctx: RunContext,
  portalUrl: string,
  organization: string,
): Promise<AgentOpening[] | null> {
  const prefs = ctx.prefs;
  const roles = prefs.roles.slice(0, 3).join(", ");
  const level = prefs.seniority.map((s) => SENIORITY_WORDS[s] ?? s).join(" or ");
  const places = prefs.locations.join(", ");
  const startUrl = agentStartUrl(portalUrl, prefs);
  const key = createHash("sha256")
    .update(`v${GOAL_VERSION}|${startUrl}|${roles}|${level}|${places}|${prefs.remoteOk}`)
    .digest("hex")
    .slice(0, 40);

  const [cached] = await db.select().from(agentCacheTable).where(eq(agentCacheTable.key, key));
  if (cached && Date.now() - cached.createdAt.getTime() < CACHE_HOURS * 3_600_000) {
    const parsed = AgentResult.safeParse(cached.result);
    if (parsed.success) {
      await ctx.rec.event("agent", "agent", `Reused today's Agent results for ${organization}`, portalUrl);
      return normalize(parsed.data.openings);
    }
  }

  if (ctx.budget.agentRuns <= 0) return null;
  if ((await agentBudgetLeftToday()) - heldForReviewers(ctx.reviewer).agentUsd < RESERVE_USD) {
    await ctx.rec.event("warning", "agent", `Skipped Agent for ${organization}: today's Agent budget is used up`, portalUrl);
    return null;
  }
  ctx.budget.agentRuns--;

  await ctx.rec.event(
    "agent",
    "agent",
    `Fetch couldn't read ${organization}'s portal, so Agent is opening it in a real browser`,
    portalUrl,
  );
  const goal = agentGoal(prefs, organization, startUrl !== portalUrl);

  try {
    const outcome = await runAgent({
      url: startUrl,
      goal,
      maxDurationSeconds: RUN_BUDGET.agentMaxDurationSeconds,
      outputSchema: {
        type: "object",
        properties: {
          openings: {
            type: "array",
            maxItems: 8,
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                location: { type: "string", nullable: true },
                url: { type: "string" },
              },
              required: ["title", "url"],
            },
          },
        },
        required: ["openings"],
      },
    });
    const cost = outcome.estimatedCostUsd ?? RESERVE_USD;
    ctx.rec.bump({ agentRuns: 1, estimatedCostUsd: cost });
    await addUsage({ agentRuns: 1, agentCostUsd: cost });

    const parsed = AgentResult.safeParse(outcome.result ?? {});
    if (!outcome.ok || !parsed.success) {
      await ctx.rec.event(
        "warning",
        "agent",
        `Agent couldn't finish on ${organization}'s portal (${outcome.failureReason ?? "unexpected result"})`,
        portalUrl,
      );
      return null;
    }
    const openings = normalize(parsed.data.openings);
    await db
      .insert(agentCacheTable)
      .values({ key, url: portalUrl, result: { openings }, costUsd: cost })
      .onConflictDoUpdate({ target: agentCacheTable.key, set: { result: { openings }, costUsd: cost, createdAt: new Date() } });
    await ctx.rec.event(
      "agent",
      "agent",
      `Agent found ${openings.length} matching opening${openings.length === 1 ? "" : "s"} at ${organization} (${outcome.steps ?? "?"} steps, ~$${cost.toFixed(2)})`,
      portalUrl,
    );
    return openings;
  } catch (err) {
    logger.warn({ err, portalUrl }, "Agent run failed");
    await ctx.rec.event("warning", "agent", `Agent run on ${organization}'s portal failed`, portalUrl);
    return null;
  }
}

function normalize(openings: Array<{ title: string; location?: string | null; url: string }>): AgentOpening[] {
  const out: AgentOpening[] = [];
  for (const o of openings) {
    const url = parseUrl(o.url.trim());
    const title = o.title.replace(/\s+/g, " ").trim().slice(0, 160);
    if (!url || !title) continue;
    out.push({ title, location: o.location?.trim() || null, url: url.toString() });
  }
  return out.slice(0, 8);
}
