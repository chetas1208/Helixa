import { useMemo } from "react";
import type { Simulation } from "../types";
import { Skeleton } from "../design/Skeleton";
import { ClampedText, Disclosure } from "./Disclosure";
import { FramesTable, TrajectoryChart } from "./TrajectoryChart";
import type { ChartSeries } from "./TrajectoryChart";
import { StaticExample } from "./StaticExample";
import { fmtInt, fmtYears, framesToCsv, framesToJson, replicateBand, replicateKey, summarize } from "./runData";
import type { RunEntry } from "./useSimulationRuns";
import type { Lifecycle, RunError } from "./simulationStore";
import { btn, input, muted, sectionTitle } from "./ui";

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface Props {
  lifecycle: Lifecycle;
  error: RunError | null;
  progress: { done: number; total: number } | null;
  runs: RunEntry[];
  selectedId: string | null;
  compareId: string | null;
  selected: Simulation | null;
  compare: Simulation | null;
  blocked: string | null;
  activeRevisionId: string | null;
  engineDown: boolean;
  playheadYear: number | null;
  onSelect: (id: string) => void;
  onCompare: (id: string | null) => void;
}

const runLabel = (r: RunEntry) => (r.sim ? `${r.id} · seed ${r.sim.seed} · ${fmtYears(r.sim.simulated_years)} · N ${r.sim.population_size}` : r.id);

export function OutcomePanel(p: Props) {
  const { selected, compare } = p;
  const loaded = p.runs.filter((r) => r.sim);

  const band = useMemo(() => {
    if (!selected) return null;
    const key = replicateKey(selected);
    const group = loaded.filter((r) => r.sim && replicateKey(r.sim) === key).map((r) => r.sim!);
    return group.length >= 2 ? replicateBand(group) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, p.runs]);

  const series: ChartSeries[] = selected ? [{ key: "a", label: "Run A", sim: selected }, ...(compare && compare.simulation_id !== selected.simulation_id ? [{ key: "b" as const, label: "Run B", sim: compare }] : [])] : [];
  const sum = selected ? summarize(selected.frames) : null;
  const reading =
    selected && sum
      ? [
          `The focal allele went from ${sum.start?.toFixed(2)} to ${sum.end?.toFixed(2)} over ${fmtInt(selected.generations_executed)} generations (${fmtYears(selected.simulated_years)} at a declared ${fmtInt(selected.generation_time_years)} y/generation).`,
          sum.extinct ? `Population size reached zero at ${fmtYears(sum.extinctAtYear ?? 0)}, which the model counts as extinction under these assumptions.` : "",
          selected.fitness_focal === selected.fitness_other ? "Selection was zero, so the change is random drift." : `Focal fitness ${selected.fitness_focal} vs ${selected.fitness_other}.`,
          "Generated from the recorded frames; another seed can end differently.",
        ]
          .filter(Boolean)
          .join(" ")
      : "";

  return (
    <div className="space-y-4 p-4" aria-live="polite">
      {p.lifecycle === "pending" && (
        <div role="status" className="space-y-2 rounded-md border border-cyan-300/30 bg-cyan-400/[0.07] p-3">
          <p className="text-sm font-medium text-cyan-50">Waiting for the simulation engine</p>
          <p className={muted}>
            The request is synchronous; there is no progress or ETA to report.
            {p.progress && p.progress.total > 1 ? ` Replicate ${Math.min(p.progress.done + 1, p.progress.total)} of ${p.progress.total} in flight.` : ""}
          </p>
          <Skeleton className="h-3 w-2/3" label="Waiting for engine" />
        </div>
      )}

      {p.lifecycle === "failed" && p.error && (
        <div role="alert" className="space-y-1 rounded-md border border-red-300/40 bg-red-400/10 p-3">
          <p className="text-sm font-medium text-red-100">
            {p.error.unreachable ? "Simulation engine not reachable" : `Run refused by the engine (HTTP ${p.error.status})`}
          </p>
          <p className="break-words font-mono text-xs leading-relaxed text-red-100/90">{p.error.detail}</p>
          <p className={muted}>No result was produced, so none is shown. Your draft is unchanged and earlier runs are intact.</p>
        </div>
      )}

      {p.engineDown && <StaticExample />}

      {!selected && !p.engineDown && p.lifecycle !== "pending" && (
        <div className="rounded-md border border-white/10 bg-white/[0.03] p-4">
          <p className="text-sm font-medium text-slate-100">No run for this workspace yet</p>
          <p className={`${muted} mt-1`}>Set up a scenario on the left and choose Run simulation. Results, charts and the 3D ribbon appear only after the engine returns real frames.</p>
        </div>
      )}

      {p.blocked && (
        <div role="alert" className="rounded-md border border-amber-300/40 bg-amber-400/10 p-3 text-xs text-amber-100">
          Not displayed: {p.blocked}
        </div>
      )}

      {selected && sum && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {sum.extinct ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-red-300/60 bg-red-400/15 px-2.5 py-0.5 text-xs font-semibold text-red-100">
                <span aria-hidden>✕</span> Extinct at {fmtYears(sum.extinctAtYear ?? 0)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/40 bg-emerald-400/10 px-2.5 py-0.5 text-xs text-emerald-100">
                <span aria-hidden>●</span> Population persisted
              </span>
            )}
            {sum.fixedAt === "focal" && <span className="rounded-full border border-cyan-300/40 bg-cyan-400/10 px-2.5 py-0.5 text-xs text-cyan-100">Focal allele fixed (frequency 1)</span>}
            {sum.fixedAt === "other" && <span className="rounded-full border border-violet-300/40 bg-violet-400/10 px-2.5 py-0.5 text-xs text-violet-100">Focal allele lost (frequency 0)</span>}
          </div>

          <section aria-label="Run selection" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <div className="min-w-0 space-y-1">
              <label htmlFor="run-a" className="text-xs text-slate-200">Run A (drives playback + ribbon)</label>
              <select id="run-a" className={`${input} w-full`} value={p.selectedId ?? ""} onChange={(e) => p.onSelect(e.target.value)}>
                {loaded.map((r) => (
                  <option key={r.id} value={r.id}>{runLabel(r)}</option>
                ))}
              </select>
            </div>
            <div className="min-w-0 space-y-1">
              <label htmlFor="run-b" className="text-xs text-slate-200">Compare with Run B</label>
              <select id="run-b" className={`${input} w-full`} value={p.compareId ?? ""} onChange={(e) => p.onCompare(e.target.value || null)} disabled={loaded.length < 2}>
                <option value="">{loaded.length < 2 ? "Needs a second real run" : "None"}</option>
                {loaded.filter((r) => r.id !== p.selectedId).map((r) => (
                  <option key={r.id} value={r.id}>{runLabel(r)}</option>
                ))}
              </select>
            </div>
          </section>

          <TrajectoryChart series={series} band={band} playheadYear={p.playheadYear} />
          {!band && <p className={muted}>Replicate range appears only with two or more real runs of the same scenario (different seeds).</p>}

          <section aria-label="Plain-language reading" className="space-y-1">
            <h3 className={sectionTitle}>What happened in this run</h3>
            <ClampedText text={reading} />
          </section>
          <p className="truncate font-mono text-[11px] text-slate-300" title={`result_sha256 ${selected.result_sha256}`} data-testid="run-provenance">
            seed {selected.seed} · {selected.engine} {selected.engine_version} · {selected.fidelity} · sha {selected.result_sha256.slice(0, 12)}…
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btn} onClick={() => download(`${selected.simulation_id}-frames.csv`, framesToCsv(selected), "text/csv")}>Export CSV</button>
            <button type="button" className={btn} onClick={() => download(`${selected.simulation_id}-frames.json`, framesToJson(selected), "application/json")}>Export JSON</button>
            <span className={muted}>{selected.frames.length} recorded frames, no interpolated rows</span>
          </div>

          <div className="space-y-2">
            <Disclosure title="Frames table" hint={`${selected.frames.length} rows${series.length > 1 ? " · Run A and B" : ""}`}>
              <FramesTable series={series} />
            </Disclosure>
            <Disclosure title="Run record" hint="ids, hashes, model settings">
              <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
                {[
                  ["Run", selected.simulation_id],
                  ["Engine", `${selected.engine} ${selected.engine_version}`],
                  ["Fidelity", selected.fidelity],
                  ["Seed", String(selected.seed)],
                  ["Generations", `${fmtInt(selected.generations_executed)} (${selected.generation_time_years} y each, declared)`],
                  ["Population size", `${fmtInt(selected.population_size)} · ploidy ${selected.ploidy}`],
                  ["Fitness", `${selected.fitness_class}: ${selected.fitness_note}`],
                  ["Recombination", selected.recombination],
                  ["Workspace", selected.workspace_id],
                  ["Genome revision", selected.genome_revision_id + (p.activeRevisionId && p.activeRevisionId !== selected.genome_revision_id ? " (an earlier revision than the current one)" : "")],
                  ["result_sha256", selected.result_sha256],
                ].map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-slate-300">{k}</dt>
                    <dd className="m-0 break-all font-mono text-slate-100">{v}</dd>
                  </div>
                ))}
              </dl>
            </Disclosure>
            <Disclosure title="Engine narrative and limitations" hint="verbatim">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-100">{selected.narrative}</p>
              <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-slate-100" aria-label="Limitations">
                {selected.limitations.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </Disclosure>
          </div>
        </>
      )}
    </div>
  );
}
