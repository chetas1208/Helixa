/**
 * Tab 4 "Harness Library". It lists WORKSPACES (a genome state plus its analysis harness, evidence and
 * simulations) and is the single place to choose which one every other tab shows.
 * Data comes only from validated hooks; activation goes through the draft-aware SwitchGuard and the
 * active card changes only after the server has accepted `select` (no stale flashes).
 */
import { useCallback, useMemo, useRef, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Plus, Search } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { isApiError } from "../api/client";
import { useArchiveWorkspace, useBranchWorkspace, useCreateWorkspace, useRenameWorkspace, useWorkspaceCapabilities, useWorkspaces } from "../api/hooks";
import { useSession } from "../state/session";
import type { Workspace } from "../types";
import { CompareDialog } from "./CompareDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { FILTER_LABELS, SORT_LABELS, filterAndSortWorkspaces } from "./libraryModel";
import type { LibraryFilter, LibrarySort } from "./libraryModel";
import { NameDialog } from "./NameDialog";
import { SwitchGuardDialog, useGuardedWorkspaceSwitch, useSwitchGuardStore } from "./SwitchGuard";
import { BaselineRow } from "./BaselineRow";
import { exportWorkspaceProvenance } from "./exportProvenance";
import { SpecimenSkeleton, WorkspaceCard } from "./WorkspaceCard";
import { useNow } from "./time";
import { WorkspaceDrawer } from "./WorkspaceDrawer";
import { btnPrimary, btnQuiet, fieldCls } from "./ui";
import { ResearchEvidencePanel } from "../../v16/ResearchEvidencePanel";

type NameDialogState = { kind: "create" } | { kind: "fork" } | { kind: "branch"; source: Workspace } | { kind: "rename"; source: Workspace } | null;
interface Notice {
  text: string;
  /** Offer to activate a just-created workspace. */
  activateId?: string;
}

const GRID = "grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,17.5rem),1fr))]";

export const LIBRARY_SUBTITLE = "Saved workspaces: a genome state plus its analysis harness, evidence and simulations";

export function HarnessLibraryTab() {
  const workspaces = useWorkspaces();
  const qc = useQueryClient();
  const caps = useWorkspaceCapabilities();
  const now = useNow();
  const activeId = useSession((s) => s.activeWorkspaceId);
  const switchWorkspace = useGuardedWorkspaceSwitch();
  const switchError = useSwitchGuardStore((s) => s.lastError);
  const clearSwitchError = useSwitchGuardStore((s) => s.setLastError);
  const create = useCreateWorkspace();
  const branch = useBranchWorkspace();
  const rename = useRenameWorkspace();
  const archive = useArchiveWorkspace();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [sort, setSort] = useState<LibrarySort>("updated");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Workspace | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialogState>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const latestRequest = useRef(0);

  const all = workspaces.data?.workspaces;
  const list = useMemo(() => (all ? filterAndSortWorkspaces(all, { query, filter, sort, includeArchived: showArchived }) : []), [all, query, filter, sort, showArchived]);
  const byId = useCallback((id: string | null) => all?.find((w) => w.workspace_id === id) ?? null, [all]);

  const activate = useCallback(
    async (id: string) => {
      const mine = ++latestRequest.current;
      setPendingId(id);
      setNotice(null);
      try {
        await switchWorkspace(id);
      } finally {
        if (latestRequest.current === mine) setPendingId(null); // only the latest request owns the busy state
      }
    },
    [switchWorkspace],
  );

  const submitName = (name: string) => {
    if (!nameDialog) return;
    setDialogError(null);
    const done = (ws: Workspace, verb: string) => {
      setNameDialog(null);
      setNotice({ text: `${verb} "${ws.name}". It is saved; activate it to work in it.`, activateId: ws.workspace_id });
    };
    const fail = (e: unknown) => setDialogError(isApiError(e) ? e.detail : e instanceof Error ? e.message : "Request failed");
    if (nameDialog.kind === "create" || nameDialog.kind === "fork") create.mutate(name, { onSuccess: (ws) => done(ws, "Created"), onError: fail });
    else if (nameDialog.kind === "branch") branch.mutate({ workspaceId: nameDialog.source.workspace_id, name }, { onSuccess: (ws) => done(ws, "Branched"), onError: fail });
    else
      rename.mutate(
        { workspaceId: nameDialog.source.workspace_id, name },
        { onSuccess: (ws) => { setNameDialog(null); setNotice({ text: `Renamed to "${ws.name}".` }); }, onError: fail },
      );
  };
  const closeNameDialog = () => {
    setNameDialog(null);
    setDialogError(null);
  };

  const confirmArchive = () => {
    if (!archiveTarget) return;
    setDialogError(null);
    archive.mutate(
      { workspaceId: archiveTarget.workspace_id },
      {
        onSuccess: (ws) => {
          setArchiveTarget(null);
          setDrawerId(null);
          setNotice({ text: `Archived "${ws.name}". It is hidden from this list, not deleted.` });
        },
        onError: (e) => setDialogError(isApiError(e) ? e.detail : e instanceof Error ? e.message : "Request failed"),
      },
    );
  };

  const hasAny = (all?.length ?? 0) > 0;
  const archivedCount = all?.filter((w) => w.status.toUpperCase() === "ARCHIVED").length ?? 0;
  const filtersActive = query.trim() !== "" || filter !== "all";

  return (
    <Tooltip.Provider delayDuration={150}>
      <div className="pointer-events-none h-full w-full p-3 sm:p-5">
        <div className="pointer-events-auto mx-auto flex h-full max-w-[84rem] flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#070c17]/80 backdrop-blur-md">
          <header className="px-5 pb-3 pt-5 sm:px-7">
            <div className="flex items-center justify-between gap-3">
              <h1 className="whitespace-nowrap text-2xl font-semibold tracking-tight text-slate-50 sm:text-[1.7rem]">Harness Library</h1>
              <button type="button" aria-label="Create workspace" className={`${btnPrimary} shrink-0 gap-2`} onClick={() => setNameDialog({ kind: "create" })}>
                <Plus size={16} aria-hidden />
                <span className="sm:hidden">Create</span>
                <span className="hidden sm:inline">Create workspace</span>
              </button>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-300">{LIBRARY_SUBTITLE}</p>
          </header>

          <div className="flex-1 overflow-y-auto px-5 pb-6 sm:px-7">
            <BaselineRow onFork={() => setNameDialog({ kind: "fork" })} />

            {switchError && (
              <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300/40 bg-amber-400/10 p-3 text-sm text-amber-100">
                <span>{switchError}</span>
                <button type="button" className={btnQuiet} onClick={() => clearSwitchError(null)}>Dismiss</button>
              </div>
            )}
            {notice && (
              <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cyan-300/30 bg-cyan-400/10 p-3 text-sm text-cyan-50">
                <span>{notice.text}</span>
                <span className="flex gap-2">
                  {notice.activateId && (
                    <button type="button" className={btnPrimary} onClick={() => notice.activateId && void activate(notice.activateId)}>
                      Activate
                    </button>
                  )}
                  <button type="button" className={btnQuiet} onClick={() => setNotice(null)}>Dismiss</button>
                </span>
              </div>
            )}

            {/* One slim toolbar row */}
            {hasAny && (
              <div className="mb-4 flex flex-wrap items-center gap-2.5">
                <div className="relative min-w-[11rem] flex-1 basis-56">
                  <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input id="lib-search" type="search" aria-label="Search workspaces" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or id" className={`${fieldCls} h-9 min-h-0 w-full pl-9`} />
                </div>
                <div className="flex min-w-0 basis-full gap-2.5 sm:basis-auto">
                  <select aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value as LibraryFilter)} className={`${fieldCls} h-9 min-h-0 min-w-0 flex-1 py-0 sm:flex-none`}>
                    {(Object.keys(FILTER_LABELS) as LibraryFilter[]).map((k) => (
                      <option key={k} value={k}>{FILTER_LABELS[k]}</option>
                    ))}
                  </select>
                  <select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as LibrarySort)} className={`${fieldCls} h-9 min-h-0 min-w-0 flex-1 py-0 sm:flex-none`}>
                    {(Object.keys(SORT_LABELS) as LibrarySort[]).map((k) => (
                      <option key={k} value={k}>{SORT_LABELS[k]}</option>
                    ))}
                  </select>
                </div>
                {archivedCount > 0 && (
                  <label className="flex h-9 items-center gap-2 text-sm text-slate-200">
                    <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="h-4 w-4 accent-cyan-300" />
                    Archived ({archivedCount})
                  </label>
                )}
                <p className="ml-auto text-xs text-slate-300" aria-live="polite">
                  {list.length} of {all?.length ?? 0}
                </p>
              </div>
            )}

            <div className="mb-4">
              <ResearchEvidencePanel surface="library" workspaceId={activeId} />
            </div>

            {/* Body states */}
            {workspaces.isPending ? (
              <ul aria-label="Loading workspaces" className={GRID}>
                {[0, 1, 2, 3].map((i) => <SpecimenSkeleton key={i} />)}
              </ul>
            ) : workspaces.isError ? (
              <div role="alert" className="rounded-2xl border border-rose-300/30 bg-rose-400/[0.06] p-5">
                <h2 className="text-base font-semibold text-slate-50">Workspaces could not be loaded</h2>
                <p className="mt-1 text-sm leading-relaxed text-slate-200">
                  {isApiError(workspaces.error) ? workspaces.error.detail : "Unexpected error."}
                  {isApiError(workspaces.error) && workspaces.error.contractMismatch && " The server's answer did not match what this app expects, so nothing is shown."}
                </p>
                <button type="button" className={`${btnPrimary} mt-3`} onClick={() => void workspaces.refetch()}>Retry</button>
              </div>
            ) : !hasAny ? (
              <div className="rounded-2xl border border-dashed border-white/20 px-6 py-10 text-center">
                <h2 className="text-lg font-semibold text-slate-50">No workspaces yet</h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-300">
                  A workspace holds a genome state, the analysis harness version, evidence and any simulations. Create one to start from the baseline reference.
                </p>
                <button type="button" className={`${btnPrimary} mt-4`} onClick={() => setNameDialog({ kind: "create" })}>Create your first workspace</button>
              </div>
            ) : list.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/20 p-6 text-center">
                <p className="text-sm text-slate-200">No workspace matches the current search or filter.</p>
                {filtersActive && (
                  <button type="button" className={`${btnQuiet} mt-3`} onClick={() => { setQuery(""); setFilter("all"); }}>Clear search and filter</button>
                )}
              </div>
            ) : (
              <ul aria-label="Workspaces" className={GRID}>
                {list.map((ws) => (
                  <WorkspaceCard
                    key={ws.workspace_id}
                    workspace={ws}
                    all={all ?? []}
                    isActive={ws.workspace_id === activeId}
                    switching={pendingId === ws.workspace_id}
                    otherSwitching={pendingId !== null && pendingId !== ws.workspace_id}
                    caps={caps.data}
                    now={now}
                    onActivate={(id) => void activate(id)}
                    onOpen={(w) => setDrawerId(w.workspace_id)}
                    onBranch={(w) => setNameDialog({ kind: "branch", source: w })}
                    onCompare={(w) => setCompareId(w.workspace_id)}
                    onRename={(w) => setNameDialog({ kind: "rename", source: w })}
                    onArchive={(w) => { setDialogError(null); setArchiveTarget(w); }}
                    onExport={(w) => void exportWorkspaceProvenance(qc, w, all ?? [], !!caps.data?.listSimulations)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <WorkspaceDrawer
        workspace={byId(drawerId)}
        all={all ?? []}
        isActive={drawerId !== null && drawerId === activeId}
        switching={pendingId === drawerId}
        onActivate={(id) => void activate(id)}
        onBranch={(w) => setNameDialog({ kind: "branch", source: w })}
        onCompare={(w) => setCompareId(w.workspace_id)}
        onRename={(w) => setNameDialog({ kind: "rename", source: w })}
        onArchive={(w) => { setDialogError(null); setArchiveTarget(w); }}
        onClose={() => setDrawerId(null)}
      />
      <CompareDialog left={byId(compareId)} all={all ?? []} onClose={() => setCompareId(null)} />
      <NameDialog
        open={!!nameDialog}
        title={nameDialog?.kind === "fork" ? "Fork from baseline" : nameDialog?.kind === "branch" ? `Branch ${nameDialog.source.name}` : nameDialog?.kind === "rename" ? `Rename ${nameDialog.source.name}` : "Create workspace"}
        description={
          nameDialog?.kind === "branch"
            ? "Forks the current saved revision into a new workspace with its own history. Unsaved drafts are not copied. The source is not changed."
            : nameDialog?.kind === "rename"
              ? "Changes the display name only. Ids, revisions and hashes stay the same."
              : nameDialog?.kind === "fork"
                ? "Forks the immutable baseline into a new workspace. The baseline itself is never edited."
                : "Starts a new workspace at the immutable baseline reference."
        }
        submitLabel={nameDialog?.kind === "fork" ? "Fork baseline" : nameDialog?.kind === "branch" ? "Create branch" : nameDialog?.kind === "rename" ? "Rename" : "Create workspace"}
        initialName={nameDialog?.kind === "branch" ? `${nameDialog.source.name} branch` : nameDialog?.kind === "rename" ? nameDialog.source.name : ""}
        pending={create.isPending || branch.isPending || rename.isPending}
        error={dialogError}
        onSubmit={submitName}
        onClose={closeNameDialog}
      />
      <ConfirmDialog
        open={!!archiveTarget}
        title={`Archive ${archiveTarget?.name ?? ""}?`}
        description="Archiving hides this workspace from the library and prevents activating it. Its revisions and simulations are kept; nothing is deleted."
        confirmLabel="Archive workspace"
        pending={archive.isPending}
        error={dialogError}
        onConfirm={confirmArchive}
        onClose={() => { setArchiveTarget(null); setDialogError(null); }}
      />
      {/* Fallback mount: the app shell mounts one at the root; extra instances stay silent. */}
      <SwitchGuardDialog />
    </Tooltip.Provider>
  );
}
