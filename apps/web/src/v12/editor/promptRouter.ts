/**
 * V14 intent router. Deterministic; labelled "Parsed locally" in the UI.
 * Vague trait wishes never become proposals. Precise substitutions still go through parsePrompt.
 */
import type { InterpretCommandRequest, InterpretCommandResponse } from "../../v14/contracts";
import { PARSER_LABEL, MAX_PROMPT_CHARS, normalizePrompt, parsePrompt } from "./promptParser";
import type { ParseContext } from "./promptParser";
import { isNucleotide } from "./editorModel";
import { buildResearchProposal } from "./researchProposal";
import { resolveAnatomyMention } from "../../features/genome-editor/localAnatomy";

export const ROUTER_PARSER = "deterministic-v14" as const;
export const SYNTHETIC_REFERENCE_ASSET_ID = "ref_synthetic_chr22";
export const GRCH38_REFERENCE_ASSET_ID = "grch38_slices_ensembl116";

export interface RouterContext extends ParseContext {
  locusId?: string | null;
  anatomyId?: string | null;
  geneId?: string | null;
  assembly?: string | null;
  referenceAssetId?: string | null;
}

const emptyExplore = { action: "focus_anatomy" as const, anatomy_ids: [] as string[], gene_ids: [] as string[], locus_id: null as string | null };

function base(over: Partial<InterpretCommandResponse> & Pick<InterpretCommandResponse, "intent" | "reason">): InterpretCommandResponse {
  return {
    explore: null,
    edit: null,
    trait_goal: null,
    parser: ROUTER_PARSER,
    source: "text",
    ...over,
  };
}

const TRAIT_RULES: { re: RegExp; topic: string; anatomy: string[] }[] = [
  { re: /\b(?:ultraviolet|uv\s+radiation|uv\s+resist\w*)\b/, topic: "ultraviolet resistance", anatomy: ["UBERON:0002097"] },
  { re: /\bstronger\s+legs?\b/, topic: "stronger legs", anatomy: ["UBERON:0002103"] },
  { re: /\bbigger\s+hands?\b/, topic: "bigger hands", anatomy: ["UBERON:0002398"] },
  { re: /\bsmarter\s+brains?\b/, topic: "smarter brain", anatomy: ["UBERON:0000955"] },
  { re: /\b(?:change\s+)?(?:my\s+)?eye\s+colou?rs?\b/, topic: "eye colour", anatomy: ["UBERON:0000970"] },
  { re: /\bsurvive\s+extreme\s+cold\b/, topic: "survive extreme cold", anatomy: [] },
  { re: /\bextreme\s+cold\b/, topic: "survive extreme cold", anatomy: [] },
  { re: /\btaller\b/, topic: "height", anatomy: [] },
  { re: /\bsmarter\b/, topic: "intelligence", anatomy: ["UBERON:0000955"] },
  { re: /\bmore\s+intelligent\b/, topic: "intelligence", anatomy: ["UBERON:0000955"] },
  { re: /\bbigger\s+(?:arms|muscles|chest|biceps)\b/, topic: "muscle size", anatomy: ["UBERON:0001630"] },
  { re: /\bstronger\s+(?:arms|body|muscles)\b/, topic: "strength", anatomy: ["UBERON:0001630"] },
  { re: /\bmake\s+me\b/, topic: "trait wish", anatomy: [] },
  { re: /\bi\s+want\s+to\s+be\b/, topic: "trait wish", anatomy: [] },
  { re: /\bcure\s+\w+/, topic: "disease treatment", anatomy: [] },
];

const WHY_NOT_AUTOMATIC =
  "A trait wish is not a single-base substitution. This editor will not invent a locus or an allele for it. You can explore related anatomy and genes with evidence in those tissues. Anatomy never changes from an edit.";

const PHENOTYPE_WISH = /\b(?:make|help|increase|decrease|improve)\b/;
const PHENOTYPE_SUBJECT = /\b(?:organism|resistant|resistance|tolerate|tolerance|pigment\w*|ultraviolet|radiation)\b/;
const SEQUENCE_TALK = /\b(?:base|position|nucleotide|allele|locus|grch38)\b/;

function unmatchedPhenotypeWish(norm: string): boolean {
  if (!norm || EXPLORE_LEAD.test(norm) || SEQUENCE_TALK.test(norm)) return false;
  return PHENOTYPE_WISH.test(norm) && PHENOTYPE_SUBJECT.test(norm);
}

const EXPLORE_LEAD = /^(show|display|focus|find|look(?:ing)?\s+at|open|go\s+to|explore|inspect|see|list|what(?:'s| is)|where(?:'s| is)|genes?)\b/;
const GENES_IN = /\bgenes?\s+(?:in|of|for|expressed\s+in|from)\s+(?:the\s+)?(.+)$/;
const SHOW_TARGET = /^(?:show|display|focus|find|look(?:ing)?\s+at|open|go\s+to|explore|inspect|see)\s+(?:me\s+)?(?:the\s+)?(.+)$/;

/** True when the text is a vague phenotype/trait wish and must never become a proposal. */
export function isTraitGoalText(text: string): boolean {
  const n = normalizePrompt(text);
  if (!n) return false;
  if (explicitSubstitution(text, n)) return false;
  return TRAIT_RULES.some((r) => r.re.test(n)) || unmatchedPhenotypeWish(n);
}

function explicitSubstitution(raw: string, norm: string): boolean {
  return /[acgt]\s*>\s*[acgt]/i.test(raw)
    || /(?:chr)?(\d{1,2}|x|y|mt)\s*:\s*\d+\s+[acgt]\s*(?:>|to|->)\s*[acgt]/.test(norm)
    || /\b(?:base|position|nucleotide|nt|bp)\s+\d+\s+(?:to|into|=|->)\s+[acgt]/.test(norm)
    || /\b\d+\s*[acgt]\s*>\s*[acgt]\b/.test(norm);
}

function traitResponse(text: string): InterpretCommandResponse {
  const n = normalizePrompt(text);
  const hit = TRAIT_RULES.find((r) => r.re.test(n));
  const topic = hit?.topic ?? "trait wish";
  return base({
    intent: "TRAIT_GOAL",
    reason: `Parsed locally: "${topic}" is a trait goal, not an edit.`,
    trait_goal: {
      topic,
      why_not_automatic: WHY_NOT_AUTOMATIC,
      related_anatomy_ids: hit?.anatomy ?? [],
      explore_actions: ["open_anatomy", "show_genes"],
      complexity_notes: [
        "Most human traits are polygenic and environment-sensitive.",
        "Expression in a tissue is not evidence that editing that gene would change the organ.",
        "A candidate edit stays pending until published evidence and a valid reference identify one.",
      ],
      research: buildResearchProposal(topic),
    },
  });
}

function parseGrch38Edit(raw: string, ctx: RouterContext): InterpretCommandResponse | null {
  const src = (raw ?? "").normalize("NFKC");
  const m =
    src.match(/\b(?:change\s+)?(?:GRCh38\s+)?(?:chr)?(\d{1,2}|[XxYy]|[Mm][Tt])\s*:\s*(\d+)\s+([ACGTacgt])\s*(?:>|to|->)\s*([ACGTacgt])\b/i)
    || src.match(/\b(?:GRCh38\s+)?(?:chr)?(\d{1,2}|[XxYy]|[Mm][Tt])[:\-](\d+)[:\-]([ACGTacgt])[:\-]([ACGTacgt])\b/i);
  if (!m) return null;
  const contig = m[1]!;
  const position = Number(m[2]);
  const stated = m[3]!.toUpperCase();
  const alt = m[4]!.toUpperCase();
  if (!isNucleotide(alt) || !isNucleotide(stated)) return null;
  return base({
    intent: "PRECISE_EDIT",
    reason: `Parsed locally: set GRCh38 ${contig}:${position} ${stated}>${alt}.`,
    edit: {
      locus_id: ctx.locusId ?? null,
      reference_asset_id: ctx.referenceAssetId ?? GRCH38_REFERENCE_ASSET_ID,
      assembly: "GRCh38",
      contig,
      position,
      stated_ref: stated,
      alt,
    },
  });
}

function exploreResponse(text: string, ctx: RouterContext): InterpretCommandResponse | null {
  const n = normalizePrompt(text);
  if (!n || !EXPLORE_LEAD.test(n)) return null;
  if (explicitSubstitution(text, n)) return null;

  const genesIn = n.match(GENES_IN);
  const show = n.match(SHOW_TARGET);
  const mention = (genesIn?.[1] ?? show?.[1] ?? n).replace(/\?+$/, "").trim();
  const resolved = resolveAnatomyMention(mention) ?? (ctx.anatomyId ? { id: ctx.anatomyId, label: mention } : null);

  if (/\bgenes?\b/.test(n) || /\bexpressed\b/.test(n)) {
    return base({
      intent: "EXPLORE",
      reason: resolved
        ? `Parsed locally: genes with evidence in ${resolved.label}.`
        : "Parsed locally: opening genes with evidence in the selected tissue.",
      explore: {
        action: "show_genes",
        anatomy_ids: resolved ? [resolved.id] : ctx.anatomyId ? [ctx.anatomyId] : [],
        gene_ids: [],
        locus_id: ctx.locusId ?? null,
      },
    });
  }

  if (/\b(sequence|locus|reference|bases?|grch38)\b/.test(n)) {
    return base({
      intent: "EXPLORE",
      reason: "Parsed locally: opening the sequence window.",
      explore: { action: "show_sequence", anatomy_ids: ctx.anatomyId ? [ctx.anatomyId] : [], gene_ids: ctx.geneId ? [ctx.geneId] : [], locus_id: ctx.locusId ?? null },
    });
  }

  if (resolved || show) {
    return base({
      intent: "EXPLORE",
      reason: resolved ? `Parsed locally: focusing ${resolved.label}.` : "Parsed locally: opening anatomy.",
      explore: {
        action: "focus_anatomy",
        anatomy_ids: resolved ? [resolved.id] : [],
        gene_ids: [],
        locus_id: null,
      },
    });
  }
  return null;
}

/** Route free text. Never returns PRECISE_EDIT for a trait-goal phrase. */
export function routePrompt(text: string, ctx: RouterContext, source: "text" | "voice" = "text"): InterpretCommandResponse {
  const raw = (text ?? "").trim();
  if (!raw) return { ...base({ intent: "UNSUPPORTED", reason: "Type what you would like to explore or an explicit edit such as \"change base 4 to A\"." }), source };
  if (raw.length > MAX_PROMPT_CHARS) {
    return { ...base({ intent: "UNSUPPORTED", reason: `That is too long to parse safely (${raw.length} > ${MAX_PROMPT_CHARS} characters).` }), source };
  }

  if (isTraitGoalText(raw)) return { ...traitResponse(raw), source };

  const explored = exploreResponse(raw, ctx);
  if (explored) return { ...explored, source };

  const grch = parseGrch38Edit(raw, ctx);
  if (grch) return { ...grch, source };

  const parsed = parsePrompt(raw, ctx);
  if (parsed.kind === "proposal") {
    const synthetic = !ctx.locusId && (ctx.assembly == null || ctx.assembly === SYNTHETIC_REFERENCE_ASSET_ID || /synthetic/i.test(ctx.assembly));
    return {
      ...base({
        intent: "PRECISE_EDIT",
        reason: `Parsed locally: set position ${parsed.position} to ${parsed.alt}.`,
        edit: {
          locus_id: ctx.locusId ?? null,
          reference_asset_id: ctx.referenceAssetId ?? (synthetic ? SYNTHETIC_REFERENCE_ASSET_ID : GRCH38_REFERENCE_ASSET_ID),
          assembly: ctx.assembly ?? (ctx.locusId ? "GRCh38" : "synthetic-chr22-educational"),
          contig: ctx.contig ?? "chr22",
          position: parsed.position,
          stated_ref: parsed.fromRef ?? null,
          alt: parsed.alt,
        },
      }),
      source,
    };
  }
  if (parsed.kind === "needs_selection" || parsed.kind === "ambiguous") {
    return { ...base({ intent: "NEEDS_CLARIFICATION", reason: parsed.reason }), source };
  }
  return { ...base({ intent: "UNSUPPORTED", reason: parsed.reason }), source };
}

/** True only when the router produced a precise substitution that may enter the draft. */
export function intentCreatesDraft(r: InterpretCommandResponse): boolean {
  return r.intent === "PRECISE_EDIT" && !!r.edit && isNucleotide(r.edit.alt);
}

export function toInterpretRequest(text: string, source: "text" | "voice", ctx: RouterContext, workspaceId?: string | null): InterpretCommandRequest {
  return {
    text,
    workspace_id: workspaceId ?? null,
    source,
    selection: {
      anatomy_id: ctx.anatomyId ?? null,
      gene_id: ctx.geneId ?? null,
      locus_id: ctx.locusId ?? null,
      position: ctx.selectedPosition,
    },
  };
}

export { PARSER_LABEL, emptyExplore, WHY_NOT_AUTOMATIC };
