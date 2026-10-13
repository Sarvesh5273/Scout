import { Link } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { ScoutMark } from '@/components/shell';

export default function NotFound() {
  return (
    <div className="relative mx-auto max-w-3xl px-4 py-20 sm:py-28 text-center">
      <div className="absolute inset-0 -z-10 grid-paper [mask-image:radial-gradient(circle,black,transparent_65%)]" />
      <ScoutMark className="radar mx-auto h-20 w-20 text-foreground/70" />
      <p className="mt-6 font-mono text-xs uppercase tracking-[0.3em] text-primary font-bold">404 · trail went cold</p>
      <h1 className="mt-3 font-display text-4xl sm:text-6xl font-extrabold">Scout searched. Nothing here.</h1>
      <p className="mt-4 text-muted-foreground">This page does not exist, or the hunt was deleted.</p>
      <Link href="/" className="mt-8 inline-flex items-center gap-2 rounded-full bg-foreground text-background px-6 py-3 font-semibold hover:bg-primary transition-colors" data-testid="link-home-404">
        <ArrowLeft className="h-4 w-4" /> Back to your hunts
      </Link>
    </div>
  );
}
