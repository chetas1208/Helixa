import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { TIER_LABEL, type InterpretationTier, type RelationshipKind } from "../../src/v14/contracts";

/** Source + license + copy guards. Missing Agent 1–4 files fail with a clear owner. */
const REPO = path.resolve(__dirname, "../../../..");
const WEB = path.resolve(__dirname, "../..");

const BANNED_COPY = [
  "genes that control",
  "gene that controls",
  "controls this organ",
  "causes this organ",
  "will make your hands",
  "will enlarge",
];
const REQUIRED_COPY = [
  "Genes with evidence in this tissue",
  "Variants associated with related traits",
  "Curated gene–phenotype relationships",
];
const BANNED_ASSETS = ["z-anatomy", "zanatomy", "z_anatomy", "bodyparts3d", "bodypart3d", "body parts 3d"];
const SKIP_DIR = new Set(["node_modules", "dist", ".git", ".venv", "__pycache__", "artifacts"]);

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|json|css|html)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const rel = (f: string) => path.relative(WEB, f);

function requireFile(abs: string, owner: string): string {
  if (!fs.existsSync(abs)) {
    throw new Error(`${owner} has not landed ${path.relative(REPO, abs)}. Guardrail fails until that file exists.`);
  }
  return fs.readFileSync(abs, "utf8");
}

describe("V14 contract tiers and relationship kinds", () => {
  it("interpretation tiers are labelled as text, never a numeric confidence", () => {
    const tiers: InterpretationTier[] = [
      "reference-fact",
      "observed-expression",
      "statistical-association",
      "curated-relationship",
      "predicted-hypothesis",
      "unknown",
    ];
    for (const t of tiers) {
      expect(TIER_LABEL[t], t).toBeTruthy();
      expect(TIER_LABEL[t]).not.toMatch(/\d+(\.\d+)?%/);
      expect(TIER_LABEL[t].toLowerCase()).not.toContain("confidence");
    }
    expect(TIER_LABEL["observed-expression"]).toMatch(/expression/i);
    expect(TIER_LABEL["statistical-association"]).toMatch(/association/i);
  });

  it("phenotype relationship kinds are distinct from expression", () => {
    const kinds: RelationshipKind[] = [
      "ANATOMICAL_PART_OF",
      "SYSTEM_MEMBERSHIP",
      "GENE_EXPRESSED_IN",
      "REGULATORY_ASSOCIATION_IN_TISSUE",
      "VARIANT_TRAIT_ASSOCIATION",
      "CURATED_GENE_PHENOTYPE_RELATIONSHIP",
      "VISUAL_ASSET_FOR_ANATOMY",
      "EDIT_OVERLAPS_GENE_OR_REGULATORY_REGION",
    ];
    expect(new Set(kinds).size).toBe(8);
    expect(kinds).not.toContain("GENE_CONTROLS_ORGAN");
  });
});

describe("banned causal copy is not product UI", () => {
  const dirs = [
    path.join(WEB, "src/v14"),
    path.join(WEB, "src/features/anatomy"),
    path.join(WEB, "src/features/genome-editor"),
    path.join(WEB, "src/v12/editor"),
    path.join(WEB, "src/v12/evolution"),
    path.join(WEB, "src/v12/simulation"),
    path.join(WEB, "src/v12/library"),
  ];
  const files = dirs.flatMap((d) => walk(d));

  it("product source does not say genes that control X", () => {
    const hits: string[] = [];
    for (const f of files) {
      const c = strip(fs.readFileSync(f, "utf8")).toLowerCase();
      for (const banned of BANNED_COPY) {
        if (c.includes(banned)) hits.push(`${rel(f)}: ${banned}`);
      }
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("Agent 3 evidence drawer uses the required honest labels (fails until landed)", () => {
    const candidates = [
      path.join(WEB, "src/features/genome-editor/EvidenceDrawer.tsx"),
      path.join(WEB, "src/features/genome-editor/EvidenceSections.tsx"),
      path.join(WEB, "src/v12/editor/EvidenceDrawer.tsx"),
      path.join(WEB, "src/v14/design/EvidenceSections.tsx"),
    ];
    const found = candidates.filter((p) => fs.existsSync(p));
    if (found.length === 0) {
      const featureDir = path.join(WEB, "src/features/genome-editor");
      const v14src = walk(path.join(WEB, "src/v14")).map(rel);
      throw new Error(
        `V14 Agent 3 has not landed evidence-section copy. Looked for ${candidates.map((p) => path.relative(REPO, p)).join(", ")}. ` +
          `features/genome-editor exists=${fs.existsSync(featureDir)}; v14 src files=${v14src.join(",") || "(none besides contracts/state)"}.`,
      );
    }
    const blob = found.map((p) => fs.readFileSync(p, "utf8")).join("\n");
    for (const required of REQUIRED_COPY) {
      expect(blob, `missing required copy: ${required}`).toContain(required);
    }
    for (const banned of BANNED_COPY) {
      expect(blob.toLowerCase()).not.toContain(banned);
    }
  });
});

describe("no Z-Anatomy / BodyParts3D in the web tree", () => {
  it("anatomy feature and public assets do not contain banned atlas names", () => {
    const roots = [path.join(WEB, "src/features/anatomy"), path.join(WEB, "public/anatomy"), path.join(WEB, "src/v14")];
    const hits: string[] = [];
    for (const root of roots) {
      for (const f of walk(root)) {
        const c = fs.readFileSync(f, "utf8").toLowerCase();
        for (const marker of BANNED_ASSETS) {
          if (c.includes(marker)) hits.push(`${rel(f)}: ${marker}`);
        }
      }
      if (fs.existsSync(root)) {
        for (const f of walk(root)) {
          if (BANNED_ASSETS.some((m) => f.toLowerCase().includes(m.replace(/\s/g, "")))) hits.push(rel(f));
        }
      }
    }
    expect(hits).toEqual([]);
  });
});

describe("anatomy selection never writes genomic data", () => {
  it("anatomySelection store persists nothing and does not touch workspace ids", () => {
    const src = requireFile(
      path.join(WEB, "src/v14/state/anatomySelection.ts"),
      "V14 Agent 4",
    );
    expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(src).not.toMatch(/workspace_id|activeWorkspaceId/);
    expect(src).toMatch(/selectAnatomy/);
  });
});
