import { create } from "zustand";

export interface Finding {
  check_id: string;
  status: "PASS" | "FAIL" | "WARNING" | "INCONCLUSIVE" | "ERROR";
  severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  message: string;
  locus?: {
    chrom: string;
    pos: number;
    ref: string;
    alt: string[];
  };
  metadata?: Record<string, any>;
}

export interface RunEvent {
  event_id: string;
  run_id: string;
  seq: number;
  timestamp: string;
  event_type: string;
  entity_id?: string;
  evidence_digest?: string;
  payload: Record<string, any>;
}

export interface LineageNode {
  id: string;
  version_id: string;
  status: string;
  parent_id?: string | null;
  require_reference_allele_check: boolean;
  include_reference_metadata: boolean;
  optimizer_provenance?: string;
  gate_reason?: string;
}

export interface LineageEdge {
  source: string;
  target: string;
  label?: string;
}

export interface EvidenceReceipt {
  receipt_id: string;
  receipt_digest: string;
  run_id: string;
  parent_version_id: string;
  candidate_version_id: string;
  score: string;
  parent_score: string;
  false_positive_rate: number;
  promoted: boolean;
  decision_reason: string;
  created_at: string;
  optimizer_provenance?: string;
  adjudication?: string;
  holdout_case_ids?: string[];
  reference_artifact_sha256?: string;
  raindrop_status?: string;
  elevenlabs_status?: string;
  false_positive_count?: number;
  negative_control_count?: number;
}

export type QualityPref = "auto" | "low" | "medium" | "high";

export interface Toast {
  id: string;
  kind: "info" | "success" | "warn" | "error";
  title: string;
  detail?: string;
  ttlMs?: number;
}

interface GenomeStore {
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;

  selectedFindingIdx: number | null;
  setSelectedFindingIdx: (idx: number | null) => void;
  hoveredFindingIdx: number | null;
  setHoveredFindingIdx: (idx: number | null) => void;

  qualityPref: QualityPref;
  setQualityPref: (q: QualityPref) => void;

  booted: boolean;
  setBooted: (b: boolean) => void;

  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;

  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;

  activeMode: "MISSION" | "EVOLUTION" | "PROOF" | "STUDIO";
  setActiveMode: (mode: "MISSION" | "EVOLUTION" | "PROOF" | "STUDIO") => void;

  selectedVcf: string;
  setSelectedVcf: (vcf: string) => void;

  activeRunId: string | null;
  setActiveRunId: (id: string | null) => void;

  runStatus: string;
  setRunStatus: (status: string) => void;

  events: RunEvent[];
  addEvent: (event: RunEvent) => void;
  setEvents: (events: RunEvent[]) => void;

  findings: Finding[];
  setFindings: (findings: Finding[]) => void;

  lineageNodes: LineageNode[];
  lineageEdges: LineageEdge[];
  setLineage: (nodes: LineageNode[], edges: LineageEdge[]) => void;

  receipt: EvidenceReceipt | null;
  setReceipt: (receipt: EvidenceReceipt | null) => void;

  policyDiff: string | null;
  setPolicyDiff: (diff: string | null) => void;

  integrationHealth: Record<string, { status: string; detail?: string }> | null;
  setIntegrationHealth: (health: Record<string, { status: string; detail?: string }> | null) => void;

  isEvolving: boolean;
  setIsEvolving: (evolving: boolean) => void;

  devClockSeconds: number | null;
  setDevClockSeconds: (secs: number | null) => void;
}

export const useGenomeStore = create<GenomeStore>((set) => ({
  selectedNodeId: null,
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),

  selectedFindingIdx: null,
  setSelectedFindingIdx: (idx) => set({ selectedFindingIdx: idx }),
  hoveredFindingIdx: null,
  setHoveredFindingIdx: (idx) => set({ hoveredFindingIdx: idx }),

  qualityPref: "auto",
  setQualityPref: (q) => set({ qualityPref: q }),

  booted: false,
  setBooted: (b) => set({ booted: b }),

  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),

  toasts: [],
  pushToast: (t) =>
    set((state) => ({
      toasts: [...state.toasts, { ...t, id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }].slice(-5),
    })),
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  activeMode: "MISSION",
  setActiveMode: (mode) => set({ activeMode: mode }),

  selectedVcf: "ref_mismatch.vcf",
  setSelectedVcf: (vcf) => set({ selectedVcf: vcf }),

  activeRunId: null,
  setActiveRunId: (id) => set({ activeRunId: id }),

  runStatus: "IDLE",
  setRunStatus: (status) => set({ runStatus: status }),

  events: [],
  addEvent: (event) => set((state) => {
    // Deduplicate by event_id or seq
    if (state.events.some((e) => e.seq === event.seq)) return state;
    return { events: [...state.events, event].sort((a, b) => a.seq - b.seq) };
  }),
  setEvents: (events) => set({ events }),

  findings: [],
  setFindings: (findings) => set({ findings }),

  lineageNodes: [
    {
      id: "harness-v1",
      version_id: "harness-v1",
      status: "BASELINE",
      parent_id: null,
      require_reference_allele_check: false,
      include_reference_metadata: false,
    },
  ],
  lineageEdges: [],
  setLineage: (nodes, edges) => set({ lineageNodes: nodes, lineageEdges: edges }),

  receipt: null,
  setReceipt: (receipt) => set({ receipt }),

  policyDiff: null,
  setPolicyDiff: (diff) => set({ policyDiff: diff }),

  integrationHealth: null,
  setIntegrationHealth: (health) => set({ integrationHealth: health }),

  isEvolving: false,
  setIsEvolving: (evolving) => set({ isEvolving: evolving }),

  devClockSeconds: null,
  setDevClockSeconds: (secs) => set({ devClockSeconds: secs }),
}));
