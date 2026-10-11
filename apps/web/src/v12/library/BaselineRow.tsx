import { Lock } from "lucide-react";
import { useGenomeWindow, useReference } from "../api/hooks";
import { Skeleton } from "../design/Skeleton";
import { Fingerprint } from "./Fingerprint";
import { btnQuiet } from "./ui";

const Dot = () => <span aria-hidden className="text-slate-500 max-sm:hidden">·</span>;

/** Slim pinned baseline: the immutable reference every workspace starts from. Forking is the only way to continue from it. */
export function BaselineRow({ onFork }: { onFork: () => void }) {
  const ref = useReference();
  const win = useGenomeWindow(1, 48);
  const r = ref.data;
  return (
    <section aria-label="Pinned baseline" className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-sky-300/20 bg-sky-400/[0.04] px-4 py-2.5">
      <div className="w-40 shrink-0">
        {win.data ? (
          <Fingerprint preview={win.data.bases} label="Baseline reference, bases 1 to 48" />
        ) : win.isError ? (
          <div className="h-10" />
        ) : (
          <Skeleton className="h-10 w-full" label="Loading baseline" />
        )}
      </div>
      <div className="order-3 min-w-0 basis-full sm:order-none sm:flex-1 sm:basis-64">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-slate-100">
          <Lock size={14} aria-hidden className="text-sky-200" />
          <strong className="font-semibold">Baseline</strong>
          <Dot />
          <span>{r ? r.contig : "..."}</span>
          <Dot />
          {r && !r.official_grch38 ? <span className="text-amber-100">synthetic (not GRCh38)</span> : <span>{r?.assembly ?? "..."}</span>}
          <Dot />
          <span>never edited</span>
        </p>
        <p className="mt-0.5 text-xs text-slate-300">Immutable. Continue from it only by forking.</p>
      </div>
      <button type="button" className={`${btnQuiet} ml-auto sm:ml-0`} onClick={onFork}>
        Fork
      </button>
    </section>
  );
}
