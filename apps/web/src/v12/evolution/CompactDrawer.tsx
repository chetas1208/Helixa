import { useState } from "react";
import type { ReactNode } from "react";
import type { EvidenceKind, Intelligence } from "../types";
import { EvidenceBadge } from "../design/EvidenceBadge";
import { Panel } from "../design/Panel";
import { eventLabel } from "./genomeModel";
import type { GenomeEvent } from "./genomeModel";
import { policyDiff, recordedReceiptId } from "./harnessModel";
import type { HarnessRecord, Lineage } from "./harnessModel";
import { ListenButton } from "./Listen";
import { btn, focusRing } from "../simulation/ui";

function Row({ title, badge, children }: { title: string; badge: EvidenceKind; children: ReactNode }) {
  return (
    <section className="space-y-0.5 border-t border-white/10 pt-1.5 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-slate-50">{title}</h3>
        <EvidenceBadge kind={badge} />
      </div>
      <p className="line-clamp-2 text-[13px] leading-snug text-slate-100">{children}</p>
    </section>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[12px] [overflow-wrap:anywhere]">{children}</span>;
}

function Copy({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`${btn} ml-2 min-h-[26px] px-2 py-0 text-xs`}
      onClick={() => {
        try {
          void navigator.clipboard.writeText(value).then(() => setDone(true));
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function Technical({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="border-t border-white/10 pt-2">
      <button type="button" aria-expanded={open} onClick={onToggle} className={`text-[13px] text-cyan-200 underline-offset-2 hover:underline ${focusRing} rounded`}>
        {open ? "Hide technical details" : "Show technical details"}
      </button>
      {open && <div className="mt-2 space-y-2 text-xs text-slate-200">{children}</div>}
    </div>
  );
}

const Json = ({ data }: { data: unknown }) => (
  <pre className="max-h-44 overflow-auto rounded-md bg-black/30 p-2 font-mono text-[11px] leading-relaxed text-slate-200">{JSON.stringify(data, null, 2)}</pre>
);

const SEMANTICS_MODES = [
  { id: "EDIT_HISTORY", label: "Edit History", desc: "Chronological sequence from baseline anchor to this revision." },
  { id: "GENOMIC_ORIENTATION", label: "Genomic Orientation", desc: "Relative to 5' transcription start site on the reference strand." },
  { id: "REGULATORY_PATHWAY", label: "Regulatory Pathway", desc: "Molecular direction of upstream promoter/enhancer influences." },
  { id: "MODEL_DEPENDENCY", label: "Model Dependency", desc: "Causal computation flow through the trait simulation." },
] as const;

function UpstreamDownstreamSelector() {
  const [selected, setSelected] = useState<string>("EDIT_HISTORY");
  const current = SEMANTICS_MODES.find((m) => m.id === selected) ?? SEMANTICS_MODES[0];
  return (
    <section className="space-y-1.5 border-t border-white/10 pt-1.5" aria-label="Upstream and downstream semantics">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-slate-50">Upstream / Downstream</h3>
        <EvidenceBadge kind="VALIDATED" label="Semantic frame" />
      </div>
      <div className="flex flex-wrap gap-1">
        {SEMANTICS_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setSelected(m.id)}
            className={`rounded px-1.5 py-0.5 text-[11px] font-medium transition ${
              selected === m.id
                ? "bg-cyan-500/20 text-cyan-200 border border-cyan-400/40"
                : "bg-white/5 text-slate-300 hover:bg-white/10"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="text-[12px] leading-snug text-slate-200">{current.desc}</p>
      <p className="text-[11px] leading-snug text-slate-400 italic">
        Note: Not an ancestor-descendant history of real humans. There is no unique historical evolutionary path from the reference genome to a user edit.
      </p>
    </section>
  );
}

interface GenomeProps {
  event: GenomeEvent;
  intelligence: Intelligence | undefined;
  linkedHarness: string | null;
}

export function GenomeDrawer({ event, intelligence, linkedHarness }: GenomeProps) {
  const [open, setOpen] = useState(false);
  const n = event.node;
  const intel = intelligence && intelligence.genome_revision_id === n.id ? intelligence : undefined;
  const changed = event.isBaseline
    ? "Unedited reference anchor."
    : event.deltaKnown
      ? event.delta.length
        ? event.delta.map((c) => `Base ${c.position}: ${c.from} to ${c.to}`).join("; ") + " (in-silico)"
        : event.isBranchPoint
          ? "Branch created: an exact copy of its parent revision; no base differs."
          : "No base differs from its parent."
      : `+${event.addedCount ?? 0} edit(s); base positions not provided by the API.`;
  const parent = n.branchedFromId !== undefined ? "unedited reference" : event.parentId ?? "none";
  return (
    <Panel as="aside" aria-label="Genome version details" className="flex h-full min-h-0 flex-col gap-1.5 overflow-y-auto px-3.5 py-3">
      <h2 className="text-sm font-semibold text-slate-50">{eventLabel(event)}{event.isCurrent ? " (current)" : ""}</h2>
      <Row title="What changed" badge={event.isBaseline ? "REFERENCE" : "VALIDATED"}>{changed}</Row>
      <Row title="Why" badge={intel ? "VALIDATED" : "INCONCLUSIVE"}>{intel ? intel.what_was_computed : "No rationale is stored for this version."}</Row>
      <Row title="Source" badge="VALIDATED">
        {n.workspaceName ? `${n.workspaceName} · ` : ""}{n.createdAt ? n.createdAt.slice(0, 16).replace("T", " ") : "time not provided"} · parent {parent} · {linkedHarness ? `harness ${linkedHarness}` : "no recorded harness link"}
      </Row>
      <UpstreamDownstreamSelector />
      <Row title="Limits" badge="INCONCLUSIVE">In-silico only; no trait or health effect was computed. Synthetic reference, not GRCh38.</Row>
      <Technical open={open} onToggle={() => setOpen((v) => !v)}>
        <div>genome_revision_id <Mono>{n.virtual ? "none (unedited reference)" : n.id}</Mono>{!n.virtual && <Copy value={n.id} />}</div>
        <div>parent_revision_id <Mono>{n.branchedFromId ?? n.parentId ?? "null"}</Mono></div>
        <div>sequence_sha256 {n.sha256 ? <><Mono>{n.sha256}</Mono><Copy value={n.sha256} /></> : <Mono>not applicable</Mono>}</div>
        <div>edit_count <Mono>{n.editCount}</Mono>{n.editsSource === "derived" ? " (positions derived from the current version's edit list)" : ""}</div>
        {intel && <div>trust: {intel.trust}</div>}
        <div className="text-slate-300">Listen: voice briefings need a recorded evidence receipt; genome versions have none.</div>
        <Json data={{ revision: n, delta: event.delta, from_baseline: event.fromBaseline, intelligence: intel ?? null }} />
      </Technical>
    </Panel>
  );
}

interface HarnessProps {
  record: HarnessRecord;
  all: HarnessRecord[];
  lineage: Lineage | undefined;
  lineageNote: string | null;
  linked: boolean;
}

export function HarnessDrawer({ record, all, lineage, lineageNote, linked }: HarnessProps) {
  const [open, setOpen] = useState(false);
  const parent = all.find((h) => h.version_id === record.parent_version_id);
  const changes = policyDiff(parent, record);
  const receipt = recordedReceiptId(record);
  const edges = lineage?.edges.filter((e) => e.source === record.version_id || e.target === record.version_id) ?? [];
  const what = parent
    ? changes.length
      ? `${changes.length} change${changes.length > 1 ? "s" : ""}: ${changes.slice(0, 2).map((c) => `${c.path.split(".").pop()} ${c.from}→${c.to}`).join("; ")}`
      : "No policy or tool difference from its parent."
    : "Root version; nothing earlier to compare with.";
  return (
    <Panel as="aside" aria-label="Harness step details" className="flex h-full min-h-0 flex-col gap-1.5 overflow-y-auto px-3.5 py-3">
      <h2 className="text-sm font-semibold text-slate-50"><span className="font-mono">{record.version_id}</span> <span className="font-normal text-slate-300">· {record.status}</span></h2>
      <Row title="What changed" badge="VALIDATED">{what}</Row>
      <Row title="Why" badge={record.mutation_rationale ? "HYPOTHESIS" : "INCONCLUSIVE"}>{record.mutation_rationale ?? record.diff_summary ?? "No rationale recorded."}</Row>
      <Row title="Source" badge="VALIDATED">
        {record.parent_version_id ? `from ${record.parent_version_id}` : "root"} · {record.created_at ? record.created_at.slice(0, 16).replace("T", " ") : "time not recorded"} · {linked ? "linked to this workspace" : "no recorded link to the genome lane"}
      </Row>
      <Row title="Limits" badge="INCONCLUSIVE">A promotion gates the agent&apos;s policy; it says nothing about any genome.</Row>
      <Technical open={open} onToggle={() => setOpen((v) => !v)}>
        <div>harness_id <Mono>{record.harness_id ?? "not recorded"}</Mono></div>
        <div>lineage: {lineageNote ?? (edges.length ? edges.map((e) => `${e.source} to ${e.target}${e.label ? ` (${e.label})` : ""}`).join("; ") : "no edges recorded")}</div>
        <div>evidence receipt: <Mono>{receipt ?? "none recorded"}</Mono></div>
        {receipt ? <ListenButton receiptId={receipt} /> : <div className="text-slate-300">Listen is hidden: the voice briefing needs a recorded receipt id.</div>}
        <Json data={{ harness: record, lineage_edges: edges }} />
      </Technical>
    </Panel>
  );
}
