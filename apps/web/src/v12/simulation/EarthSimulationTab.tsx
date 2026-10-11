import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../api/client";
import { recallSimulations, useEnvironmentPresets, useListedSimulations, useParameterSpecs, useWorkspace, useWorkspaceCapabilities } from "../api/hooks";
import { EvidenceBadge } from "../design/EvidenceBadge";
import { Panel } from "../design/Panel";
import { Skeleton } from "../design/Skeleton";
import { UnavailableNotice } from "../design/UnavailableNotice";
import { useSession } from "../state/session";
import { SIM_DEFAULT_PLAYBACK_SECONDS } from "../types";
import { liveClock, useEarthScene } from "./earthSceneStore";
import { OutcomePanel } from "./OutcomePanel";
import { frameIndexAt } from "./playbackClock";
import { checkRunOwnership, fmtInt, fmtYears } from "./runData";
import { lightingPreview } from "./scenario";
import type { ScenarioDraft } from "./scenario";
import { ScenarioPanel } from "./ScenarioPanel";
import { Scrubber } from "./Scrubber";
import { useSimulationStore, useWsSim } from "./simulationStore";
import { usePlayback } from "./usePlayback";
import { useRunsData, useSimulationRunner } from "./useSimulationRuns";
import { btn } from "./ui";
import { ResearchEvidencePanel } from "../../v16/ResearchEvidencePanel";

/** Earth Simulation tab (DOM side). The 3D scene is EarthScene, fed through earthSceneStore. */
export function EarthSimulationTab() {
  const wsId = useSession((s) => s.activeWorkspaceId);
  const reduced = useSession((s) => s.reducedMotion);
  const ws = useWorkspace(wsId);
  const specs = useParameterSpecs();
  const presets = useEnvironmentPresets();
  const sim = useWsSim(wsId);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [interpolate, setInterpolate] = useState(false);

  const revisionId = ws.data?.active_genome_revision_id ?? null;
  const { run, pending } = useSimulationRunner(wsId, revisionId);

  // Switching workspace resets to that workspace's last remembered run (ids only; results are refetched).
  useEffect(() => {
    if (!wsId) return;
    const st = useSimulationStore.getState();
    if (st.byWs[wsId]?.hydrated) return;
    const newestFirst = recallSimulations(wsId);
    st.patch(wsId, { hydrated: true, runIds: [...newestFirst].reverse(), selectedRunId: newestFirst[0] ?? null });
  }, [wsId]);

  // Runs the backend lists for this workspace (when that route exists) join the remembered ones.
  const caps = useWorkspaceCapabilities();
  const listed = useListedSimulations(wsId, !!caps.data?.listSimulations);
  useEffect(() => {
    if (!wsId || !listed.data?.length) return;
    const st = useSimulationStore.getState();
    const cur = st.byWs[wsId];
    const known = cur?.runIds ?? [];
    const fresh = listed.data.map((s) => s.simulation_id).filter((id) => !known.includes(id));
    if (!fresh.length) return;
    const runIds = [...fresh, ...known].slice(-12);
    st.patch(wsId, { runIds, selectedRunId: cur?.selectedRunId && runIds.includes(cur.selectedRunId) ? cur.selectedRunId : runIds[runIds.length - 1] });
  }, [wsId, listed.data]);

  const runs = useRunsData(sim.runIds, wsId);
  const selectedEntry = runs.find((r) => r.id === sim.selectedRunId);
  const compareEntry = runs.find((r) => r.id === sim.compareRunId);
  const own = checkRunOwnership(selectedEntry?.sim, wsId && sim.selectedRunId ? { simulationId: sim.selectedRunId, workspaceId: wsId } : null);
  const selected = own.ok ? selectedEntry!.sim! : null;
  const compareOwn = checkRunOwnership(compareEntry?.sim, wsId && sim.compareRunId ? { simulationId: sim.compareRunId, workspaceId: wsId } : null);
  const compare = compareOwn.ok ? compareEntry!.sim! : null;
  const blocked = selectedEntry?.sim && !own.ok ? own.reason : selectedEntry?.error ? `Run ${selectedEntry.id} could not be loaded: ${selectedEntry.error}` : null;

  // Playback + scene bridge.
  const playbackS = selected?.playback_seconds || SIM_DEFAULT_PLAYBACK_SECONDS;
  const { controller, snap } = usePlayback(selected?.simulation_id ?? null, playbackS, selected?.simulated_years ?? 0);
  const setRun = useEarthScene((s) => s.setRun);
  const clearRun = useEarthScene((s) => s.clearRun);
  useEffect(() => {
    if (selected) setRun(selected.simulation_id, selected.frames.map(({ simulated_years, allele_frequency, population_size, extinct }) => ({ simulated_years, allele_frequency, population_size, extinct })), selected.simulated_years);
    else clearRun();
    liveClock.visibleYear = 0;
  }, [selected, setRun, clearRun]);
  useEffect(() => useEarthScene.getState().setReducedMotion(reduced), [reduced]);
  useEffect(() => {
    useEarthScene.getState().setPreview(lightingPreview(sim.draft));
  }, [sim.draft]);
  useEffect(() => () => void useEarthScene.getState().clearRun(), []);

  const sceneIdx = selected ? frameIndexAt(selected.frames, snap.visibleYear) : -1;
  const sceneFrame = selected && sceneIdx >= 0 ? selected.frames[sceneIdx] : null;
  const sceneReadout =
    selected && sceneFrame
      ? `frame ${fmtInt(sceneIdx + 1)} of ${fmtInt(selected.frames.length)} · year ${fmtYears(sceneFrame.simulated_years)} · p ${sceneFrame.allele_frequency.toFixed(2)}${sceneFrame.extinct ? " · extinct" : ""}`
      : null;

  const engineDown = useMemo(() => {
    const down = (e: unknown) => e instanceof ApiError && e.status === 0;
    return down(specs.error) || down(presets.error) || down(ws.error) || (sim.lifecycle === "failed" && !!sim.error?.unreachable);
  }, [specs.error, presets.error, ws.error, sim.lifecycle, sim.error]);

  if (!wsId) {
    return (
      <div className="pointer-events-none flex h-full items-center justify-center p-4">
        <Panel className="max-w-md p-5">
          <UnavailableNotice title="No active workspace" detail="Pick a workspace in the Harness Library. Simulations always run against one workspace's exact genome revision." />
        </Panel>
      </div>
    );
  }

  const patch = (p: Partial<ScenarioDraft>) => useSimulationStore.getState().patchDraft(wsId, p);

  return (
    <div className="pointer-events-none relative flex h-full w-full flex-col gap-3 overflow-y-auto p-3 lg:block lg:overflow-hidden lg:p-0" data-tab="simulation">
      {/* Scene window on small screens (canvas shows through); on desktop the panels float over it. */}
      <div aria-hidden className="h-[34vh] shrink-0 lg:hidden" />

      <div className="pointer-events-none absolute top-3 z-10 hidden justify-center lg:left-[18.5rem] lg:right-[23.5rem] lg:flex xl:left-[24rem] xl:right-[27.5rem]">
        <SceneCaption readout={sceneReadout} />
      </div>
      <div className="pointer-events-none order-1 flex justify-center lg:hidden"><SceneCaption readout={sceneReadout} /></div>

      {/* Left: scenario controls (collapsible) */}
      <div className="order-3 lg:absolute lg:bottom-[9.25rem] lg:left-3 lg:top-3 lg:flex lg:w-[17rem] lg:flex-col xl:w-[22.5rem]">
        {leftOpen ? (
          <Panel
            title="Scenario"
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
            actions={<button type="button" className={btn} onClick={() => setLeftOpen(false)} aria-label="Collapse scenario controls">Hide</button>}
          >
            <div className="min-h-0 flex-1 overflow-y-auto">
              {specs.isLoading || ws.isLoading ? (
                <div className="space-y-3 p-4"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
              ) : specs.error ? (
                <div className="p-4"><UnavailableNotice title={engineDown ? "Simulation engine not reachable" : "Parameter catalog unavailable"} detail={specs.error instanceof ApiError ? specs.error.detail : (specs.error as Error).message} endpoint="GET /api/v10/evolution/parameters" /></div>
              ) : (
                <>
                  <ScenarioPanel
                    draft={sim.draft}
                    specs={specs.data?.parameters ?? []}
                    presets={presets.data?.presets ?? []}
                    disabled={!revisionId || sim.lifecycle === "pending"}
                    pending={pending || sim.lifecycle === "pending"}
                    revisionLabel={revisionId ?? "unknown"}
                    onPatch={patch}
                    onReset={() => useSimulationStore.getState().resetDraft(wsId)}
                    onRun={run}
                  />
                  <div className="px-3 pb-3">
                    <ResearchEvidencePanel surface="simulation" workspaceId={wsId} assembly={ws.data?.assembly ?? null} />
                  </div>
                </>
              )}
            </div>
          </Panel>
        ) : (
          <button type="button" className={`${btn} pointer-events-auto w-max`} onClick={() => setLeftOpen(true)} aria-expanded={false}>Show scenario controls</button>
        )}
      </div>

      {/* Right: outcome */}
      <div className="order-4 lg:absolute lg:bottom-[9.25rem] lg:right-3 lg:top-3 lg:flex lg:w-[22rem] lg:flex-col lg:items-end xl:w-[26rem]">
        {rightOpen ? (
          <Panel
            title={
              <span className="flex items-center gap-2">
                Outcome <EvidenceBadge kind={selected ? "SIMULATED" : "INCONCLUSIVE"} label={selected ? "Simulation outcome" : "No run yet"} />
              </span>
            }
            className="flex min-h-0 w-full flex-1 flex-col overflow-hidden"
            actions={<button type="button" className={btn} onClick={() => setRightOpen(false)} aria-label="Collapse outcome panel">Hide</button>}
          >
            <div className="min-h-0 flex-1 overflow-y-auto">
              <OutcomePanel
                lifecycle={sim.lifecycle}
                error={sim.error}
                progress={sim.progress}
                runs={runs}
                selectedId={sim.selectedRunId}
                compareId={sim.compareRunId}
                selected={selected}
                compare={compare}
                blocked={blocked}
                activeRevisionId={revisionId}
                engineDown={engineDown}
                playheadYear={selected ? snap.visibleYear : null}
                onSelect={(id) => useSimulationStore.getState().patch(wsId, { selectedRunId: id })}
                onCompare={(id) => useSimulationStore.getState().patch(wsId, { compareRunId: id })}
              />
            </div>
          </Panel>
        ) : (
          <button type="button" className={`${btn} pointer-events-auto w-max`} onClick={() => setRightOpen(true)} aria-expanded={false}>Show outcome</button>
        )}
      </div>

      {/* Bottom: scrubber */}
      <Panel
        className="order-2 lg:absolute lg:bottom-3 lg:left-3 lg:right-3"
        aria-label="Playback controls"
      >
        <Scrubber controller={controller} snap={snap} sim={selected} playbackSeconds={playbackS} interpolate={interpolate} onInterpolate={setInterpolate} reducedMotion={reduced} />
      </Panel>
    </div>
  );
}

function SceneCaption({ readout }: { readout: string | null }) {
  return (
    <div className="pointer-events-none flex max-w-full flex-col items-center gap-1 text-center">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span className="max-w-full rounded-full border border-white/15 bg-slate-950/70 px-3 py-1 text-xs text-slate-100 backdrop-blur">
          Illustrative visualization of model output
        </span>
        <span className="max-w-full rounded-full border border-amber-300/40 bg-amber-400/10 px-3 py-1 text-xs text-amber-200 backdrop-blur" data-testid="unsupported-phenotype-label">
          Unsupported phenotype consequence: not modeled
        </span>
      </div>
      <span className="max-w-full rounded-md bg-slate-950/70 px-2.5 py-1 font-mono text-xs text-cyan-50 backdrop-blur" data-testid="scene-frame-readout" aria-live="off">
        {readout ?? "No run loaded: the ring stays grey"}
      </span>
      <span className="max-w-full rounded-md bg-slate-950/55 px-2 py-0.5 text-[11px] leading-snug text-slate-300 backdrop-blur">
        Ring: lit share = focal allele frequency of that frame; height = population size.
      </span>
    </div>
  );
}
