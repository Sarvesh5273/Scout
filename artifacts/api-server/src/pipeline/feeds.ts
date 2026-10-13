import type { AtsRef } from "./urls";

/** One opening from a public ATS JSON feed, normalized across providers. */
export interface FeedPosting {
  title: string;
  url: string;
  location: string | null;
  postedAt: string | null;
  employmentType: string | null;
  /** Full description when the feed includes it (Lever); lets Scout skip reading the posting page. */
  description: string | null;
  organization: string | null;
  remote: boolean | null;
}

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function isoDate(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v).toISOString().slice(0, 10);
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h\d|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Fetch returns JSON resources as markdown text, slightly mangled (seen Oct 7, 2026): Greenhouse feeds come
 * back with markdown escapes (`absolute\_url`), Lever feeds with raw control characters inside strings.
 * Repairs are tried from least to most invasive; code fences or stray prose around the JSON are tolerated.
 */
export function parseJsonBody(body: string): unknown {
  const trimmed = body.trim();
  const start = trimmed.search(/[[{]/);
  const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
  if (start < 0 || end <= start) return null;
  const core = trimmed.slice(start, end + 1);
  // Control characters are invalid inside JSON strings and insignificant between tokens.
  const noControl = core.replace(/[\u0000-\u001f]+/g, " ");
  // A backslash before anything but a JSON escape character can only be a markdown escape.
  const unescaped = noControl.replace(/\\([^"\\/bfnrtu])/g, "$1");
  for (const candidate of [core, noControl, unescaped]) {
    const parsed = tryParse(candidate);
    if (parsed !== undefined) return parsed;
  }
  return null;
}

/** Parses a feed from Fetch output: the parsed JSON when TinyFish returned an object, else the raw text. */
export function parseFeed(ref: AtsRef, page: { text: string; json: Record<string, unknown> | null }): FeedPosting[] | null {
  const data = page.json ?? parseJsonBody(page.text);
  if (data === null) return null;
  switch (ref.ats) {
    case "greenhouse":
      return parseGreenhouse(ref, data);
    case "lever":
      return parseLever(data);
    case "smartrecruiters":
      return parseSmartRecruiters(ref, data);
    case "workable":
      return parseWorkable(ref, data);
    default:
      return null;
  }
}

function parseGreenhouse(ref: AtsRef, data: unknown): FeedPosting[] | null {
  if (!isObj(data) || !Array.isArray(data["jobs"])) return null;
  const out: FeedPosting[] = [];
  for (const job of data["jobs"]) {
    if (!isObj(job)) continue;
    const title = str(job["title"]);
    const id = job["id"];
    if (!title || (typeof id !== "number" && typeof id !== "string")) continue;
    const location = isObj(job["location"]) ? str(job["location"]["name"]) : null;
    out.push({
      title,
      // The board-hosted URL is always readable; company-hosted absolute_urls often aren't.
      url: `https://${ref.host}/${ref.org}/jobs/${id}`,
      location,
      postedAt: isoDate(job["first_published"]) ?? isoDate(job["updated_at"]),
      employmentType: null,
      description: null,
      organization: str(job["company_name"]),
      remote: location ? /remote/i.test(location) : null,
    });
  }
  return out;
}

function parseLever(data: unknown): FeedPosting[] | null {
  if (!Array.isArray(data)) return null;
  const out: FeedPosting[] = [];
  for (const job of data) {
    if (!isObj(job)) continue;
    const title = str(job["text"]);
    const url = str(job["hostedUrl"]);
    if (!title || !url) continue;
    const categories = isObj(job["categories"]) ? job["categories"] : {};
    const lists = Array.isArray(job["lists"])
      ? job["lists"]
          .filter(isObj)
          .map((l) => `${str(l["text"]) ?? ""}\n${stripHtml(str(l["content"]) ?? "")}`)
          .join("\n")
      : "";
    const description = [str(job["descriptionPlain"]), lists, str(job["additionalPlain"])]
      .filter(Boolean)
      .join("\n\n");
    const allLocations = Array.isArray(categories["allLocations"])
      ? categories["allLocations"].map(str).filter(Boolean).join("; ")
      : null;
    out.push({
      title,
      url,
      location: allLocations || str(categories["location"]),
      postedAt: isoDate(job["createdAt"]),
      employmentType: str(categories["commitment"]),
      description: description || null,
      organization: null,
      remote: str(job["workplaceType"]) === "remote" ? true : null,
    });
  }
  return out;
}

function parseSmartRecruiters(ref: AtsRef, data: unknown): FeedPosting[] | null {
  if (!isObj(data) || !Array.isArray(data["content"])) return null;
  const out: FeedPosting[] = [];
  for (const job of data["content"]) {
    if (!isObj(job)) continue;
    const title = str(job["name"]);
    const id = str(job["id"]);
    if (!title || !id) continue;
    const loc = isObj(job["location"]) ? job["location"] : {};
    const location =
      str(loc["fullLocation"]) ?? ([str(loc["city"]), str(loc["country"])].filter(Boolean).join(", ") || null);
    out.push({
      title,
      url: `https://jobs.smartrecruiters.com/${ref.org}/${id}`,
      location,
      postedAt: isoDate(job["releasedDate"]),
      employmentType: isObj(job["typeOfEmployment"]) ? str(job["typeOfEmployment"]["label"]) : null,
      description: null,
      organization: isObj(job["company"]) ? str(job["company"]["name"]) : null,
      remote: typeof loc["remote"] === "boolean" ? loc["remote"] : null,
    });
  }
  return out;
}

function parseWorkable(ref: AtsRef, data: unknown): FeedPosting[] | null {
  if (!isObj(data) || !Array.isArray(data["jobs"])) return null;
  const company = str(data["name"]);
  const out: FeedPosting[] = [];
  for (const job of data["jobs"]) {
    if (!isObj(job)) continue;
    const title = str(job["title"]);
    const shortcode = str(job["shortcode"]);
    const url = shortcode ? `https://apply.workable.com/${ref.org}/j/${shortcode}` : str(job["url"]);
    if (!title || !url) continue;
    out.push({
      title,
      url,
      location: [str(job["city"]), str(job["country"])].filter(Boolean).join(", ") || null,
      postedAt: isoDate(job["published_on"]) ?? isoDate(job["created_at"]),
      employmentType: str(job["employment_type"]),
      description: null,
      organization: company,
      remote: typeof job["telecommuting"] === "boolean" ? job["telecommuting"] : null,
    });
  }
  return out;
}

/** Workday postings have no public GET feed; titles and places are recoverable from posting URLs. */
export function workdayPostingsFromLinks(ref: AtsRef, links: string[]): FeedPosting[] {
  const out: FeedPosting[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      continue;
    }
    if (url.hostname.toLowerCase() !== ref.host) continue;
    const parts = url.pathname.split("/").filter(Boolean);
    const jobIdx = parts.indexOf("job");
    if (jobIdx < 0 || parts.length < jobIdx + 3) continue;
    const slug = parts[parts.length - 1] ?? "";
    const key = slug.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const title = slug
      .replace(/_[A-Za-z]*-?\d[\w-]*$/, "")
      .replace(/-+/g, " ")
      .trim();
    const place = (parts[jobIdx + 1] ?? "").replace(/-+/g, " ").trim();
    if (!title) continue;
    out.push({
      title,
      url: `https://${url.hostname}${url.pathname}`,
      location: place || null,
      postedAt: null,
      employmentType: null,
      description: null,
      organization: null,
      remote: /remote/i.test(place) ? true : null,
    });
  }
  return out;
}
