import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  useGetHunt,
  getGetHuntQueryKey,
  useListListings,
  getListListingsQueryKey,
  useGetHuntSummary,
  getGetHuntSummaryQueryKey,
  useListHuntSources,
  getListHuntSourcesQueryKey,
  useListHuntRuns,
  getListHuntRunsQueryKey,
  useStartHuntRun,
  type ListListingsParams,
  type HuntSummary,
  type Hunt,
} from '@workspace/api-client-react';
import { ArrowLeft, Pencil, RotateCw, Search, Lock, X, SlidersHorizontal, Globe, Bot, ExternalLink } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { RunPanel } from '@/components/run-panel';
import { ListingCard } from '@/components/listing-card';
import { ScoutMark } from '@/components/shell';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { ago, apiErrorMessage, apiErrorStatus, isActiveRun, deadlineInfo, usd, hostOf, untilRefresh } from '@/lib/scout';
import NotFound from '@/pages/not-found';

type Filters = Required<Omit<ListListingsParams, 'huntId' | 'kind' | 'q'>> & { kind: 'all' | 'job' | 'program' };
const defaultFilters: Filters = { view: 'all', kind: 'all', visa: 'any', funding: 'any', minScore: 0, sort: 'score' };

function Seg<T extends string>({ value, onChange, options, testId }: { value: T; onChange: (v: T) => void; options: { v: T; label: string; count?: number }[]; testId: string }) {
  return (
    <div className="inline-flex rounded-full bg-muted p-0.5 overflow-x-auto max-w-full">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            'whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-all',
            value === o.v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
          data-testid={`${testId}-${o.v}`}
        >
          {o.label}
          {o.count !== undefined && <span className="ml-1 font-mono opacity-60">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

function SummaryStrip({ s }: { s: HuntSummary }) {
  const visaTotal = Math.max(1, s.byVisa.sponsors + s.byVisa.not_sponsored + s.byVisa.citizens_only + s.byVisa.unknown);
  const fundTotal = Math.max(1, s.byFunding.fully_funded + s.byFunding.paid + s.byFunding.unpaid + s.byFunding.unknown);
  const bar = (parts: [number, string, string][], total: number) => (
    <div className="flex h-2 rounded-full overflow-hidden bg-muted">
      {parts.map(([n, c, t]) => n > 0 && <span key={t} title={`${t}: ${n}`} className={c} style={{ width: `${(n / total) * 100}%` }} />)}
    </div>
  );
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-px rounded-2xl overflow-hidden border bg-border" data-testid="panel-summary">
      <div className="bg-card p-4">
        <div className="font-display text-4xl font-extrabold tabular-nums">{s.total}</div>
        <div className="text-xs text-muted-foreground">{s.byKind.job} jobs · {s.byKind.program} programs</div>
      </div>
      <div className="bg-card p-4">
        <div className="font-display text-4xl font-extrabold tabular-nums text-primary">{s.new}</div>
        <div className="text-xs text-muted-foreground">new · {s.saved} saved · {s.hidden} hidden</div>
      </div>
      <div className="bg-card p-4 space-y-2">
        <div className="flex justify-between text-xs"><span className="font-semibold">Visa</span><span className="font-mono text-[hsl(var(--visa))]">{s.byVisa.sponsors} sponsor</span></div>
        {bar([[s.byVisa.sponsors, 'bg-[hsl(var(--visa))]', 'Sponsors'], [s.byVisa.unknown, 'bg-muted-foreground/30', 'Not stated'], [s.byVisa.not_sponsored, 'bg-destructive/60', 'No'], [s.byVisa.citizens_only, 'bg-destructive', 'Citizens only']], visaTotal)}
        <div className="text-[11px] text-muted-foreground">{s.byVisa.unknown} unstated · {s.byVisa.not_sponsored + s.byVisa.citizens_only} ruled out</div>
      </div>
      <div className="bg-card p-4 space-y-2">
        <div className="flex justify-between text-xs"><span className="font-semibold">Funding</span><span className="font-mono">{s.byFunding.fully_funded} full</span></div>
        {bar([[s.byFunding.fully_funded, 'bg-accent', 'Fully funded'], [s.byFunding.paid, 'bg-accent/50', 'Paid'], [s.byFunding.unknown, 'bg-muted-foreground/30', 'Not stated'], [s.byFunding.unpaid, 'bg-foreground/40', 'Unpaid']], fundTotal)}
        <div className="text-[11px] text-muted-foreground">{s.byFunding.paid} paid · {s.byFunding.unpaid} unpaid</div>
      </div>
    </div>
  );
}

function Briefing({ hunt }: { hunt: Hunt }) {
  const p = hunt.preferences;
  const bits = [
    p.roles.join(' / '),
    p.locations.length ? p.locations.join(', ') : 'anywhere',
    p.remoteOk ? 'remote ok' : null,
    p.needsVisaSponsorship ? `needs visa${p.citizenship ? ` (${p.citizenship})` : ''}` : null,
    p.funding !== 'any' ? (p.funding === 'fully_funded' ? 'fully funded' : 'paid') : null,
  ].filter(Boolean);
  return <p className="mt-2 text-muted-foreground">{bits.join(' · ')}</p>;
}

export default function HuntDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [tab, setTab] = useState<'sources' | 'runs'>('sources');
  const [startedRunId, setStartedRunId] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const hunt = useGetHunt(id, { query: { enabled: !!id, queryKey: getGetHuntQueryKey(id) } });
  const listParams: ListListingsParams = {
    huntId: id,
    view: filters.view,
    visa: filters.visa,
    funding: filters.funding,
    minScore: filters.minScore,
    sort: filters.sort,
    ...(filters.kind !== 'all' ? { kind: filters.kind } : {}),
    ...(dq ? { q: dq } : {}),
  };
  const listings = useListListings(listParams, { query: { enabled: !!id, queryKey: getListListingsQueryKey(listParams), placeholderData: keepPreviousData } });
  const summary = useGetHuntSummary(id, { query: { enabled: !!id, queryKey: getGetHuntSummaryQueryKey(id) } });
  const sources = useListHuntSources(id, { query: { enabled: !!id, queryKey: getListHuntSourcesQueryKey(id) } });
  const runs = useListHuntRuns(id, { query: { enabled: !!id, queryKey: getListHuntRunsQueryKey(id) } });
  const start = useStartHuntRun();

  if (!id || apiErrorStatus(hunt.error) === 404) return <NotFound />;

  if (hunt.isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-10 space-y-4">
        <div className="h-10 w-2/3 rounded-lg bg-muted animate-pulse" />
        <div className="h-28 rounded-2xl bg-card border animate-pulse" />
        {[0, 1, 2].map((i) => <div key={i} className="h-36 rounded-xl bg-card border animate-pulse" />)}
      </div>
    );
  }
  if (hunt.isError || !hunt.data) {
    return (
      <div className="mx-auto max-w-xl px-4 pt-20 text-center">
        <h1 className="font-display text-3xl font-bold">Scout lost the trail</h1>
        <p className="mt-2 text-muted-foreground">{apiErrorMessage(hunt.error, 'This hunt could not be loaded.')}</p>
        <button onClick={() => hunt.refetch()} className="mt-5 inline-flex items-center gap-2 rounded-full bg-foreground text-background px-5 py-2 text-sm font-semibold" data-testid="button-retry-hunt">
          <RotateCw className="h-4 w-4" /> Try again
        </button>
      </div>
    );
  }

  const h = hunt.data;
  const latest = h.latestRun;
  const runId = startedRunId && (!latest || latest.id <= startedRunId) ? startedRunId : latest?.id;
  const running = isActiveRun(latest?.status) || (startedRunId !== null && startedRunId === runId && (!latest || latest.id !== startedRunId || isActiveRun(latest.status)));
  const s = summary.data;
  const items = listings.data ?? [];
  const filtersActive = JSON.stringify(filters) !== JSON.stringify(defaultFilters) || !!dq;

  const searchAgain = () =>
    start.mutate(
      { huntId: id },
      {
        onSuccess: (r) => {
          setStartedRunId(r.id);
          qc.invalidateQueries({ queryKey: getGetHuntQueryKey(id) });
          qc.invalidateQueries({ queryKey: getListHuntRunsQueryKey(id) });
          toast({ title: 'Scout is on it', description: 'Results will appear as soon as the run finishes.' });
        },
        onError: (e) => {
          if (apiErrorStatus(e) === 409) qc.invalidateQueries({ queryKey: getGetHuntQueryKey(id) });
          toast({ title: apiErrorStatus(e) === 409 ? 'Already searching' : 'Could not start a search', description: apiErrorMessage(e), variant: 'destructive' });
        },
      },
    );

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-6 sm:pt-10">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back">
        <ArrowLeft className="h-4 w-4" /> All hunts
      </Link>

      <header className="mt-3 flex flex-col md:flex-row md:items-end gap-4">
        <div className="min-w-0 flex-1">
          {h.isShowcase && (
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary text-secondary-foreground px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider">
              <Lock className="h-3 w-3" /> Showcase · refreshes on its own {h.nextRefreshAt && `· next refresh ${untilRefresh(h.nextRefreshAt)}`}
            </span>
          )}
          <h1 className="mt-2 font-display text-3xl sm:text-5xl font-extrabold leading-tight" data-testid="text-hunt-name">{h.name}</h1>
          <Briefing hunt={h} />
          <p className="mt-1 font-mono text-xs text-muted-foreground">{h.lastRunAt ? `Last checked ${ago(h.lastRunAt)}` : 'Not searched yet'}</p>
        </div>
        {!h.readOnly && (
          <div className="flex gap-2">
            <Link href={`/hunts/${id}/edit`} className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2.5 text-sm font-semibold hover:bg-muted transition-colors" data-testid="link-edit">
              <Pencil className="h-4 w-4" /> Edit
            </Link>
            <button
              onClick={searchAgain}
              disabled={start.isPending || running}
              className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold shadow-md hover:-translate-y-px transition-all disabled:opacity-60 disabled:hover:translate-y-0"
              data-testid="button-search-again"
            >
              <RotateCw className={cn('h-4 w-4', (start.isPending || running) && 'animate-spin')} />
              {running ? 'Searching…' : 'Search again now'}
            </button>
          </div>
        )}
      </header>

      {runId && (
        <div className="mt-6">
          <RunPanel key={runId} runId={runId} huntId={id} knownStatus={runId === latest?.id ? latest.status : 'queued'} />
        </div>
      )}

      {s && s.total > 0 && <div className="mt-6"><SummaryStrip s={s} /></div>}

      <div className="mt-8 grid lg:grid-cols-[1fr_320px] gap-8">
        <section>
          <div className="sticky top-14 z-20 -mx-4 px-4 sm:mx-0 sm:px-0 py-3 bg-background/90 backdrop-blur-md space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Seg value={filters.view} onChange={(v) => set('view', v)} testId="tab-view" options={[
                { v: 'all', label: 'All', count: s ? s.total - s.hidden : undefined },
                { v: 'new', label: 'New', count: s?.new },
                { v: 'saved', label: 'Saved', count: s?.saved },
                { v: 'hidden', label: 'Hidden', count: s?.hidden },
              ]} />
              <div className="relative flex-1 min-w-[10rem]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  value={q}
                  maxLength={80}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Filter by title, org, place"
                  className="w-full rounded-full border border-input bg-card pl-9 pr-8 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary"
                  data-testid="input-search"
                />
                {q && <button onClick={() => setQ('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear"><X className="h-4 w-4" /></button>}
              </div>
              <button
                onClick={() => setShowFilters((x) => !x)}
                className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold transition-colors', showFilters || filtersActive ? 'bg-foreground text-background border-foreground' : 'hover:bg-muted')}
                data-testid="button-toggle-filters"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
              </button>
            </div>
            {showFilters && (
              <div className="rise rounded-2xl border bg-card p-4 grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5"><span className="text-xs font-semibold text-muted-foreground">Visa</span>
                  <Seg value={filters.visa} onChange={(v) => set('visa', v)} testId="filter-visa" options={[{ v: 'any', label: 'Any' }, { v: 'sponsors', label: 'Sponsors' }, { v: 'not_restricted', label: 'Not ruled out' }]} /></div>
                <div className="space-y-1.5"><span className="text-xs font-semibold text-muted-foreground">Funding</span>
                  <Seg value={filters.funding} onChange={(v) => set('funding', v)} testId="filter-funding" options={[{ v: 'any', label: 'Any' }, { v: 'paid', label: 'Paid' }, { v: 'fully_funded', label: 'Fully funded' }]} /></div>
                <div className="space-y-1.5"><span className="text-xs font-semibold text-muted-foreground">Kind</span>
                  <Seg value={filters.kind} onChange={(v) => set('kind', v)} testId="filter-kind" options={[{ v: 'all', label: 'Both' }, { v: 'job', label: 'Jobs' }, { v: 'program', label: 'Programs' }]} /></div>
                <div className="space-y-1.5"><span className="text-xs font-semibold text-muted-foreground">Sort</span>
                  <Seg value={filters.sort} onChange={(v) => set('sort', v)} testId="filter-sort" options={[{ v: 'score', label: 'Best fit' }, { v: 'newest', label: 'Newest' }, { v: 'deadline', label: 'Deadline' }]} /></div>
                <div className="sm:col-span-2 space-y-2">
                  <div className="flex justify-between text-xs"><span className="font-semibold text-muted-foreground">Minimum fit</span><span className="font-mono font-bold">{filters.minScore}</span></div>
                  <Slider value={[filters.minScore]} min={0} max={100} step={5} onValueChange={(v) => set('minScore', v[0])} data-testid="slider-min-score" />
                </div>
                {filtersActive && (
                  <button onClick={() => { setFilters(defaultFilters); setQ(''); }} className="sm:col-span-2 justify-self-start text-xs font-semibold text-primary hover:underline" data-testid="button-reset-filters">Reset filters</button>
                )}
              </div>
            )}
          </div>

          <div className={cn('mt-3 space-y-4 transition-opacity', listings.isFetching && listings.isPlaceholderData && 'opacity-60')}>
            {listings.isLoading ? (
              [0, 1, 2].map((i) => <div key={i} className="h-40 rounded-xl border bg-card animate-pulse" />)
            ) : listings.isError ? (
              <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-5 text-sm text-destructive flex justify-between items-center">
                {apiErrorMessage(listings.error, 'Could not load listings.')}
                <button onClick={() => listings.refetch()} className="underline" data-testid="button-retry-listings">Retry</button>
              </div>
            ) : items.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed p-10 text-center">
                <ScoutMark className={cn('mx-auto h-12 w-12 text-muted-foreground/50', running && 'radar')} />
                <h3 className="mt-3 font-display text-xl font-bold">
                  {running ? 'Scout is still out reading' : filtersActive ? 'Nothing matches these filters' : !h.lastRunAt ? 'No search yet' : filters.view === 'saved' ? 'Nothing saved yet' : 'No listings found this time'}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
                  {running ? 'Listings land here the moment the run wraps up. Watch the field log above.' : filtersActive ? 'Loosen a filter or clear the search to see more.' : filters.view === 'saved' ? 'Bookmark listings to build your shortlist.' : h.readOnly ? 'This showcase hunt will refresh on its own schedule.' : 'Try broader roles or more locations, then search again.'}
                </p>
                {filtersActive && !running && (
                  <button onClick={() => { setFilters(defaultFilters); setQ(''); }} className="mt-4 rounded-full border px-4 py-2 text-sm font-semibold hover:bg-muted" data-testid="button-clear-empty">Clear filters</button>
                )}
              </div>
            ) : (
              items.map((l, i) => <ListingCard key={l.id} listing={l} huntId={id} readOnly={h.readOnly} index={i} />)
            )}
          </div>
        </section>

        <aside className="space-y-6">
          {s && s.upcomingDeadlines.length > 0 && (
            <div className="rounded-2xl bg-secondary text-secondary-foreground p-5">
              <h3 className="font-display font-bold text-lg">Closing soon</h3>
              <ul className="mt-3 space-y-3">
                {s.upcomingDeadlines.slice(0, 6).map((d) => {
                  const di = deadlineInfo(d.deadline);
                  return (
                    <li key={d.listingId} className="text-sm" data-testid={`row-deadline-${d.listingId}`}>
                      <div className={cn('font-mono text-[11px] font-bold', di.tone === 'urgent' ? 'text-primary' : 'text-secondary-foreground/60')}>{di.label}</div>
                      <div className="font-semibold leading-snug">{d.title}</div>
                      <div className="text-secondary-foreground/60 text-xs">{d.organization}</div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {s && s.topOrganizations.length > 0 && (
            <div className="rounded-2xl border bg-card p-5">
              <h3 className="font-display font-bold text-lg">Who is hiring</h3>
              <ul className="mt-3 space-y-1.5">
                {s.topOrganizations.slice(0, 8).map((o) => (
                  <li key={o.organization} className="flex items-center justify-between text-sm">
                    <span className="truncate">{o.organization}</span>
                    <span className="font-mono text-xs text-muted-foreground">{o.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-2xl border bg-card overflow-hidden">
            <div className="flex border-b">
              {(['sources', 'runs'] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)} className={cn('flex-1 py-3 text-sm font-semibold transition-colors', tab === t ? 'bg-card text-foreground shadow-[inset_0_-2px_0_hsl(var(--primary))]' : 'bg-muted/50 text-muted-foreground hover:text-foreground')} data-testid={`tab-${t}`}>
                  {t === 'sources' ? `Sources${sources.data ? ` · ${sources.data.length}` : ''}` : 'Run history'}
                </button>
              ))}
            </div>
            <div className="max-h-[28rem] overflow-y-auto p-3">
              {tab === 'sources' ? (
                sources.isLoading ? <div className="h-24 animate-pulse bg-muted rounded-lg" /> :
                sources.isError ? <button onClick={() => sources.refetch()} className="text-sm text-destructive underline p-2">Could not load sources. Retry</button> :
                (sources.data ?? []).length === 0 ? <p className="p-3 text-sm text-muted-foreground">Scout has not checked any sources for this hunt yet.</p> : (
                  <ul className="space-y-1">
                    {(sources.data ?? []).map((src) => (
                      <li key={src.id} className="rounded-lg p-2 hover:bg-muted/60 transition-colors" data-testid={`row-source-${src.id}`}>
                        <div className="flex items-center gap-2">
                          <span className={cn('h-2 w-2 rounded-full shrink-0', src.status === 'ok' ? 'bg-[hsl(var(--visa))]' : src.status === 'empty' ? 'bg-muted-foreground/40' : 'bg-destructive')} title={src.status} />
                          <a href={src.url} target="_blank" rel="noreferrer" className="text-sm font-medium truncate hover:text-primary flex-1">{src.label}</a>
                          {src.readMethod === 'agent' ? <Bot className="h-3.5 w-3.5 text-primary shrink-0" aria-label="Read by Agent" /> : <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-label="Read by Fetch" />}
                        </div>
                        <div className="ml-4 font-mono text-[10px] text-muted-foreground">
                          {hostOf(src.url)} · {src.kind.replace('_', ' ')} · {src.listingsFound} found · {src.status}
                        </div>
                        {src.note && <div className="ml-4 text-xs text-muted-foreground italic">{src.note}</div>}
                      </li>
                    ))}
                  </ul>
                )
              ) : runs.isLoading ? <div className="h-24 animate-pulse bg-muted rounded-lg" /> :
                runs.isError ? <button onClick={() => runs.refetch()} className="text-sm text-destructive underline p-2">Could not load runs. Retry</button> :
                (runs.data ?? []).length === 0 ? <p className="p-3 text-sm text-muted-foreground">No runs yet.</p> : (
                <ol className="relative ml-2 border-l pl-4 space-y-4 py-2">
                  {(runs.data ?? []).map((r) => (
                    <li key={r.id} className="relative" data-testid={`row-run-${r.id}`}>
                      <span className={cn('absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-card', r.status === 'completed' ? 'bg-[hsl(var(--visa))]' : r.status === 'partial' ? 'bg-[hsl(var(--fund))]' : r.status === 'failed' ? 'bg-destructive' : 'bg-primary animate-pulse')} />
                      <div className="flex justify-between text-sm"><span className="font-semibold capitalize">{r.status}</span><span className="font-mono text-[11px] text-muted-foreground">{ago(r.startedAt)}</span></div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {r.trigger} · {r.stats.listingsFound} found · {r.stats.newListings} new · {r.stats.sourcesChecked} sources · {usd(r.stats.estimatedCostUsd)}
                      </div>
                      {r.error && <div className="text-xs text-destructive mt-0.5">{r.error}</div>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
          <Link href="/how-it-works" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid="link-how-aside">
            How Scout reads these pages <ExternalLink className="h-3 w-3" />
          </Link>
        </aside>
      </div>
    </div>
  );
}
