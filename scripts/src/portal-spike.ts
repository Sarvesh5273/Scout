/**
 * Day-1 spike: which career portals can TinyFish Fetch read, and what does Agent cost when it can't?
 *
 *   pnpm --filter @workspace/scripts run spike:portals
 *   pnpm --filter @workspace/scripts run spike:portals -- --only=notion,atlassian --agent=all --max-seconds=90
 *
 * --agent=fallback (default) runs Agent only where Fetch found no postings, mirroring Scout's
 * "Agent learns once, Fetch polls for free" ladder. --agent=all forces it, --agent=none skips it.
 *
 * Readability is judged by posting links, not page text: Fetch's markdown drops most list entries
 * (Palantir's Lever board: 3 roles in the text, 314 posting links), while its link list is complete.
 */
import {
  AGENT_STEP_COST_USD,
  createTinyFishFromEnv,
  type AgentOutcome,
  type OutputSchema,
  type TinyFishClient,
} from "@workspace/tinyfish";

interface Target {
  company: string;
  portal: string;
  url: string;
  /** An intern-filtered URL to test with free Fetch, when the portal's filter syntax is known. */
  filteredUrl?: string;
}

const TARGETS: Target[] = [
  { company: "Groww", portal: "greenhouse", url: "https://job-boards.greenhouse.io/groww" },
  {
    company: "Palantir",
    portal: "lever",
    url: "https://jobs.lever.co/palantir",
    filteredUrl: "https://jobs.lever.co/palantir?commitment=Internship",
  },
  { company: "Notion", portal: "ashby", url: "https://jobs.ashbyhq.com/notion" },
  {
    company: "NVIDIA",
    portal: "workday",
    url: "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite",
    filteredUrl: "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite?q=intern",
  },
  { company: "Visa", portal: "smartrecruiters", url: "https://careers.smartrecruiters.com/Visa" },
  { company: "Google", portal: "bigtech-custom", url: "https://www.google.com/about/careers/applications/jobs/results/?q=software%20intern" },
  { company: "Razorpay", portal: "india-custom", url: "https://razorpay.com/careers/" },
  { company: "Atlassian", portal: "custom (demo)", url: "https://www.atlassian.com/company/careers/all-jobs" },
  { company: "Figma", portal: "custom (demo)", url: "https://www.figma.com/careers/" },
];

/** Links that point at a single job posting on a common ATS or a typical custom careers site. */
const POSTING_LINK = new RegExp(
  [
    String.raw`lever\.co/[^/]+/[0-9a-f-]{36}`,
    String.raw`greenhouse\.io/[^/]+/jobs/\d+`,
    String.raw`gh_jid=\d+`,
    String.raw`ashbyhq\.com/[^/]+/[0-9a-f-]{36}`,
    String.raw`smartrecruiters\.com/[^/]+/\d{6,}`,
    String.raw`myworkdayjobs\.com/.+/job/`,
    String.raw`careers?/(details|jobs?|positions?)/[^?#]*\d{4,}`,
    String.raw`jobs/results/\d+`,
  ].join("|"),
  "i",
);
const ROLE_WORDS = /\b(engineer|developer|intern(ship)?|analyst|scientist|designer|manager|associate|specialist|architect)\b/i;
const MIN_POSTINGS = 3;

const LEARN_SCHEMA: OutputSchema = {
  type: "object",
  properties: {
    success: { type: "boolean" },
    failure_reason: { type: "string", nullable: true },
    results_url: { type: "string", nullable: true },
    filters_applied: { type: "array", items: { type: "string" } },
    roles: {
      type: "array",
      maxItems: 25,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          location: { type: "string" },
          url: { type: "string" },
        },
        required: ["title"],
      },
    },
  },
  required: ["success", "roles"],
};

function learnGoal(company: string): string {
  return [
    `You are on the careers site of ${company}.`,
    "Find currently open software engineering internship roles. If there are none, return open entry-level software roles instead.",
    "Use the site's own search box or filters (for example search 'intern' or filter by 'Internship') when they exist.",
    "Do not apply, do not log in, and do not enter any personal details.",
    "Return the matching roles visible on the results page (at most 25).",
    "If the address bar changed to reflect your search or filters, put that full URL in results_url; otherwise leave it null.",
    "If the site blocks you, shows a captcha, or requires a login to see roles, set success to false and explain in failure_reason.",
  ].join(" ");
}

interface Args {
  only: string[] | null;
  agent: "fallback" | "all" | "none";
  maxSeconds: number;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const agent = get("agent") ?? "fallback";
  if (agent !== "fallback" && agent !== "all" && agent !== "none") {
    throw new Error(`--agent must be fallback, all or none (got "${agent}")`);
  }
  const maxSeconds = Number(get("max-seconds") ?? 90);
  if (!Number.isFinite(maxSeconds) || maxSeconds < 30 || maxSeconds > 300) {
    throw new Error("--max-seconds must be between 30 and 300");
  }
  const only = get("only")?.toLowerCase().split(",").filter(Boolean) ?? null;
  return { only, agent, maxSeconds };
}

function roleLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/[#*_[\]()>|`]/g, " ").replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 4 && l.length < 120 && ROLE_WORDS.test(l));
}

function postingLinks(links: string[]): string[] {
  return [...new Set(links.filter((l) => POSTING_LINK.test(l)))];
}

function host(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function short(err: unknown): string {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return msg.slice(0, 160);
}

/** What one Fetch of one URL showed. */
interface PageRead {
  postings: number;
  roleLines: number;
  hasIntern: boolean;
  chars: number;
  ms: number | null;
  error: string | null;
  samples: string[];
}

async function readPage(tf: TinyFishClient, url: string): Promise<PageRead> {
  const read: PageRead = { postings: 0, roleLines: 0, hasIntern: false, chars: 0, ms: null, error: null, samples: [] };
  try {
    const out = await tf.fetch([url], { ttl: 0, links: true });
    read.ms = out.ms;
    const page = out.pages[0];
    if (page) {
      const lines = roleLines(page.text);
      read.postings = postingLinks(page.links).length;
      read.roleLines = lines.length;
      read.hasIntern = lines.some((l) => /intern/i.test(l));
      read.chars = page.text.length;
      read.samples = lines.slice(0, 3);
    }
    if (out.errors[0]) read.error = out.errors[0].error;
  } catch (err) {
    read.error = short(err);
  }
  return read;
}

interface Row {
  target: Target;
  searchTop: string | null;
  searchHit: boolean | null;
  searchError: string | null;
  base: PageRead;
  filtered: PageRead | null;
  agent: AgentOutcome | null;
  agentError: string | null;
  agentRoles: number | null;
  recipeUrl: string | null;
  recipe: PageRead | null;
}

async function runTarget(tf: TinyFishClient, target: Target, args: Args): Promise<Row> {
  const row: Row = {
    target,
    searchTop: null,
    searchHit: null,
    searchError: null,
    base: await readPage(tf, target.url),
    filtered: target.filteredUrl ? await readPage(tf, target.filteredUrl) : null,
    agent: null,
    agentError: null,
    agentRoles: null,
    recipeUrl: null,
    recipe: null,
  };

  // Search: does it surface the official careers page?
  try {
    const { results } = await tf.search(`${target.company} careers software engineering internship`, {
      purpose: "Find the company's official careers or jobs page",
    });
    const slug = target.company.toLowerCase();
    row.searchTop = results[0]?.url ?? null;
    row.searchHit = results.slice(0, 5).some((r) => host(r.url) === host(target.url) || host(r.url).includes(slug));
  } catch (err) {
    row.searchError = short(err);
  }

  const fetchFound = row.base.postings >= MIN_POSTINGS;
  const shouldRunAgent = args.agent === "all" || (args.agent === "fallback" && !fetchFound);
  if (!shouldRunAgent) return row;

  // Agent: learn the portal (filters -> roles + filtered URL).
  try {
    const outcome = await tf.runAgent({
      url: target.url,
      goal: learnGoal(target.company),
      outputSchema: LEARN_SCHEMA,
      maxDurationSeconds: args.maxSeconds,
      onStreamingUrl: (url) => console.log(`  [${target.company}] watch live: ${url}`),
    });
    row.agent = outcome;
    const roles = outcome.result?.["roles"];
    row.agentRoles = Array.isArray(roles) ? roles.length : null;
    const resultsUrl = outcome.result?.["results_url"];
    if (typeof resultsUrl === "string" && resultsUrl.startsWith("http") && resultsUrl !== target.url) {
      row.recipeUrl = resultsUrl;
    }
  } catch (err) {
    row.agentError = short(err);
  }

  // Recipe check: can free Fetch poll the URL that Agent found?
  if (row.recipeUrl) row.recipe = await readPage(tf, row.recipeUrl);
  return row;
}

function verdict(row: Row): string {
  if (row.base.postings >= MIN_POSTINGS) return "FETCH";
  if (row.filtered && row.filtered.postings >= MIN_POSTINGS) return "FETCH (filtered URL)";
  if (row.agent?.ok && (row.recipe?.postings ?? 0) >= MIN_POSTINGS) return "AGENT once -> FETCH";
  if (row.agent?.ok) return "AGENT each poll";
  if (row.base.roleLines >= MIN_POSTINGS) return "TEXT ONLY (check by hand)";
  return "UNREADABLE";
}

function describe(read: PageRead): string {
  const error = read.error ? `error ${read.error} · ` : "";
  const intern = read.hasIntern ? " (incl. intern)" : "";
  return `${error}${read.postings} posting links · ${read.roleLines} role-like lines${intern} · ${read.chars} chars · ${read.ms ?? "-"} ms`;
}

function printRow(row: Row): void {
  const a = row.agent;
  const lines = [
    `\n== ${row.target.company} (${row.target.portal})  ->  ${verdict(row)}`,
    `  search:   ${row.searchError ?? `${row.searchHit ? "hit" : "miss"} · top: ${row.searchTop ?? "none"}`}`,
    `  fetch:    ${describe(row.base)}`,
    ...row.base.samples.map((s) => `            e.g. ${s}`),
  ];
  if (row.filtered) lines.push(`  filtered: ${describe(row.filtered)}  <- ${row.target.filteredUrl}`);
  if (a) {
    lines.push(
      `  agent:    ${a.ok ? "ok" : `FAILED (${a.failureReason})`} · ${row.agentRoles ?? "?"} roles · ${a.steps ?? "?"} steps · ${a.seconds}s · ~$${a.estimatedCostUsd ?? "?"}`,
    );
    if (row.recipeUrl && row.recipe) lines.push(`  recipe:   ${describe(row.recipe)}  <- ${row.recipeUrl}`);
  } else if (row.agentError) {
    lines.push(`  agent:    error ${row.agentError}`);
  }
  console.log(lines.join("\n"));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const targets = args.only ? TARGETS.filter((t) => args.only!.includes(t.company.toLowerCase())) : TARGETS;
  if (targets.length === 0) throw new Error(`--only matched no targets. Options: ${TARGETS.map((t) => t.company).join(", ")}`);

  // One shared client, so its semaphore holds Agent at 2 concurrent runs. Search/Fetch stay well inside free limits.
  const tf = createTinyFishFromEnv();
  const before = await tf.getWalletBalance().catch(() => null);
  console.log(`Spike: ${targets.length} portals · agent=${args.agent} · cap ${args.maxSeconds}s/run${before ? ` · wallet ${before.available} ${before.currency}` : ""}`);

  const rows = await Promise.all(
    targets.map((t) =>
      runTarget(tf, t, args).then((row) => {
        printRow(row);
        return row;
      }),
    ),
  );

  const agentRows = rows.filter((r) => r.agent);
  const steps = agentRows.reduce((sum, r) => sum + (r.agent?.steps ?? 0), 0);
  const after = agentRows.length > 0 && before ? await tf.getWalletBalance().catch(() => null) : null;
  console.log("\n== Summary");
  for (const r of rows) console.log(`  ${r.target.company.padEnd(10)} ${r.target.portal.padEnd(16)} ${verdict(r)}`);
  console.log(`  agent runs: ${agentRows.length} · steps: ${steps} · est. $${(steps * AGENT_STEP_COST_USD).toFixed(2)}`);
  if (before && after) {
    console.log(`  wallet: ${before.available} -> ${after.available} ${after.currency} (measured spend ${(before.available - after.available).toFixed(2)})`);
  }
}

main().catch((err) => {
  console.error(short(err));
  process.exit(1);
});
