import { useMemo } from "react";
import { useGenomeStore } from "./useGenomeStore";
import type { Finding, LineageNode, RunEvent } from "./useGenomeStore";

export type Severity = Finding["severity"];
export type SeverityCounts = Record<Severity, number>;

export interface EventDigest {
  seq: number;
  eventId: string;
  eventType: string;
  digest: string;
}

export const SEVERITIES: readonly Severity[] = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];

const SEVERITY_WEIGHT: Record<Severity, number> = {
  INFO: 0,
  LOW: 0.1,
  MEDIUM: 0.25,
  HIGH: 0.5,
  CRITICAL: 0.8,
};

const STATUS_FACTOR: Record<Finding["status"], number> = {
  PASS: 0,
  FAIL: 1,
  ERROR: 1,
  WARNING: 0.5,
  INCONCLUSIVE: 0.35,
};

/** Findings that represent a threat (anything that did not pass). */
function isThreat(f: Finding): boolean {
  return f.status !== "PASS";
}

/** Count of non-passing findings per severity; unknown severities are ignored. */
export function severityCounts(findings: readonly Finding[] | null | undefined): SeverityCounts {
  const counts: SeverityCounts = { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  for (const f of findings ?? []) {
    if (isThreat(f) && f.severity in counts) counts[f.severity] += 1;
  }
  return counts;
}

/**
 * Aggregate risk in [0, 1]. Each non-passing finding contributes an independent
 * probability (severity weight x status factor); the result is 1 - prod(1 - p),
 * so it is monotonic, order independent, and saturates toward 1.
 */
export function riskScore(findings: readonly Finding[] | null | undefined): number {
  let safe = 1;
  for (const f of findings ?? []) {
    const p = (SEVERITY_WEIGHT[f.severity] ?? 0) * (STATUS_FACTOR[f.status] ?? 0);
    safe *= 1 - p;
  }
  const risk = 1 - safe;
  return Math.min(1, Math.max(0, risk));
}

/** Most recently added node (lineage arrays are append-ordered), or null when empty. */
export function latestNode(nodes: readonly LineageNode[] | null | undefined): LineageNode | null {
  if (!nodes || nodes.length === 0) return null;
  return nodes[nodes.length - 1];
}

export function promotedCount(nodes: readonly LineageNode[] | null | undefined): number {
  let n = 0;
  for (const node of nodes ?? []) if (node.status === "PROMOTED") n += 1;
  return n;
}

/** Events carrying an evidence digest, in sequence order. */
export function eventDigests(events: readonly RunEvent[] | null | undefined): EventDigest[] {
  const out: EventDigest[] = [];
  for (const e of events ?? []) {
    if (e.evidence_digest) {
      out.push({ seq: e.seq, eventId: e.event_id, eventType: e.event_type, digest: e.evidence_digest });
    }
  }
  return out.sort((a, b) => a.seq - b.seq);
}

export function useSeverityCounts(): SeverityCounts {
  const findings = useGenomeStore((s) => s.findings);
  return useMemo(() => severityCounts(findings), [findings]);
}

export function useRiskScore(): number {
  const findings = useGenomeStore((s) => s.findings);
  return useMemo(() => riskScore(findings), [findings]);
}

export function useLatestNode(): LineageNode | null {
  const nodes = useGenomeStore((s) => s.lineageNodes);
  return useMemo(() => latestNode(nodes), [nodes]);
}

export function usePromotedCount(): number {
  const nodes = useGenomeStore((s) => s.lineageNodes);
  return useMemo(() => promotedCount(nodes), [nodes]);
}

export function useEventDigests(): EventDigest[] {
  const events = useGenomeStore((s) => s.events);
  return useMemo(() => eventDigests(events), [events]);
}

export const selectors = {
  severityCounts,
  riskScore,
  latestNode,
  promotedCount,
  eventDigests,
};
