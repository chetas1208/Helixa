/**
 * Deterministic local grammar for explicit single-base substitution statements.
 * Label everywhere in the UI: "Parsed locally". There is no interpretation endpoint and no model:
 * anything that is not an explicit statement is refused or turned into a question, never guessed.
 *
 *   "change base 4 to A"             -> proposal {position:4, alt:A}
 *   "set position 12 to G"           -> proposal
 *   "substitute the selected nucleotide with T" (selection=7) -> proposal {7, T}
 *   "make it a C" (selection=7)      -> proposal {7, C};  without selection -> needs_selection
 *   "change base 1,024 from g to a"  -> proposal with fromRef G
 *   "insert a base at 5"             -> unsupported (only 1-base substitutions)
 *
 * Pure functions only. Positions are 1-based coordinates in the loaded window.
 */
import type { Nucleotide } from "../types";

export const PARSER_LABEL = "Parsed locally" as const;
export const MAX_PROMPT_CHARS = 600;

export interface ParseContext {
  /** Currently selected 1-based position (from the helix / list), or null. */
  selectedPosition: number | null;
  windowStart: number;
  windowEnd: number;
  /** Loaded contig name (e.g. "chr22"); another contig named in the text is refused. */
  contig?: string;
}

export type ParseCode =
  | "empty"
  | "too_long"
  | "not_an_edit"
  | "negated"
  | "unsupported_operation"
  | "range"
  | "multiple_edits"
  | "multiple_positions"
  | "selection_conflict"
  | "no_allele"
  | "multiple_alleles"
  | "invalid_allele"
  | "out_of_range"
  | "non_integer"
  | "wrong_contig"
  | "ordinal_ambiguous"
  | "unrecognized_words";

export type ParseResult =
  | {
      kind: "proposal";
      position: number;
      alt: Nucleotide;
      /** Allele the user claims is there ("from G to A"); the caller must compare with the real base. */
      fromRef?: Nucleotide;
      via: "explicit_position" | "selection";
      label: typeof PARSER_LABEL;
    }
  | { kind: "needs_selection"; label: typeof PARSER_LABEL; reason: string }
  | { kind: "ambiguous"; label: typeof PARSER_LABEL; reason: string; code: ParseCode }
  | { kind: "unsupported"; label: typeof PARSER_LABEL; reason: string; code: ParseCode };

export const EXAMPLE_PROMPTS = ["change base 4 to A", "set position 12 to G", "make the selected nucleotide a C"] as const;

const unsupported = (code: ParseCode, reason: string): ParseResult => ({ kind: "unsupported", label: PARSER_LABEL, reason, code });
const ambiguous = (code: ParseCode, reason: string): ParseResult => ({ kind: "ambiguous", label: PARSER_LABEL, reason, code });
const needsSelection = (reason: string): ParseResult => ({ kind: "needs_selection", label: PARSER_LABEL, reason });

// ---------- vocabulary ----------

const ALLELE_WORDS: Record<string, Nucleotide> = {
  a: "A", c: "C", g: "G", t: "T",
  adenine: "A", cytosine: "C", guanine: "G", thymine: "T",
};
const NON_DNA_ALLELE = new Set(["u", "uracil", "n", "x", "r", "y"]);

const CHANGE_VERBS = new Set([
  "change", "changes", "set", "make", "substitute", "replace", "mutate", "turn", "convert", "switch",
  "edit", "update", "put", "swap", "flip", "alter", "modify", "correct", "revert", "use",
]);
const UNSUPPORTED_OPS: Record<string, string> = {
  insert: "insertion", insertion: "insertion", delete: "deletion", deletion: "deletion", remove: "deletion",
  duplicate: "duplication", duplication: "duplication", inversion: "inversion", invert: "inversion",
  frameshift: "frameshift", indel: "insertion/deletion", excise: "deletion", splice: "splicing", knockout: "knockout",
  knock: "knockout", amplify: "amplification", copy: "copying", paste: "pasting", cut: "cutting",
  crispr: "genome-editing procedure", transplant: "transplant",
};
const NEGATIONS = new Set(["dont", "do_not", "not", "never", "no_change", "cancel", "undo", "stop", "without", "nothing", "nevermind"]);
const POSITION_NOUNS = new Set(["base", "position", "pos", "nucleotide", "nt", "bp", "locus", "site", "number", "no", "coordinate", "index", "residue", "allele", "letter"]);
const SELECTION_WORDS = new Set(["selected", "this", "that", "current", "chosen", "highlighted", "picked", "active", "marked", "it", "here", "clicked", "focused"]);
const CONNECTORS = new Set(["to", "into", "with", "as", "be", "become", "becomes", "equal", "equals", "is", "->", "=>", "=", "should", "will", "by", "for", "of", "at", "on", "in", "from", "the", "a", "an", "and", "then"]);
const POLITE = new Set(["please", "can", "could", "would", "you", "i", "want", "like", "need", "to_", "kindly", "just", "now", "ok", "okay", "hey", "lets", "let's", "let", "us", "we", "my", "me", "so", "thanks", "thank", "pls", "go", "ahead", "do", "really", "actually", "exactly", "only", "single", "one_base", "1-base", "simply", "same", "again", "window", "nucleotides_", "genome"]);

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const ORDINAL_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};

// ---------- normalisation ----------

/** Lowercase, unify unicode arrows/quotes/space, drop sentence punctuation, keep digit-group commas. Pure. */
export function normalizePrompt(input: string): string {
  let s = input.normalize("NFKC").toLowerCase();
  s = s.replace(/[‘’“”`"]/g, "'").replace(/[→⇒]/g, " -> ");
  s = s.replace(/\bdon't\b/g, "dont").replace(/'/g, "");
  s = s.replace(/\bchr(?:omosome)?\s*([a-z0-9]+)\s*[:.]\s*(\d)/g, "chr$1:$2");
  // thousands separators: 1,024 -> 1024 (only well-formed groups)
  s = s.replace(/\b\d{1,3}(?:,\d{3})+\b/g, (m) => m.replace(/,/g, ""));
  s = s.replace(/(\d)\s*#/g, "$1 ").replace(/#\s*(\d)/g, " position $1");
  // allele lists written as A,G / A.G / A/G / A|G stay two alleles (never "article + allele")
  s = s.replace(/\b([acgt])\s*[,./|]\s*(?=[acgt]\b)/g, "$1 and ");
  // hyphenated number words: twenty-one -> twenty one
  s = s.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)-(one|two|three|four|five|six|seven|eight|nine)\b/g, "$1 $2");
  // sentence punctuation (keep ':' in chr22:12, '.' between digits for non_integer detection, '-' / '>' / '=' operators)
  s = s.replace(/[!?;,]+/g, " ").replace(/(?<!\d)\./g, " ").replace(/\.(?!\d)/g, " ").replace(/:(?!\d)/g, " ");
  s = s.replace(/[()[\]{}]/g, " ");
  s = s.replace(/<|(?<![-=])>/g, " ").replace(/-\s*>|=\s*>/g, " -> ").replace(/=/g, " = ");
  return s.replace(/\s+/g, " ").trim();
}

function convertNumberWords(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t in NUMBER_WORDS) {
      let v = NUMBER_WORDS[t];
      // "twenty one"
      if (v >= 20 && v % 10 === 0 && i + 1 < tokens.length) {
        const n = NUMBER_WORDS[tokens[i + 1]];
        if (n !== undefined && n >= 1 && n <= 9) { v += n; i++; }
      }
      out.push(String(v));
    } else {
      out.push(t);
    }
  }
  return out;
}

const isDigits = (t: string) => /^\d+$/.test(t);

/** Parse an explicit edit statement. Never guesses a locus; see header for the grammar. */
export function parsePrompt(text: string, ctx: ParseContext): ParseResult {
  const raw = (text ?? "").trim();
  if (!raw) return unsupported("empty", "Type an explicit edit such as \"change base 4 to A\".");
  if (raw.length > MAX_PROMPT_CHARS) return unsupported("too_long", `That is too long to parse safely (${raw.length} > ${MAX_PROMPT_CHARS} characters). State one edit at a time.`);

  const norm = normalizePrompt(raw);
  if (!norm) return unsupported("empty", "Type an explicit edit such as \"change base 4 to A\".");

  // --- contig mention (chr22:12 -> position 12) ---
  let work = norm;
  const contigRefs = [...work.matchAll(/\bchr([a-z0-9]+):(\d+)\b/g)];
  for (const m of contigRefs) {
    const name = `chr${m[1]}`;
    if (ctx.contig && name !== ctx.contig.toLowerCase()) {
      return unsupported("wrong_contig", `Only ${ctx.contig} is loaded. ${name} cannot be edited here.`);
    }
  }
  work = work.replace(/\bchr[a-z0-9]+:(\d+)\b/g, "position $1");

  if (/\d\.\d/.test(work)) return unsupported("non_integer", "Positions must be whole numbers (1-based).");

  // ordinals "4th base", "first nucleotide"
  const ordinals: number[] = [];
  work = work.replace(/\b(\d+)(?:st|nd|rd|th)\b/g, (_m, d) => { ordinals.push(Number(d)); return " position " + d + " "; });
  work = work.replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/g, (_m, w) => { ordinals.push(ORDINAL_WORDS[w]); return " position " + ORDINAL_WORDS[w] + " "; });
  if (ordinals.length > 0 && ctx.windowStart !== 1) {
    return ambiguous("ordinal_ambiguous", `Ordinal positions like "4th" are ambiguous because the window starts at ${ctx.windowStart}. Use the coordinate (e.g. "position ${ctx.windowStart}").`);
  }

  let tokens = work.split(" ").filter(Boolean);

  // --- negation / question ---
  if (tokens.some((t) => NEGATIONS.has(t)) || /\bdo not\b/.test(work) || /\bno change\b/.test(work)) {
    return unsupported("negated", "That reads as a negation or a cancel. State the edit positively (e.g. \"change base 4 to A\"), or use Discard / Undo.");
  }
  if (/^(what|which|why|how|is|are|does|do|show|tell|explain|list)\b/.test(work) && !tokens.some((t) => CHANGE_VERBS.has(t))) {
    return unsupported("not_an_edit", "That looks like a question, not an edit. Only explicit statements like \"change base 4 to A\" are parsed.");
  }

  // --- unsupported operations ---
  for (const t of tokens) {
    if (UNSUPPORTED_OPS[t]) {
      return unsupported("unsupported_operation", `Unsupported: ${UNSUPPORTED_OPS[t]}. Only single-base substitutions (A, C, G, T) are supported by the backend.`);
    }
  }
  if (/\b(bases|nucleotides|bps|letters|positions)\b/.test(work)) {
    if (/\b\d+\s*(?:to|through|thru|-|and|until)\s*\d+\b/.test(work) || tokens.filter(isDigits).length > 1 || /\bbetween\b/.test(work) || /\ball\b/.test(work)) {
      return unsupported("range", "Multi-base ranges are not supported. State one base at a time (e.g. \"change base 4 to A\").");
    }
  }
  if (/\b\d+\s*(?:-|through|thru|until)\s*\d+\b/.test(work) && !/->/.test(work)) {
    return unsupported("range", "Multi-base ranges are not supported. State one base at a time.");
  }
  if (/\b(?:every|each|all|entire|whole)\b/.test(work)) {
    return unsupported("range", "Bulk edits are not supported. State one base at a time.");
  }

  tokens = convertNumberWords(tokens);
  if (tokens.some((t) => /^-\d+$/.test(t))) {
    return unsupported("out_of_range", "Positions are 1-based whole numbers (position 1 is the first base).");
  }

  // --- change verb gate ---
  const verbCount = tokens.filter((t) => CHANGE_VERBS.has(t)).length;
  const hasArrow = tokens.includes("->") || tokens.includes("=");
  if (verbCount === 0 && !hasArrow) {
    return unsupported("not_an_edit", "I could not find an edit verb. Try \"change base 4 to A\" or \"set position 12 to G\".");
  }
  if (verbCount > 1 && tokens.some((t) => t === "and" || t === "then" || t === "also")) {
    return ambiguous("multiple_edits", "That contains more than one edit. Send them one at a time, or add them to the draft separately.");
  }

  // --- "from X" reference claim ---
  let fromRef: Nucleotide | undefined;
  const fromIdx = tokens.indexOf("from");
  if (fromIdx >= 0) {
    let j = fromIdx + 1;
    if (tokens[j] === "a" || tokens[j] === "an") {
      // "from a g" -> article + G ; "from a to g" -> A
      if (tokens[j + 1] && tokens[j + 1] in ALLELE_WORDS && tokens[j + 1] !== "a") j++;
    }
    const w = tokens[j];
    if (w && w in ALLELE_WORDS) {
      fromRef = ALLELE_WORDS[w];
      tokens.splice(fromIdx, j - fromIdx + 1);
    } else if (w && NON_DNA_ALLELE.has(w)) {
      return unsupported("invalid_allele", `"${w.toUpperCase()}" is not a DNA base. Use A, C, G or T.`);
    } else {
      tokens.splice(fromIdx, 1);
    }
  }

  // --- positions ---
  const numberIdx: number[] = [];
  tokens.forEach((t, i) => { if (isDigits(t)) numberIdx.push(i); });
  const numbers = numberIdx.map((i) => Number(tokens[i]));
  const distinctNumbers = Array.from(new Set(numbers));
  if (distinctNumbers.length > 1) {
    return ambiguous("multiple_positions", `Several positions were mentioned (${distinctNumbers.join(", ")}). Name exactly one.`);
  }

  const usesSelectionWord = tokens.some((t) => SELECTION_WORDS.has(t));
  let position: number | null = distinctNumbers.length === 1 ? distinctNumbers[0] : null;
  let via: "explicit_position" | "selection" = "explicit_position";

  if (position === null) {
    if (!usesSelectionWord) {
      return needsSelection(
        ctx.selectedPosition !== null
          ? `No position was given. Say "the selected base" (currently position ${ctx.selectedPosition}) or name a position, e.g. "change base 4 to A".`
          : "No position was given. Select a base on the helix (or in the list) or name one, e.g. \"change base 4 to A\".",
      );
    }
    if (ctx.selectedPosition === null) {
      return needsSelection("No base is selected. Click a base on the helix or in the list first, then try again.");
    }
    position = ctx.selectedPosition;
    via = "selection";
  } else if (usesSelectionWord && ctx.selectedPosition !== null && ctx.selectedPosition !== position && tokens.some((t) => ["selected", "chosen", "highlighted", "picked", "clicked", "focused"].includes(t))) {
    return ambiguous("selection_conflict", `You said both position ${position} and the selected base (${ctx.selectedPosition}). Name one.`);
  }

  if (!Number.isInteger(position) || position < 1) {
    return unsupported("out_of_range", "Positions are 1-based whole numbers (position 1 is the first base).");
  }
  if (position < ctx.windowStart || position > ctx.windowEnd) {
    return unsupported("out_of_range", `Position ${position} is outside the loaded window (${ctx.windowStart}-${ctx.windowEnd}). Only loaded bases can be edited here.`);
  }

  // --- allele ---
  if (tokens.includes("or")) return ambiguous("multiple_alleles", "\"or\" leaves the target base open. State exactly one of A, C, G or T.");
  const restIdx = tokens.map((_t, i) => i).filter((i) => {
    const t = tokens[i];
    if (numberIdx.includes(i)) return false;
    if (CHANGE_VERBS.has(t) || POSITION_NOUNS.has(t) || SELECTION_WORDS.has(t) || POLITE.has(t) || t === "->" || t === "=") return false;
    if (CONNECTORS.has(t) && t !== "a" && t !== "an") return false;
    return true;
  });
  // "a" is an article only directly before a base ("make it a C"); otherwise it is the allele A
  const isArticle = (i: number) => tokens[i] === "an" || (tokens[i] === "a" && i + 1 < tokens.length && tokens[i + 1] in ALLELE_WORDS);
  if (restIdx.filter((i) => tokens[i] === "a").length > 2) return ambiguous("multiple_alleles", "Several bases were mentioned. State exactly one of A, C, G or T.");
  const others = restIdx.filter((i) => !isArticle(i)).map((i) => tokens[i]);

  const unknown = others.filter((t) => !(t in ALLELE_WORDS) && !NON_DNA_ALLELE.has(t));
  const badAlleles = others.filter((t) => NON_DNA_ALLELE.has(t));
  if (badAlleles.length > 0 && unknown.length === 0 && others.length === badAlleles.length) {
    return unsupported("invalid_allele", `"${badAlleles[0].toUpperCase()}" is not a DNA base here. Use A, C, G or T.`);
  }
  if (unknown.length > 0) {
    return unsupported("unrecognized_words", `I could not interpret "${unknown[0]}". Try: "change base ${position} to A".`);
  }
  const alleles = others.map((t) => ALLELE_WORDS[t]);
  let alt: Nucleotide | null = null;
  if (alleles.length === 0) {
    return needsSelection("No target base was given. Say which base to use, e.g. \"change base " + position + " to A\".");
  } else if (alleles.length === 1) {
    alt = alleles[0];
  } else {
    return ambiguous("multiple_alleles", `Several target bases were mentioned (${alleles.join(", ")}). State exactly one of A, C, G or T.`);
  }

  const out: ParseResult = { kind: "proposal", position, alt, via, label: PARSER_LABEL };
  if (fromRef) out.fromRef = fromRef;
  return out;
}

/** True if the ParseResult is a ready structured proposal. Narrowing helper. */
export function isProposal(r: ParseResult): r is Extract<ParseResult, { kind: "proposal" }> {
  return r.kind === "proposal";
}

/** Plain-language one-liner for each result kind. */
export function describeParse(r: ParseResult): string {
  switch (r.kind) {
    case "proposal":
      return `Parsed locally: set position ${r.position} to ${r.alt}${r.via === "selection" ? " (selected base)" : ""}.`;
    case "needs_selection":
      return r.reason;
    case "ambiguous":
    case "unsupported":
      return r.reason;
  }
}

/** Does the user's "from X" claim match the real current allele? Null when no claim. */
export function fromRefMismatch(r: Extract<ParseResult, { kind: "proposal" }>, currentAllele: string | null): string | null {
  if (!r.fromRef || !currentAllele) return null;
  return r.fromRef === currentAllele ? null : `You said ${r.fromRef}, but position ${r.position} currently reads ${currentAllele}. Nothing was changed.`;
}
