import { useMemo } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { EvidenceBadge } from "../design/EvidenceBadge";
import { Skeleton } from "../design/Skeleton";
import { isApiError } from "../api/client";
import { useHarnessLineage, useHarnesses, useIntelligence, useReference, useWorkspace, useWorkspaceCapabilities } from "../api/hooks";
import { onlyIfActive } from "../state/raceGuard";
import type { Workspace } from "../types";
import {
  assemblyLabel,
  buildBranchPath,
  checkEdits,
  describeBaseline,
  formatTimestamp,
  isArchived,
  workspaceEvidence,
} from "./libraryModel";
import { exportWorkspaceProvenance } from "./exportProvenance";
import { SimulationRunRow, useWorkspaceRunIds } from "./SimulationRuns";
import { ActivePill, Field, SectionTitle, UnavailableAction, btnPrimary, btnQuiet } from "./ui";

interface Props {
  workspace: Workspace | null;
  all: readonly Workspace[];
  isActive: boolean;
  switching: boolean;
  onActivate: (id: string) => void;
  onBranch: (ws: Workspace) => void;
  onCompare: (ws: Workspace) => void;
  onRename: (ws: Workspace) => void;
  onArchive: (ws: Workspace) => void;
  onClose: () => void;
}

export function WorkspaceDrawer(props: Props) {
  const { workspace, onClose } = props;
  return (
    <Dialog.Root open={!!workspace} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby="ws-drawer-desc"
          className="fixed inset-y-0 right-0 z-[71] flex w-[min(100vw,34rem)] flex-col border-l border-white/15 bg-[#0b1220]/97 shadow-2xl"
        >
          {workspace && <DrawerBody key={workspace.workspace_id} {...props} workspace={workspace} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DrawerBody({ workspace: listed, all, isActive, switching, onActivate, onBranch, onCompare, onRename, onArchive }: Props & { workspace: Workspace }) {
  const qc = useQueryClient();
  const detail = useWorkspace(listed.workspace_id);
  // Prefer the freshest record, but only if it is truly this workspace (never another's data).
  const ws: Workspace = onlyIfActive(listed.workspace_id, detail.data) ?? listed;
  const evidence = workspaceEvidence(ws);
  const path = useMemo(() => buildBranchPath(ws, all), [ws, all]);
  const baseline = describeBaseline(path);
  const runs = useWorkspaceRunIds(ws.workspace_id);
  const simIds = runs.ids;
  const caps = useWorkspaceCapabilities();
  const archived = isArchived(ws);
  const intel = useIntelligence(ws.workspace_id);
  const harnesses = useHarnesses();
  const reference = useReference();
  const matchedHarness = harnesses.data?.harnesses.find((h) => (h.version_id ?? h.id) === ws.active_harness_version_id);
  const lineage = useHarnessLineage(matchedHarness ? ws.active_harness_version_id : null);

  const exportProvenance = () => exportWorkspaceProvenance(qc, ws, all, !!caps.data?.listSimulations);

  return (
    <>
      <header className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div className="min-w-0">
          <Dialog.Title className="truncate text-lg font-semibold text-slate-50">{ws.name}</Dialog.Title>
          <Dialog.Description id="ws-drawer-desc" className="mt-0.5 break-all font-mono text-xs text-slate-300">
            {ws.workspace_id}
          </Dialog.Description>
        </div>
        <div className="flex items-center gap-2">
          {isActive && <ActivePill />}
          {archived && <span className="rounded-full border border-white/25 px-2 py-0.5 text-xs text-slate-200">Archived</span>}
          <Dialog.Close asChild>
            <button type="button" className={btnQuiet} aria-label="Close details">Close</button>
          </Dialog.Close>
        </div>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
        <section aria-label="Actions">
          <div className="flex flex-wrap gap-2">
            {!isActive && !archived && (
              <button type="button" className={btnPrimary} onClick={() => onActivate(ws.workspace_id)} disabled={switching}>
                {switching ? "Activating..." : "Activate"}
              </button>
            )}
            <button type="button" className={btnQuiet} onClick={() => onBranch(ws)}>Branch</button>
            <button type="button" className={btnQuiet} onClick={() => onCompare(ws)}>Compare</button>
            <button type="button" className={btnQuiet} onClick={() => void exportProvenance()}>Export provenance (JSON)</button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {caps.data?.rename ? (
              <button type="button" className={btnQuiet} onClick={() => onRename(ws)}>Rename</button>
            ) : (
              <UnavailableAction label="Rename" reason="This API has no way to rename a workspace yet." endpoint="PATCH /api/v10/genome/workspaces/{id}" />
            )}
            <UnavailableAction label="Duplicate" reason="The API has no duplicate route. Use Branch to fork the current revision." endpoint="POST /api/v10/genome/workspaces/{id}/duplicate" />
            {caps.data?.archive && !isActive && !archived ? (
              <button type="button" className={btnQuiet} onClick={() => onArchive(ws)}>Archive</button>
            ) : caps.data?.archive ? (
              <UnavailableAction label="Archive" reason={archived ? "Already archived." : "The active workspace cannot be archived. Activate another workspace first."} />
            ) : (
              <UnavailableAction label="Archive" reason="This API cannot archive workspaces, so none is hidden or deleted." endpoint="POST /api/v10/genome/workspaces/{id}/archive" />
            )}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-300">
            Export contains ids, hashes and edits only: no transcripts, audio or prompts. Unavailable actions need backend routes that this API does not have. Archiving hides a workspace; nothing is deleted.
          </p>
        </section>

        <section aria-label="Evidence status">
          <SectionTitle>Evidence status</SectionTitle>
          <EvidenceBadge kind={evidence.kind} label={evidence.label} />
          <p className="mt-2 text-sm leading-relaxed text-slate-300">{evidence.detail}</p>
          {intel.data && intel.data.workspace_id === ws.workspace_id && (
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              <span className="text-slate-300">Backend trust note: </span>
              {intel.data.trust}
            </p>
          )}
        </section>

        <section aria-label="Edit summary">
          <SectionTitle>Edit summary</SectionTitle>
          {ws.active_revision.edits.length === 0 ? (
            <p className="text-sm text-slate-300">No in-silico edits. The sequence equals the reference.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full min-w-[22rem] text-left text-sm">
                <caption className="sr-only">In-silico edits, 1-based positions</caption>
                <thead className="text-xs text-slate-300">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Position</th>
                    <th scope="col" className="px-3 py-2 font-medium">Change</th>
                    <th scope="col" className="px-3 py-2 font-medium">Allele check at commit</th>
                  </tr>
                </thead>
                <tbody>
                  {checkEdits(ws.active_revision.edits).map(({ edit: e, expectedBefore, matched }, i) => (
                    <tr key={`${e.position}-${i}`} className="border-t border-white/10">
                      <td className="px-3 py-1.5 font-mono">{e.position}</td>
                      <td className="px-3 py-1.5 font-mono">{e.current_allele_at_commit} to {e.alt}</td>
                      <td className="px-3 py-1.5">{matched ? `Matched (${expectedBefore})` : `Mismatch (expected ${expectedBefore})`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-slate-300">In-silico sequence change. Not lab-verified.</p>
        </section>

        <section aria-label="Analysis harness">
          <SectionTitle>Analysis harness</SectionTitle>
          <p className="text-sm leading-relaxed text-slate-300">
            A harness version is the analysis agent's strategy, tools and context policy. It is not part of the genome and carries no biological meaning.
          </p>
          <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="Linked harness version" mono>{ws.active_harness_version_id}</Field>
            <Field label="Registry record">
              {harnesses.isPending ? "Checking registry..." : harnesses.isError ? "Registry unavailable" : matchedHarness ? `Found, status ${matchedHarness.status ?? "unknown"}` : "No recorded link"}
            </Field>
          </dl>
          {!matchedHarness && !harnesses.isPending && (
            <p className="mt-2 text-sm text-slate-300">
              {harnesses.isError
                ? `The harness registry could not be read (${isApiError(harnesses.error) ? harnesses.error.detail : "error"}).`
                : "This workspace's harness id is not in the harness registry, so no lineage is shown and none is invented."}
            </p>
          )}
          {matchedHarness && lineage.data && (
            <p className="mt-2 text-sm text-slate-300">
              {lineage.data.recorded ? `Lineage: ${lineage.data.lineage.nodes.length} version(s), ${lineage.data.lineage.edges.length} link(s).` : lineage.data.reason}
            </p>
          )}
        </section>

        <section aria-label="Simulation runs">
          <SectionTitle>Simulation runs</SectionTitle>
          {simIds.length > 0 && <p className="mb-2 text-xs text-slate-300">{runs.source === "server+browser" ? "Listed by the server for this workspace." : "Runs remembered in this browser (ids only)."}</p>}
          {simIds.length === 0 ? (
            <p className="text-sm text-slate-300">{runs.loading ? "Looking for runs..." : runs.source === "browser" ? "No runs remembered in this browser for this workspace. This API cannot list simulations by workspace, so only runs started here are shown." : "No simulation recorded for this workspace yet."}</p>
          ) : (
            <ul className="space-y-3">
              {simIds.map((id) => (
                <li key={id}>
                  <SimulationRunRow workspaceId={ws.workspace_id} simulationId={id} detailed />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Branch path and baseline">
          <SectionTitle>Branch path</SectionTitle>
          <p className="text-sm leading-relaxed text-slate-300">{baseline.text}</p>
          <ol className="mt-3 space-y-2">
            {path.steps.map((s, i) => (
              <li key={s.revisionId} className="rounded-lg border border-white/10 p-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-mono text-[13px] text-slate-100">{s.revisionId}</span>
                  {i === 0 && <span className="rounded-full border border-white/20 px-2 text-xs text-slate-200">Current</span>}
                  {s.parentRevisionId === null && <span className="rounded-full border border-sky-300/50 px-2 text-xs text-sky-200">Baseline (immutable)</span>}
                </div>
                <p className="mt-0.5 text-xs text-slate-300">
                  {s.editCount} edit{s.editCount === 1 ? "" : "s"}, {formatTimestamp(s.createdAt)}
                  {s.workspaceId && s.workspaceId !== ws.workspace_id ? `, in workspace ${s.workspaceName ?? s.workspaceId}` : ""}
                </p>
              </li>
            ))}
            {path.truncatedAt && (
              <li className="rounded-lg border border-dashed border-white/20 p-2.5 text-sm text-slate-300">
                Continues at <span className="font-mono">{path.truncatedAt}</span> (not returned by the API).
              </li>
            )}
          </ol>
        </section>

        <section aria-label="Source hashes">
          <SectionTitle>Source hashes</SectionTitle>
          <dl className="space-y-2">
            <Field label="Current sequence (sha256 of the loaded 1-48 window)" mono>{ws.active_revision.sequence_sha256}</Field>
            {baseline.sequenceSha256 && <Field label="Baseline sequence sha256" mono>{baseline.sequenceSha256}</Field>}
            {reference.data && reference.data.reference_asset_id === ws.reference_asset_id && (
              <Field label={`Reference ${reference.data.reference_asset_id} checksum_sha256`} mono>{reference.data.checksum_sha256}</Field>
            )}
            {reference.isPending && <Skeleton className="h-5 w-64" label="Loading reference checksum" />}
            <Field label="Assembly">{assemblyLabel(ws)}</Field>
            <Field label="Last saved">{formatTimestamp(ws.updated_at)} (revision counter {ws.revision_counter})</Field>
          </dl>
        </section>
      </div>
    </>
  );
}
