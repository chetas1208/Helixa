import { useId } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Archive, CircleDot, GitBranch, Pencil } from "lucide-react";
import type { ReactNode } from "react";
import type { WorkspaceCapabilities } from "../api/schemas";
import { Skeleton } from "../design/Skeleton";
import type { Workspace } from "../types";
import { editedPositions } from "./fingerprint";
import { Fingerprint } from "./Fingerprint";
import { KIND_LABEL, formatTimestamp, isArchived, workspaceKind } from "./libraryModel";
import type { WorkspaceKind } from "./libraryModel";
import { OverflowMenu } from "./OverflowMenu";
import type { MenuItem } from "./OverflowMenu";
import { formatRelative } from "./time";

const KIND_STYLE: Record<WorkspaceKind, { cls: string; icon: ReactNode }> = {
  baseline: { cls: "border-sky-300/40 bg-sky-400/10 text-sky-100", icon: <CircleDot size={12} aria-hidden /> },
  edited: { cls: "border-violet-300/40 bg-violet-400/10 text-violet-100", icon: <Pencil size={12} aria-hidden /> },
  branch: { cls: "border-cyan-300/40 bg-cyan-400/10 text-cyan-100", icon: <GitBranch size={12} aria-hidden /> },
  archived: { cls: "border-slate-400/40 bg-slate-400/10 text-slate-200", icon: <Archive size={12} aria-hidden /> },
};

export function KindBadge({ kind }: { kind: WorkspaceKind }) {
  const s = KIND_STYLE[kind];
  return (
    <span data-kind-badge={kind} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>
      {s.icon}
      {KIND_LABEL[kind]}
    </span>
  );
}

const MAX_DOTS = 10;

/** One dot per in-silico edit (capped, with +N), so edit volume reads at a glance. */
export function EditDots({ count }: { count: number }) {
  if (count === 0) return <span className="text-sm text-slate-300">No edits</span>;
  const shown = Math.min(count, MAX_DOTS);
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-200">
      <span aria-hidden className="inline-flex items-center gap-[5px]">
        {Array.from({ length: shown }, (_, i) => (
          <span key={i} className="h-2 w-2 rounded-full bg-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.55)]" />
        ))}
        {count > MAX_DOTS && <span className="ml-0.5 text-xs text-amber-200">+{count - MAX_DOTS}</span>}
      </span>
      {count} edit{count === 1 ? "" : "s"}
    </span>
  );
}

interface Props {
  workspace: Workspace;
  all: readonly Workspace[];
  isActive: boolean;
  /** This card's activation is in flight (select not yet confirmed by the server). */
  switching: boolean;
  /** Another card's activation is in flight, so pressing this (still active) card means "stay here". */
  otherSwitching: boolean;
  caps: WorkspaceCapabilities | undefined;
  now: number;
  onActivate: (id: string) => void;
  onOpen: (ws: Workspace) => void;
  onBranch: (ws: Workspace) => void;
  onCompare: (ws: Workspace) => void;
  onRename: (ws: Workspace) => void;
  onArchive: (ws: Workspace) => void;
  onExport: (ws: Workspace) => void;
}

/** Specimen card: the whole card activates; everything secondary lives in the overflow menu and the detail drawer. */
export function WorkspaceCard({ workspace: ws, all, isActive, switching, otherSwitching, caps, now, onActivate, onOpen, onBranch, onCompare, onRename, onArchive, onExport }: Props) {
  const descId = useId();
  const kind = workspaceKind(ws, all);
  const archived = isArchived(ws);
  const synthetic = !ws.official_grch38;
  const lit = editedPositions(ws.active_revision.edits);
  const relative = formatRelative(ws.updated_at, now);

  const items: MenuItem[] = [
    { key: "details", label: "Details", onSelect: () => onOpen(ws) },
    { key: "branch", label: "Branch (fork this revision)", onSelect: () => onBranch(ws) },
    { key: "compare", label: "Compare with...", onSelect: () => onCompare(ws) },
    caps?.rename
      ? { key: "rename", label: "Rename", onSelect: () => onRename(ws) }
      : { key: "rename", label: "Rename", disabledReason: "Needs PATCH /api/v10/genome/workspaces/{id}, which this API does not have." },
    caps?.archive && !isActive && !archived
      ? { key: "archive", label: "Archive", onSelect: () => onArchive(ws) }
      : {
          key: "archive",
          label: "Archive",
          disabledReason: archived ? "Already archived." : isActive ? "Activate another workspace first." : "Needs POST /api/v10/genome/workspaces/{id}/archive, which this API does not have.",
        },
    { key: "export", label: "Export provenance (JSON)", onSelect: () => onExport(ws) },
  ];

  const opensDetails = archived || (isActive && !otherSwitching);
  const primaryLabel = archived ? `Open details of ${ws.name} (archived)` : opensDetails ? `Open details of ${ws.name} (active workspace)` : isActive ? `Stay on ${ws.name}` : `Activate ${ws.name}`;
  const onPrimary = () => (opensDetails ? onOpen(ws) : onActivate(ws.workspace_id));

  return (
    <li
      data-testid={`workspace-card-${ws.workspace_id}`}
      data-active={isActive ? "true" : "false"}
      data-kind={kind}
      aria-current={isActive ? "true" : undefined}
      className="group relative isolate"
    >
      <button type="button" onClick={onPrimary} disabled={switching} aria-label={primaryLabel} aria-describedby={descId} className="absolute inset-0 z-10 cursor-pointer rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-slate-100 disabled:cursor-progress" />
      <span id={descId} className="sr-only">
        {KIND_LABEL[kind]}, {ws.edit_count} in-silico edit{ws.edit_count === 1 ? "" : "s"}, saved {relative}. {archived ? "Archived workspaces cannot be activated." : isActive ? "Currently selected in all tabs." : "Selecting it shows it in all tabs."}
      </span>

      <div
        className={`pointer-events-none relative z-20 flex h-full flex-col gap-3 rounded-2xl border p-4 transition duration-200 motion-safe:group-hover:-translate-y-0.5 ${
          isActive
            ? "border-cyan-300/70 bg-gradient-to-b from-cyan-400/[0.10] to-cyan-400/[0.02] shadow-[0_0_0_1px_rgba(103,232,249,0.45),0_14px_44px_-14px_rgba(34,211,238,0.55)]"
            : archived
              ? "border-white/10 bg-white/[0.02] opacity-70"
              : "border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.015] group-hover:border-white/30 group-hover:shadow-[0_14px_36px_-18px_rgba(125,211,252,0.5)]"
        } ${switching ? "motion-safe:animate-pulse" : ""}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 text-[1.2rem] font-semibold leading-snug text-slate-50" title={ws.name}>
              {ws.name}
            </h3>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <KindBadge kind={kind} />
              {isActive && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/70 bg-cyan-300/20 px-2.5 py-0.5 text-xs font-semibold text-cyan-50">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-cyan-200 shadow-[0_0_8px_rgba(165,243,252,0.9)]" />
                  Active
                </span>
              )}
            </div>
          </div>
          <OverflowMenu label={`More actions for ${ws.name}`} items={items} />
        </div>

        <div className="relative overflow-hidden rounded-xl border border-white/[0.07] bg-[#050a14]/85 px-2 pb-1.5 pt-5 [background-image:radial-gradient(110%_90%_at_50%_0%,rgba(56,189,248,0.10),transparent_70%)]">
          <span className="absolute left-3 top-1.5 text-[11px] leading-none text-slate-300">bases 1-48{synthetic ? ", synthetic" : ""}</span>
          <Fingerprint preview={ws.active_revision.preview_1_48} lit={lit} label={`Sequence fingerprint of ${ws.name}: ${ws.active_revision.preview_1_48.length} bases, ${lit.size} edited position${lit.size === 1 ? "" : "s"} lit`} />
        </div>

        <div className="mt-auto flex items-center justify-between gap-3">
          <EditDots count={ws.edit_count} />
          {switching ? (
            <span className="text-sm text-cyan-100">Activating...</span>
          ) : (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <time dateTime={ws.updated_at} className="pointer-events-auto cursor-default text-sm text-slate-300">
                  saved {relative}
                </time>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content sideOffset={6} className="z-[90] rounded-md border border-white/15 bg-[#0b1220] px-2.5 py-1.5 text-xs text-slate-100 shadow-xl">
                  {formatTimestamp(ws.updated_at)}
                  <Tooltip.Arrow className="fill-[#0b1220]" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          )}
        </div>
      </div>
    </li>
  );
}

export function SpecimenSkeleton() {
  return (
    <li aria-hidden className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <Skeleton className="h-6 w-2/3" label="Loading workspace" />
      <Skeleton className="mt-3 h-5 w-20 rounded-full" label="Loading" />
      <Skeleton className="mt-4 h-[84px] w-full rounded-xl" label="Loading fingerprint" />
      <div className="mt-4 flex justify-between">
        <Skeleton className="h-4 w-24" label="Loading" />
        <Skeleton className="h-4 w-28" label="Loading" />
      </div>
    </li>
  );
}
