/**
 * Bridge between the DOM-side Genome Editor and the R3F scene. The scene must never read React Query or
 * any React context (contexts do not cross into <Canvas>), so GenomeEditorTab pushes PLAIN DATA here and
 * EditorScene subscribes. Zustand only; no fetching, no side effects.
 */
import { create } from "zustand";
import type { EvidenceKind } from "../types";
import { NO_INSETS } from "./helixGeometry";
import type { Insets } from "./helixGeometry";

export type CompareMode = "off" | "overlay" | "split";

export interface EditorSceneData {
  /** "ready" once a real window has been loaded. Otherwise the scene draws only the body and a quiet placeholder. */
  status: "loading" | "ready" | "error";
  /** 1-based coordinate of the first base in the window. */
  start: number;
  /** Reference (baseline) window bases, saved-revision bases and draft-preview bases. Same length. */
  baselineBases: string;
  savedBases: string;
  draftBases: string;
  /** What the helix is compared against when compare is on (saved revision or baseline). */
  originalBases: string;
  selectedPosition: number | null;
  /** 1-based position the focus window is centred on (selection, or the scrubber). Null = window centre. */
  focusPosition: number | null;
  /** Proposed alt for the selected base, if any (drawn as a ghost cue). */
  proposedAlt: string | null;
  compareMode: CompareMode;
  /** Half-turns requested from the DOM "Turn figure" button (0 = front). Dragging the figure also turns it. */
  bodyTurns: number;
  /** Evidence status of the highlighted changes: HYPOTHESIS (draft) or VALIDATED (saved) shapes the cue. */
  evidenceKind: EvidenceKind;
  reducedMotion: boolean;
  /** Pixels covered by DOM panels (measured by the tab); the scene frames its subject in the free area. */
  insets: Insets;
  /** Pauses idle rotation (e.g. tab hidden, low-power). */
  paused: boolean;
}

export interface EditorSceneActions {
  onSelect: (position: number | null) => void;
}

const initial: EditorSceneData = {
  status: "loading",
  start: 1,
  baselineBases: "",
  savedBases: "",
  draftBases: "",
  originalBases: "",
  selectedPosition: null,
  focusPosition: null,
  proposedAlt: null,
  compareMode: "off",
  bodyTurns: 0,
  evidenceKind: "REFERENCE",
  reducedMotion: false,
  insets: NO_INSETS,
  paused: false,
};

type Store = EditorSceneData & EditorSceneActions & { set: (patch: Partial<EditorSceneData>) => void; setActions: (a: Partial<EditorSceneActions>) => void };

export const useEditorSceneStore = create<Store>((set, get) => ({
  ...initial,
  onSelect: () => undefined,
  set: (patch) => {
    // Skip no-op patches so the scene does not re-render needlessly.
    const cur = get() as unknown as Record<string, unknown>;
    for (const k of Object.keys(patch)) {
      if (cur[k] !== (patch as Record<string, unknown>)[k]) {
        set(patch);
        return;
      }
    }
  },
  setActions: (a) => set(a),
}));

export const resetEditorSceneStore = () => useEditorSceneStore.setState({ ...initial });
