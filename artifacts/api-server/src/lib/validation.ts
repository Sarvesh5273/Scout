import type { ZodError } from "zod";
import type { HuntPreferencesData } from "@workspace/db";

/** One readable line from a Zod error, e.g. "preferences.roles: Array must contain at least 1 element(s)". */
export function describeZodError(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

function cleanList(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.replace(/\s+/g, " ").trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** Trims and de-duplicates free-text fields after schema validation. */
export function normalizePreferences(p: HuntPreferencesData): HuntPreferencesData {
  return {
    roles: cleanList(p.roles),
    keywords: cleanList(p.keywords),
    excludeKeywords: cleanList(p.excludeKeywords),
    locations: cleanList(p.locations),
    remoteOk: p.remoteOk,
    seniority: [...new Set(p.seniority)],
    opportunityTypes: [...new Set(p.opportunityTypes)],
    needsVisaSponsorship: p.needsVisaSponsorship,
    citizenship: p.citizenship?.replace(/\s+/g, " ").trim() || null,
    funding: p.funding,
    companies: cleanList(p.companies),
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Key-order-independent comparison. Postgres jsonb reorders object keys, so comparing
 * `JSON.stringify` output against a stored hunt reports a change every time.
 */
export function samePreferences(a: HuntPreferencesData, b: HuntPreferencesData): boolean {
  return stableStringify(a) === stableStringify(b);
}

const LEVEL: Record<HuntPreferencesData["seniority"][number], string> = {
  internship: "internships",
  new_grad: "new-grad roles",
  entry_level: "entry-level roles",
  experienced: "roles",
};

/** A role that already names its level ("Machine learning intern") is used as is, not "... intern internships". */
const LEVEL_IN_ROLE: Partial<Record<HuntPreferencesData["seniority"][number], RegExp>> = {
  internship: /\bintern(s|ship|ships)?\b/i,
  new_grad: /\b(new grad|graduate)\b/i,
  entry_level: /\b(entry[- ]level|junior)\b/i,
};

/** Default hunt name, e.g. "Software Engineer internships · Germany, Canada". */
export function defaultHuntName(p: HuntPreferencesData): string {
  const role = p.roles[0] ?? "Openings";
  const seniority = p.seniority[0] ?? "internship";
  const what = LEVEL_IN_ROLE[seniority]?.test(role) ? role : `${role} ${LEVEL[seniority]}`;
  const where = p.locations.length ? ` · ${p.locations.slice(0, 2).join(", ")}${p.locations.length > 2 ? " +" : ""}` : "";
  return `${what}${where}`.slice(0, 80);
}
