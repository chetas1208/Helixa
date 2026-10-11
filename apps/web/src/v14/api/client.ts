/**
 * V14 fetch + zod helpers. Reuses the V12 transport so 409 / contract-mismatch behaviour stays one policy.
 */
export {
  ApiError,
  CONTRACT_MISMATCH_DETAIL,
  DEFAULT_TIMEOUT_MS,
  apiGet,
  apiGetParsed,
  apiPatchParsed,
  apiPost,
  apiPostParsed,
  isAbortError,
  isApiError,
  shouldRetryRequest,
  summariseIssues,
  withTimeout,
} from "../../v12/api/client";

export const V14 = {
  interpret: "/api/genome-edit/interpret-command",
  proposals: "/api/genome-edit/proposals",
  proposal: (id: string) => `/api/genome-edit/proposals/${encodeURIComponent(id)}`,
  validate: (id: string) => `/api/genome-edit/proposals/${encodeURIComponent(id)}/validate`,
  apply: (id: string) => `/api/genome-edit/proposals/${encodeURIComponent(id)}/apply`,
  loci: "/api/genome-edit/loci",
  locusWindow: (id: string, start: number, end: number) =>
    `/api/genome-edit/loci/${encodeURIComponent(id)}/window?start=${start}&end=${end}`,
  anatomyTree: "/api/anatomy/tree",
  anatomySearch: "/api/anatomy/search",
  anatomy: (id: string) => `/api/anatomy/${encodeURIComponent(id)}`,
  anatomyGenes: (id: string) => `/api/anatomy/${encodeURIComponent(id)}/genes`,
  gene: (id: string) => `/api/genes/${encodeURIComponent(id)}`,
  geneTissues: (id: string) => `/api/genes/${encodeURIComponent(id)}/tissues`,
  geneAnnotations: (id: string) => `/api/genes/${encodeURIComponent(id)}/annotations?assembly=GRCh38`,
  geneVariants: (id: string) => `/api/genes/${encodeURIComponent(id)}/variants?assembly=GRCh38`,
  voiceStatus: "/api/voice/status",
  voiceTranscribe: "/api/voice/transcribe",
} as const;
