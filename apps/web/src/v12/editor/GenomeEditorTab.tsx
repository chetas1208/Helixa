import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, RotateCw } from "lucide-react";
import { EvidenceDrawer, ExploreChips, interpretCommandOrLocal } from "../../features/genome-editor";
import type { DrawerSection } from "../../features/genome-editor";
import { useLocusWindow } from "../../features/genome-editor/useLocusWindow";
import { useAnatomySelection } from "../../v14/state/anatomySelection";
import { ApiError } from "../api/client";
import { useGenomeWindow, useReference, useWorkspace, useWorkspaces } from "../api/hooks";
import { EvidenceBadge } from "../design/EvidenceBadge";
import { Skeleton } from "../design/Skeleton";
import { UnavailableNotice } from "../design/UnavailableNotice";
import { useSession } from "../state/session";
import type { DraftAction, DraftOp, EditDraft, Nucleotide } from "../types";
import { BaseInspector } from "./BaseInspector";
import { DraftToolbar } from "./DraftToolbar";
import type { CompareAgainst } from "./DraftToolbar";
import { PromptComposer } from "./PromptComposer";
import type { SubmitOutcome } from "./PromptComposer";
import { ProposalPreview } from "./ProposalPreview";
import { ResearchProposalCard } from "./ResearchProposalCard";
import { buildResearchProposal } from "./researchProposal";
import { SemanticBaseList } from "./SemanticBaseList";
import { StatusChip } from "./StatusChip";
import { canRedo, canUndo, draftReducer, emptyDraft } from "./draftReducer";
import {
  GRCH38_REFERENCE_ASSET_ID,
  SYNTHETIC_REFERENCE_ASSET_ID,
  WINDOW_END,
  WINDOW_START,
  applyDraftOps,
  applySavedEdits,
  deriveEditorStatus,
  describeSelection,
  detectDraftConflict,
  draftSummary,
  indexOfPosition,
  isNucleotide,
  refreshOps,
  restoreBaselineOps,
} from "./editorModel";
import { useEditorSceneStore } from "./editorSceneStore";
import type { CompareMode } from "./editorSceneStore";
import { ResearchEvidencePanel } from "../../v16/ResearchEvidencePanel";
import { bodyColumnFraction } from "./helixGeometry";
import { fromRefMismatch } from "./promptParser";
import { intentCreatesDraft, routePrompt, toInterpretRequest } from "./promptRouter";
import type { RouterContext } from "./promptRouter";
import type { TraitResearchProposal } from "../../v14/contracts";
import { useDraftReview } from "./useDraftReview";
import { useMediaQuery } from "./useMediaQuery";
import type { VoiceAdapter } from "./voiceAdapter";

/**
 * Tab 1: Genome Editor (the product hero). DOM overlay only: the big body figure (left column) and the DNA helix
 * (right column) are drawn by <EditorScene/> inside the shell's persistent canvas. One screen, no inner tabs or view
 * switches. The stage is click-through; only panels take pointer events.
 */
export function GenomeEditorTab({ voiceAdapter }: { voiceAdapter?: VoiceAdapter } = {}) {
  const activeWorkspaceId = useSession((s) => s.activeWorkspaceId);
  const drafts = useSession((s) => s.drafts);
  const selectedPosition = useSession((s) => s.selectedPosition);
  const connection = useSession((s) => s.connection);
  const sessionReduced = useSession((s) => s.reducedMotion);
  const mqReduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const reduced = sessionReduced || mqReduced;
  const isMobile = useMediaQuery("(max-width: 768px)");

  const anatomyId = useAnatomySelection((s) => s.anatomyId);
  const geneId = useAnatomySelection((s) => s.geneId);
  const locusId = useAnatomySelection((s) => s.locusId);
  const drawerOpen = useAnatomySelection((s) => s.drawerOpen);

  const list = useWorkspaces();
  const wsId = activeWorkspaceId ?? list.data?.active?.workspace_id ?? null;
  const wsQ = useWorkspace(wsId);
  const refQ = useReference();
  const winQ = useGenomeWindow(WINDOW_START, WINDOW_END);
  const locusQ = useLocusWindow(locusId);
  const ws = wsQ.data;
  const win = winQ.data;
  const draft: EditDraft | undefined = wsId ? drafts[wsId] : undefined;
  const locusWin = locusQ.data ?? null;
  const usingLocus = !!locusWin && locusWin.bases.length > 0;

  // ---------- derived sequences ----------
  const start = usingLocus && locusWin ? locusWin.start : (win?.start ?? WINDOW_START);
  const baseline = useMemo(
    () => (usingLocus && locusWin ? locusWin.bases.toUpperCase() : win ? win.bases.toUpperCase() : ""),
    [usingLocus, locusWin, win],
  );
  const referenceAssetId = usingLocus ? GRCH38_REFERENCE_ASSET_ID : (ws?.reference_asset_id ?? SYNTHETIC_REFERENCE_ASSET_ID);
  const savedBases = useMemo(
    () => (ws && baseline ? applySavedEdits(baseline, start, ws.active_revision.edits, referenceAssetId) : baseline),
    [ws, baseline, start, referenceAssetId],
  );
  const ops = draft?.ops ?? [];
  const draftBases = useMemo(() => (savedBases ? applyDraftOps(savedBases, start, ops) : ""), [savedBases, start, ops]);
  const ready = (!!win || usingLocus) && !!ws && baseline.length > 0;
  const contig = usingLocus && locusWin ? locusWin.contig : (win?.contig ?? refQ.data?.contig ?? "chr22");
  const assembly = usingLocus && locusWin ? locusWin.assembly : (win?.assembly ?? refQ.data?.assembly ?? "synthetic-chr22-educational");
  const [lastIntent, setLastIntent] = useState<string | null>(null);
  const [drawerSection, setDrawerSection] = useState<DrawerSection | null>(null);
  const [traitWhy, setTraitWhy] = useState<string | null>(null);
  const [researchProposal, setResearchProposal] = useState<TraitResearchProposal | null>(null);

  // ---------- local UI state ----------
  const [compareMode, setCompareMode] = useState<CompareMode>("off");
  const [compareAgainst, setCompareAgainst] = useState<CompareAgainst>("saved");
  const [bodyTurns, setBodyTurns] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [lastUnsupported, setLastUnsupported] = useState(false);
  const [dropNote, setDropNote] = useState<string | null>(null);

  // ---------- draft plumbing (session holds per-workspace drafts) ----------
  const wsRef = useRef(ws);
  wsRef.current = ws;
  const dispatchDraft = useCallback((action: DraftAction) => {
    const w = wsRef.current;
    if (!w) return;
    const st = useSession.getState();
    const cur = st.drafts[w.workspace_id] ?? emptyDraft(w);
    const next = draftReducer(cur, action);
    if (next !== cur || !st.drafts[w.workspace_id]) st.setDraft(w.workspace_id, next);
    setLastUnsupported(false);
  }, []);

  // keep the draft's recorded base in step with an UNCHANGED-by-user workspace (empty draft only)
  const conflict = detectDraftConflict(draft, ws);
  useEffect(() => {
    if (!ws) return;
    const st = useSession.getState();
    if (!st.drafts[ws.workspace_id] || conflict.kind === "stale-empty") st.setDraft(ws.workspace_id, emptyDraft(ws));
  }, [ws, conflict.kind]);

  // detect remote changes: refetch on focus/visibility and every 20 s while visible
  const refetchWs = wsQ.refetch;
  useEffect(() => {
    if (!wsId) return;
    const poll = () => { if (!document.hidden) void refetchWs(); };
    const t = setInterval(poll, 20000);
    document.addEventListener("visibilitychange", poll);
    window.addEventListener("focus", poll);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", poll); window.removeEventListener("focus", poll); };
  }, [wsId, refetchWs]);

  const remoteConflict = conflict.kind === "remote-change" ? conflict : null;
  const review = useDraftReview({ open: reviewOpen, workspace: ws, draft, blocked: !!remoteConflict && true, dispatchDraft });
  const saving = review.save.phase === "saving";

  // close the review once everything was saved
  useEffect(() => {
    if (reviewOpen && ops.length === 0 && review.save.phase === "saved") setReviewOpen(false);
  }, [reviewOpen, ops.length, review.save.phase]);

  useEffect(() => { setInspectorCollapsed(isMobile); }, [isMobile]);

  // opening the review gives the bottom stack priority: fold the inspector
  useEffect(() => { if (reviewOpen) setInspectorCollapsed(true); }, [reviewOpen]);

  // workspace switch resets transient UI
  useEffect(() => { setReviewOpen(false); setLastUnsupported(false); setDropNote(null); setCompareMode("off"); setLastIntent(null); setTraitWhy(null); setResearchProposal(null); }, [wsId]);

  // ---------- compare ----------
  const originalBases = compareAgainst === "baseline" ? baseline : savedBases;
  const canCompare = ready && draftBases !== originalBases;
  const effectiveCompare: CompareMode = canCompare ? compareMode : "off";

  // ---------- selection ----------
  const selection = useMemo(
    () => (ready && selectedPosition !== null ? describeSelection(selectedPosition, start, baseline, savedBases, draftBases, ops) : null),
    [ready, selectedPosition, start, baseline, savedBases, draftBases, ops],
  );
  const setSelected = useCallback((p: number | null) => useSession.getState().setSelectedPosition(p), []);
  useEffect(() => {
    // selection must stay inside the loaded window
    if (ready && selectedPosition !== null && indexOfPosition(selectedPosition, start, baseline.length) < 0) setSelected(null);
  }, [ready, selectedPosition, start, baseline.length, setSelected]);

  // ---------- measure what the panels cover so the scene frames its subject in the free area ----------
  const rootRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const inspectorOpenDesktop = !!selection && !isMobile;
  const [leftFrac, setLeftFrac] = useState(() => bodyColumnFraction(typeof window === "undefined" ? 1440 : window.innerWidth));
  useEffect(() => {
    const measure = () => {
      const root = rootRef.current;
      const stack = stackRef.current;
      if (!root || !stack) return;
      const r = root.getBoundingClientRect();
      const h = window.innerHeight;
      const stackGap = Math.round(Math.max(0, h - stack.getBoundingClientRect().top + 8));
      const cap = captionRef.current;
      const frac = bodyColumnFraction(window.innerWidth);
      setLeftFrac(frac);
      // desktop: clear the status line and the toolbar row only; the inspector is handled by `right`.
      // phones: the whole top block (status + toolbar + caption) sits above both columns.
      const below = (el: HTMLElement | null) => (el && el.offsetHeight > 0 ? el.getBoundingClientRect().bottom + 8 : 0);
      const top = isMobile ? below(topRef.current) : Math.max(below(statusRef.current), below(toolsRef.current));
      useEditorSceneStore.getState().set({
        insets: {
          top: Math.round(Math.max(r.top + 10, top)),
          right: inspectorOpenDesktop ? 340 : 0,
          bottomLeft: isMobile || !cap ? stackGap : Math.round(Math.max(0, h - cap.getBoundingClientRect().top + 6)),
          bottomRight: stackGap,
          leftFrac: frac,
        },
      });
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro && stackRef.current) ro.observe(stackRef.current);
    if (ro && topRef.current) ro.observe(topRef.current);
    if (ro && captionRef.current) ro.observe(captionRef.current);
    if (ro && statusRef.current) ro.observe(statusRef.current);
    if (ro && toolsRef.current) ro.observe(toolsRef.current);
    window.addEventListener("resize", measure);
    return () => { ro?.disconnect(); window.removeEventListener("resize", measure); };
  }, [isMobile, inspectorOpenDesktop, ready]);

  // ---------- push plain data to the scene ----------
  const evidenceKind = ops.length > 0 ? "HYPOTHESIS" : (ws?.edit_count ?? 0) > 0 ? "VALIDATED" : "REFERENCE";
  const sceneStatus = ready ? "ready" : winQ.isError ? "error" : "loading";
  useEffect(() => {
    useEditorSceneStore.getState().set({
      status: sceneStatus,
      start,
      baselineBases: ready ? baseline : "",
      savedBases: ready ? savedBases : "",
      draftBases: ready ? draftBases : "",
      originalBases: ready ? originalBases : "",
      selectedPosition: ready ? selectedPosition : null,
      proposedAlt: selection?.proposedAlt ?? null,
      compareMode: effectiveCompare,
      bodyTurns,
      evidenceKind,
      reducedMotion: reduced,
    });
  }, [sceneStatus, ready, start, baseline, savedBases, draftBases, originalBases, selectedPosition, selection?.proposedAlt, effectiveCompare, bodyTurns, evidenceKind, reduced]);
  useEffect(() => {
    useEditorSceneStore.getState().setActions({ onSelect: setSelected });
    const vis = () => useEditorSceneStore.getState().set({ paused: document.hidden });
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, [setSelected]);

  // ---------- actions ----------
  const addOp = useCallback(
    (position: number, alt: Nucleotide, origin: DraftOp["origin"]) => {
      const idx = indexOfPosition(position, start, savedBases.length);
      if (idx < 0) return;
      dispatchDraft({ type: "add", op: { position, ref: savedBases[idx], alt, origin } });
    },
    [start, savedBases, dispatchDraft],
  );

  /** Remove a pending op: an op whose alt equals its ref reverts that position in the reducer. */
  const removeOp = useCallback(
    (position: number) => {
      const o = ops.find((x) => x.position === position);
      if (o && isNucleotide(o.ref)) dispatchDraft({ type: "add", op: { ...o, alt: o.ref } });
    },
    [ops, dispatchDraft],
  );

  const routerCtx = useMemo<RouterContext>(
    () => ({
      selectedPosition,
      windowStart: start,
      windowEnd: start + Math.max(0, baseline.length - 1),
      contig,
      assembly,
      locusId,
      anatomyId,
      geneId,
      referenceAssetId,
    }),
    [selectedPosition, start, baseline.length, contig, assembly, locusId, anatomyId, geneId, referenceAssetId],
  );

  const applyRouted = useCallback(
    (routed: ReturnType<typeof routePrompt>, origin: DraftOp["origin"]): SubmitOutcome => {
      setLastIntent(routed.intent);
      setLastUnsupported(false);
      if (routed.intent === "TRAIT_GOAL") {
        const why = routed.trait_goal?.why_not_automatic ?? routed.reason;
        const topic = routed.trait_goal?.topic ?? "trait wish";
        setTraitWhy(why);
        setResearchProposal(routed.trait_goal?.research ?? buildResearchProposal(topic));
        setReviewOpen(false);
        setDrawerSection("sequence");
        useAnatomySelection.getState().openDrawer();
        if (routed.trait_goal?.related_anatomy_ids[0]) {
          useAnatomySelection.getState().selectAnatomy(routed.trait_goal.related_anatomy_ids[0], { focus: true, openDrawer: true });
        }
        return { tone: "ask", message: why };
      }
      if (routed.intent === "EXPLORE") {
        const ex = routed.explore;
        if (ex?.anatomy_ids[0]) useAnatomySelection.getState().selectAnatomy(ex.anatomy_ids[0], { focus: true, openDrawer: true });
        if (ex?.gene_ids[0]) useAnatomySelection.getState().selectGene(ex.gene_ids[0]);
        if (ex?.locus_id) useAnatomySelection.getState().selectLocus(ex.locus_id);
        const section: DrawerSection = ex?.action === "show_genes" || ex?.action === "show_gene_tissues" ? "genes" : ex?.action === "show_sequence" ? "sequence" : "anatomy";
        setDrawerSection(section);
        useAnatomySelection.getState().openDrawer();
        return { tone: "ok", message: routed.reason };
      }
      if (intentCreatesDraft(routed) && routed.edit) {
        const position = routed.edit.position;
        const alt = routed.edit.alt;
        if (!isNucleotide(alt)) {
          setLastUnsupported(true);
          return { tone: "unsupported", message: "Only A, C, G or T can be drafted." };
        }
        const idx = indexOfPosition(position, start, draftBases.length);
        if (idx < 0) {
          return { tone: "ask", message: `Parsed locally: ${routed.edit.assembly} ${routed.edit.contig}:${position} ${alt}. That coordinate is not in the loaded window. Inspect the matching GRCh38 locus first.` };
        }
        const current = draftBases[idx];
        const mismatch = routed.edit.stated_ref
          ? fromRefMismatch({ kind: "proposal", position, alt, fromRef: isNucleotide(routed.edit.stated_ref) ? routed.edit.stated_ref : undefined, via: "explicit_position", label: "Parsed locally" }, current)
          : null;
        if (mismatch) return { tone: "ask", message: mismatch };
        if (current === alt) return { tone: "ask", message: `Position ${position} already reads ${alt}. Nothing to change.` };
        addOp(position, alt, origin);
        setSelected(position);
        setResearchProposal(null);
        setReviewOpen(true);
        review.dismissSave();
        return { tone: "ok", message: `${routed.reason} Review it below. Nothing is saved until you confirm.` };
      }
      if (routed.intent === "UNSUPPORTED") {
        setLastUnsupported(true);
        return { tone: "unsupported", message: `Unsupported. ${routed.reason}` };
      }
      return { tone: "ask", message: routed.reason };
    },
    [start, draftBases, addOp, setSelected, review],
  );

  const onSubmit = useCallback(
    async (text: string, origin: DraftOp["origin"]): Promise<SubmitOutcome> => {
      const source = origin === "voice" ? "voice" : "text";
      const local = routePrompt(text, routerCtx, source);
      try {
        const routed = await interpretCommandOrLocal(toInterpretRequest(text, source, routerCtx, wsId), routerCtx);
        if (local.intent === "TRAIT_GOAL") {
          return applyRouted({ ...local, source: routed.source, edit: null }, origin);
        }
        return applyRouted(routed, origin);
      } catch {
        return applyRouted(local, origin);
      }
    },
    [routerCtx, wsId, applyRouted],
  );

  const onExploreBody = useCallback(() => {
    setDrawerSection("anatomy");
    useAnatomySelection.getState().openDrawer();
  }, []);

  const reload = useCallback(
    async (keep: boolean) => {
      const r = await wsQ.refetch();
      const fresh = r.data;
      if (!fresh || !baseline) return;
      const st = useSession.getState();
      if (!keep || !draft) {
        st.setDraft(fresh.workspace_id, emptyDraft(fresh));
        setDropNote(null);
        return;
      }
      const freshSaved = applySavedEdits(baseline, start, fresh.active_revision.edits, referenceAssetId);
      const kept = refreshOps(draft.ops, freshSaved, start);
      st.setDraft(fresh.workspace_id, { ...emptyDraft(fresh), ops: kept });
      const dropped = draft.ops.length - kept.length;
      setDropNote(dropped > 0 ? `${dropped} draft change(s) no longer apply to the latest version and were dropped.` : null);
    },
    [wsQ, baseline, start, draft, referenceAssetId],
  );

  const onRestoreBaseline = () => {
    const restore = restoreBaselineOps(savedBases, baseline, start, "manual");
    dispatchDraft({ type: "clear" });
    for (const op of restore) dispatchDraft({ type: "add", op });
    setReviewOpen(true);
    review.dismissSave();
  };
  const onDiscard = () => {
    dispatchDraft({ type: "clear" });
    setReviewOpen(false);
    review.dismissSave();
    setLastUnsupported(false);
  };

  const status = deriveEditorStatus({
    editCount: ws?.edit_count ?? 0,
    draftOpCount: ops.length,
    validating: reviewOpen && review.validating,
    unsupported: lastUnsupported || (reviewOpen && review.anyRejected),
  });
  const inlineStatus = reviewOpen && ops.length > 0
    ? review.validating ? ("Validating" as const) : review.anyError ? ("Unavailable" as const) : review.allValidated ? ("Ready to review" as const) : null
    : null;

  // ---------- messages ----------
  const offline = connection === "offline" || (winQ.error instanceof ApiError && winQ.error.status === 0);
  const remoteMsg = remoteConflict
    ? `This workspace changed elsewhere (version counter ${remoteConflict.draftCounter} to ${remoteConflict.remoteCounter}). Your unsaved draft was based on the older version, so it cannot be saved yet.`
    : null;
  const loading = !ready && !winQ.isError && !wsQ.isError;
  const loadError = winQ.isError ? winQ.error : wsQ.isError ? wsQ.error : null;
  const synthetic = usingLocus ? false : (win ? !win.official_grch38 : refQ.data ? !refQ.data.official_grch38 : false);
  const showChrome = selectedPosition !== null || ops.length > 0 || reviewOpen || lastIntent === "PRECISE_EDIT" || lastIntent === "TRAIT_GOAL" || lastIntent === "UNSUPPORTED";
  const stripLabel = usingLocus
    ? `Baseline · GRCh38 · ${locusId}`
    : `Baseline · GRCh38 · ${contig}:${start}-${start + Math.max(0, baseline.length - 1)} (${assembly})`;
  const facing = bodyTurns % 2 === 0 ? "front" : "back";
  const turnButton = (
    <button
      type="button"
      onClick={() => setBodyTurns((t) => t + 1)}
      aria-label={`Turn the figure around (showing ${facing})`}
      title="Turn the figure around. You can also drag it."
      data-testid="body-turn"
      className="pointer-events-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-slate-950/55 px-3 text-xs text-slate-100 backdrop-blur hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
    >
      <RotateCw className="h-3.5 w-3.5" aria-hidden /> Turn figure
    </button>
  );
  const bodyCaption = (
    <span className="leading-4 text-slate-300" data-testid="body-caption">
      <span className="max-[768px]:hidden">Illustrative figure. Its anatomy never changes with edits; the glow only confirms an edit landed. No validated body-level effect.</span>
      <span className="min-[769px]:hidden">Illustrative figure. Anatomy never changes with edits; no validated body-level effect.</span>
    </span>
  );


  const toolbar = ready ? (
    <DraftToolbar
      opCount={ops.length}
      canUndo={canUndo(draft)}
      canRedo={canRedo(draft)}
      canDiscard={ops.length > 0 || (draft?.redo.length ?? 0) > 0}
      canRestoreBaseline={savedBases !== baseline && draftBases !== baseline}
      canCompare={canCompare}
      compareMode={effectiveCompare}
      compareAgainst={compareAgainst}
      reviewOpen={reviewOpen}
      busy={saving}
      onUndo={() => dispatchDraft({ type: "undo" })}
      onRedo={() => dispatchDraft({ type: "redo" })}
      onDiscard={onDiscard}
      onRestoreBaseline={onRestoreBaseline}
      onCompareMode={setCompareMode}
      onCompareAgainst={setCompareAgainst}
      onReview={() => { setReviewOpen(true); review.dismissSave(); }}
    />
  ) : null;

  return (
    <div ref={rootRef} className="relative h-full w-full" data-testid="genome-editor-tab" data-ready={ready ? "true" : "false"}>

      {/* ---------- top: one status line (left) + draft tools (right; below the status on phones) ---------- */}
      <div ref={topRef} className="pointer-events-none absolute inset-x-3 top-3 flex flex-col gap-2 min-[769px]:inset-x-4 min-[769px]:flex-row min-[769px]:items-start min-[769px]:justify-between">
        {loading ? (
          <div className="flex items-center gap-2" aria-busy="true">
            <Skeleton className="h-7 w-28 rounded-full" label="Loading status" />
            <Skeleton className="h-4 w-56" label="Loading reference" />
          </div>
        ) : showChrome ? (
          <div ref={statusRef} className="pointer-events-none flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs leading-5 text-slate-200">
            {ws && (
              <span className="text-slate-300">
                <EvidenceBadge kind="REFERENCE" label="Observed reference" />
                <span className="ml-2 font-mono">version {ws.revision_counter}</span> <span className="text-slate-500">&middot;</span> {draftSummary(ops)}
              </span>
            )}
          </div>
        ) : (
          <div ref={statusRef} className="hidden" />
        )}
        {ready && (
          <div className={`pointer-events-none flex flex-col items-start gap-2 min-[769px]:shrink-0 min-[769px]:items-end ${showChrome ? "" : "max-[768px]:hidden"}`}>
            <div ref={toolsRef} className="pointer-events-none flex max-w-full flex-col items-start gap-2 min-[769px]:items-end">
              {toolbar}
              {effectiveCompare !== "off" && (
                <p className="pointer-events-auto rounded-lg bg-slate-950/60 px-3 py-1 text-xs leading-5 text-slate-100 backdrop-blur" data-testid="compare-legend">
                  Left: {compareAgainst === "baseline" ? "baseline" : "saved version"}. Right: draft. Rendering is artistic; the letters are the data.
                </p>
              )}
            </div>
            {selection && !isMobile && (
              <BaseInspector
                className="w-[320px]"
                info={selection}
                contig={contig}
                collapsed={inspectorCollapsed}
                onToggle={() => setInspectorCollapsed((c) => !c)}
                onChoose={(alt) => addOp(selection.position, alt, "manual")}
                onRemoveDraft={() => removeOp(selection.position)}
                onClear={() => setSelected(null)}
                disabled={saving}
              />
            )}
            {isMobile && showChrome && (
              <div className="pointer-events-none flex items-center gap-2 text-[11px]">
                {turnButton}
                {bodyCaption}
              </div>
            )}
          </div>
        )}
        {ready && isMobile && !showChrome && (
          <div className="pointer-events-none flex items-center gap-2 text-[11px]">
            {turnButton}
            {bodyCaption}
          </div>
        )}
      </div>

      {/* ---------- under the body column (desktop): turn + honest caption ---------- */}
      {ready && !isMobile && (
        <div ref={captionRef} className="pointer-events-none absolute bottom-3 left-4 flex items-center justify-center gap-2.5 text-xs" style={{ width: `calc(${leftFrac * 100}% - 2rem)` }}>
          {turnButton}
          <span className="max-w-[24rem]">{bodyCaption}</span>
        </div>
      )}

      <EvidenceDrawer
        open={drawerOpen}
        section={drawerSection}
        onSection={setDrawerSection}
        sequenceNote={usingLocus ? `Pinned locus ${locusId}.` : undefined}
        traitWhy={traitWhy}
      />
      <div className="pointer-events-auto absolute left-4 top-14 z-30 w-[min(20rem,42%)]">
        <ResearchEvidencePanel
          surface="editor"
          geneId={geneId}
          anatomyId={anatomyId}
          assembly={ws?.assembly ?? null}
          workspaceId={wsId}
        />
      </div>

      {/* ---------- error / disconnected ---------- */}
      {loadError && (
        <div className="pointer-events-auto absolute right-4 top-24 w-[min(26rem,calc(100%-2rem))] max-[768px]:left-4" data-testid="editor-error">
          <UnavailableNotice
            title={offline ? "Disconnected: the API is unreachable" : "Could not load the reference window"}
            detail={offline ? "The body figure stays available, but there is no sequence to show. Your draft, if any, is kept in this session. Check the connection and retry." : loadError instanceof ApiError ? loadError.detail : "Unexpected error."}
            endpoint={offline ? undefined : "/api/v10/genome/window"}
            action={
              <button type="button" onClick={() => { void winQ.refetch(); void wsQ.refetch(); void list.refetch(); }} className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 px-3 py-1.5 text-sm text-slate-100 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
                <RefreshCw className="h-4 w-4" aria-hidden /> Retry
              </button>
            }
          />
        </div>
      )}

      {/* ---------- bottom stack ---------- */}
      {/* ---------- bottom stack: under the helix column on desktop, full width on phones ---------- */}
      <div
        ref={stackRef}
        className="pointer-events-none absolute bottom-3 right-0 flex flex-col items-center gap-2 px-3 min-[769px]:px-4"
        style={{ left: isMobile ? 0 : `${leftFrac * 100}%` }}
      >

        {dropNote && <p role="status" className="glass pointer-events-auto rounded-lg px-3 py-1.5 text-sm text-amber-100">{dropNote}</p>}

        {remoteMsg && !reviewOpen && (
          <div className="glass-strong pointer-events-auto w-full max-w-[640px] rounded-xl border border-amber-300/40 p-3 text-sm text-amber-50" role="alert" data-testid="remote-conflict">
            {remoteMsg}
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => void reload(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 px-2.5 py-1 text-xs hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><RefreshCw className="h-3.5 w-3.5" aria-hidden /> Reload latest, keep my draft</button>
              <button type="button" onClick={() => void reload(false)} className="rounded-lg border border-white/25 px-2.5 py-1 text-xs hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Reload latest, discard draft</button>
            </div>
          </div>
        )}

        {review.save.phase === "saved" && (
          <div className="glass-strong pointer-events-auto flex w-full max-w-[640px] flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-emerald-300/40 p-3 text-sm text-emerald-50" role="status" data-testid="saved-notice">
            <EvidenceBadge kind="VALIDATED" label="Reference check passed" />
            <span>
              Saved {review.save.saved} change{review.save.saved === 1 ? "" : "s"} as new version{review.save.saved === 1 ? "" : "s"}. Current: <span className="font-mono">{review.save.revisionId}</span> (counter {review.save.counter}).
            </span>
            <span className="text-xs text-emerald-100/80">No phenotype or protein model ran.</span>
            <button type="button" onClick={review.dismissSave} className="ml-auto rounded-md px-2 py-0.5 text-xs hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-200">Dismiss</button>
          </div>
        )}

        {researchProposal && !reviewOpen && (
          <ResearchProposalCard proposal={researchProposal} onDismiss={() => setResearchProposal(null)} />
        )}

        {reviewOpen && draft && (
          <div className="w-full max-w-[640px]">
            <ProposalPreview
              contig={contig}
              draft={draft}
              review={review}
              conflictMessage={remoteMsg}
              onRemove={(op) => removeOp(op.position)}
              onClose={() => setReviewOpen(false)}
              onReloadKeep={() => void reload(true)}
              onReloadDiscard={() => void reload(false)}
            />
          </div>
        )}

        {selection && isMobile && !reviewOpen && (
          <div className="w-full max-w-[640px]">
            <BaseInspector
              info={selection}
              contig={contig}
              collapsed={inspectorCollapsed}
              onToggle={() => setInspectorCollapsed((c) => !c)}
              onChoose={(alt) => addOp(selection.position, alt, "manual")}
              onRemoveDraft={() => removeOp(selection.position)}
              onClear={() => setSelected(null)}
              disabled={saving}
              compact
              className="max-h-[38vh] overflow-y-auto"
            />
          </div>
        )}

        {ready ? (
          <div className="flex w-full max-w-[900px] flex-col items-stretch gap-1.5">
            <div className="pointer-events-auto flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs leading-5 text-slate-200">
              <StatusChip status={status} />
              <span className="font-mono" data-testid="reference-label">{stripLabel}</span>
              {synthetic && (
                <span className="rounded-full border border-amber-300/50 bg-amber-400/10 px-2 py-0.5 text-[11px] font-medium text-amber-100" data-testid="synthetic-label">
                  Local synthetic sequence, not GRCh38
                </span>
              )}
            </div>
            <ExploreChips
              onSection={setDrawerSection}
              onWhy={() => {
                setTraitWhy("A trait wish is not a single-base substitution. Name a GRCh38 coordinate and allele, or explore genes with evidence in this tissue. Anatomy never changes from an edit.");
                setDrawerSection("sequence");
                useAnatomySelection.getState().openDrawer();
              }}
            />
            <SemanticBaseList
              start={start}
              contig={contig}
              baseline={baseline}
              saved={savedBases}
              draft={draftBases}
              selectedPosition={selectedPosition}
              reducedMotion={reduced}
              onSelect={setSelected}
              onPropose={(p, alt) => addOp(p, alt, "manual")}
            />
          </div>
        ) : loading ? (
          <Skeleton className="h-[3.4rem] w-full max-w-[900px] rounded-xl" label="Loading bases" />
        ) : null}

        {loading ? (
          <Skeleton className="h-[3.4rem] w-full max-w-[640px] rounded-2xl" label="Loading editor" />
        ) : (
          <PromptComposer
            selectedPosition={selectedPosition}
            onSubmit={onSubmit}
            status={inlineStatus}
            voiceAdapter={voiceAdapter}
            disabled={!ready || saving}
            disabledReason={!ready ? "The reference window is not loaded" : "Saving in progress"}
            onExploreBody={onExploreBody}
          />
        )}
      </div>
    </div>
  );
}
