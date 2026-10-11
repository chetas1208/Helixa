import { z } from "zod";

export const ResearchStatusSchema = z.object({
  health: z.enum([
    "disabled",
    "not_configured",
    "configured_unverified",
    "connected",
    "rate_limited",
    "permission_denied",
    "wrong_scope",
    "unavailable",
  ]),
  verified: z.boolean(),
  embedding_model: z.string().nullable(),
  rerank_model: z.string().nullable(),
  vector_search: z.object({
    supported: z.boolean(),
    active: z.boolean(),
  }).passthrough(),
  disclaimer: z.string(),
}).passthrough();

export const ResearchSearchSchema = z.object({
  status: z.string(),
  health: z.string(),
  fallback_reason: z.string().nullable(),
  disclaimer: z.string(),
  untrusted: z.literal(true),
  citations: z.array(z.object({
    document_id: z.string(),
    source_url: z.string(),
    title: z.string(),
    excerpt: z.string(),
    evidence_type: z.string(),
    source_type: z.string(),
    provenance: z.string(),
    gene_ids: z.array(z.string()),
    untrusted: z.literal(true),
  })),
  index: z.object({
    mode: z.string().nullable(),
    vector_search_supported: z.boolean(),
    vector_search_active: z.boolean(),
  }),
}).passthrough();

export type ResearchStatus = z.infer<typeof ResearchStatusSchema>;
export type ResearchSearch = z.infer<typeof ResearchSearchSchema>;
