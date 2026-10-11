import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InterpretCommandRequest } from "../contracts";
import { V14, apiGetParsed, apiPostParsed } from "./client";
import {
  ApplyEditResultSchema,
  GenomeEditProposalSchema,
  InterpretCommandResponseSchema,
  LociListSchema,
  LocusWindowSchema,
  VoiceStatusSchema,
  v14qk,
} from "./schemas";

export { v14qk } from "./schemas";

export function useInterpretCommand() {
  return useMutation({
    mutationFn: (body: InterpretCommandRequest) =>
      apiPostParsed(V14.interpret, body, InterpretCommandResponseSchema),
  });
}

export function useGenomeEditProposal(proposalId: string | null, workspaceId?: string | null) {
  return useQuery({
    queryKey: v14qk.proposal(proposalId ?? "none", workspaceId),
    enabled: !!proposalId,
    queryFn: ({ signal }) => apiGetParsed(V14.proposal(proposalId ?? ""), GenomeEditProposalSchema, signal),
  });
}

export function useCreateGenomeEditProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      workspace_id: string;
      parent_revision_id?: string | null;
      locus_id?: string | null;
      reference_asset_id?: string | null;
      position: number;
      alt: string;
      source: "text" | "voice" | "manual";
      note?: string | null;
      anatomy_id?: string | null;
    }) => apiPostParsed(V14.proposals, body, GenomeEditProposalSchema),
    onSuccess: (proposal) => {
      void qc.invalidateQueries({ queryKey: v14qk.proposal(proposal.proposal_id, proposal.workspace_id) });
    },
  });
}

export function useValidateGenomeEditProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { proposalId: string; workspaceId?: string | null }) =>
      apiPostParsed(V14.validate(input.proposalId), {}, GenomeEditProposalSchema),
    onSuccess: (proposal) => {
      void qc.invalidateQueries({ queryKey: v14qk.proposal(proposal.proposal_id, proposal.workspace_id) });
    },
  });
}

export function useApplyGenomeEditProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { proposalId: string; expected_counter: number; idempotencyKey?: string; workspaceId?: string | null }) =>
      apiPostParsed(V14.apply(input.proposalId), { expected_counter: input.expected_counter }, ApplyEditResultSchema, {
        headers: input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : undefined,
      }),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ["workspace", result.workspace.workspace_id] });
      void qc.invalidateQueries({ queryKey: v14qk.proposal(result.receipt.proposal_id, result.workspace.workspace_id) });
    },
  });
}

export function useVoiceStatus() {
  return useQuery({
    queryKey: v14qk.voiceStatus,
    queryFn: ({ signal }) => apiGetParsed(V14.voiceStatus, VoiceStatusSchema, signal),
    staleTime: 60_000,
  });
}

export function useLoci(anatomyId?: string | null, geneId?: string | null) {
  return useQuery({
    queryKey: v14qk.loci(anatomyId, geneId),
    queryFn: ({ signal }) => apiGetParsed(V14.loci, LociListSchema, signal),
    staleTime: 60_000,
  });
}

export function useLocusWindow(locusId: string | null, start: number, end: number, workspaceId?: string | null) {
  return useQuery({
    queryKey: v14qk.locusWindow(locusId ?? "", start, end, workspaceId),
    enabled: !!locusId,
    queryFn: ({ signal }) => apiGetParsed(V14.locusWindow(locusId ?? "", start, end), LocusWindowSchema, signal),
    staleTime: Infinity,
  });
}
