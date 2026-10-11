/**
 * Local, honest anatomy mention map for the editor until Agent 1/2 land live tree + search.
 * Ids follow V14_UI_CONTRACTS §1. This is a teaching fallback, not an ontology server.
 */

export interface LocalAnatomyHit {
  id: string;
  label: string;
  type: string;
  laterality?: "left" | "right" | "midline" | "none";
}

export const LOCAL_ANATOMY: { id: string; labels: string[]; type: string; laterality?: LocalAnatomyHit["laterality"] }[] = [
  { id: "UBERON:0002398@left", labels: ["left hand", "left palm"], type: "region", laterality: "left" },
  { id: "UBERON:0002398@right", labels: ["right hand", "right palm"], type: "region", laterality: "right" },
  { id: "UBERON:0002398", labels: ["hand", "hands", "manus", "palm"], type: "region" },
  { id: "UBERON:0000966", labels: ["retina"], type: "organ" },
  { id: "UBERON:0000970", labels: ["eye", "eyes"], type: "organ" },
  { id: "UBERON:0000955", labels: ["brain"], type: "organ" },
  { id: "UBERON:0002103", labels: ["leg", "legs"], type: "region" },
  { id: "UBERON:0002387@left", labels: ["left foot"], type: "region", laterality: "left" },
  { id: "UBERON:0002387@right", labels: ["right foot"], type: "region", laterality: "right" },
  { id: "UBERON:0000948", labels: ["heart"], type: "organ" },
  { id: "UBERON:0002048", labels: ["lung", "lungs"], type: "organ" },
  { id: "UBERON:0002107", labels: ["ear", "ears"], type: "organ" },
  { id: "UBERON:0001264", labels: ["pancreas"], type: "organ" },
  { id: "UBERON:0002113", labels: ["kidney", "kidneys"], type: "organ" },
  { id: "UBERON:0000945", labels: ["stomach"], type: "organ" },
  { id: "UBERON:0000029", labels: ["lymph node"], type: "organ" },
  { id: "UBERON:0001630", labels: ["muscle", "muscles", "skeletal muscle"], type: "muscle" },
  { id: "DIAMOND:region-head-face", labels: ["face", "head"], type: "region" },
];

/** Longest-label match. "left hand" wins over "hand". */
export function resolveAnatomyMention(text: string): LocalAnatomyHit | null {
  const n = (text ?? "").toLowerCase().replace(/[?!.,]+/g, " ").replace(/\s+/g, " ").trim();
  if (!n) return null;
  let best: LocalAnatomyHit | null = null;
  let bestLen = 0;
  for (const row of LOCAL_ANATOMY) {
    for (const label of row.labels) {
      if (label.length >= bestLen && (n === label || n.includes(label) || label.includes(n))) {
        best = { id: row.id, label: row.labels[0]!, type: row.type, laterality: row.laterality };
        bestLen = label.length;
      }
    }
  }
  return best;
}
