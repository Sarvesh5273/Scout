import type { HuntPreferencesData } from "@workspace/db";
import { ATS_SEARCH_DOMAINS, EXCLUDED_DOMAINS } from "./urls";

export type SearchIntent = "ats" | "web" | "programs" | "company";

export interface SearchTask {
  intent: SearchIntent;
  query: string;
  purpose: string;
  /** Short description for the run log, e.g. "job boards". */
  label: string;
  includeDomains?: string[];
  excludeDomains?: string[];
  company?: string;
}

const SENIORITY_WORD: Record<HuntPreferencesData["seniority"][number], string> = {
  internship: "intern",
  new_grad: "new grad",
  entry_level: "entry level",
  experienced: "",
};

const ROLE_NOISE =
  /\b(intern|interns|internship|internships|new grad|graduate|junior|senior|entry[- ]level|role|position|engineer|developer|scientist|analyst|researcher|associate)\b/gi;

/** "Machine Learning Engineer Intern" -> "machine learning"; used for research-program queries. */
export function fieldOf(role: string): string {
  const field = role.replace(ROLE_NOISE, " ").replace(/[,;/|]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return field || role.toLowerCase();
}

/** Summer internships are recruited a year ahead from roughly July onwards. */
export function targetYear(now: Date = new Date()): number {
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
}

function primarySeniority(prefs: HuntPreferencesData): string {
  const order: Array<HuntPreferencesData["seniority"][number]> = ["internship", "new_grad", "entry_level", "experienced"];
  const first = order.find((s) => prefs.seniority.includes(s));
  return first ? SENIORITY_WORD[first] : "";
}

const join = (...parts: Array<string | null | undefined>) =>
  parts
    .filter((p): p is string => Boolean(p && p.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

const LEVEL_IN_ROLE: Record<string, RegExp> = {
  intern: /\bintern(s|ship|ships)?\b/i,
  "new grad": /\b(new grad|graduate)\b/i,
  "entry level": /\b(entry[- ]level|junior)\b/i,
};

/** Adds the level word unless the role already says it ("Machine learning intern" stays as is, not "... intern intern"). */
function roleWithLevel(role: string, level: string, word: string = level): string {
  return LEVEL_IN_ROLE[level]?.test(role) ? role : join(role, word);
}

/**
 * Turns preferences into a prioritized list of TinyFish Search queries:
 * companies the user named, postings on job boards (Greenhouse, Lever, Ashby, Workday...), the open web,
 * and funded research programs. The caller trims to the run's search budget.
 */
export function planSearches(prefs: HuntPreferencesData, now: Date = new Date()): SearchTask[] {
  const level = primarySeniority(prefs);
  const year = targetYear(now);
  const roles = prefs.roles.slice(0, 3);
  const places = prefs.locations.slice(0, 3);
  const firstPlace = places[0] ?? (prefs.remoteOk ? "remote" : "");
  const wantsJobs = prefs.opportunityTypes.includes("company_roles");
  const wantsPrograms = prefs.opportunityTypes.includes("research_programs");

  const companies: SearchTask[] = [];
  const primary: SearchTask[] = [];
  const secondary: SearchTask[] = [];

  for (const company of prefs.companies) {
    companies.push({
      intent: "company",
      company,
      label: company,
      query: join(company, "careers", roleWithLevel(roles[0] ?? "", level)),
      purpose: `Find the official careers page or job board of ${company} listing ${level || ""} openings`.trim(),
      excludeDomains: EXCLUDED_DOMAINS,
    });
  }

  if (wantsJobs) {
    const atsQueries: SearchTask[] = roles.map((role, i) => ({
      intent: "ats" as const,
      label: "job boards",
      query: join(roleWithLevel(role, level), places.length ? places[i % places.length] : firstPlace),
      purpose: "Find individual open job and internship postings that match a student's search",
      includeDomains: ATS_SEARCH_DOMAINS,
    }));
    for (const place of places.slice(roles.length)) {
      atsQueries.push({
        intent: "ats",
        label: "job boards",
        query: join(roleWithLevel(roles[0] ?? "", level), place),
        purpose: "Find individual open job and internship postings that match a student's search",
        includeDomains: ATS_SEARCH_DOMAINS,
      });
    }
    primary.push(...atsQueries.slice(0, 2));
    secondary.push(...atsQueries.slice(2));

    if (prefs.needsVisaSponsorship) {
      primary.push({
        intent: "ats",
        label: "job boards (visa sponsorship)",
        query: join(roleWithLevel(roles[0] ?? "", level), "visa sponsorship", firstPlace),
        purpose: "Find open postings that offer visa sponsorship to international candidates",
        includeDomains: ATS_SEARCH_DOMAINS,
      });
    }
    primary.push({
      intent: "web",
      label: "the web",
      query: join(roleWithLevel(roles[0] ?? "", level, level === "intern" ? "internship" : level), firstPlace, String(year), "apply"),
      purpose: "Find company careers pages and job portals with current openings",
      excludeDomains: EXCLUDED_DOMAINS,
    });
    if (prefs.keywords.length > 0) {
      secondary.push({
        intent: "ats",
        label: "job boards (keywords)",
        query: join(roleWithLevel(roles[0] ?? "", level), prefs.keywords.slice(0, 2).join(" "), firstPlace),
        purpose: "Find individual open postings that mention the student's keywords",
        includeDomains: ATS_SEARCH_DOMAINS,
      });
    }
  }

  if (wantsPrograms) {
    const fields = [...new Set(roles.map(fieldOf))];
    const funding =
      prefs.funding === "fully_funded" ? "fully funded" : prefs.funding === "paid" ? "paid stipend" : "stipend";
    const programPurpose =
      "Find official pages of internship and research programs (universities, labs, agencies, companies) with their eligibility, funding and deadlines";
    primary.push({
      intent: "programs",
      label: "research programs",
      query: join(funding, fields[0], "research internship international students", String(year)),
      purpose: programPurpose,
      excludeDomains: EXCLUDED_DOMAINS,
    });
    primary.push({
      intent: "programs",
      label: "research programs",
      query: join("summer research program", fields[1] ?? fields[0], "undergraduate international applicants", firstPlace, String(year)),
      purpose: programPurpose,
      excludeDomains: EXCLUDED_DOMAINS,
    });
    if (prefs.citizenship) {
      secondary.push({
        intent: "programs",
        label: "research programs",
        query: join(fields[0], "research internship abroad for students from", prefs.citizenship, funding, String(year)),
        purpose: programPurpose,
        excludeDomains: EXCLUDED_DOMAINS,
      });
    }
    for (const place of places.slice(0, 2)) {
      secondary.push({
        intent: "programs",
        label: "research programs",
        query: join(fields[0], "research internship", place, "international students", funding, String(year)),
        purpose: programPurpose,
        excludeDomains: EXCLUDED_DOMAINS,
      });
    }
  }

  const seen = new Set<string>();
  return [...companies, ...primary, ...secondary].filter((task) => {
    const key = task.query.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
