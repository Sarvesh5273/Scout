import { formatDistanceToNowStrict, differenceInCalendarDays, format, parseISO } from 'date-fns';
import type { Listing, RunStatus } from '@workspace/api-client-react';

export function apiErrorMessage(err: unknown, fallback = 'Something went wrong.'): string {
  if (err && typeof err === 'object') {
    const data = (err as { data?: unknown }).data;
    if (data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string') {
      return (data as { error: string }).error;
    }
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg) return msg;
  }
  return fallback;
}

export function apiErrorStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object' && typeof (err as { status?: unknown }).status === 'number') {
    return (err as { status: number }).status;
  }
  return undefined;
}

export const isActiveRun = (s?: RunStatus | null) => s === 'queued' || s === 'running';

export function ago(iso?: string | null): string {
  if (!iso) return 'never';
  try {
    return formatDistanceToNowStrict(parseISO(iso), { addSuffix: true });
  } catch {
    return '—';
  }
}

/** "in 5 hours" for an upcoming refresh; "due now" once overdue, since it starts the next time someone opens Scout. */
export function untilRefresh(iso: string): string {
  try {
    const at = parseISO(iso);
    return at.getTime() > Date.now() ? formatDistanceToNowStrict(at, { addSuffix: true }) : 'due now';
  } catch {
    return '—';
  }
}

export function shortDate(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return format(parseISO(iso), 'd MMM yyyy');
  } catch {
    return iso;
  }
}

export type DeadlineTone = 'none' | 'passed' | 'urgent' | 'soon' | 'later';
export function deadlineInfo(iso?: string | null): { label: string; tone: DeadlineTone; days: number | null } {
  if (!iso) return { label: 'No deadline stated', tone: 'none', days: null };
  try {
    const d = parseISO(iso);
    const days = differenceInCalendarDays(d, new Date());
    if (days < 0) return { label: `Closed ${format(d, 'd MMM')}`, tone: 'passed', days };
    if (days === 0) return { label: 'Closes today', tone: 'urgent', days };
    if (days <= 7) return { label: `${days}d left · ${format(d, 'd MMM')}`, tone: 'urgent', days };
    if (days <= 30) return { label: `${days}d left · ${format(d, 'd MMM')}`, tone: 'soon', days };
    return { label: `Closes ${format(d, 'd MMM yyyy')}`, tone: 'later', days };
  } catch {
    return { label: iso, tone: 'later', days: null };
  }
}

export const visaLabel: Record<Listing['visa']['status'], string> = {
  sponsors: 'Sponsors visa',
  not_sponsored: 'No sponsorship',
  citizens_only: 'Citizens only',
  unknown: 'Visa not stated',
};

export const fundingLabel: Record<Listing['funding']['level'], string> = {
  fully_funded: 'Fully funded',
  paid: 'Paid',
  unpaid: 'Unpaid',
  unknown: 'Pay not stated',
};

export const seniorityLabel: Record<string, string> = {
  internship: 'Internship',
  new_grad: 'New grad',
  entry_level: 'Entry level',
  experienced: 'Experienced',
  unknown: 'Level unclear',
};

export const workModeLabel: Record<string, string> = {
  onsite: 'On-site',
  hybrid: 'Hybrid',
  remote: 'Remote',
  unknown: '',
};

export const toolLabel: Record<string, string> = {
  search: 'Search',
  fetch: 'Fetch',
  agent: 'Agent',
  ai: 'AI',
  system: 'Scout',
};

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function usd(n: number): string {
  return `$${n.toFixed(n < 1 ? 3 : 2)}`;
}
