/**
 * Structured research record for a trait wish.
 * The candidate edit stays pending until evidence identifies a real allele.
 * This module must never emit a sequence, coordinate, or gene as if it were the edit.
 */
import type { TraitResearchProposal } from "../../v14/contracts";

export const EVIDENCE_STATUS = "Research retrieval required" as const;
export const CANDIDATE_STATUS = "Pending evidence-based identification" as const;
export const DNA_STATUS = "Available after validated edit" as const;
export const BODY_STATUS = "Hypothetical unless supported" as const;
export const APPROVAL_STATUS = "Required before applying" as const;

const AREAS: Record<string, { user_intent: string; research_area: string }> = {
  "ultraviolet resistance": {
    user_intent: "Explore increased UV tolerance",
    research_area: "Pigmentation and DNA repair",
  },
  "eye colour": { user_intent: "Explore eye colour", research_area: "Iris pigmentation" },
  "stronger legs": { user_intent: "Explore greater leg strength", research_area: "Skeletal muscle" },
  "stronger arms": { user_intent: "Explore greater arm strength", research_area: "Skeletal muscle" },
  strength: { user_intent: "Explore greater strength", research_area: "Skeletal muscle" },
  "bigger hands": { user_intent: "Explore hand size", research_area: "Limb development" },
  "muscle size": { user_intent: "Explore muscle size", research_area: "Skeletal muscle" },
  "smarter brain": { user_intent: "Explore cognition", research_area: "Nervous system" },
  intelligence: { user_intent: "Explore cognition", research_area: "Nervous system" },
  "survive extreme cold": { user_intent: "Explore cold tolerance", research_area: "Thermoregulation and metabolism" },
  height: { user_intent: "Explore stature", research_area: "Skeletal growth" },
  "disease treatment": { user_intent: "Explore a disease-related question", research_area: "Not yet classified" },
  "trait wish": { user_intent: "Explore a described biological change", research_area: "Not yet classified" },
};

export function buildResearchProposal(topic: string): TraitResearchProposal {
  const known = AREAS[topic];
  return {
    user_intent: known?.user_intent ?? `Explore ${topic}`,
    research_area: known?.research_area ?? "Not yet classified",
    evidence: EVIDENCE_STATUS,
    candidate_edit: CANDIDATE_STATUS,
    dna_rendering: DNA_STATUS,
    body_rendering: BODY_STATUS,
    approval: APPROVAL_STATUS,
  };
}

/** A research record is not an edit. Reject any record that smuggles an allele. */
export function researchOmitsSequence(proposal: TraitResearchProposal): boolean {
  const blob = Object.values(proposal).join(" ");
  return !/[ACGT]\s*>\s*[ACGT]/i.test(blob) && !/\b(?:chr)?\d{1,2}\s*:\s*\d+/.test(blob);
}
