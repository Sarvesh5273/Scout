import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, Loader2 } from 'lucide-react';
import type { HuntPreferences } from '@workspace/api-client-react';
import { Form, FormField, FormItem, FormMessage, FormControl } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

const tags = (min: number, max: number, itemMin: number, itemMax: number, label: string) =>
  z
    .array(z.string().trim().min(itemMin, `Each ${label} needs ${itemMin}+ characters`).max(itemMax, `Keep each ${label} under ${itemMax} characters`))
    .min(min, min ? `Add at least ${min} ${label}` : undefined)
    .max(max, `Up to ${max} ${label}s`);

export const prefsSchema = z.object({
  name: z.string().trim().max(80, 'Keep the name under 80 characters'),
  roles: tags(1, 5, 2, 80, 'role'),
  keywords: tags(0, 10, 1, 40, 'keyword'),
  excludeKeywords: tags(0, 10, 1, 40, 'keyword'),
  locations: tags(0, 6, 2, 60, 'location'),
  remoteOk: z.boolean(),
  seniority: z.array(z.enum(['internship', 'new_grad', 'entry_level', 'experienced'])).min(1, 'Pick at least one level'),
  opportunityTypes: z.array(z.enum(['company_roles', 'research_programs'])).min(1, 'Pick at least one kind of opportunity'),
  needsVisaSponsorship: z.boolean(),
  citizenship: z.string().trim().max(60),
  funding: z.enum(['any', 'paid', 'fully_funded']),
  companies: tags(0, 10, 2, 60, 'company'),
});
export type PrefsValues = z.infer<typeof prefsSchema>;

export const emptyPrefs: HuntPreferences = {
  roles: [],
  keywords: [],
  excludeKeywords: [],
  locations: [],
  remoteOk: true,
  seniority: ['internship'],
  opportunityTypes: ['company_roles', 'research_programs'],
  needsVisaSponsorship: true,
  citizenship: null,
  funding: 'any',
  companies: [],
};

export function toValues(name: string, p: HuntPreferences): PrefsValues {
  return { name, ...p, citizenship: p.citizenship ?? '' };
}
export function toPrefs(v: PrefsValues): { name?: string; preferences: HuntPreferences } {
  const { name, citizenship, ...rest } = v;
  return { name: name.trim() || undefined, preferences: { ...rest, citizenship: citizenship.trim() || null } };
}

function TagInput({ value, onChange, placeholder, max, testId }: { value: string[]; onChange: (v: string[]) => void; placeholder: string; max: number; testId: string }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const t = draft.trim().replace(/,$/, '');
    if (t && !value.includes(t) && value.length < max) onChange([...value, t]);
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-input bg-card px-2 py-2 focus-within:ring-2 focus-within:ring-ring/40 focus-within:border-primary transition-shadow">
      {value.map((t) => (
        <span key={t} className="rise inline-flex items-center gap-1 rounded-full bg-foreground text-background pl-2.5 pr-1 py-0.5 text-sm">
          {t}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} className="rounded-full p-0.5 hover:bg-background/20" aria-label={`Remove ${t}`}>
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={add}
        disabled={value.length >= max}
        placeholder={value.length >= max ? `Max ${max}` : placeholder}
        className="flex-1 min-w-[8rem] bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-muted-foreground/70"
        data-testid={testId}
      />
    </div>
  );
}

function Chips<T extends string>({ options, value, onChange, multi, testId }: { options: { v: T; label: string; hint?: string }[]; value: T[]; onChange: (v: T[]) => void; multi: boolean; testId: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o.v);
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(multi ? (on ? value.filter((x) => x !== o.v) : [...value, o.v]) : [o.v])}
            className={cn(
              'rounded-xl border px-3.5 py-2 text-left text-sm transition-all active:scale-95',
              on ? 'bg-foreground text-background border-foreground shadow-sm' : 'bg-card hover:border-foreground/40',
            )}
            data-testid={`${testId}-${o.v}`}
          >
            <span className="font-semibold">{o.label}</span>
            {o.hint && <span className={cn('block text-xs', on ? 'text-background/70' : 'text-muted-foreground')}>{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

function Row({ n, title, hint, children }: { n: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid md:grid-cols-[220px_1fr] gap-3 md:gap-8 py-6 border-b border-border/70">
      <div>
        <span className="font-mono text-[11px] text-primary font-bold">{n}</span>
        <h3 className="font-display text-lg font-bold leading-tight">{title}</h3>
        {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      </div>
      <div className="space-y-3 min-w-0">{children}</div>
    </div>
  );
}

export function PreferencesForm({
  defaultValues,
  submitLabel,
  pending,
  serverError,
  onSubmit,
  extraActions,
}: {
  defaultValues: PrefsValues;
  submitLabel: string;
  pending: boolean;
  serverError?: string | null;
  onSubmit: (v: PrefsValues) => void;
  extraActions?: ReactNode;
}) {
  const form = useForm<PrefsValues>({ resolver: zodResolver(prefsSchema), defaultValues });
  const text = 'w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40 focus:border-primary';

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <Row n="01" title="Name this hunt" hint="Optional. Scout will name it from your roles otherwise.">
          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem>
              <FormControl><input {...field} placeholder="e.g. Summer research abroad" className={text} data-testid="input-name" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </Row>
        <Row n="02" title="What are you after?" hint="1 to 5 roles. Press Enter after each.">
          <FormField control={form.control} name="roles" render={({ field }) => (
            <FormItem>
              <TagInput value={field.value} onChange={field.onChange} max={5} placeholder="Machine learning intern, Robotics research…" testId="input-roles" />
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="opportunityTypes" render={({ field }) => (
            <FormItem>
              <Chips multi value={field.value} onChange={field.onChange} testId="chip-type" options={[
                { v: 'company_roles', label: 'Company roles', hint: 'Careers pages and job boards' },
                { v: 'research_programs', label: 'Research programs', hint: 'Funded internships at universities, labs, agencies' },
              ]} />
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="seniority" render={({ field }) => (
            <FormItem>
              <Chips multi value={field.value} onChange={field.onChange} testId="chip-seniority" options={[
                { v: 'internship', label: 'Internship' },
                { v: 'new_grad', label: 'New grad' },
                { v: 'entry_level', label: 'Entry level' },
                { v: 'experienced', label: 'Experienced' },
              ]} />
              <FormMessage />
            </FormItem>
          )} />
        </Row>
        <Row n="03" title="Where?" hint="Up to 6 countries or cities. Leave empty for anywhere.">
          <FormField control={form.control} name="locations" render={({ field }) => (
            <FormItem>
              <TagInput value={field.value} onChange={field.onChange} max={6} placeholder="Germany, Zurich, Japan…" testId="input-locations" />
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="remoteOk" render={({ field }) => (
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-remote" /> Remote roles are fine too
            </label>
          )} />
        </Row>
        <Row n="04" title="Visa and money" hint="Scout labels every listing with what the posting actually says.">
          <FormField control={form.control} name="needsVisaSponsorship" render={({ field }) => (
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-visa" /> I need visa sponsorship
            </label>
          )} />
          <FormField control={form.control} name="citizenship" render={({ field }) => (
            <FormItem>
              <FormControl><input {...field} placeholder="Your citizenship, e.g. India" className={text} data-testid="input-citizenship" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="funding" render={({ field }) => (
            <FormItem>
              <Chips multi={false} value={[field.value]} onChange={(v) => field.onChange(v[0])} testId="chip-funding" options={[
                { v: 'any', label: 'Any' },
                { v: 'paid', label: 'Paid', hint: 'Salary or stipend' },
                { v: 'fully_funded', label: 'Fully funded', hint: 'Stipend plus travel or housing' },
              ]} />
            </FormItem>
          )} />
        </Row>
        <Row n="05" title="Sharpen it" hint="All optional.">
          <FormField control={form.control} name="keywords" render={({ field }) => (
            <FormItem>
              <span className="text-xs font-semibold text-muted-foreground">Must mention</span>
              <TagInput value={field.value} onChange={field.onChange} max={10} placeholder="PyTorch, computer vision…" testId="input-keywords" />
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="excludeKeywords" render={({ field }) => (
            <FormItem>
              <span className="text-xs font-semibold text-muted-foreground">Skip if it mentions</span>
              <TagInput value={field.value} onChange={field.onChange} max={10} placeholder="Sales, unpaid…" testId="input-exclude" />
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="companies" render={({ field }) => (
            <FormItem>
              <span className="text-xs font-semibold text-muted-foreground">Check these organizations directly (Scout finds others too)</span>
              <TagInput value={field.value} onChange={field.onChange} max={10} placeholder="DeepMind, EPFL, CERN…" testId="input-companies" />
              <FormMessage />
            </FormItem>
          )} />
        </Row>

        {serverError && (
          <div className="mt-6 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" data-testid="text-form-error">
            {serverError}
          </div>
        )}
        <div className="sticky bottom-0 z-10 -mx-4 sm:mx-0 mt-6 flex flex-wrap items-center gap-3 border-t sm:border sm:rounded-2xl bg-background/90 backdrop-blur px-4 py-3">
          {extraActions}
          <button
            type="submit"
            disabled={pending}
            className="ml-auto inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-5 py-2.5 font-semibold shadow-md hover:-translate-y-px transition-all disabled:opacity-60"
            data-testid="button-submit"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitLabel}
          </button>
        </div>
      </form>
    </Form>
  );
}
