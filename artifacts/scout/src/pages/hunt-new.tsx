import { useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useCreateHunt, useStartHuntRun, useListPresets, getListHuntsQueryKey } from '@workspace/api-client-react';
import { PreferencesForm, emptyPrefs, toValues, toPrefs, type PrefsValues } from '@/components/preferences-form';
import { apiErrorMessage } from '@/lib/scout';
import { useToast } from '@/hooks/use-toast';

export default function HuntNewPage() {
  const search = useSearch();
  const presetId = new URLSearchParams(search).get('preset');
  const presets = useListPresets();
  const preset = presetId ? presets.data?.find((p) => p.id === presetId) : undefined;
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateHunt();
  const start = useStartHuntRun();
  const [err, setErr] = useState<string | null>(null);

  const submit = (v: PrefsValues) => {
    setErr(null);
    create.mutate(
      { data: toPrefs(v) },
      {
        onSuccess: (hunt) => {
          qc.invalidateQueries({ queryKey: getListHuntsQueryKey() });
          start.mutate(
            { huntId: hunt.id },
            {
              onSettled: () => navigate(`/hunts/${hunt.id}`),
              onError: (e) => toast({ title: 'Hunt saved, but the search did not start', description: apiErrorMessage(e), variant: 'destructive' }),
            },
          );
        },
        onError: (e) => setErr(apiErrorMessage(e)),
      },
    );
  };

  const waiting = presetId && presets.isLoading;

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 pt-10 sm:pt-14">
      <p className="font-mono text-xs uppercase tracking-[0.25em] text-primary font-bold">New hunt</p>
      <h1 className="mt-2 font-display text-4xl sm:text-5xl font-extrabold">Write Scout a brief.</h1>
      <p className="mt-3 text-muted-foreground max-w-xl">
        {preset ? `Starting from "${preset.title}". Adjust anything, then send Scout out.` : 'The more specific you are, the sharper the shortlist. A search takes one to three minutes.'}
      </p>
      <div className="mt-6">
        {waiting ? (
          <div className="space-y-4">{[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-xl bg-card border animate-pulse" />)}</div>
        ) : (
          <PreferencesForm
            key={preset?.id ?? 'blank'}
            defaultValues={toValues('', preset?.preferences ?? emptyPrefs)}
            submitLabel={create.isPending || start.isPending ? 'Sending Scout…' : 'Create and search now'}
            pending={create.isPending || start.isPending}
            serverError={err}
            onSubmit={submit}
          />
        )}
      </div>
    </div>
  );
}
