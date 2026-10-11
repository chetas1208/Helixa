import { create } from "zustand";

/**
 * Exploration selection for the anatomy-first editor (contract §5). Owner: Agent 4.
 * Ids only. Selecting anatomy never changes the active workspace, revision or reference.
 */
export interface FocusRequest { anatomyId: string | null; nonce: number }

export type AnatomyQuality = "auto" | "low" | "medium" | "high";

export interface AnatomySelectionState {
  anatomyId: string | null;
  geneId: string | null;
  locusId: string | null;
  transcriptId: string | null;
  hoverId: string | null;
  drawerOpen: boolean;
  focusRequest: FocusRequest | null;
  quality: AnatomyQuality;
  selectAnatomy: (id: string | null, opts?: { focus?: boolean; openDrawer?: boolean }) => void;
  hover: (id: string | null) => void;
  selectGene: (id: string | null) => void;
  selectLocus: (id: string | null, transcriptId?: string | null) => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  backToBody: () => void;
  clear: () => void;
  setQuality: (quality: AnatomyQuality) => void;
}

let nonce = 0;

export const useAnatomySelection = create<AnatomySelectionState>((set) => ({
  anatomyId: null,
  geneId: null,
  locusId: null,
  transcriptId: null,
  hoverId: null,
  drawerOpen: false,
  focusRequest: null,
  quality: "auto",
  selectAnatomy: (id, opts) =>
    set((s) => ({
      anatomyId: id,
      geneId: id === s.anatomyId ? s.geneId : null,
      drawerOpen: opts?.openDrawer ?? (id !== null ? s.drawerOpen : false),
      focusRequest: opts?.focus === false ? s.focusRequest : { anatomyId: id, nonce: ++nonce },
    })),
  hover: (id) => set((s) => (s.hoverId === id ? s : { hoverId: id })),
  selectGene: (id) => set({ geneId: id }),
  selectLocus: (id, transcriptId = null) => set({ locusId: id, transcriptId }),
  openDrawer: () => set({ drawerOpen: true }),
  closeDrawer: () => set({ drawerOpen: false }),
  backToBody: () => set({ anatomyId: null, geneId: null, drawerOpen: false, focusRequest: { anatomyId: null, nonce: ++nonce } }),
  clear: () => set({ anatomyId: null, geneId: null, locusId: null, transcriptId: null, hoverId: null, drawerOpen: false, focusRequest: { anatomyId: null, nonce: ++nonce } }),
  setQuality: (quality) => set({ quality }),
}));
