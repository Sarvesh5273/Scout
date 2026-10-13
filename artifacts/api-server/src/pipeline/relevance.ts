import type { HuntPreferencesData } from "@workspace/db";
import { placeMatches } from "./places";
import { normalizeText } from "./urls";

/**
 * Cheap title-level relevance used before spending a Fetch or an AI call on a posting.
 * Final ranking happens later with the AI match step plus deterministic scoring.
 */

const STOP = new Set([
  "and", "or", "of", "the", "a", "an", "in", "for", "to", "with", "at", "on", "role", "roles", "job", "jobs",
  "position", "intern", "interns", "internship", "internships", "new", "grad", "graduate", "junior", "entry",
  "level", "summer", "2025", "2026", "2027", "2028", "program", "programme",
]);

const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bml\b/g, "machine learning"],
  [/\bai\b/g, "artificial intelligence"],
  [/\b(swe|sde)\b/g, "software engineer"],
  [/\bpm\b/g, "product manager"],
  [/\bnlp\b/g, "natural language processing"],
  [/\bcv\b/g, "computer vision"],
  [/\bux\b/g, "user experience design"],
  [/\bqa\b/g, "quality assurance"],
];

function expand(text: string): string {
  let out = normalizeText(text);
  for (const [pattern, replacement] of ABBREVIATIONS) out = out.replace(pattern, replacement);
  return out;
}

function stems(text: string): string[] {
  return expand(text)
    .split(" ")
    .filter((w) => w.length >= 2 && !STOP.has(w))
    .map((w) => w.slice(0, 5));
}

const INTERN_TITLE =
  /\b(intern|interns|internship|co ?op|stagiaire|stage|praktikum|praktikant|werkstudent|working student|trainee|placement|summer (student|analyst|associate|research|fellow)|research fellow|fellowship|scholar)\b/;
const EARLY_TITLE = /\b(new grad|graduate|university|campus|early career|entry level|class of 20\d\d|20\d\d start|junior|associate|engineer i)\b/;
const SENIOR_TITLE = /\b(senior|sr|staff|principal|lead|manager|director|head|vp|vice president|architect|distinguished)\b/;
/** Openings aimed at people who aren't university students or graduates. */
const OTHER_AUDIENCE = /\b(high school|secondary school|apprentice|apprenticeship)\b/;

export interface TitleRelevance {
  /** 0..1: best share of a requested role's words present in the title (description words count 40%). */
  role: number;
  internTitle: boolean;
  earlyTitle: boolean;
  /** Clearly senior title while the seeker only wants early-career roles. */
  tooSenior: boolean;
  /** Too senior, or aimed at another audience (e.g. high-school programs). */
  offTarget: boolean;
  locationMatch: boolean | null;
  excluded: boolean;
  keywordHit: boolean;
  /** Combined ordering score. */
  score: number;
}

export function titleRelevance(
  prefs: HuntPreferencesData,
  title: string,
  extraText: string | null,
  location: string | null,
): TitleRelevance {
  const normTitle = expand(title);
  const titleStems = new Set(stems(title));
  const extraStems = new Set(stems(extraText ?? ""));

  let role = 0;
  for (const r of prefs.roles) {
    const rs = stems(r);
    if (rs.length === 0) continue;
    const inTitle = rs.filter((s) => titleStems.has(s)).length;
    const inExtra = rs.filter((s) => !titleStems.has(s) && extraStems.has(s)).length;
    role = Math.max(role, (inTitle + 0.4 * inExtra) / rs.length);
  }

  const internTitle = INTERN_TITLE.test(normTitle);
  const earlyTitle = EARLY_TITLE.test(normTitle);
  const wantsOnlyEarly = !prefs.seniority.includes("experienced");
  const tooSenior = wantsOnlyEarly && SENIOR_TITLE.test(normTitle) && !internTitle;
  const seniorityMatch =
    (internTitle && prefs.seniority.includes("internship")) ||
    (earlyTitle && (prefs.seniority.includes("new_grad") || prefs.seniority.includes("entry_level"))) ||
    (!internTitle && prefs.seniority.includes("experienced"));

  let locationMatch: boolean | null = null;
  if (prefs.locations.length > 0 && location) {
    locationMatch =
      prefs.locations.some((p) => placeMatches(p, location)) || (prefs.remoteOk && /\bremote\b/i.test(location));
  }
  const offTarget = tooSenior || OTHER_AUDIENCE.test(normTitle);

  const haystack = `${normTitle} ${expand(extraText ?? "")}`;
  const excluded = prefs.excludeKeywords.some((k) => {
    const nk = normalizeText(k);
    return nk.length > 0 && new RegExp(`\\b${nk}\\b`).test(normTitle);
  });
  const keywordHit = prefs.keywords.some((k) => {
    const nk = normalizeText(k);
    return nk.length > 0 && haystack.includes(nk);
  });

  const score =
    role * 3 + (seniorityMatch ? 1.5 : 0) + (locationMatch ? 1 : 0) + (keywordHit ? 0.5 : 0) - (offTarget ? 4 : 0);

  return { role, internTitle, earlyTitle, tooSenior, offTarget, locationMatch, excluded, keywordHit, score };
}

/** Postings from a company board must look on-topic and at the right level before Scout reads them. */
export function isPlausibleBoardPosting(prefs: HuntPreferencesData, rel: TitleRelevance): boolean {
  if (rel.excluded || rel.offTarget) return false;
  const roleOk = rel.role >= 0.5 || (rel.keywordHit && rel.role > 0);
  if (!roleOk) return false;
  if (prefs.seniority.includes("experienced")) return true;
  if (rel.internTitle) return prefs.seniority.includes("internship");
  return prefs.seniority.includes("new_grad") || prefs.seniority.includes("entry_level");
}
