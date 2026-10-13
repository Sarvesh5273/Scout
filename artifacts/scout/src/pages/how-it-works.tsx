import { Link } from 'wouter';
import { useGetUsage } from '@workspace/api-client-react';
import { Search, Globe, Bot, Sparkles, Merge, ArrowRight } from 'lucide-react';
import { shortDate, usd } from '@/lib/scout';

const steps = [
  { icon: Search, tool: 'Search', title: 'Find where openings live', body: 'From your brief, Scout writes targeted queries with TinyFish Search to discover careers pages, job-board postings and research-program pages that match your roles, places and level.' },
  { icon: Globe, tool: 'Fetch', title: 'Read the pages, live', body: 'TinyFish Fetch loads each page right now and returns its text and links, so Scout can find the individual postings and read their details instead of trusting a stale index.' },
  { icon: Bot, tool: 'Agent', title: 'Drive a browser where Fetch cannot', body: 'Some applicant-tracking portals only render with JavaScript. For those, TinyFish Agent drives a real browser through the portal. Its results are cached so the same portal is not re-run needlessly.' },
  { icon: Sparkles, tool: 'AI', title: 'Extract, label and score', body: 'An AI step pulls structured fields from each posting: visa sponsorship, stipend, travel, housing, deadline, eligibility. Each label keeps a short quote as evidence. Then every listing is scored against your preferences.' },
  { icon: Merge, tool: 'Merge', title: 'Deduplicate and rank', body: 'The same role often appears on a careers page and three job boards. Scout merges duplicates and hands back one ranked shortlist, marking what is new since last time.' },
];

export default function HowItWorksPage() {
  const usage = useGetUsage();
  const u = usage.data;
  const stats = u
    ? [
        ['Searches run', u.searches.toLocaleString()],
        ['Pages read', u.pagesRead.toLocaleString()],
        ['Browser runs', u.agentRuns.toLocaleString()],
        ['Agent spend', usd(u.agentCostUsd)],
        ['Listings tracked', u.listingsTracked.toLocaleString()],
        ['Organizations', u.organizationsTracked.toLocaleString()],
        ['Runs completed', u.runsCompleted.toLocaleString()],
      ]
    : [];

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-12 sm:pt-20">
      <p className="font-mono text-xs uppercase tracking-[0.25em] text-primary font-bold">How it works</p>
      <h1 className="mt-3 font-display text-4xl sm:text-6xl font-extrabold leading-[0.95] max-w-3xl">A research assistant that shows its work.</h1>
      <p className="mt-5 text-lg text-muted-foreground max-w-2xl">Scout is built on TinyFish. Here is exactly what happens between pressing search and reading your shortlist.</p>

      <ol className="mt-14 relative">
        <span className="absolute left-5 sm:left-7 top-2 bottom-2 w-px bg-border" />
        {steps.map((s, i) => (
          <li key={s.tool} className="rise relative grid grid-cols-[40px_1fr] sm:grid-cols-[56px_1fr] gap-4 sm:gap-8 pb-10" style={{ animationDelay: `${i * 80}ms` }}>
            <span className={`relative z-10 grid place-items-center h-10 w-10 sm:h-14 sm:w-14 rounded-full ${i === 2 ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>
              <s.icon className="h-5 w-5 sm:h-6 sm:w-6" />
            </span>
            <div className="pt-1 sm:pt-3">
              <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">0{i + 1} · {s.tool}</span>
              <h2 className="font-display text-2xl font-bold">{s.title}</h2>
              <p className="mt-2 text-muted-foreground max-w-2xl leading-relaxed">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className="mt-6 rounded-3xl bg-secondary text-secondary-foreground p-6 sm:p-10 relative overflow-hidden">
        <div className="absolute inset-0 grid-paper opacity-30" />
        <div className="relative">
          <h2 className="font-display text-3xl font-extrabold">Scout's field record</h2>
          <p className="text-secondary-foreground/60 text-sm">Live totals across every hunt{u?.since ? `, since ${shortDate(u.since)}` : ''}.</p>
          {usage.isLoading ? (
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4">{Array.from({ length: 7 }).map((_, i) => <div key={i} className="h-16 rounded-lg bg-secondary-foreground/10 animate-pulse" />)}</div>
          ) : usage.isError ? (
            <p className="mt-6 text-sm">Usage numbers are unavailable right now. <button onClick={() => usage.refetch()} className="underline" data-testid="button-retry-usage">Retry</button></p>
          ) : (
            <dl className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-6">
              {stats.map(([k, v], i) => (
                <div key={k} className="rise" style={{ animationDelay: `${i * 60}ms` }}>
                  <dd className="font-display text-4xl font-extrabold tabular-nums" data-testid={`text-usage-${k.toLowerCase().replace(/\s/g, '-')}`}>{v}</dd>
                  <dt className="font-mono text-[11px] uppercase tracking-wider text-secondary-foreground/60">{k}</dt>
                </div>
              ))}
            </dl>
          )}
        </div>
      </section>

      <div className="mt-12 text-center">
        <Link href="/hunts/new" className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-6 py-3 font-semibold shadow-md hover:-translate-y-0.5 transition-all" data-testid="link-start">
          Send Scout out <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
