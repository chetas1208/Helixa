/**
 * URL <-> anatomy/gene/locus ids. Composes with V12 `?tab=&workspace=` — never writes sequence.
 * Mount `useAnatomyUrlSync` once beside `useUrlSync`; each helper preserves the other's params.
 */

export const ANATOMY_ID_PATTERN = /^(UBERON|CL|PATO):\d+(@(left|right))?$|^DIAMOND:[A-Za-z0-9_-]+$|^system:[a-z0-9-]+$/;
export const GENE_ID_PATTERN = /^ENSG\d{11}$/;
export const LOCUS_ID_PATTERN = /^grch38:[A-Za-z0-9-]+:[0-9A-Z]+:\d+-\d+$|^ref_synthetic_chr22$/;
const MAX_ID_LENGTH = 96;
const SEQUENCE_RUN = /[ACGTNacgtn]{16,}/;

export interface AnatomyUrlSelection {
  anatomy: string | null;
  gene: string | null;
  locus: string | null;
  issues: string[];
}

export function isAnatomyId(v: unknown): v is string {
  return typeof v === "string" && v.length <= MAX_ID_LENGTH && ANATOMY_ID_PATTERN.test(v) && !SEQUENCE_RUN.test(v);
}
export function isGeneId(v: unknown): v is string {
  return typeof v === "string" && GENE_ID_PATTERN.test(v);
}
export function isLocusId(v: unknown): v is string {
  return typeof v === "string" && v.length <= MAX_ID_LENGTH && LOCUS_ID_PATTERN.test(v) && !SEQUENCE_RUN.test(v);
}

export function parseAnatomyUrl(search: string): AnatomyUrlSelection {
  const issues: string[] = [];
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return { anatomy: null, gene: null, locus: null, issues: ["unparseable query string"] };
  }
  const rawA = params.get("anatomy");
  const rawG = params.get("gene");
  const rawL = params.get("locus");
  let anatomy: string | null = null;
  let gene: string | null = null;
  let locus: string | null = null;
  if (rawA !== null) {
    if (isAnatomyId(rawA)) anatomy = rawA;
    else issues.push("malformed anatomy id ignored");
  }
  if (rawG !== null) {
    if (isGeneId(rawG)) gene = rawG;
    else issues.push("malformed gene id ignored");
  }
  if (rawL !== null) {
    if (isLocusId(rawL)) locus = rawL;
    else issues.push("malformed locus id ignored");
  }
  return { anatomy, gene, locus, issues };
}

export function serialiseAnatomyUrl(
  sel: { anatomy: string | null; gene: string | null; locus: string | null },
  currentSearch = "",
): string {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(currentSearch);
  } catch {
    params = new URLSearchParams();
  }
  if (sel.anatomy && isAnatomyId(sel.anatomy)) params.set("anatomy", sel.anatomy);
  else params.delete("anatomy");
  if (sel.gene && isGeneId(sel.gene)) params.set("gene", sel.gene);
  else params.delete("gene");
  if (sel.locus && isLocusId(sel.locus)) params.set("locus", sel.locus);
  else params.delete("locus");
  const s = params.toString();
  return s ? `?${s}` : "";
}
