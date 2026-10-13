import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Plus } from 'lucide-react';
import { useGetAccess, getGetAccessQueryKey, useHealthCheck, getHealthCheckQueryKey } from '@workspace/api-client-react';
import { hasReviewerPass } from '@/lib/reviewer-pass';
import { cn } from '@/lib/utils';

export function ScoutMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="16" cy="16" r="7" fill="none" stroke="currentColor" strokeWidth="2.5" opacity=".45" />
      <path d="M16 16 L27 8" stroke="hsl(var(--primary))" strokeWidth="3" strokeLinecap="round" />
      <circle cx="16" cy="16" r="2.6" fill="hsl(var(--primary))" />
    </svg>
  );
}

function HealthDot() {
  // Checked once per page load: polling would keep the published server (and its bill) awake while a tab sits open.
  const { data, isError } = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey() } });
  const ok = !isError && data?.status;
  return (
    <span className="hidden sm:flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground" data-testid="status-health">
      <span className={cn('h-1.5 w-1.5 rounded-full', ok ? 'bg-[hsl(var(--visa))]' : isError ? 'bg-destructive' : 'bg-muted-foreground/40')} />
      {ok ? 'Live' : isError ? 'Offline' : '…'}
    </span>
  );
}

/** Shown only when this browser opened a valid reviewer link, so a reviewer (or the owner) can see it worked. */
function ReviewerBadge() {
  const { data } = useGetAccess({ query: { queryKey: getGetAccessQueryKey(), enabled: hasReviewerPass() } });
  if (!data?.reviewer) return null;
  return (
    <span
      className="hidden sm:inline-flex items-center rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground"
      title="Searches from this browser use capacity kept for reviewers"
      data-testid="status-reviewer-pass"
    >
      Reviewer pass
    </span>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const nav = [
    { href: '/', label: 'Hunts' },
    { href: '/how-it-works', label: 'How it works' },
  ];
  return (
    <div className="min-h-[100dvh] flex flex-col">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-14 flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 group" data-testid="link-home">
            <ScoutMark className="h-7 w-7 text-foreground transition-transform duration-500 group-hover:rotate-[200deg]" />
            <span className="font-display text-xl font-extrabold tracking-tight">Scout</span>
          </Link>
          <nav className="flex items-center gap-1 ml-2">
            {nav.map((n) => {
              const active = n.href === '/' ? loc === '/' : loc.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  data-testid={`link-nav-${n.label.toLowerCase().replace(/\s/g, '-')}`}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-sm transition-colors',
                    active ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                  )}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-4">
            <ReviewerBadge />
            <HealthDot />
            <Link
              href="/hunts/new"
              data-testid="link-new-hunt"
              className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-3.5 py-1.5 text-sm font-semibold shadow-sm hover:-translate-y-px hover:shadow-md transition-all"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New hunt</span>
            </Link>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border/70 mt-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Scout reads the live web with TinyFish. Every label cites the posting.</span>
          <span className="font-mono">Your hunts stay in this browser.</span>
        </div>
      </footer>
    </div>
  );
}
