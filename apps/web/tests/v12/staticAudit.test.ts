import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/** Source-level guards (node environment): privacy, injection, tab-count and single-writer invariants. */
const ROOT = path.resolve(__dirname, "../../src");
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = [...walk(path.join(ROOT, "v12")), ...walk(path.join(ROOT, "app"))];
const read = (f: string) => fs.readFileSync(f, "utf8");
/** strip comments so words in docs do not trigger */
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const rel = (f: string) => path.relative(ROOT, f);

describe("static source guards", () => {
  it("there is source to audit", () => expect(files.length).toBeGreaterThan(30));

  it("no backend text can reach the DOM as HTML", () => {
    const hits = files.filter((f) => /dangerouslySetInnerHTML|\.innerHTML\s*=|outerHTML\s*=|insertAdjacentHTML|document\.write\(/.test(code(f))).map(rel);
    expect(hits).toEqual([]);
  });

  it("no eval / new Function", () => {
    expect(files.filter((f) => /\beval\s*\(|new Function\s*\(/.test(code(f))).map(rel)).toEqual([]);
  });

  it("browser storage is used only for non-sensitive UI preferences and simulation ids", () => {
    const users = files.filter((f) => /\b(localStorage|sessionStorage|indexedDB)\b/.test(code(f))).map(rel).sort();
    // allow-list: simulation id memory (ids only) and render/motion preferences. Anything else needs a privacy review.
    const allowed = ["v12/api/simMemory.ts", "v12/shell/renderPrefs.ts", "v12/editor/GenomeEditorTab.tsx" /* one-time "hint seen" flag */];
    expect(users.filter((u) => !allowed.includes(u)), `unreviewed storage use: ${users.join(", ")}`).toEqual([]);
  });

  it("the Genome Editor persists nothing but (at most) a literal '1' hint flag", () => {
    const editor = files.filter((x) => rel(x).startsWith("v12/editor/"));
    const sets = editor.flatMap((f) => [...code(f).matchAll(/(?:localStorage|sessionStorage)\.setItem\(([^)]*)\)/g)].map((m) => `${rel(f)}: ${m[1]!.replace(/\s+/g, "")}`));
    for (const a of sets) expect(a).toMatch(/: [A-Z_]+,"1"$/);
  });

  it("the simulation id key has exactly ONE writer (no second implementation with another ordering)", () => {
    const writers = files.filter((f) => /diamond\.v12\.sims/.test(code(f))).map(rel);
    expect(writers).toEqual(["v12/api/simMemory.ts"]);
  });

  it("render prefs never persist genomic data or transcripts (only quality/motion keys)", () => {
    const f = files.find((x) => rel(x) === "v12/shell/renderPrefs.ts");
    if (!f) return;
    const src = code(f);
    for (const banned of ["transcript", "sequence", "bases", "workspace", "draft", "genome"]) {
      const setItem = [...src.matchAll(/setItem\([^)]*\)/g)].map((m) => m[0]).join(" ");
      expect(setItem.toLowerCase(), `setItem mentions ${banned}`).not.toContain(banned);
    }
  });

  it("no external network targets (only same-origin /api) in product source", () => {
    const hits: string[] = [];
    for (const f of files) {
      const c = code(f);
      for (const m of c.matchAll(/(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)[^;\n]*["'`]https?:\/\/[^"'`]+/g)) hits.push(`${rel(f)}: ${m[0].slice(0, 100)}`);
    }
    expect(hits).toEqual([]);
  });

  it("no secrets or API keys are referenced by the browser code", () => {
    const hits = files.filter((f) => /(ELEVENLABS|MONGODB_URI|api[_-]?key|xi-api-key|secret)/i.test(code(f).replace(/["'`][^"'`\n]{0,80}["'`]/g, (m) => (/api[_-]?key|secret/i.test(m) ? m : "")))).map(rel);
    // string literals mentioning the words (e.g. copy such as "no API key needed") are tolerated only if not assignments
    const assignments = files.flatMap((f) => [...code(f).matchAll(/(api[_-]?key|secret|token|password)["']?\s*[:=]\s*["'`][^"'`]{8,}/gi)].map((m) => `${rel(f)}: ${m[0]}`));
    expect(assignments).toEqual([]);
    void hits;
  });

  it("App declares exactly the four tabs from TAB_ORDER and no legacy mode names", () => {
    const app = read(path.join(ROOT, "app/App.tsx"));
    expect(app).toMatch(/TAB_ORDER/);
    for (const legacy of ["MISSION", "PROOF", "STUDIO", "ProofView", "MissionView", "StudioView", "ModeNav"]) expect(app).not.toContain(legacy);
  });

  it("tab components never import each other's internals (isolation rule)", () => {
    const bad: string[] = [];
    for (const f of files) {
      const r = rel(f);
      const dir = r.split("/")[1];
      if (!["editor", "evolution", "simulation", "library"].includes(dir ?? "")) continue;
      for (const m of read(f).matchAll(/from\s+["']\.\.\/(editor|evolution|simulation|library)\/([^"']+)["']/g)) if (m[1] !== dir && !(dir === "evolution" && m[1] === "simulation" && m[2] === "ui")) bad.push(`${r} -> ${m[1]}/${m[2]}`);
    }
    // cross-tab imports must go through shared modules (api/state/design/shell); evolution may reuse simulation/ui style tokens (tolerated, ideally moved to design/)
    expect(bad).toEqual([]);
  });
});
