import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { parsePrompt } from "../../src/v12/editor/promptParser";
import { applySavedEdits } from "../../src/v12/editor/editorModel";
import { buildBodyGeometry } from "../../src/v12/editor/bodyGeometry";

const WEB = path.resolve(__dirname, "../..");
const REPO = path.resolve(WEB, "../..");

function exists(rel: string) {
  return fs.existsSync(path.join(REPO, rel));
}
function failMissing(owner: string, rel: string): never {
  throw new Error(`${owner} has not landed ${rel}. Scientific guardrail fails until that file exists.`);
}

describe("expression is not causality (frontend copy + types)", () => {
  it("TIER_LABEL does not present expression as a phenotype map", async () => {
    const { TIER_LABEL } = await import("../../src/v14/contracts");
    expect(TIER_LABEL["observed-expression"].toLowerCase()).not.toMatch(/caus|control|phenotype map/);
    expect(TIER_LABEL["statistical-association"].toLowerCase()).toContain("association");
  });
});

describe("vague trait goals are not local mutations", () => {
  const ctx = { selectedPosition: null, windowStart: 1, windowEnd: 48 };
  const goals = [
    "make my hands bigger",
    "bigger hands",
    "stronger legs",
    "smarter brain",
    "survive extreme cold",
    "change my eye colour",
  ];

  it("the V12 local parser refuses trait goals (never a proposal)", () => {
    for (const text of goals) {
      const parsed = parsePrompt(text, ctx);
      expect(parsed.kind, text).not.toBe("proposal");
    }
  });

  it("Agent 3/4 V14 interpret client treats them as TRAIT_GOAL", () => {
    const candidates = [
      "apps/web/src/v14/editor/interpretCommand.ts",
      "apps/web/src/v14/api/interpret.ts",
      "apps/web/src/features/genome-editor/interpretCommand.ts",
      "apps/web/src/v12/editor/v14Interpret.ts",
    ];
    const hit = candidates.find((p) => exists(p));
    if (!hit) {
      failMissing("V14 Agent 3 or 4", candidates.join(" | "));
    }
    const src = fs.readFileSync(path.join(REPO, hit), "utf8");
    expect(src).toMatch(/TRAIT_GOAL/);
    expect(src).toMatch(/hands bigger|bigger hands|trait_goal/i);
  });
});

describe("GRCh37 is rejected in client contracts", () => {
  it("Gene.assembly is the GRCh38 literal", async () => {
    const src = fs.readFileSync(path.join(WEB, "src/v14/contracts.ts"), "utf8");
    expect(src).toMatch(/assembly:\s*"GRCh38"/);
    expect(src).not.toMatch(/assembly:\s*"GRCh37"/);
  });
});

describe("DNA edit changes the allele; body geometry does not", () => {
  it("applySavedEdits mutates the sequence window only", () => {
    const baseline = "ACGTACGT";
    const edited = applySavedEdits(baseline, 1, [{ position: 2, ref: "C", alt: "T" }]);
    expect(edited[1]).toBe("T");
    expect(baseline[1]).toBe("C");
  });

  it("procedural body geometry is not a function of sequence", () => {
    const a = buildBodyGeometry();
    const b = buildBodyGeometry();
    expect(a.getAttribute("position")?.count).toBe(b.getAttribute("position")?.count);
    const src = fs
      .readFileSync(path.join(WEB, "src/v12/editor/bodyGeometry.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/\b(draftBases|editCount|alternate_allele|applySavedEdits)\b/);
    expect(src).toMatch(/export function buildBodyGeometry\(\)/);
  });

  it("Agent 1 anatomy meshes do not take sequence as input", () => {
    const index = path.join(WEB, "src/features/anatomy/index.ts");
    if (!fs.existsSync(index)) {
      failMissing("V14 Agent 1", "apps/web/src/features/anatomy/index.ts");
    }
    const anatomyDir = path.join(WEB, "src/features/anatomy");
    const files = fs.readdirSync(anatomyDir).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes(".test."));
    const blob = files.map((f) => fs.readFileSync(path.join(anatomyDir, f), "utf8")).join("\n");
    expect(blob).toMatch(/AnatomyStage/);
    expect(blob).not.toMatch(/applySavedEdits|draftBases|alternate_allele/);
  });
});

describe("required organs are in the mesh manifest or tree fixture", () => {
  const required = ["head", "hand", "heart", "kidney", "foot", "spine"];

  it("Agent 1 exports a searchable/selectable set covering the required parts", () => {
    const manifestPaths = [
      path.join(WEB, "src/features/anatomy/anatomy-mesh-manifest.json"),
      path.join(WEB, "src/features/anatomy/anatomyMeshManifest.ts"),
      path.join(WEB, "src/features/anatomy/anatomyMeshManifest.json"),
      path.join(WEB, "src/features/anatomy/manifest.ts"),
      path.join(WEB, "public/anatomy/anatomy-mesh-manifest.json"),
    ];
    const hit = manifestPaths.find((p) => fs.existsSync(p));
    if (!hit) {
      failMissing("V14 Agent 1", "apps/web/src/features/anatomy/anatomyMeshManifest.*");
    }
    const text = fs.readFileSync(hit, "utf8").toLowerCase();
    const missing = required.filter((part) => !text.includes(part));
    expect(missing, `manifest missing parts: ${missing.join(", ")}`).toEqual([]);
  });
});
