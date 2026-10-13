import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useUpdateHuntListing,
  getListListingsQueryKey,
  getGetHuntSummaryQueryKey,
  getGetHuntQueryKey,
  type Listing,
} from '@workspace/api-client-react';
import { Bookmark, EyeOff, Eye, ArrowUpRight, ChevronDown, Quote, Plane, Home, Coins, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  apiErrorMessage,
  deadlineInfo,
  fundingLabel,
  visaLabel,
  seniorityLabel,
  workModeLabel,
  toolLabel,
  hostOf,
  ago,
} from '@/lib/scout';

const visaTone: Record<Listing['visa']['status'], string> = {
  sponsors: 'bg-[hsl(var(--visa))] text-white border-transparent',
  not_sponsored: 'bg-destructive/10 text-destructive border-destructive/30',
  citizens_only: 'bg-destructive/10 text-destructive border-destructive/30',
  unknown: 'bg-transparent text-muted-foreground border-dashed border-input',
};
const fundTone: Record<Listing['funding']['level'], string> = {
  fully_funded: 'bg-accent text-accent-foreground border-transparent',
  paid: 'bg-accent/30 text-foreground border-accent',
  unpaid: 'bg-muted text-muted-foreground border-border line-through decoration-1',
  unknown: 'bg-transparent text-muted-foreground border-dashed border-input',
};
const dlTone = {
  none: 'text-muted-foreground border-dashed border-input',
  passed: 'text-muted-foreground border-border line-through',
  urgent: 'bg-primary text-primary-foreground border-transparent',
  soon: 'text-primary border-primary/50 bg-primary/5',
  later: 'text-foreground border-border',
};

function scoreColor(s: number) {
  if (s >= 80) return 'text-primary';
  if (s >= 60) return 'text-foreground';
  return 'text-muted-foreground';
}

function Perk({ on, icon: Icon, label }: { on: boolean | null; icon: typeof Plane; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[11px] font-mono',
        on === true ? 'text-foreground' : on === false ? 'text-muted-foreground/60 line-through' : 'text-muted-foreground/60',
      )}
      title={on === null ? `${label}: not stated` : `${label}: ${on ? 'covered' : 'not covered'}`}
    >
      <Icon className="h-3 w-3" />
      {label}
      {on === null && '?'}
    </span>
  );
}

export function ListingCard({
  listing,
  huntId,
  readOnly,
  index,
}: {
  listing: Listing;
  huntId: number;
  readOnly: boolean;
  index: number;
}) {
  const [open, setOpen] = useState(false);
  const [popKey, setPopKey] = useState(0);
  const qc = useQueryClient();
  const { toast } = useToast();
  const update = useUpdateHuntListing();
  const dl = deadlineInfo(listing.deadline);
  const l = listing;

  const flag = (data: { saved?: boolean; hidden?: boolean }, msg: string) => {
    setPopKey((k) => k + 1);
    update.mutate(
      { huntId, listingId: l.id, data },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListListingsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetHuntSummaryQueryKey(huntId) });
          qc.invalidateQueries({ queryKey: getGetHuntQueryKey(huntId) });
          toast({ title: msg });
        },
        onError: (e) => toast({ title: 'Could not update', description: apiErrorMessage(e), variant: 'destructive' }),
      },
    );
  };

  return (
    <article
      className={cn(
        'rise group relative rounded-xl border bg-card shadow-xs transition-all duration-200 hover:shadow-md hover:-translate-y-0.5',
        l.hidden && 'opacity-60',
        l.status === 'closed' && 'opacity-75',
      )}
      style={{ animationDelay: `${Math.min(index, 12) * 45}ms` }}
      data-testid={`card-listing-${l.id}`}
    >
      {l.isNew && (
        <span className="absolute -top-2 left-4 rounded-full bg-primary px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-primary-foreground">
          New
        </span>
      )}
      <div className="flex gap-3 sm:gap-5 p-4 sm:p-5">
        <div className="flex flex-col items-center shrink-0 w-12 sm:w-14 pt-0.5">
          <span className={cn('font-display text-3xl sm:text-4xl font-extrabold leading-none tabular-nums', scoreColor(l.score))} data-testid={`text-score-${l.id}`}>
            {l.score}
          </span>
          <span className="mt-1 h-1 w-full rounded-full bg-muted overflow-hidden">
            <span className="block h-full bg-primary" style={{ width: `${l.score}%` }} />
          </span>
          <span className="mt-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">fit</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground/80 truncate">{l.organization}</span>
                <span className="font-mono uppercase tracking-wider text-[10px] rounded border px-1">{l.kind === 'program' ? 'Program' : 'Job'}</span>
                {l.status === 'closed' && <span className="font-mono uppercase text-[10px] text-destructive">Closed</span>}
                {l.status === 'unverified' && (
                  <span
                    className="font-mono uppercase text-[10px] text-muted-foreground border border-dashed border-input rounded px-1"
                    title="Agent saw this opening live on the company's portal, but its page couldn't be read, so visa and funding details are not checked."
                    data-testid={`status-unverified-${l.id}`}
                  >
                    Not verified
                  </span>
                )}
              </div>
              <h3 className="mt-0.5 font-display text-lg sm:text-xl font-bold leading-snug" data-testid={`text-title-${l.id}`}>
                {l.title}
              </h3>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {l.locations.length > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {l.locations.slice(0, 3).join(' · ')}
                    {l.locations.length > 3 && ` +${l.locations.length - 3}`}
                  </span>
                )}
                {workModeLabel[l.workMode] && <span>{workModeLabel[l.workMode]}</span>}
                <span>{seniorityLabel[l.seniority]}</span>
                {l.employmentType && <span>{l.employmentType}</span>}
              </div>
            </div>
            {!readOnly && (
              <div className="flex shrink-0 gap-1">
                <button
                  key={`s${popKey}`}
                  onClick={() => flag({ saved: !l.saved }, l.saved ? 'Removed from saved' : 'Saved to your shortlist')}
                  disabled={update.isPending}
                  className={cn(
                    'pop h-9 w-9 grid place-items-center rounded-full border transition-colors',
                    l.saved ? 'bg-foreground text-background border-foreground' : 'hover:bg-muted text-muted-foreground hover:text-foreground',
                  )}
                  aria-label={l.saved ? 'Unsave' : 'Save'}
                  data-testid={`button-save-${l.id}`}
                >
                  <Bookmark className={cn('h-4 w-4', l.saved && 'fill-current')} />
                </button>
                <button
                  onClick={() => flag({ hidden: !l.hidden }, l.hidden ? 'Back in your results' : 'Hidden from results')}
                  disabled={update.isPending}
                  className="h-9 w-9 grid place-items-center rounded-full border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  aria-label={l.hidden ? 'Unhide' : 'Hide'}
                  data-testid={`button-hide-${l.id}`}
                >
                  {l.hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className={cn('rounded-md border px-2 py-1 text-xs font-semibold', visaTone[l.visa.status])} data-testid={`status-visa-${l.id}`}>
              {visaLabel[l.visa.status]}
            </span>
            <span className={cn('rounded-md border px-2 py-1 text-xs font-semibold', fundTone[l.funding.level])} data-testid={`status-funding-${l.id}`}>
              {fundingLabel[l.funding.level]}
            </span>
            <span className={cn('rounded-md border px-2 py-1 text-xs font-semibold font-mono', dlTone[dl.tone])} data-testid={`status-deadline-${l.id}`}>
              {dl.label}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-3">
            <Perk on={l.funding.stipend} icon={Coins} label="Stipend" />
            <Perk on={l.funding.travel} icon={Plane} label="Travel" />
            <Perk on={l.funding.housing} icon={Home} label="Housing" />
          </div>

          {l.reasons.length > 0 && !open && (
            <p className="mt-2 text-sm text-muted-foreground line-clamp-1">
              <span className="text-foreground/70">Why: </span>
              {l.reasons.join(' · ')}
            </p>
          )}

          <div className={cn('grid transition-all duration-300', open ? 'grid-rows-[1fr] opacity-100 mt-4' : 'grid-rows-[0fr] opacity-0')}>
            <div className="overflow-hidden space-y-3">
              {l.summary && <p className="text-sm leading-relaxed">{l.summary}</p>}
              {l.reasons.length > 0 && (
                <ul className="space-y-1">
                  {l.reasons.map((r, i) => (
                    <li key={i} className="flex gap-2 text-sm">
                      <span className="mt-2 h-1 w-3 shrink-0 bg-primary rounded-full" />
                      {r}
                    </li>
                  ))}
                </ul>
              )}
              <div className="grid sm:grid-cols-2 gap-2">
                <Evidence label="On visas" text={l.visa.note} />
                <Evidence label="On funding" text={l.funding.note} />
              </div>
              {l.eligibility && <Evidence label="Eligibility" text={l.eligibility} />}
              <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
                <span>Read on <a href={l.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">{l.sourceLabel} · {hostOf(l.sourceUrl)}</a></span>
                <span>Found via {toolLabel[l.foundVia]}</span>
                {l.postedAt && <span>Posted {ago(l.postedAt)}</span>}
                <span>First seen {ago(l.firstSeenAt)}</span>
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <a
              href={l.applyUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full bg-foreground text-background px-3 py-1.5 text-xs font-semibold hover:bg-primary transition-colors"
              data-testid={`link-apply-${l.id}`}
            >
              Apply <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
            <button
              onClick={() => setOpen((o) => !o)}
              className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              data-testid={`button-expand-${l.id}`}
            >
              {open ? 'Less' : 'Evidence & details'}
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
            </button>
            <span className="ml-auto hidden sm:inline font-mono text-[10px] uppercase tracking-widest text-muted-foreground">via {toolLabel[l.foundVia]}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

function Evidence({ label, text }: { label: string; text: string | null }) {
  return (
    <div className="rounded-lg bg-muted/60 border-l-2 border-primary/60 px-3 py-2">
      <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        <Quote className="h-3 w-3" /> {label}
      </div>
      <p className="mt-1 text-sm italic text-foreground/85">{text ? `"${text}"` : 'The posting does not say.'}</p>
    </div>
  );
}
