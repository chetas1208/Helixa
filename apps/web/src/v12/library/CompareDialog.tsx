import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { EvidenceBadge } from "../design/EvidenceBadge";
import type { Workspace } from "../types";
import { differingPositions } from "./fingerprint";
import { Fingerprint } from "./Fingerprint";
import { compareWorkspaces } from "./libraryModel";
import type { CompareStatus } from "./libraryModel";
import { KindBadge } from "./WorkspaceCard";
import { workspaceKind } from "./libraryModel";
import { btnQuiet, fieldCls } from "./ui";

const STATUS_TEXT: Record<CompareStatus, string> = {
  same: "Same change",
  differs: "Different change",
  "only-a": "Only in first",
  "only-b": "Only in second",
};

function Side({ ws, all, other, lit, tag }: { ws: Workspace; all: readonly Workspace[]; other: string; lit: ReadonlySet<number>; tag: string }) {
  const bases = Array.from(lit).sort((a, b) => a - b);
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-[#050a14]/70 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-slate-300">{tag}</p>
          <p className="truncate text-base font-semibold text-slate-50" title={ws.name}>{ws.name}</p>
        </div>
        <KindBadge kind={workspaceKind(ws, all)} />
      </div>
      <div className="mt-2">
        <Fingerprint
          size="large"
          letters
          preview={ws.active_revision.preview_1_48}
          lit={lit}
          label={`${ws.name}, bases 1 to 48. ${lit.size === 0 ? `Identical to ${other} in this window.` : `${lit.size} base${lit.size === 1 ? "" : "s"} differ from ${other}: positions ${bases.join(", ")}.`}`}
        />
      </div>
      <p className="mt-1 break-all font-mono text-xs text-slate-300">{ws.active_genome_revision_id}</p>
    </div>
  );
}

/** Read-only side-by-side revision diff. Differing bases are lit in both helices and listed as edits below. Mutates nothing. */
export function CompareDialog({ left, all, onClose }: { left: Workspace | null; all: readonly Workspace[]; onClose: () => void }) {
  const others = useMemo(() => all.filter((w) => w.workspace_id !== left?.workspace_id && w.status.toUpperCase() !== "ARCHIVED"), [all, left]);
  const [rightId, setRightId] = useState<string>("");
  const right = others.find((w) => w.workspace_id === rightId) ?? others[0] ?? null;
  const cmp = useMemo(() => (left && right ? compareWorkspaces(left, right) : null), [left, right]);
  const lit = useMemo(() => (left && right ? differingPositions(left.active_revision.preview_1_48, right.active_revision.preview_1_48) : new Set<number>()), [left, right]);

  return (
    <Dialog.Root open={!!left} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[71] max-h-[90vh] w-[min(95vw,60rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-white/15 bg-[#0b1220]/97 p-5 shadow-2xl">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold text-slate-50">Compare genome states</Dialog.Title>
              <Dialog.Description className="mt-1 max-w-xl text-sm leading-relaxed text-slate-300">
                Read-only. Lit bases are where the two current revisions differ in the loaded window (bases 1-48). Nothing is changed or selected.
              </Dialog.Description>
            </div>
            {left && others.length > 0 && (
              <div>
                <label htmlFor="cmp-right" className="text-xs text-slate-300">Compare with</label>
                <select id="cmp-right" value={right?.workspace_id ?? ""} onChange={(e) => setRightId(e.target.value)} className={`${fieldCls} mt-1 block min-w-[14rem]`}>
                  {others.map((w) => (
                    <option key={w.workspace_id} value={w.workspace_id}>{w.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {left && others.length === 0 && <p className="mt-4 rounded-xl border border-white/10 p-4 text-sm text-slate-200">Create or branch another workspace to compare.</p>}

          {left && right && cmp && (
            <div className="mt-4" aria-live="polite">
              <div className="grid gap-3 md:grid-cols-2">
                <Side ws={left} all={all} other={right.name} lit={lit} tag="First" />
                <Side ws={right} all={all} other={left.name} lit={lit} tag="Second" />
              </div>
              <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-200">
                <EvidenceBadge kind={cmp.sameSequence ? "REFERENCE" : "HYPOTHESIS"} label={cmp.sameSequence ? "Identical sequence hash" : lit.size === 1 ? "1 base differs in the window" : `${lit.size} bases differ in the window`} />
                {!cmp.sameReference && <span className="text-amber-200">Different reference assets: positions are not directly comparable.</span>}
              </p>
              {cmp.rows.length === 0 ? (
                <p className="mt-3 rounded-xl border border-white/10 p-3 text-sm text-slate-300">Neither workspace has in-silico edits: both are at the reference baseline.</p>
              ) : (
                <div className="mt-3 overflow-x-auto rounded-xl border border-white/10">
                  <table className="w-full min-w-[30rem] text-left text-sm">
                    <caption className="sr-only">Edit differences by 1-based position</caption>
                    <thead className="text-xs text-slate-300">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-medium">Position</th>
                        <th scope="col" className="px-3 py-2 font-medium">Reference</th>
                        <th scope="col" className="px-3 py-2 font-medium">{left.name}</th>
                        <th scope="col" className="px-3 py-2 font-medium">{right.name}</th>
                        <th scope="col" className="px-3 py-2 font-medium">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cmp.rows.map((r) => (
                        <tr key={r.position} className="border-t border-white/10">
                          <td className="px-3 py-1.5 font-mono">{r.position}</td>
                          <td className="px-3 py-1.5 font-mono">{r.ref}</td>
                          <td className="px-3 py-1.5 font-mono">{r.altA ?? "(reference)"}</td>
                          <td className="px-3 py-1.5 font-mono">{r.altB ?? "(reference)"}</td>
                          <td className="px-3 py-1.5">{STATUS_TEXT[r.status]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          <div className="mt-4 flex justify-end">
            <Dialog.Close asChild>
              <button type="button" className={btnQuiet}>Close</button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
