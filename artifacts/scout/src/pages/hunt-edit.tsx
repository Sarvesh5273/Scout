import { useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetHunt,
  getGetHuntQueryKey,
  useUpdateHunt,
  useDeleteHunt,
  getListHuntsQueryKey,
} from '@workspace/api-client-react';
import { ArrowLeft, Trash2, Lock } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { PreferencesForm, toValues, toPrefs, type PrefsValues } from '@/components/preferences-form';
import { apiErrorMessage, apiErrorStatus } from '@/lib/scout';
import { useToast } from '@/hooks/use-toast';
import NotFound from '@/pages/not-found';

export default function HuntEditPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const hunt = useGetHunt(id, { query: { enabled: !!id, queryKey: getGetHuntQueryKey(id) } });
  const update = useUpdateHunt();
  const del = useDeleteHunt();
  const [err, setErr] = useState<string | null>(null);

  if (!id || apiErrorStatus(hunt.error) === 404) return <NotFound />;

  const submit = (v: PrefsValues) => {
    setErr(null);
    const { name, preferences } = toPrefs(v);
    update.mutate(
      { huntId: id, data: { name, preferences } },
      {
        onSuccess: (h) => {
          qc.setQueryData(getGetHuntQueryKey(id), h);
          qc.invalidateQueries({ queryKey: getListHuntsQueryKey() });
          toast({ title: 'Brief updated', description: 'Search again to apply the new preferences.' });
          navigate(`/hunts/${id}`);
        },
        onError: (e) => setErr(apiErrorMessage(e)),
      },
    );
  };

  const remove = () =>
    del.mutate(
      { huntId: id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListHuntsQueryKey() });
          qc.removeQueries({ queryKey: getGetHuntQueryKey(id) });
          toast({ title: 'Hunt deleted' });
          navigate('/');
        },
        onError: (e) => toast({ title: 'Could not delete', description: apiErrorMessage(e), variant: 'destructive' }),
      },
    );

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 pt-8 sm:pt-12">
      <Link href={`/hunts/${id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back">
        <ArrowLeft className="h-4 w-4" /> Back to hunt
      </Link>
      <h1 className="mt-3 font-display text-4xl font-extrabold">Edit brief</h1>
      {hunt.isLoading ? (
        <div className="mt-6 space-y-4">{[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-xl bg-card border animate-pulse" />)}</div>
      ) : hunt.isError || !hunt.data ? (
        <div className="mt-6 rounded-xl border border-destructive/40 bg-destructive/5 p-5 text-sm text-destructive">
          {apiErrorMessage(hunt.error, 'Could not load this hunt.')}{' '}
          <button className="underline" onClick={() => hunt.refetch()} data-testid="button-retry">Retry</button>
        </div>
      ) : hunt.data.readOnly ? (
        <div className="mt-6 rounded-2xl border-2 border-dashed p-8 text-center">
          <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-display text-xl font-bold">Showcase hunts are read-only</p>
          <p className="text-sm text-muted-foreground">Start your own hunt to set your own preferences.</p>
          <Link href="/hunts/new" className="mt-4 inline-flex rounded-full bg-primary text-primary-foreground px-5 py-2 text-sm font-semibold" data-testid="link-new">New hunt</Link>
        </div>
      ) : (
        <div className="mt-4">
          <PreferencesForm
            defaultValues={toValues(hunt.data.name, hunt.data.preferences)}
            submitLabel="Save changes"
            pending={update.isPending}
            serverError={err}
            onSubmit={submit}
            extraActions={
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button type="button" className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors" data-testid="button-delete">
                    <Trash2 className="h-4 w-4" /> Delete hunt
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="font-display">Delete "{hunt.data.name}"?</AlertDialogTitle>
                    <AlertDialogDescription>This removes the hunt, its listings, saved items and run history. It cannot be undone.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="button-cancel-delete">Keep it</AlertDialogCancel>
                    <AlertDialogAction onClick={remove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-delete">
                      {del.isPending ? 'Deleting…' : 'Delete'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            }
          />
        </div>
      )}
    </div>
  );
}
