# Scout

Scout is a web app that finds internships, jobs and funded research programs on the live web. You give it roles, places, seniority, visa needs and funding needs; it searches company careers pages, ATS job boards and research-program pages, then returns a deduplicated, ranked shortlist with apply links and visa / stipend / travel / housing / deadline labels quoted from each posting. Built for TinyFish Student Bounty Drop 001, "Job Portal / Careers Finder" (brief: `attached_assets/Pasted-TECHNICAL-STUDENT-BOUNTY-DROP-001-Job-Portal-Careers-Fi_1791362373408.txt`). Submission target: Oct 14, 2026 (IST); the bounty closes Oct 15, 11:59 PM PT.

History: Scout started as an iMessage assistant for the same drop's Photon brief. That brief was dropped on Oct 7, 2026 (the owner has no iPhone, which Photon's shared pool requires). The `SPECTRUM_*` secrets are unused leftovers.

## Run & Operate

- `artifacts/api-server: API Server` — Express on `/api`, plus the run queue and the refresh scheduler in the same process
- `artifacts/scout: web` — React + Vite frontend at `/`
- `pnpm run typecheck` — full typecheck; `pnpm --filter @workspace/api-spec run codegen` after editing `lib/api-spec/openapi.yaml`
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/scripts run spike:portals` — Fetch-vs-Agent readability spike (Agent runs cost wallet credit); `scripts/src/ats-feed-spike.ts` checks Fetch on ATS JSON feeds
- Secrets: `TINYFISH_API_KEY` (agent.tinyfish.ai). AI calls go through Replit AI Integrations (`AI_INTEGRATIONS_OPENAI_*`, no user key; billed to Replit credits).

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9, zod v3, Drizzle ORM 0.45 + PostgreSQL, Express 5, esbuild
- Web: TinyFish Search, Fetch and Agent via the official `@tiny-fish/sdk`, wrapped in `lib/tinyfish`
- AI: `gpt-5.6-luna` with strict `json_schema` output (`artifacts/api-server/src/lib/config.ts`)

## Where things live

- `lib/api-spec/openapi.yaml` — API contract; Orval generates `lib/api-zod` (server validation) and `lib/api-client-react` (frontend hooks)
- `lib/tinyfish` — the only place that talks to TinyFish
- `artifacts/api-server/src/pipeline` — one run: plan → Search → Fetch → AI extract → Agent (fallback) → re-check → match/score → store (`run.ts` orchestrates)
- `artifacts/api-server/src/lib/config.ts` — every cost and abuse limit (daily, per client, per run) and refresh cadence
- `artifacts/api-server/src/lib/presets.ts` — presets; the two `showcase` ones are seeded as public example hunts
- `artifacts/scout/src` — frontend

## Architecture decisions

- No accounts. Each browser keeps a random id in localStorage and sends it as `Authorization: Bearer <id>`; cookies are not used because the preview is a cross-site iframe that drops them. A user's hunts are private (other clients get 404). Showcase hunts are public and read-only.
- Detect roles by posting links (`fetch(..., { links: true })`), not page text: Fetch's markdown drops most list entries while its link list is complete. ATS boards are read through their public JSON feeds where possible.
- Agent is a fallback only: it runs for portals of companies the user named that Fetch couldn't read, with a step cap and a daily dollar budget.
- AI returns verdicts (role / location / eligibility fit) and labels; the 0–100 score is computed deterministically from them in `match.ts`. Listings are never hardcoded; showcase hunts are refreshed live on a schedule.
- One queued/running run per hunt is enforced by the partial unique index `runs_one_active_per_hunt_idx`.
- Use one shared TinyFish client per process: its semaphore enforces TinyFish's concurrent-Agent limit only within that instance.

## User preferences

- Demo and testing use real data only (no canned postings).
- Keep explanations short and simple.

## Gotchas

- Use `logger`/`req.log`, never `console.log`, in server code. Never log resume text or other PII.
- gpt-5.x models: use `max_completion_tokens`; they reject `temperature`.
- Orval: an operation with both path and query params emits two `ListXParams` exports and breaks the api-zod barrel, so `/listings` takes `huntId` as a query param.
- Posting locations are cities while preferences are usually countries; pre-ranking uses the small gazetteer in `pipeline/places.ts`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
