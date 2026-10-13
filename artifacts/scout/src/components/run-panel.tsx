import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetRun,
  getGetRunQueryKey,
  getGetHuntQueryKey,
  getListListingsQueryKey,
  getGetHuntSummaryQueryKey,
  getListHuntSourcesQueryKey,
  getListHuntRunsQueryKey,
  getListHuntsQueryKey,
  type RunStatus,
  type RunEvent,
} from '@workspace/api-client-react';
import { AlertTriangle, CheckCircle2, CircleDashed, XCircle, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isActiveRun, toolLabel, hostOf, usd } from '@/lib/scout';
import { format, parseISO } from 'date-fns';

// Matches the order the pipeline emits events in: Agent only runs after Fetch + AI reading come up short.
const STAGES = ['plan', 'search', 'fetch', 'extract', 'agent', 'match', 'done'] as const;
const stageName: Record<string, string> = {
  plan: 'Plan',
  search: 'Search',
  fetch: 'Read',
  agent: 'Browse',
  extract: 'Extract',
  match: 'Rank',
  done: 'Done',
};

const toolTone: Record<string, string> = {
  search: 'bg-[hsl(var(--visa))]/15 text-[hsl(var(--visa))]',
  fetch: 'bg-accent/40 text-foreground',
  agent: 'bg-primary/15 text-primary',
  ai: 'bg-foreground/10 text-foreground',
  system: 'bg-muted text-muted-foreground',
};

function EventRow({ e, latest }: { e: RunEvent; latest: boolean }) {
  const warn = e.stage === 'warning';
  const err = e.stage === 'error';
  return (
    <li className="rise flex gap-3 py-2 border-b border-border/50 last:border-0">
      <span className="font-mono text-[10px] text-muted-foreground pt-1 w-14 shrink-0 tabular-nums">
        {(() => {
          try {
            return format(parseISO(e.at), 'HH:mm:ss');
          } catch {
            return '';
          }
        })()}
      </span>
      <span className={cn('h-fit rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider shrink-0', toolTone[e.tool])}>
        {toolLabel[e.tool]}
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p className={cn(warn && 'text-[hsl(var(--fund))]', err && 'text-destructive', latest && 'font-medium')}>
          {(warn || err) && <AlertTriangle className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />}
          {e.message}
        </p>
        {e.url && (
          <a href={e.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-primary truncate max-w-full">
            {hostOf(e.url)} <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </li>
  );
}

export function RunPanel({ runId, huntId, knownStatus }: { runId: number; huntId: number; knownStatus?: RunStatus }) {
  const qc = useQueryClient();
  const { data: run, isLoading } = useGetRun(runId, {
    query: {
      queryKey: getGetRunQueryKey(runId),
      enabled: !!runId,
      refetchInterval: (q) => (!q.state.data || isActiveRun(q.state.data.status) ? 2000 : false),
    },
  });
  const prev = useRef<RunStatus | undefined>(knownStatus);

  useEffect(() => {
    if (!run) return;
    const was = prev.current;
    prev.current = run.status;
    if ((was === undefined || isActiveRun(was)) && !isActiveRun(run.status)) {
      qc.invalidateQueries({ queryKey: getGetHuntQueryKey(huntId) });
      qc.invalidateQueries({ queryKey: getListListingsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetHuntSummaryQueryKey(huntId) });
      qc.invalidateQueries({ queryKey: getListHuntSourcesQueryKey(huntId) });
      qc.invalidateQueries({ queryKey: getListHuntRunsQueryKey(huntId) });
      qc.invalidateQueries({ queryKey: getListHuntsQueryKey() });
    }
  }, [run, huntId, qc]);

  if (isLoading || !run) {
    return <div className="h-40 rounded-2xl border bg-card animate-pulse" />;
  }

  const active = isActiveRun(run.status);
  const events = run.events;
  const reached = new Set(events.map((e) => e.stage));
  const lastStageIdx = Math.max(-1, ...events.map((e) => STAGES.indexOf(e.stage as (typeof STAGES)[number])));
  const s = run.stats;
  const stats = [
    ['Searches', s.searches],
    ['Pages read', s.pagesRead],
    ['Browser runs', s.agentRuns],
    ['Sources', s.sourcesChecked],
    ['Listings', s.listingsFound],
    ['New', s.newListings],
  ] as const;

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl border',
        active ? 'bg-secondary text-secondary-foreground border-secondary' : 'bg-card',
      )}
      data-testid="panel-run"
    >
      {active && (
        <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden">
          <div className="sweep h-full w-1/3 bg-primary" />
        </div>
      )}
      <div className="p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          {active ? (
            <span className="relative flex h-3 w-3">
              <span className="ping-soft absolute inset-0 rounded-full bg-primary" />
              <span className="relative h-3 w-3 rounded-full bg-primary" />
            </span>
          ) : run.status === 'completed' ? (
            <CheckCircle2 className="h-5 w-5 text-[hsl(var(--visa))]" />
          ) : run.status === 'partial' ? (
            <AlertTriangle className="h-5 w-5 text-[hsl(var(--fund))]" />
          ) : (
            <XCircle className="h-5 w-5 text-destructive" />
          )}
          <h2 className="font-display text-xl font-bold" data-testid="status-run">
            {run.status === 'queued' && 'Scout is getting ready'}
            {run.status === 'running' && 'Scout is out reading the web'}
            {run.status === 'completed' && 'Scout is back'}
            {run.status === 'partial' && 'Back, with a few gaps'}
            {run.status === 'failed' && 'This search did not finish'}
          </h2>
          <span className={cn('ml-auto font-mono text-[11px]', active ? 'text-secondary-foreground/60' : 'text-muted-foreground')}>
            Run #{run.id} · {run.trigger} · est. {usd(s.estimatedCostUsd)}
          </span>
        </div>
        {run.status === 'partial' && <p className="mt-2 text-sm text-muted-foreground">Some sources could not be read, but everything below was verified on the pages that did load.</p>}
        {run.status === 'failed' && run.error && <p className="mt-2 text-sm text-destructive">{run.error}</p>}

        <ol className="mt-5 grid grid-cols-7 gap-1">
          {STAGES.map((st, i) => {
            const done = i < lastStageIdx || (!active && reached.has(st)) || (!active && run.status !== 'failed');
            const current = active && i === lastStageIdx;
            return (
              <li key={st} className="flex flex-col gap-1.5">
                <span
                  className={cn(
                    'h-1.5 rounded-full transition-colors duration-500',
                    done ? 'bg-primary' : current ? 'bg-primary/60 animate-pulse' : active ? 'bg-secondary-foreground/15' : 'bg-muted',
                  )}
                />
                <span className={cn('font-mono text-[9px] sm:text-[10px] uppercase tracking-wider', current ? 'text-primary font-bold' : 'opacity-60')}>
                  {stageName[st]}
                </span>
              </li>
            );
          })}
        </ol>

        <dl className="mt-5 grid grid-cols-3 sm:grid-cols-6 gap-px rounded-xl overflow-hidden bg-current/10">
          {stats.map(([k, v]) => (
            <div key={k} className={cn('px-3 py-2.5', active ? 'bg-secondary' : 'bg-card')}>
              <dd key={v} className="rise font-display text-2xl font-extrabold tabular-nums" data-testid={`text-stat-${k.toLowerCase().replace(/\s/g, '-')}`}>
                {v}
              </dd>
              <dt className="font-mono text-[10px] uppercase tracking-wider opacity-60">{k}</dt>
            </div>
          ))}
        </dl>

        {events.length > 0 ? (
          <details open={active} className="mt-5 group">
            <summary className="cursor-pointer select-none font-mono text-[11px] uppercase tracking-widest opacity-70 hover:opacity-100">
              Field log · {events.length} steps
            </summary>
            <ul className={cn('mt-2 max-h-80 overflow-y-auto rounded-xl px-3', active ? 'bg-background text-foreground' : 'bg-muted/40')}>
              {[...events].reverse().map((e, i) => (
                <EventRow key={e.id} e={e} latest={active && i === 0} />
              ))}
            </ul>
          </details>
        ) : (
          active && (
            <p className="mt-5 flex items-center gap-2 text-sm opacity-70">
              <CircleDashed className="h-4 w-4 radar" /> Planning which searches to run…
            </p>
          )
        )}
      </div>
    </section>
  );
}
