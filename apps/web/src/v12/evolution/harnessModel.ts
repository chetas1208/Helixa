/** Pure model for the Agent harness track (legacy /api/harnesses + /lineage). Harness versions are NOT biology. */

export interface HarnessRecord {
  version_id: string;
  harness_id?: string;
  parent_version_id?: string | null;
  status: string;
  validation_policy?: Record<string, unknown>;
  context_policy?: Record<string, unknown>;
  execution_policy?: Record<string, unknown>;
  allowed_tools?: string[];
  mutation_rationale?: string | null;
  diff_summary?: string | null;
  metadata?: Record<string, unknown>;
  created_at?: string;
  [k: string]: unknown;
}

export interface LineageNode {
  id: string;
  version_id: string;
  status?: string;
  parent_id?: string | null;
  [k: string]: unknown;
}
export interface LineageEdge {
  source: string;
  target: string;
  label?: string;
}
export interface Lineage {
  root_version_id: string;
  nodes: LineageNode[];
  edges: LineageEdge[];
}

export interface PolicyChange {
  path: string;
  from: string;
  to: string;
}

const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

/** Field-level differences between a harness version and its parent (policies and tools). */
export function policyDiff(parent: HarnessRecord | undefined, child: HarnessRecord): PolicyChange[] {
  if (!parent) return [];
  const out: PolicyChange[] = [];
  for (const group of ["validation_policy", "context_policy", "execution_policy"] as const) {
    const a = (parent[group] ?? {}) as Record<string, unknown>;
    const b = (child[group] ?? {}) as Record<string, unknown>;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push({ path: `${group}.${k}`, from: show(a[k]), to: show(b[k]) });
    }
  }
  const ta = new Set(parent.allowed_tools ?? []);
  const tb = new Set(child.allowed_tools ?? []);
  for (const t of tb) if (!ta.has(t)) out.push({ path: "allowed_tools", from: "(absent)", to: `+ ${t}` });
  for (const t of ta) if (!tb.has(t)) out.push({ path: "allowed_tools", from: t, to: "(removed)" });
  return out;
}

export type StepTone = "baseline" | "accepted" | "rejected" | "pending";
const REJECTED = /REJECT|FAIL|ERROR|ABORT|DENIED/i;
const ACCEPTED = /PROMOT|ACCEPT|ACTIVE|PASS/i;

export function stepTone(status: string): StepTone {
  if (/BASELINE/i.test(status)) return "baseline";
  if (REJECTED.test(status)) return "rejected";
  if (ACCEPTED.test(status)) return "accepted";
  return "pending";
}

export function sortHarnesses(list: readonly HarnessRecord[]): HarnessRecord[] {
  return [...list].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.version_id.localeCompare(b.version_id));
}

/** Receipt id recorded on the harness step, if any. Only a recorded id can be briefed by /api/voice/briefing. */
export function recordedReceiptId(h: HarnessRecord): string | null {
  const m = h.metadata ?? {};
  for (const k of ["receipt_id", "evidence_receipt_id", "latest_receipt_id"]) {
    const v = (m as Record<string, unknown>)[k] ?? h[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

/** Cross-track link: true only when ids are exactly equal. Never inferred. */
export function linkedHarnessId(revisionHarnessId: string, harnesses: readonly HarnessRecord[]): string | null {
  return harnesses.some((h) => h.version_id === revisionHarnessId) ? revisionHarnessId : null;
}
