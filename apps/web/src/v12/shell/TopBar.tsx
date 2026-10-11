import { PencilLine, Wifi, WifiOff, AlertTriangle, CircleDashed } from "lucide-react";
import { useReference, useWorkspaces } from "../api/hooks";
import { Skeleton } from "../design/Skeleton";
import { hasUnsavedDraft, useSession } from "../state/session";
import { BrandMark } from "./BrandMark";
import { QualityMenu } from "./QualityMenu";
import { RenderChip } from "./RenderNotice";
import { TabNav } from "./TabNav";
import type { ConnectionInfo } from "./connection";
import type { ConnectionState } from "../types";

const CONN_ICON = { online: Wifi, degraded: AlertTriangle, offline: WifiOff, unknown: CircleDashed } as const;
const CONN_TONE: Record<ConnectionState, string> = {
  online: "text-ev-validated",
  degraded: "text-ev-hypothesis",
  offline: "text-danger",
  unknown: "text-fg-3",
};

export function ConnectionPill({ info, compact }: { info: ConnectionInfo; compact?: boolean }) {
  const Icon = CONN_ICON[info.state];
  return (
    <span
      role="status"
      data-testid="connection-status"
      data-state={info.state}
      aria-label={info.label}
      title={info.detail}
      className={`inline-flex h-9 items-center gap-1.5 rounded-control px-2 text-xs font-medium ${CONN_TONE[info.state]}`}
    >
      <Icon aria-hidden className={`h-4 w-4 ${info.state === "unknown" ? "animate-spin [animation-duration:3s]" : ""}`} />
      {!compact && <span className="text-fg-2 max-[1180px]:sr-only">{info.label}</span>}
    </span>
  );
}

function DraftIndicator({ compact }: { compact?: boolean }) {
  const unsaved = useSession(hasUnsavedDraft);
  const count = useSession((s) => (s.activeWorkspaceId ? (s.drafts[s.activeWorkspaceId]?.ops.length ?? 0) : 0));
  const setActiveTab = useSession((s) => s.setActiveTab);
  if (!unsaved) return null;
  const label = `Unsaved draft: ${count} ${count === 1 ? "edit" : "edits"}`;
  return (
    <button
      type="button"
      data-testid="draft-indicator"
      onClick={() => setActiveTab("editor")}
      aria-label={`${label}. Open the Genome Editor`}
      title={`${label} (in-silico, not saved). Click to open the Genome Editor.`}
      className="inline-flex h-9 items-center gap-1.5 rounded-control border border-ev-hypothesis/40 bg-ev-hypothesis/10 px-2.5 text-xs font-medium text-ev-hypothesis transition-colors duration-fast hover:bg-ev-hypothesis/15"
    >
      <PencilLine aria-hidden className="h-3.5 w-3.5" />
      {compact ? <span>{count}</span> : (
        <>
          <span className="max-[1340px]:hidden">Unsaved draft</span>
          <span className="coord">{count}</span>
        </>
      )}
    </button>
  );
}

function WorkspaceContext({ compact }: { compact?: boolean }) {
  const ws = useWorkspaces();
  const ref = useReference();
  const activeId = useSession((s) => s.activeWorkspaceId);
  const setActiveTab = useSession((s) => s.setActiveTab);

  const id = activeId ?? ws.data?.active?.workspace_id ?? null;
  const active = id ? (ws.data?.workspaces.find((w) => w.workspace_id === id) ?? (ws.data?.active?.workspace_id === id ? ws.data.active : null)) : null;

  const refId = ref.data?.reference_asset_id ?? active?.reference_asset_id ?? null;
  const synthetic = ref.data ? !ref.data.official_grch38 : active ? !active.official_grch38 : false;

  const loading = (ws.isPending && !ws.isError) || (!active && ws.isFetching);
  const refTitle = ref.data
    ? `${ref.data.assembly} / ${ref.data.contig}, ${ref.data.length.toLocaleString("en-US")} bp. ${synthetic ? "Local synthetic reference: not the official GRCh38." : "Official reference."} sha256 ${ref.data.checksum_sha256}`
    : undefined;

  return (
    <button
      type="button"
      data-testid="workspace-context"
      onClick={() => setActiveTab("library")}
      title={`Active workspace${active ? `: ${active.name}` : ""}. Open the Harness Library to switch.`}
      aria-label={`Active workspace: ${active?.name ?? (loading ? "loading" : "none")}. Reference ${refId ?? "unknown"}. Open the Harness Library to switch.`}
      className="group flex min-w-0 max-w-[17rem] flex-col items-start rounded-control px-2.5 py-1 text-left transition-colors duration-fast hover:bg-ink-700/50 max-[1180px]:max-w-[11rem] max-md:max-w-none max-md:flex-1 max-md:px-1.5"
    >
      {loading ? (
        <>
          <Skeleton className="h-3.5 w-28" label="Loading workspace" />
          <Skeleton className="mt-1.5 h-3 w-36" label="Loading reference" />
        </>
      ) : (
        <>
          <span className="w-full truncate text-sm font-semibold leading-5 text-fg">{active?.name ?? "No workspace loaded"}</span>
          <span className="coord flex w-full items-center gap-1.5 truncate text-xs leading-4 text-fg-3" title={refTitle}>
            {refId ? (
              <>
                <span className="truncate">{refId}</span>
                {synthetic && !compact && <span className="shrink-0 rounded border border-ev-hypothesis/35 px-1 text-2xs leading-4 text-ev-hypothesis max-[1340px]:hidden">synthetic</span>}
              </>
            ) : (
              <span>reference not loaded</span>
            )}
          </span>
        </>
      )}
    </button>
  );
}

/** Desktop / tablet bar: brand, workspace context, the four tabs, draft + connection + display. */
export function TopBar({ info }: { info: ConnectionInfo }) {
  return (
    <div className="flex h-[var(--bar-h)] items-center gap-3 border-b border-line/10 bg-gradient-to-b from-ink-950/95 to-ink-950/75 px-4 backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex shrink-0 items-center gap-2.5" aria-label="HELIXA">
          <BrandMark />
          <span className="text-[0.95rem] font-semibold uppercase leading-none tracking-[0.18em] text-fg">HELIXA</span>
        </div>
        <span aria-hidden className="h-6 w-px shrink-0 bg-line/15" />
        <WorkspaceContext />
      </div>

      <div className="flex min-w-0 flex-1 justify-center">
        <TabNav />
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <DraftIndicator />
        <RenderChip />
        <ConnectionPill info={info} />
        <QualityMenu />
      </div>
    </div>
  );
}

/** Phone top bar (<= 768px): the tabs live in the bottom bar. */
export function CompactTopBar({ info }: { info: ConnectionInfo }) {
  return (
    <div className="flex h-[var(--bar-h)] items-center gap-1.5 border-b border-line/10 bg-ink-950/90 px-2.5 backdrop-blur-md">
      <BrandMark size={24} />
      <span className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-fg">HELIXA</span>
      <WorkspaceContext compact />
      <DraftIndicator compact />
      <RenderChip />
      <ConnectionPill info={info} compact />
      <QualityMenu />
    </div>
  );
}
