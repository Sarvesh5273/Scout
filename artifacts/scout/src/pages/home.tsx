import { Link } from 'wouter';
import { useListHunts, useListPresets, type Hunt } from '@workspace/api-client-react';
import { ArrowRight, Radio, RotateCw, Lock } from 'lucide-react';
import { ago, isActiveRun, apiErrorMessage, untilRefresh } from '@/lib/scout';
import { ScoutMark } from '@/components/shell';
import { cn } from '@/lib/utils';

function HuntRow({ h, i }: { h: Hunt; i: number }) {
  const running = isActiveRun(h.latestRun?.status);
  const p = h.preferences;
  return (
    <Link
      href={`/hunts/${h.id}`}
      className="rise group grid grid-cols-[1fr_auto] gap-4 items-center rounded-2xl border bg-card p-4 sm:p-5 hover:shadow-md hover:-translate-y-0.5 hover:border-foreground/30 transition-all"
      style={{ animationDelay: `${i * 50}ms` }}
      data-testid={`card-hunt-${h.id}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {running && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" /> Searching
            </span>
          )}
          {h.isShowcase && (
            <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <Lock className="h-3 w-3" /> Showcase
            </span>
          )}
        </div>
        <h3 className="font-display text-lg sm:text-xl font-bold truncate group-hover:text-primary transition-colors">{h.name}</h3>
        <p className="text-sm text-muted-foreground truncate">
          {p.roles.join(', ')} · {p.locations.length ? p.locations.join(', ') : 'Anywhere'}
          {p.needsVisaSponsorship && ' · needs visa'}
        </p>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          {h.lastRunAt ? `Checked ${ago(h.lastRunAt)}` : 'Not searched yet'}
          {h.isShowcase && h.nextRefreshAt && ` · next refresh ${untilRefresh(h.nextRefreshAt)}`}
        </p>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <div className="font-display text-3xl font-extrabold tabular-nums leading-none">{h.counts.total}</div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">listings</div>
          {h.counts.new > 0 && <div className="mt-1 font-mono text-[11px] font-bold text-primary">+{h.counts.new} new</div>}
        </div>
        <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
      </div>
    </Link>
  );
}

function SkeletonRows({ n = 2 }: { n?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="h-24 rounded-2xl border bg-card animate-pulse" />
      ))}
    </div>
  );
}

export default function HomePage() {
  const hunts = useListHunts();
  const presets = useListPresets();
  const mine = (hunts.data ?? []).filter((h) => !h.isShowcase);
  const showcase = (hunts.data ?? []).filter((h) => h.isShowcase);

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <section className="relative pt-12 sm:pt-20 pb-12">
        <div className="absolute inset-0 -z-10 grid-paper [mask-image:radial-gradient(ellipse_at_top_left,black,transparent_70%)]" />
        <p className="rise font-mono text-xs uppercase tracking-[0.25em] text-primary font-bold">Your research assistant for internships abroad</p>
        <h1 className="rise mt-3 font-display text-[2.6rem] leading-[0.95] sm:text-7xl font-extrabold max-w-4xl" style={{ animationDelay: '80ms' }}>
          Stop refreshing twenty careers pages.
          <span className="text-primary"> Send Scout.</span>
        </h1>
        <p className="rise mt-5 max-w-2xl text-lg text-muted-foreground" style={{ animationDelay: '160ms' }}>
          Tell it the role, the places, and whether you need a visa. Scout reads careers pages, job boards and funded research programs live, then reports back with a ranked shortlist. Every visa and funding label quotes the posting.
        </p>
        <div className="rise mt-7 flex flex-wrap gap-3" style={{ animationDelay: '240ms' }}>
          <Link href="/hunts/new" className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-6 py-3 font-semibold shadow-md hover:-translate-y-0.5 hover:shadow-lg transition-all" data-testid="link-start-hunt">
            Start a hunt <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/how-it-works" className="inline-flex items-center gap-2 rounded-full border px-6 py-3 font-semibold hover:bg-muted transition-colors" data-testid="link-how">
            How Scout reads the web
          </Link>
        </div>
      </section>

      {hunts.isError && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-5 flex items-center justify-between gap-3">
          <p className="text-sm text-destructive">{apiErrorMessage(hunts.error, 'Could not load hunts.')}</p>
          <button onClick={() => hunts.refetch()} className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm hover:bg-muted" data-testid="button-retry-hunts">
            <RotateCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      )}

      <section className="grid lg:grid-cols-[1fr_340px] gap-10">
        <div>
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-display text-2xl font-bold">Your hunts</h2>
            <span className="font-mono text-xs text-muted-foreground">{mine.length} active</span>
          </div>
          {hunts.isLoading ? (
            <SkeletonRows />
          ) : mine.length === 0 ? (
            <div className="relative overflow-hidden rounded-2xl border-2 border-dashed p-8 sm:p-10 text-center">
              <ScoutMark className="mx-auto h-14 w-14 text-muted-foreground/50" />
              <h3 className="mt-4 font-display text-xl font-bold">Scout is waiting for orders</h3>
              <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">You have no hunts yet. Start from a preset on the right or write your own brief.</p>
              <Link href="/hunts/new" className="mt-5 inline-flex items-center gap-2 rounded-full bg-foreground text-background px-5 py-2 text-sm font-semibold hover:bg-primary transition-colors" data-testid="link-empty-new">
                Write a brief <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <div className="space-y-3">{mine.map((h, i) => <HuntRow key={h.id} h={h} i={i} />)}</div>
          )}

          <div className="mt-12 flex items-baseline justify-between mb-4">
            <h2 className="font-display text-2xl font-bold flex items-center gap-2"><Radio className="h-5 w-5 text-primary" /> Showcase hunts</h2>
            <span className="font-mono text-xs text-muted-foreground">public · auto-refresh</span>
          </div>
          {hunts.isLoading ? (
            <SkeletonRows />
          ) : showcase.length === 0 ? (
            <p className="rounded-2xl bg-muted/50 p-6 text-sm text-muted-foreground">No showcase hunts are published right now. They will appear here once Scout runs its first scheduled search.</p>
          ) : (
            <div className="space-y-3">{showcase.map((h, i) => <HuntRow key={h.id} h={h} i={i} />)}</div>
          )}
        </div>

        <aside>
          <div className="lg:sticky lg:top-20">
            <h2 className="font-display text-2xl font-bold mb-4">Start from a preset</h2>
            {presets.isLoading ? (
              <SkeletonRows n={3} />
            ) : presets.isError ? (
              <button onClick={() => presets.refetch()} className="text-sm text-destructive underline" data-testid="button-retry-presets">Presets failed to load. Retry</button>
            ) : (presets.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No presets yet.</p>
            ) : (
              <div className="space-y-2">
                {(presets.data ?? []).map((p, i) => (
                  <Link
                    key={p.id}
                    href={`/hunts/new?preset=${encodeURIComponent(p.id)}`}
                    className={cn('rise group block rounded-xl p-4 transition-all hover:-translate-y-0.5', i === 0 ? 'bg-secondary text-secondary-foreground' : 'bg-card border hover:border-foreground/30')}
                    style={{ animationDelay: `${i * 60}ms` }}
                    data-testid={`link-preset-${p.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-display font-bold">{p.title}</h3>
                      <ArrowRight className="h-4 w-4 shrink-0 opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                    </div>
                    <p className={cn('mt-1 text-sm', i === 0 ? 'text-secondary-foreground/70' : 'text-muted-foreground')}>{p.description}</p>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </aside>
      </section>
    </div>
  );
}
