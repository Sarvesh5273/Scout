/** URL helpers: parsing, canonical forms for dedupe, applicant-tracking-system (ATS) detection. */

export type AtsKind = "greenhouse" | "lever" | "ashby" | "workday" | "smartrecruiters" | "workable";

export const ATS_LABEL: Record<AtsKind, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workday: "Workday",
  smartrecruiters: "SmartRecruiters",
  workable: "Workable",
};

/**
 * Hosts where individual postings live; Search is pointed at these to find postings across many companies.
 * Ashby is left out: Fetch can't read it, so its results would only take slots from readable postings.
 */
export const ATS_SEARCH_DOMAINS = [
  "job-boards.greenhouse.io",
  "boards.greenhouse.io",
  "jobs.lever.co",
  "myworkdayjobs.com",
  "jobs.smartrecruiters.com",
  "apply.workable.com",
];

/** Login walls, bot-hostile aggregators and social sites. Scout neither searches nor reads them. */
export const EXCLUDED_DOMAINS = [
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "glassdoor.co.in",
  "ziprecruiter.com",
  "monster.com",
  "simplyhired.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "reddit.com",
  "quora.com",
  "pinterest.com",
  "tiktok.com",
  "levels.fyi",
  "teamblind.com",
];

export interface AtsRef {
  ats: AtsKind;
  /** Board slug (Workday: tenant/site). */
  org: string;
  host: string;
  postingId: string | null;
  boardUrl: string;
  /** Public JSON feed of the board's openings, read through TinyFish Fetch. Null when the ATS has none. */
  feedUrl: string | null;
  postingUrl: string | null;
  /**
   * False when TinyFish Fetch can't read this ATS at all. Ashby (tested Oct 7, 2026): boards and postings
   * return empty_content, and its JSON feed comes back as flattened description text. Only Agent can read it.
   */
  readable: boolean;
}

export function parseUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

const TWO_LEVEL_SUFFIXES = new Set([
  "co.uk", "ac.uk", "org.uk", "gov.uk", "co.in", "ac.in", "edu.in", "res.in", "org.in", "gov.in",
  "com.au", "edu.au", "org.au", "co.jp", "ac.jp", "or.jp", "com.sg", "edu.sg", "gov.sg", "ac.kr",
  "co.kr", "edu.cn", "com.cn", "ac.il", "co.il", "ac.nz", "co.nz", "com.br", "edu.br", "ac.za",
  "co.za", "edu.hk", "com.hk", "edu.tw", "com.tw", "ac.at", "edu.my", "com.my", "edu.pk", "edu.sa",
]);

/** Registrable domain, approximately (e.g. careers.example.co.uk -> example.co.uk). */
export function baseDomain(host: string): string {
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join(".");
  if (TWO_LEVEL_SUFFIXES.has(lastTwo) && labels.length >= 3) return labels.slice(-3).join(".");
  return lastTwo;
}

export function isExcluded(url: URL): boolean {
  const host = hostOf(url);
  return EXCLUDED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9_.-]*$/i;

export function detectAts(raw: string): AtsRef | null {
  const url = parseUrl(raw);
  if (!url) return null;
  const host = hostOf(url);
  const parts = url.pathname.split("/").filter(Boolean);

  if (/^(job-)?boards(\.eu)?\.greenhouse\.io$/.test(host)) {
    const eu = host.includes(".eu.");
    let org: string | null = parts[0] ?? null;
    let id: string | null = null;
    if (org === "embed") {
      org = url.searchParams.get("for");
      id = url.searchParams.get("token");
    } else if (parts[1] === "jobs" && parts[2] && /^\d+$/.test(parts[2])) {
      id = parts[2];
    }
    if (!org || !SLUG.test(org)) return null;
    org = org.toLowerCase();
    const boardHost = eu ? "job-boards.eu.greenhouse.io" : "job-boards.greenhouse.io";
    return {
      ats: "greenhouse",
      org,
      host: boardHost,
      postingId: id,
      boardUrl: `https://${boardHost}/${org}`,
      feedUrl: `https://boards-api${eu ? ".eu" : ""}.greenhouse.io/v1/boards/${org}/jobs`,
      postingUrl: id ? `https://${boardHost}/${org}/jobs/${id}` : null,
      readable: true,
    };
  }

  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    const org = parts[0];
    if (!org || !SLUG.test(org)) return null;
    const id = parts[1] && UUID.test(parts[1]) ? parts[1] : null;
    const eu = host.includes(".eu.");
    return {
      ats: "lever",
      org: org.toLowerCase(),
      host,
      postingId: id,
      boardUrl: `https://${host}/${org}`,
      feedUrl: `https://api${eu ? ".eu" : ""}.lever.co/v0/postings/${org}?mode=json`,
      postingUrl: id ? `https://${host}/${org}/${id}` : null,
      readable: true,
    };
  }

  if (host === "jobs.ashbyhq.com") {
    const org = parts[0];
    if (!org || !SLUG.test(decodeURIComponent(org).replace(/\s/g, "-"))) return null;
    const id = parts[1] && UUID.test(parts[1]) ? parts[1] : null;
    return {
      ats: "ashby",
      org,
      host,
      postingId: id,
      boardUrl: `https://${host}/${org}`,
      feedUrl: null,
      postingUrl: id ? `https://${host}/${org}/${id}` : null,
      readable: false,
    };
  }

  if (host.endsWith(".myworkdayjobs.com")) {
    let p = parts;
    if (p[0] && /^[a-z]{2}-[A-Z]{2}$/.test(p[0])) p = p.slice(1);
    const site = p[0];
    if (!site) return null;
    const isPosting = p[1] === "job" && p.length >= 3;
    const tenant = host.split(".")[0] ?? host;
    return {
      ats: "workday",
      org: `${tenant}/${site}`,
      host,
      postingId: isPosting ? (p[p.length - 1] ?? null) : null,
      boardUrl: `https://${host}/${site}`,
      feedUrl: null,
      postingUrl: isPosting ? `https://${host}/${p.join("/")}` : null,
      readable: true,
    };
  }

  if (host === "jobs.smartrecruiters.com" || host === "careers.smartrecruiters.com") {
    const org = parts[0];
    if (!org || !SLUG.test(org)) return null;
    const idMatch = parts[1] ? /^(\d{6,})/.exec(parts[1]) : null;
    return {
      ats: "smartrecruiters",
      org,
      host: "jobs.smartrecruiters.com",
      postingId: idMatch?.[1] ?? null,
      boardUrl: `https://careers.smartrecruiters.com/${org}`,
      feedUrl: `https://api.smartrecruiters.com/v1/companies/${org}/postings?limit=100`,
      postingUrl: idMatch && parts[1] ? `https://jobs.smartrecruiters.com/${org}/${parts[1]}` : null,
      readable: true,
    };
  }

  if (host === "apply.workable.com") {
    const org = parts[0];
    if (!org || org === "api" || !SLUG.test(org)) return null;
    const id = parts[1] === "j" && parts[2] ? parts[2] : null;
    return {
      ats: "workable",
      org,
      host,
      postingId: id,
      boardUrl: `https://apply.workable.com/${org}`,
      feedUrl: `https://apply.workable.com/api/v1/widget/accounts/${org}`,
      postingUrl: id ? `https://apply.workable.com/${org}/j/${id}` : null,
      readable: true,
    };
  }

  return null;
}

const KEEP_PARAMS = new Set(["gh_jid", "jobid", "job_id", "jid", "id", "jobreqid", "req", "reqid", "posting", "pid", "vacancy"]);

/** Stable identity for a page or posting: no tracking params, no www, ATS URLs in one canonical form. */
export function canonicalizeUrl(raw: string): string | null {
  const ats = detectAts(raw);
  if (ats?.postingUrl) return ats.postingUrl;
  const url = parseUrl(raw);
  if (!url) return null;
  if (ats && !ats.postingId && url.pathname.split("/").filter(Boolean).length <= 1) return ats.boardUrl;
  const host = hostOf(url);
  const path = url.pathname.replace(/\/+$/, "");
  const params = [...url.searchParams.entries()]
    .filter(([k]) => KEEP_PARAMS.has(k.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length
    ? `?${params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}`
    : "";
  return `https://${host}${path}${query}`;
}

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const ORG_PREFIX = /^the/;
const ORG_SUFFIX = /(incorporated|inc|llc|ltd|limited|corporation|corp|group|gmbh|plc)$/;

/**
 * Company names arrive in several spellings: "GoTo Group" from a posting page, "Gotogroup" from a job-board URL,
 * "Stripe, Inc." from a footer. Compare them without spaces, punctuation or a corporate suffix.
 */
function orgKey(organization: string): string {
  const compact = normalizeText(organization).replace(/ /g, "");
  // Twice, for names like "Sony Group Corporation".
  const trimmed = compact.replace(ORG_PREFIX, "").replace(ORG_SUFFIX, "").replace(ORG_SUFFIX, "");
  return trimmed.length >= 3 ? trimmed : compact;
}

function cityOf(locations: string[]): string {
  return normalizeText((locations[0] ?? "").split(/[,;/(]/)[0] ?? "");
}

/** Second dedupe key: the same opening is often reachable through several URLs. */
export function dedupeKeyFor(organization: string, title: string, locations: string[]): string {
  return `${orgKey(organization)}|${normalizeText(title)}|${cityOf(locations)}`;
}

/** The key format stored before company names were compacted, so older listings are still found and re-keyed. */
export function legacyDedupeKeyFor(organization: string, title: string, locations: string[]): string {
  return `${normalizeText(organization)}|${normalizeText(title)}|${cityOf(locations)}`;
}

const JUNK_LINK = /(privacy|cookie|terms|legal|login|log-in|signin|sign-in|signup|register|sitemap|accessibility|press|investor|blog\/?$|news\/?$|#|mailto:|tel:|javascript:)/i;
const ASSET = /\.(png|jpe?g|gif|svg|webp|ico|css|js|zip|mp4|mp3|woff2?)(\?|$)/i;
const POSTING_HINT = /(job|career|position|opening|vacanc|intern|program|fellow|opportunit|apply|recruit|student|graduate|research|summer|scholar)/i;

/** Links worth showing the extractor: same site or a known ATS, postings first. */
export function candidateLinks(pageUrl: string, links: string[], max: number): string[] {
  const page = parseUrl(pageUrl);
  if (!page) return [];
  const site = baseDomain(hostOf(page));
  const seen = new Set<string>();
  const hinted: string[] = [];
  const rest: string[] = [];
  for (const raw of links) {
    const url = parseUrl(raw);
    if (!url || isExcluded(url) || ASSET.test(url.pathname) || JUNK_LINK.test(raw)) continue;
    const host = hostOf(url);
    const sameSite = baseDomain(host) === site;
    if (!sameSite && !detectAts(raw)) continue;
    const key = canonicalizeUrl(raw);
    if (!key || seen.has(key) || key === canonicalizeUrl(pageUrl)) continue;
    seen.add(key);
    (POSTING_HINT.test(url.pathname) ? hinted : rest).push(url.toString());
  }
  return [...hinted, ...rest].slice(0, max);
}

/** Human-readable organization guess from an ATS slug or host, e.g. "acme-robotics" -> "Acme Robotics". */
export function prettyOrg(slugOrHost: string): string {
  const base = slugOrHost.split("/")[0] ?? slugOrHost;
  const word = (base.replace(/\.(com|io|ai|co|org|net|edu|in|dev)$/i, "").split(".").pop() ?? base)
    // Board slugs often carry a suffix: "sonyglobal", "stripecareers", "acmejobs".
    .replace(/(?<=^[a-z0-9]{3,})(global|careers|career|jobs|external|inc|corp)$/i, "");
  return word
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
