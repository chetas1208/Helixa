import { useEffect, useMemo, useState } from "react";
import { useGenomeWindow, useHarnessLineage, useHarnesses, useIntelligence, useWorkspace, useWorkspaces } from "../api/hooks";
import { EvidenceBadge } from "../design/EvidenceBadge";
import { Panel } from "../design/Panel";
import { Skeleton } from "../design/Skeleton";
import { UnavailableNotice } from "../design/UnavailableNotice";
import { useSession } from "../state/session";
import { btn, focusRing, input } from "../simulation/ui";
import { GenomeDrawer, HarnessDrawer } from "./CompactDrawer";
import { DiffVisual } from "./DiffVisual";
import { applyToWindow, buildGenomeTimeline, eventLabel, headline, nodesFromLineage, nodesFromRevisions, nodesFromWorkspaces, shortDiff, windowDiff } from "./genomeModel";
import { linkedHarnessId, sortHarnesses } from "./harnessModel";
import type { HarnessRecord, Lineage } from "./harnessModel";
import { Timeline } from "./Timeline";
import { useAllLineages, useGenomeLineage, useWorkspaceHarness } from "./useGenomeLineage";
import { ResearchEvidencePanel } from "../../v16/ResearchEvidencePanel";

/** Evolution tab: a visual, read-only instrument. Hero = two-lane timeline; below = DNA diff + compact drawer. */
export function EvolutionTab() {
  const wsId = useSession((s) => s.activeWorkspaceId);
  const reduced = useSession((s) => s.reducedMotion);
  const selectedRevisionId = useSession((s) => s.selectedRevisionId);
  const setSelectedRevisionId = useSession((s) => s.setSelectedRevisionId);
  const selectedPosition = useSession((s) => s.selectedPosition);
  const setSelectedPosition = useSession((s) => s.setSelectedPosition);
  const setActiveTab = useSession((s) => s.setActiveTab);

  const ws = useWorkspace(wsId);
  const intel = useIntelligence(wsId);
  const refWindow = useGenomeWindow(1, 48);
  const harnesses = useHarnesses();
  const genomeLineage = useGenomeLineage(wsId);
  const workspaces = useWorkspaces();
  const allLineages = useAllLineages(workspaces.data?.workspaces);
  const wsHarness = useWorkspaceHarness(wsId);

  const [branchId, setBranchId] = useState("");
  const [lane, setLane] = useState<"genome" | "harness">("genome");
  const [harnessId, setHarnessId] = useState<string | null>(null);
  useEffect(() => setBranchId(""), [wsId]);

  const w = ws.data;
  const nodes = useMemo(() => {
    if (!w) return [];
    if (w.revisions && w.revisions.length) return nodesFromRevisions(w.revisions);
    if (genomeLineage.data && genomeLineage.data.some((n) => n.genome_revision_id === w.active_genome_revision_id)) {
      const self = { workspaceId: w.workspace_id, name: w.name, nodes: genomeLineage.data, active: w.active_revision };
      const joined = nodesFromWorkspaces(w.workspace_id, [self, ...allLineages.data.filter((l) => l.workspaceId !== w.workspace_id)]);
      return joined.length ? joined : nodesFromLineage(genomeLineage.data, w.active_revision);
    }
    return nodesFromRevisions([w.active_revision]);
  }, [w, genomeLineage.data, allLineages.data]);
  const timeline = useMemo(() => (w ? buildGenomeTimeline(nodes, w.active_genome_revision_id) : null), [w, nodes]);

  const selectedId = timeline && selectedRevisionId && timeline.events.has(selectedRevisionId) ? selectedRevisionId : (w?.active_genome_revision_id ?? "");
  const activeBranch = timeline ? (timeline.branches.find((b) => b.id === branchId && b.path.includes(selectedId)) ?? timeline.branches.find((b) => b.path.includes(selectedId)) ?? timeline.branches[0]) : undefined;
  const path = activeBranch?.path ?? [];
  const idx = Math.max(0, path.indexOf(selectedId));
  const selected = timeline?.events.get(selectedId);
  const baseline = timeline?.baselineId ? timeline.events.get(timeline.baselineId) : undefined;

  const sortedHarnesses = useMemo(
    () => (harnesses.data ? sortHarnesses(harnesses.data.harnesses.filter((h) => typeof h.version_id === "string" && typeof h.status === "string") as unknown as HarnessRecord[]) : []),
    [harnesses.data],
  );
  const effectiveHarnessId = harnessId && sortedHarnesses.some((h) => h.version_id === harnessId) ? harnessId : (sortedHarnesses[sortedHarnesses.length - 1]?.version_id ?? null);
  const lineage = useHarnessLineage(effectiveHarnessId);
  const lineageRec = lineage.data && lineage.data.recorded ? (lineage.data.lineage as Lineage) : undefined;
  const harnessRecord = sortedHarnesses.find((h) => h.version_id === effectiveHarnessId);
  const wsHarnessId = wsHarness.data?.nodes[0]?.harness_version_id ?? selected?.node.harnessVersionId ?? w?.active_harness_version_id ?? null;
  const link = wsHarnessId ? linkedHarnessId(wsHarnessId, sortedHarnesses) : null;

  const diff = useMemo(() => {
    const edits = selected?.node.edits;
    if (!selected || !baseline?.node.edits || !edits || !refWindow.data) return null;
    const d = windowDiff(refWindow.data.bases, refWindow.data.start, baseline.node.edits, edits);
    const prev = selected.node.previewBases;
    const previewOk = prev ? applyToWindow(refWindow.data.bases, refWindow.data.start, edits).slice(0, prev.length) === prev : null;
    return { ...d, previewOk };
  }, [selected, baseline, refWindow.data]);

  const selectGenome = (id: string) => {
    setSelectedRevisionId(id);
    setLane("genome");
    const ev = timeline?.events.get(id);
    setSelectedPosition(ev && ev.deltaKnown && ev.delta.length ? ev.delta[0].position : null);
  };

  const harnessChanged = (wsHarness.data?.nodes.length ?? 1) > 1;
  const editCount = w?.active_revision.edits.length ?? 0;
  const diffTitle = selected?.isBaseline ? "Baseline" : selected ? eventLabel(selected) : "";
  const currentHead = w?.active_genome_revision_id && timeline?.events.has(w.active_genome_revision_id) ? w.active_genome_revision_id : null;
  const foreign = !!(selected?.node.workspaceId && w && selected.node.workspaceId !== w.workspace_id);

  return (
    <div className="pointer-events-auto h-full w-full overflow-y-auto" data-tab="evolution">
      <div className="mx-auto flex min-h-full w-full max-w-[96rem] flex-col gap-3 px-4 py-3 sm:px-6 xl:h-full">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold text-slate-50 sm:text-xl" data-testid="headline">
            {w ? headline(editCount, harnessChanged) : "Genome & Harness Evolution"}
          </h1>
          {w && <EvidenceBadge kind="VALIDATED" label="From stored records" />}
          {w && <span className="text-xs text-slate-300">{w.name} · read-only</span>}
          <p className="w-full text-xs text-slate-400">In-silico edit and harness versions. Not a natural evolutionary phylogeny.</p>
        </header>
        <ResearchEvidencePanel surface="evolution" workspaceId={w?.workspace_id ?? wsId} assembly={w?.assembly ?? null} />

        {!wsId ? (
          <Panel className="p-4"><UnavailableNotice title="No active workspace" detail="Pick a workspace in the Harness Library to see its history." /></Panel>
        ) : ws.isLoading ? (
          <Panel className="space-y-3 p-4"><Skeleton className="h-40 w-full" /><Skeleton className="h-24 w-full" /></Panel>
        ) : ws.error || !timeline || !w || !selected ? (
          <Panel className="p-4"><UnavailableNotice title="Genome history unavailable" detail={(ws.error as Error | null)?.message ?? "The workspace could not be loaded."} endpoint="GET /api/v10/genome/workspaces/{id}" /></Panel>
        ) : (
          <>
            <Panel className="flex shrink-0 flex-col gap-2 p-3" aria-label="Timeline">
              <div>
                <Timeline
                  timeline={timeline}
                  selectedGenomeId={selectedId}
                  onSelectGenome={selectGenome}
                  harnesses={sortedHarnesses}
                  harnessLoading={harnesses.isLoading}
                  harnessError={harnesses.error ? (harnesses.error as Error).message : null}
                  selectedHarnessId={effectiveHarnessId}
                  focusLane={lane}
                  onSelectHarness={(id) => {
                    setHarnessId(id);
                    setLane("harness");
                  }}
                  reduced={reduced}
                  currentWorkspaceId={w.workspace_id}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-2">
                {timeline.branches.length > 1 && (
                  <label className="flex items-center gap-2 text-xs text-slate-200">
                    Branch
                    <select className={input} value={activeBranch?.id} onChange={(e) => {
                      setBranchId(e.target.value);
                      const b = timeline.branches.find((x) => x.id === e.target.value);
                      if (b) selectGenome(b.headId);
                    }} aria-label="Branch picker">
                      {timeline.branches.map((b) => (
                        <option key={b.id} value={b.id}>{b.label}{b.containsCurrent ? " (current)" : ""}</option>
                      ))}
                    </select>
                  </label>
                )}
                <button type="button" className={btn} disabled={idx <= 0} onClick={() => selectGenome(path[idx - 1])} aria-label="Previous version">‹ Previous</button>
                <button type="button" className={btn} disabled={idx >= path.length - 1} onClick={() => selectGenome(path[idx + 1])} aria-label="Next version">Next ›</button>
                <label className="flex min-w-[9rem] flex-1 items-center gap-2 text-xs text-slate-200">
                  Scrub
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, path.length - 1)}
                    step={1}
                    value={idx}
                    disabled={path.length < 2}
                    onChange={(e) => selectGenome(path[Number(e.target.value)])}
                    aria-label="Scrub through genome versions"
                    aria-valuetext={`${eventLabel(selected)}, version ${idx + 1} of ${path.length}`}
                    className={`h-6 min-w-0 flex-1 accent-cyan-300 ${focusRing}`}
                  />
                  <span className="font-mono">{idx + 1}/{path.length}</span>
                </label>
                <span className="hidden text-xs text-slate-300 lg:inline">Arrow keys move along a lane.</span>
              </div>
            </Panel>

            <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr),22rem]">
              <Panel className="flex min-w-0 flex-col gap-2 p-3.5" aria-label="DNA-level comparison">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-slate-50">Baseline ↔ {selected.isCurrent ? "current" : "selected"}</h2>
                  <EvidenceBadge kind="REFERENCE" label="Reference bases 1-48" />
                  {selected.diffKnown && !selected.isBaseline && (
                    <span className="text-xs text-slate-200" data-testid="diff-explanation">{shortDiff(selected.fromBaseline)}</span>
                  )}
                  {diff?.previewOk === true && <span className="text-xs text-emerald-200">✓ matches recorded preview</span>}
                  {diff?.previewOk === false && <span role="alert" className="text-xs text-amber-200">edit list and recorded preview disagree</span>}
                </div>
                {!selected.diffKnown ? (
                  <div className="flex flex-wrap items-center gap-2 text-[13px] text-slate-100" data-testid="diff-unavailable">
                    <span>Base positions are not available for this version (not on the current line).</span>
                    <button type="button" className={btn} onClick={() => selectGenome(timeline.branches.find((b) => b.containsCurrent)?.headId ?? selected.id)}>Select current</button>
                  </div>
                ) : !diff ? (
                  <p className="text-xs text-slate-300">{refWindow.isLoading ? "Loading reference window..." : "Reference window unavailable."}</p>
                ) : selected.isBaseline || (timeline.baselineOnly && diff.cells.every((c) => !c.changed)) ? (
                  <BaselineCalm bases={diff.cells.map((c) => c.ref).join("")} baselineOnly={timeline.baselineOnly} />
                ) : (
                  <DiffVisual cells={diff.cells} outside={diff.outside} selectedPosition={selectedPosition} onPick={setSelectedPosition} selectedLabel={diffTitle.length > 9 ? "selected" : diffTitle} />
                )}
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                  {!timeline.baselineOnly && currentHead && (selected.isBaseline ? (
                    <button type="button" className={btn} onClick={() => selectGenome(currentHead)}>Select current version</button>
                  ) : baseline ? (
                    <button type="button" className={btn} onClick={() => selectGenome(baseline.id)}>Select baseline</button>
                  ) : null)}
                  {foreign ? (
                    <>
                      <span className="ml-auto text-xs text-slate-200">Stored in workspace <span className="font-semibold">{selected.node.workspaceName}</span>, not the active one.</span>
                      <button type="button" className={btn} onClick={() => setActiveTab("library")}>Switch in Harness Library</button>
                    </>
                  ) : (
                    <button type="button" className={`${btn} ml-auto`} onClick={() => setActiveTab("editor")}>Open in Genome Editor</button>
                  )}
                </div>
              </Panel>

              <div className="min-h-0">
                {lane === "harness" && harnessRecord ? (
                  <HarnessDrawer record={harnessRecord} all={sortedHarnesses} lineage={lineageRec} lineageNote={lineage.data && !lineage.data.recorded ? lineage.data.reason : null} linked={!!link && link === harnessRecord.version_id} />
                ) : (
                  <GenomeDrawer event={selected} intelligence={intel.data} linkedHarness={link} />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BaselineCalm({ bases, baselineOnly }: { bases: string; baselineOnly: boolean }) {
  return (
    <div className="flex flex-col gap-3" data-testid={baselineOnly ? "baseline-only" : "baseline-selected"}>
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-300/50 bg-emerald-400/10 text-lg text-emerald-200">✓</span>
        <div>
          <p className="text-[15px] font-semibold text-slate-50">{baselineOnly ? "Identical to baseline" : "Baseline selected"}</p>
          <p className="text-xs text-slate-300">
            {baselineOnly ? "No edits saved. The next saved version will appear here, lit base by base." : "The unedited reference bases. Select a later version to see which bases it changes."}
          </p>
        </div>
      </div>
      <p className="break-all font-mono text-[13px] tracking-[0.18em] text-slate-300/80" aria-label="Baseline bases 1 to 48">{bases}</p>
    </div>
  );
}
