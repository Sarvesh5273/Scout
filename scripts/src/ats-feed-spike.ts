/**
 * Spike: can TinyFish Fetch read public ATS JSON feeds, and can Search find postings on ATS domains?
 * Run: pnpm --filter @workspace/scripts exec tsx ./src/ats-feed-spike.ts
 */
import { createTinyFishFromEnv } from "@workspace/tinyfish";

const tf = createTinyFishFromEnv();

const feeds = [
  "https://boards-api.greenhouse.io/v1/boards/groww/jobs",
  "https://api.lever.co/v0/postings/palantir?mode=json&commitment=Internship",
  "https://api.ashbyhq.com/posting-api/job-board/notion",
];

async function tryFeeds(format: "json" | "markdown") {
  try {
    const res = await tf.fetch(feeds, { format, perUrlTimeoutMs: 30_000 });
    console.log(`\n== Fetch feeds format=${format} in ${res.ms}ms`);
    for (const p of res.pages) {
      const body = format === "json" ? JSON.stringify(p.json) : p.text;
      console.log(`- ${p.url}\n  size=${body?.length ?? 0} preview=${body?.slice(0, 300).replace(/\s+/g, " ")}`);
    }
    for (const e of res.errors) console.log(`- ERROR ${e.url}: ${e.error}`);
  } catch (err) {
    console.log(`Fetch format=${format} threw`, (err as Error).message);
  }
}

async function trySearch(query: string, includeDomains?: string[]) {
  try {
    const res = await tf.search(query, includeDomains ? { includeDomains } : {});
    console.log(`\n== Search "${query}" domains=${includeDomains?.join(",") ?? "-"} (${res.ms}ms)`);
    for (const r of res.results.slice(0, 10)) console.log(`- ${r.url} | ${r.title.slice(0, 80)}`);
  } catch (err) {
    console.log(`Search threw`, (err as Error).message);
  }
}

const ats = ["boards.greenhouse.io", "job-boards.greenhouse.io", "jobs.lever.co", "jobs.ashbyhq.com"];

await Promise.all([
  tryFeeds("json"),
  tryFeeds("markdown"),
  trySearch("software engineer intern 2027", ats),
  trySearch("machine learning internship Germany visa sponsorship", [...ats, "myworkdayjobs.com"]),
  trySearch("fully funded summer research internship international students computer science 2027"),
]);
