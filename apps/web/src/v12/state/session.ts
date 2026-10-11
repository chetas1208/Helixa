import { create } from "zustand";
import { TAB_ORDER } from "../types";
import type { ConnectionState, EditDraft, TabId } from "../types";

interface SessionState {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;

  /** Single source of client selection. Server state stays authoritative. */
  activeWorkspaceId: string | null;
  /** Set only by the guarded switch flow (library/SwitchGuard) or by URL/bootstrap sync. */
  setActiveWorkspaceId: (id: string | null) => void;

  /** Unsaved drafts, keyed by workspace id. Never persisted. Never applied to another workspace. */
  drafts: Record<string, EditDraft | undefined>;
  setDraft: (workspaceId: string, draft: EditDraft | undefined) => void;

  /** Genome Editor selection (1-based position) + inspector. */
  selectedPosition: number | null;
  setSelectedPosition: (p: number | null) => void;

  /** Evolution tab selection (revision id). */
  selectedRevisionId: string | null;
  setSelectedRevisionId: (id: string | null) => void;

  connection: ConnectionState;
  setConnection: (c: ConnectionState) => void;

  reducedMotion: boolean;
  setReducedMotion: (v: boolean) => void;
}

export const useSession = create<SessionState>((set) => ({
  activeTab: TAB_ORDER[0],
  setActiveTab: (activeTab) => set({ activeTab }),

  activeWorkspaceId: null,
  setActiveWorkspaceId: (activeWorkspaceId) => set({ activeWorkspaceId, selectedPosition: null, selectedRevisionId: null }),

  drafts: {},
  setDraft: (workspaceId, draft) => set((s) => ({ drafts: { ...s.drafts, [workspaceId]: draft } })),

  selectedPosition: null,
  setSelectedPosition: (selectedPosition) => set({ selectedPosition }),

  selectedRevisionId: null,
  setSelectedRevisionId: (selectedRevisionId) => set({ selectedRevisionId }),

  connection: "unknown",
  setConnection: (connection) => set({ connection }),

  reducedMotion: false,
  setReducedMotion: (reducedMotion) => set({ reducedMotion }),
}));

/** True when the active workspace has unsaved draft operations. */
export function hasUnsavedDraft(s: Pick<SessionState, "activeWorkspaceId" | "drafts">): boolean {
  const id = s.activeWorkspaceId;
  return !!id && (s.drafts[id]?.ops.length ?? 0) > 0;
}
