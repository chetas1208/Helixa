import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const WEB = path.resolve(__dirname, "../..");
const FIRST_VIEWPORT_COPY = "What would you like to explore or edit?";
const EXPLORE_PARTS = "Explore body parts";

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("first viewport is body + DNA + prompt only", () => {
  it("Agent 3 composer asks the V14 explore/edit question and offers Explore body parts", () => {
    const dirs = [
      path.join(WEB, "src/v12/editor"),
      path.join(WEB, "src/features/genome-editor"),
    ];
    const files = dirs.flatMap((d) => walk(d));
    const blob = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
    if (!blob.includes(FIRST_VIEWPORT_COPY)) {
      throw new Error(
        `V14 Agent 3 has not landed first-viewport copy ${JSON.stringify(FIRST_VIEWPORT_COPY)} ` +
          `in src/v12/editor or src/features/genome-editor.`,
      );
    }
    expect(blob).toContain(EXPLORE_PARTS);
  });

  it("evidence drawer is stacked sections, not a tablist (V12-ADR-009 / V14 §6)", () => {
    const dirs = [
      path.join(WEB, "src/features/genome-editor"),
      path.join(WEB, "src/v12/editor"),
    ];
    const hits: string[] = [];
    for (const f of dirs.flatMap((d) => walk(d))) {
      const s = strip(fs.readFileSync(f, "utf8"));
      if (/role=["']tablist["']/.test(s) || /role=["']tab["']/.test(s)) {
        hits.push(path.relative(WEB, f));
      }
    }
    expect(hits, `sub-tabs inside the editor: ${hits.join(", ")}`).toEqual([]);
  });
});

describe("voice transcript never auto-applies", () => {
  it("VoiceCapture only applies after an explicit Use click", () => {
    const src = fs.readFileSync(path.join(WEB, "src/v12/editor/VoiceCapture.tsx"), "utf8");
    expect(src).toMatch(/onUseTranscript/);
    expect(src).toMatch(/data-testid="voice-use"/);
    expect(src).not.toMatch(/onFinal\([^)]*\)\s*=>\s*onUseTranscript/);
    expect(src).not.toMatch(/propose\(|commit\(/);
  });

  it("voice adapter documents that finals still need confirmation", () => {
    const src = fs.readFileSync(path.join(WEB, "src/v12/editor/voiceAdapter.ts"), "utf8");
    expect(src.toLowerCase()).toMatch(/never|confirm/);
    expect(src).not.toMatch(/auto-?apply/i);
  });
});

describe("reduced motion still edits", () => {
  it("editor does not disable propose/save when reduced motion is on", () => {
    const tab = fs.readFileSync(path.join(WEB, "src/v12/editor/GenomeEditorTab.tsx"), "utf8");
    expect(tab).toMatch(/reducedMotion|prefers-reduced-motion|reduced/);
    expect(tab).not.toMatch(/if\s*\(\s*reduced[^)]*\)\s*return\s*;/);
    expect(tab).not.toMatch(/disabled=\{reduced\}/);
    expect(tab).not.toMatch(/if \(reduced\) throw/);
  });
});

describe("typed and voice share the propose path", () => {
  it("composer and voice-use both feed the same inspect/propose handler", () => {
    const composer = fs.readFileSync(path.join(WEB, "src/v12/editor/PromptComposer.tsx"), "utf8");
    expect(composer).toMatch(/onUseTranscript/);
    expect(composer).toMatch(/onSubmit/);
    expect(composer).toMatch(/inspect-proposal|prompt-input/);
  });
});
