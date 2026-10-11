import { describe, it, expect } from "vitest";
import { PARSER_LABEL } from "../../src/v12/editor/promptParser";
import { isProposal, parsePrompt } from "../../src/v12/editor/promptParser";
import { intentCreatesDraft, isTraitGoalText, routePrompt, type RouterContext } from "../../src/v12/editor/promptRouter";
import { researchOmitsSequence } from "../../src/v12/editor/researchProposal";

const ctx = (over: Partial<RouterContext> = {}): RouterContext => ({
  selectedPosition: null,
  windowStart: 1,
  windowEnd: 48,
  contig: "chr22",
  assembly: "synthetic-chr22-educational",
  ...over,
});

const TRAITS = [
  "stronger legs",
  "bigger hands",
  "smarter brain",
  "change my eye colour",
  "change my eye color",
  "survive extreme cold",
];

describe("trait-goal inputs never become proposals", () => {
  it.each(TRAITS)("%s → TRAIT_GOAL, not PRECISE_EDIT, and parsePrompt is not a proposal", (text) => {
    expect(isTraitGoalText(text)).toBe(true);
    const r = routePrompt(text, ctx());
    expect(r.intent).toBe("TRAIT_GOAL");
    expect(r.edit).toBeNull();
    expect(intentCreatesDraft(r)).toBe(false);
    expect(r.parser).toBe("deterministic-v14");
    expect(r.reason.toLowerCase()).toMatch(/parsed locally/);
    expect(parsePrompt(text, ctx()).kind).not.toBe("proposal");
  });

  it("an ultraviolet-resistance wish opens a research record and invents no allele", () => {
    const text = "Make the virtual organism more resistant to ultraviolet radiation.";
    expect(isTraitGoalText(text)).toBe(true);
    const r = routePrompt(text, ctx());
    expect(r.intent).toBe("TRAIT_GOAL");
    expect(r.edit).toBeNull();
    expect(intentCreatesDraft(r)).toBe(false);
    expect(r.trait_goal?.topic).toBe("ultraviolet resistance");
    expect(r.trait_goal?.related_anatomy_ids).toContain("UBERON:0002097");
    expect(r.trait_goal?.research).toMatchObject({
      user_intent: "Explore increased UV tolerance",
      research_area: "Pigmentation and DNA repair",
      evidence: "Research retrieval required",
      candidate_edit: "Pending evidence-based identification",
      dna_rendering: "Available after validated edit",
      body_rendering: "Hypothetical unless supported",
      approval: "Required before applying",
    });
    expect(researchOmitsSequence(r.trait_goal!.research!)).toBe(true);
  });

  it("an explicit substitution is not hijacked as a trait goal", () => {
    expect(isTraitGoalText("change base 4 to A")).toBe(false);
    expect(routePrompt("change base 4 to A", ctx()).intent).toBe("PRECISE_EDIT");
  });
});

describe("explore does not produce an edit payload", () => {
  it("show the left hand → EXPLORE focus, no draft", () => {
    const r = routePrompt("show the left hand", ctx());
    expect(r.intent).toBe("EXPLORE");
    expect(r.explore?.action).toBe("focus_anatomy");
    expect(r.explore?.anatomy_ids).toContain("UBERON:0002398@left");
    expect(r.edit).toBeNull();
    expect(intentCreatesDraft(r)).toBe(false);
  });

  it("genes in the retina → EXPLORE show_genes, no draft", () => {
    const r = routePrompt("genes in the retina", ctx());
    expect(r.intent).toBe("EXPLORE");
    expect(r.explore?.action).toBe("show_genes");
    expect(r.explore?.anatomy_ids).toContain("UBERON:0000966");
    expect(intentCreatesDraft(r)).toBe(false);
  });
});

describe("precise edits", () => {
  it("change GRCh38 14:23412800 A>G → PRECISE_EDIT", () => {
    const r = routePrompt("change GRCh38 14:23412800 A>G", ctx());
    expect(r.intent).toBe("PRECISE_EDIT");
    expect(r.edit).toMatchObject({ assembly: "GRCh38", contig: "14", position: 23412800, stated_ref: "A", alt: "G" });
    expect(intentCreatesDraft(r)).toBe(true);
  });

  it("selected locus + allele uses the selection, labelled Parsed locally", () => {
    const r = routePrompt("change the selected nucleotide to G", ctx({ selectedPosition: 4, locusId: "grch38:MYH7:14:23412700-23412939" }));
    expect(r.intent).toBe("PRECISE_EDIT");
    expect(r.edit?.position).toBe(4);
    expect(r.edit?.alt).toBe("G");
    expect(r.edit?.locus_id).toBe("grch38:MYH7:14:23412700-23412939");
    expect(r.reason).toMatch(/Parsed locally/);
    const p = parsePrompt("change the selected nucleotide to G", ctx({ selectedPosition: 4 }));
    expect(isProposal(p)).toBe(true);
  });

  it("UI parser label stays Parsed locally", () => {
    expect(PARSER_LABEL).toBe("Parsed locally");
  });
});
