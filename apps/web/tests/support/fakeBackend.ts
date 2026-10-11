/**
 * In-memory FAKE of the /api/v10 backend contract used by (a) vitest hook/component tests and
 * (b) the Playwright MOCKED project (via page.route). It mirrors the real status codes/shapes that were
 * observed against the live FastAPI service on 2026-10-11 (see docs/frontend/V12_TEST_RESULTS.md):
 *   - proposals: 400 "alt must be one of A, C, G, T", 400 "position N is outside 1..117500", 422 FastAPI validation
 *   - commit: 409 "revision_counter is X, not Y"; simulations: 409 over the 2000-generation budget
 *   - alt equal to the workspace's current allele -> status REJECTED; differing from baseline REF -> NEEDS_REVIEW
 * Everything it returns is test data. It must never be used to label anything "live".
 * Pure TypeScript: no vitest/playwright imports, so both runners can load it.
 */
import type { Simulation, SimulationFrame, Workspace, Revision, Proposal, Intelligence } from "../../src/v12/types";

export interface FakeCall {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
  status: number;
}
export interface FakeResult {
  status: number;
  json: unknown;
  /** artificial latency before responding, honoured by the Playwright adapter */
  delayMs: number;
  /** network-level failure (connection refused) */
  abort?: boolean;
}
export interface FakeOptions {
  /** every request fails at network level */
  down?: boolean;
  /** latency per request in ms */
  delayMs?: number;
  /** per-path-prefix forced responses: first match wins */
  forced?: { match: RegExp; method?: string; status: number; json: unknown; times?: number }[];
  /** start with no workspaces and without auto-seeding one */
  empty?: boolean;
  harnesses?: unknown[];
  /** include `revisions` on GET /workspaces/{id} (the 2026-10-11 live backend omits it; older contract had it) */
  exposeRevisions?: boolean;
  /** hide the optional routes (lineage/rename/archive/simulation list) to test honest 'endpoint missing' states */
  noOptionalRoutes?: boolean;
}

const ROOT = "ref_synthetic_chr22";
const ASSEMBLY = "synthetic-chr22-educational";
const REF_LEN = 117_500;
const FIRST48 = "ACGTGCAGTGTAGCTAGCTAGCTGATCGATCGTAGCTAGCTAGCTGAC";
export const FAKE_BASELINE_48 = FIRST48;

export function refBase(pos1: number): string {
  if (pos1 <= 48) return FIRST48[pos1 - 1]!;
  let x = (pos1 * 2654435761) >>> 0;
  x ^= x >>> 13;
  return "ACGT"[x & 3]!;
}

function fakeSha(s: string): string {
  // deterministic 64-hex digest-shaped string. NOT cryptographic.
  let h1 = 0x811c9dc5;
  let out = "";
  for (let r = 0; r < 8; r++) {
    for (let i = 0; i < s.length; i++) {
      h1 ^= s.charCodeAt(i) + r;
      h1 = Math.imul(h1, 16777619) >>> 0;
    }
    out += h1.toString(16).padStart(8, "0");
  }
  return out;
}

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class FakeBackend {
  opts: FakeOptions;
  calls: FakeCall[] = [];
  workspaces: Workspace[] = [];
  activeId: string | null = null;
  proposals = new Map<string, Proposal>();
  sims = new Map<string, Simulation>();
  idem = new Map<string, Simulation>();
  private n = 0;
  private clock = Date.UTC(2026, 9, 11, 12, 0, 0);

  constructor(opts: FakeOptions = {}) {
    this.opts = opts;
    if (!opts.empty) this.createWorkspace("Studio workspace");
  }

  private id(prefix: string): string {
    this.n += 1;
    return `${prefix}-fake${String(this.n).padStart(4, "0")}`;
  }
  private now(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString().replace(/\.\d{3}Z$/, "+00:00");
  }

  private seqPreview(edits: { position: number; alt: string }[]): string {
    const arr = FIRST48.split("");
    for (const e of edits) if (e.position <= 48) arr[e.position - 1] = e.alt;
    return arr.join("");
  }

  private mkRevision(parent: Revision | null, edits: Revision["edits"]): Revision {
    return {
      genome_revision_id: this.id("rev"),
      parent_revision_id: parent?.genome_revision_id ?? null,
      edits,
      preview_1_48: this.seqPreview(edits),
      sequence_sha256: fakeSha(`${ROOT}:${JSON.stringify(edits)}`),
      harness_version_id: "harness-pche-baseline",
      created_at: this.now(),
    };
  }

  createWorkspace(name: string): Workspace {
    const rev = this.mkRevision(null, []);
    const ws: Workspace = {
      workspace_id: this.id("ws"),
      name,
      reference_asset_id: ROOT,
      assembly: ASSEMBLY,
      official_grch38: false,
      active_genome_revision_id: rev.genome_revision_id,
      active_harness_version_id: "harness-pche-baseline",
      revision_counter: 1,
      edit_count: 0,
      active_revision: rev,
      status: "ACTIVE",
      updated_at: this.now(),
      revisions: [rev],
      created_at: this.now(),
    };
    this.workspaces.push(ws);
    this.activeId = ws.workspace_id;
    return ws;
  }

  ws(id: string): Workspace | undefined {
    return this.workspaces.find((w) => w.workspace_id === id);
  }
  private summary(w: Workspace): Workspace {
    const { revisions: _r, ...rest } = w; // list view omits revisions
    void _r;
    return rest as Workspace;
  }

  /** Current allele at a position in the workspace's active revision. */
  currentAllele(w: Workspace, pos: number): string {
    let a = refBase(pos);
    for (const e of w.active_revision.edits) if (e.position === pos) a = e.alt;
    return a;
  }

  handle(method: string, rawPath: string, body?: unknown, headers: Record<string, string> = {}): FakeResult {
    const [path, qs = ""] = rawPath.split("?");
    const query = Object.fromEntries(new URLSearchParams(qs));
    const delayMs = this.opts.delayMs ?? 0;
    const done = (status: number, json: unknown, extra: Partial<FakeResult> = {}): FakeResult => {
      this.calls.push({ method, path: path!, query, body, headers, status });
      return { status, json, delayMs, ...extra };
    };
    if (this.opts.down) return done(0, null, { abort: true });
    for (const f of this.opts.forced ?? []) {
      if (f.match.test(path!) && (!f.method || f.method === method) && (f.times === undefined || f.times > 0)) {
        if (f.times !== undefined) f.times -= 1;
        return done(f.status, f.json);
      }
    }
    const V = "/api/v10";
    let m: RegExpMatchArray | null;

    if (method === "GET" && path === "/api/health")
      return done(200, { status: "HEALTHY", service: "diamond-genome-api", version: "0.5.0-fake", database: "CONNECTED", mode: "local" });
    if (method === "GET" && path === "/api/v16/research/status") {
      return done(200, {
        health: "not_configured",
        legacy_status: "NOT_CONFIGURED",
        verified: false,
        embedding_model: null,
        fast_model: null,
        rerank_model: null,
        base_host: "ai.mongodb.com",
        documents: 8,
        vector_search: { supported: false, active: false, reason: "not_probed" },
        disclaimer: "Retrieved passages are citations, not causation.",
        external_research_text: false,
      });
    }
    if (method === "POST" && path === "/api/v16/research/search") {
      return done(200, {
        tool: "search_research_evidence",
        untrusted: true,
        disclaimer: "Retrieved passages are citations, not causation.",
        status: "lexical_fallback",
        health: "not_configured",
        fallback_reason: "not_configured",
        citations: [{
          document_id: "doc-brca1",
          source_url: "https://www.ncbi.nlm.nih.gov/gene/672",
          title: "BRCA1 and DNA repair association",
          excerpt: "Association only. Not a body change.",
          evidence_type: "association",
          source_type: "official_database",
          provenance: "NCBI Gene, paraphrased",
          gene_ids: ["BRCA1"],
          untrusted: true,
        }],
        exact_matches: [],
        model: { embedding: null, embedding_version: null, rerank: null },
        persistence: "memory_only",
        raindrop_recorded: false,
        index: { mode: "lexical", vector_search_supported: false, vector_search_active: false },
      });
    }
    if (method === "GET" && path === "/api/fixtures") return done(200, { fixtures: [] });
    // live backend (services/api/app/routes/voice.py): speech-to-text is not configured -> HTTP 501
    if (method === "POST" && path === "/api/voice/transcribe")
      return done(501, { status: "NOT_CONFIGURED", provider: "elevenlabs", transcript: null });
    if (method === "GET" && path === "/api/harnesses") return done(200, { harnesses: this.opts.harnesses ?? [] });
    if (method === "GET" && (m = path!.match(/^\/api\/harnesses\/([^/]+)\/lineage$/)))
      return done(404, { detail: `Harness version '${m[1]}' not found` });

    if (method === "GET" && path === `${V}/genome/baselines`)
      return done(200, {
        reference_asset_id: ROOT,
        assembly: ASSEMBLY,
        contig: "chr22",
        length: REF_LEN,
        checksum_sha256: "fcd37f8e8e43f84f5b3af43e1161f422a5674d21815b814c7cc38688e3fdd430",
        official_grch38: false,
        license_note: "Local synthetic FASTA shipped with DIAMOND fixtures. Not an official GRCh38 download. No patient sequence.",
      });
    if (method === "GET" && path === `${V}/genome/window`) {
      const start = Number(query.start);
      const end = Number(query.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) return done(400, { detail: "invalid window" });
      if (end - start + 1 > 400) return done(400, { detail: "window is capped at 400 bases" });
      let bases = "";
      for (let p = start; p <= end; p++) bases += refBase(p);
      return done(200, {
        assembly: ASSEMBLY, contig: "chr22", start, end, bases, coordinate: "1-based inclusive",
        official_grch38: false, checksum_sha256: "fcd37f8e8e43f84f5b3af43e1161f422a5674d21815b814c7cc38688e3fdd430",
      });
    }
    if (method === "GET" && path === `${V}/genome/workspaces`)
      return done(200, { workspaces: this.workspaces.filter((w) => w.status !== "ARCHIVED").map((w) => this.summary(w)), active: this.activeId ? this.summary(this.ws(this.activeId)!) : null });
    if (method === "POST" && path === `${V}/genome/workspaces`) {
      const name = (body as { name?: string } | undefined)?.name ?? "";
      if (name.length < 1) return done(422, { detail: [{ type: "string_too_short", loc: ["body", "name"], msg: "String should have at least 1 character" }] });
      return done(200, this.summary(this.createWorkspace(name)));
    }
    if (method === "GET" && path === `${V}/genome/workspaces/active`) {
      if (!this.activeId) return done(404, { detail: "no active workspace" });
      return done(200, this.ws(this.activeId));
    }
    if ((m = path!.match(/^\/api\/v10\/genome\/workspaces\/([^/]+)(?:\/([a-z-]+))?$/))) {
      const w = this.ws(m[1]!);
      const sub = m[2];
      // a route that does not exist answers FastAPI's generic 404 before any workspace lookup
      const optionalRoute = (method === "PATCH" && !sub) || (method === "POST" && sub === "archive") || (method === "GET" && ["genome-lineage", "harness-lineage", "body-descriptor"].includes(sub ?? ""));
      if (this.opts.noOptionalRoutes && optionalRoute) return done(404, { detail: "Not Found" });
      if (!w) return done(404, { detail: `'${m[1]}'` });
      if (method === "GET" && !sub) return done(200, this.opts.exposeRevisions ? w : this.summary(w));
      const optional = !this.opts.noOptionalRoutes;
      if (method === "GET" && sub === "genome-lineage" && optional)
        return done(200, { workspace_id: w.workspace_id, kind: "GENOME_REVISION", nodes: (w.revisions ?? []).map((r) => ({ genome_revision_id: r.genome_revision_id, parent_revision_id: r.parent_revision_id, edit_count: r.edits.length, sequence_sha256: r.sequence_sha256 })) });
      if (method === "GET" && sub === "harness-lineage" && optional)
        return done(200, { workspace_id: w.workspace_id, kind: "ANALYSIS_HARNESS", distinct_from_genome: true, nodes: [{ harness_version_id: w.active_harness_version_id, parent_harness_version_id: null, note: "Existing analysis policy. A nucleotide edit does not create a harness version." }] });
      if (method === "GET" && sub === "body-descriptor" && optional)
        return done(200, { workspace_id: w.workspace_id, genome_revision_id: w.active_genome_revision_id, effect_class: "ILLUSTRATIVE", anatomy_changed: false, reason: "No evidence-backed genotype-to-anatomy map. The body stays a navigation drawing.", limitations: ["DIRECT_SEQUENCE edits do not change body geometry."] });
      if (method === "PATCH" && !sub && optional) {
        const nm = (body as { name?: string } | undefined)?.name ?? "";
        if (!nm) return done(422, { detail: [{ type: "string_too_short", loc: ["body", "name"], msg: "String should have at least 1 character" }] });
        w.name = nm;
        w.updated_at = this.now();
        return done(200, this.summary(w));
      }
      if (method === "POST" && sub === "archive" && optional) {
        w.status = "ARCHIVED";
        if (this.activeId === w.workspace_id) this.activeId = this.workspaces.find((x) => x.status !== "ARCHIVED")?.workspace_id ?? null;
        return done(200, this.summary(w));
      }
      if (method === "GET" && sub === "intelligence") {
        const intel: Intelligence = {
          workspace_id: w.workspace_id,
          genome_revision_id: w.active_genome_revision_id,
          harness_version_id: w.active_harness_version_id,
          same_identifier: w.edit_count === 0,
          what_changed: w.active_revision.edits,
          what_was_computed: "Fake: SHA-256 of the edited window recomputed.",
          hypothetical: "Fake: no phenotype or body-level effect is claimed.",
          harness_adapted: "Fake: harness version unchanged.",
          trust: "TEST DATA from FakeBackend",
          official_grch38: false,
        };
        return done(200, intel);
      }
      if (method === "POST" && sub === "select") {
        const ec = (body as { expected_counter?: number | null })?.expected_counter;
        if (ec != null && ec !== w.revision_counter) return done(409, { detail: `revision_counter is ${w.revision_counter}, not ${ec}` });
        this.activeId = w.workspace_id;
        return done(200, this.summary(w));
      }
      if (method === "POST" && sub === "branch") {
        const name = (body as { name?: string })?.name ?? "";
        if (!name) return done(422, { detail: [{ type: "string_too_short", loc: ["body", "name"], msg: "String should have at least 1 character" }] });
        const rev: Revision = { ...w.active_revision, genome_revision_id: this.id("rev"), parent_revision_id: w.active_revision.genome_revision_id, created_at: this.now() };
        const nw: Workspace = { ...w, workspace_id: this.id("ws"), name, active_genome_revision_id: rev.genome_revision_id, active_revision: rev, revisions: [...(w.revisions ?? []), rev], revision_counter: w.revision_counter + 1, updated_at: this.now() };
        this.workspaces.push(nw);
        this.activeId = nw.workspace_id;
        return done(200, this.summary(nw));
      }
      if (method === "POST" && sub === "proposals") {
        const b = (body ?? {}) as { position?: number; alt?: string; note?: string };
        if (typeof b.position !== "number" || b.position < 1)
          return done(422, { detail: [{ type: "greater_than_equal", loc: ["body", "position"], msg: "Input should be greater than or equal to 1" }] });
        if (!["A", "C", "G", "T"].includes(b.alt ?? "")) return done(400, { detail: "alt must be one of A, C, G, T" });
        if (b.position > REF_LEN) return done(400, { detail: `position ${b.position} is outside 1..${REF_LEN}` });
        const cur = this.currentAllele(w, b.position);
        const ref = refBase(b.position);
        let status = "READY";
        let reason = "";
        if (b.alt === cur) { status = "REJECTED"; reason = `alt equals the current allele ${cur}; nothing to change.`; }
        else if (cur !== ref) { status = "NEEDS_REVIEW"; reason = `baseline REF is ${ref}; the workspace currently has ${cur}. Commit confirms you mean to replace the current allele.`; }
        const p: Proposal = { proposal_id: this.id("prop"), workspace_id: w.workspace_id, assembly: ASSEMBLY, contig: "chr22", position: b.position, ref, current_allele: cur, alt: b.alt!, note: b.note ?? "", status, reason, applied: false };
        this.proposals.set(p.proposal_id, p);
        return done(200, p);
      }
      if (method === "POST" && sub === "commit") {
        const b = (body ?? {}) as { proposal_id?: string; expected_counter?: number };
        const p = this.proposals.get(b.proposal_id ?? "");
        if (!p || p.workspace_id !== w.workspace_id) return done(404, { detail: "'workspace or proposal'" });
        if (b.expected_counter !== w.revision_counter) return done(409, { detail: `revision_counter is ${w.revision_counter}, not ${b.expected_counter}` });
        if (p.status === "REJECTED") return done(400, { detail: `proposal rejected: ${p.reason}` });
        const edits = [...w.active_revision.edits.filter((e) => e.position !== p.position), { position: p.position, ref: p.ref, alt: p.alt, current_allele_at_commit: p.current_allele }];
        const rev = this.mkRevision(w.active_revision, edits);
        w.revisions = [...(w.revisions ?? []), rev];
        w.active_revision = rev;
        w.active_genome_revision_id = rev.genome_revision_id;
        w.revision_counter += 1;
        w.edit_count = edits.length;
        w.updated_at = this.now();
        p.applied = true;
        return done(200, this.summary(w));
      }
      return done(405, { detail: "Method Not Allowed" });
    }

    if (method === "GET" && path === `${V}/evolution/parameters`) return done(200, { parameters: FAKE_PARAMETERS });
    if (method === "GET" && path === `${V}/evolution/environments`)
      return done(200, { nasa_power: "NOT_CONFIGURED", presets: [
        { id: "temperate-forest-example", label: "Temperate forest (local example)", scope: "FICTIONAL_EDUCATIONAL", source: "HELIXA local catalog. Not a NASA POWER response and not a paleoclimate reconstruction.", values: { temperature_c: 12, precipitation_mm_year: 900, altitude_m: 180 } },
        { id: "arid-example", label: "Arid basin (local example)", scope: "FICTIONAL_EDUCATIONAL", source: "HELIXA local catalog. Assumed numbers, not a station record.", values: { temperature_c: 28, precipitation_mm_year: 150, altitude_m: 400 } },
      ] });
    if (method === "GET" && path === `${V}/evolution/simulations` && !this.opts.noOptionalRoutes) {
      const wid = query.workspace_id;
      return done(200, { simulations: [...this.sims.values()].filter((x) => !wid || x.workspace_id === wid).reverse() });
    }
    if (method === "GET" && (m = path!.match(/^\/api\/v10\/evolution\/simulations\/([^/]+)\/playback$/)) && !this.opts.noOptionalRoutes) {
      const sm = this.sims.get(m[1]!);
      return sm ? done(200, { simulation_id: sm.simulation_id, duration_seconds: sm.playback_seconds, simulated_years: sm.simulated_years, generations_executed: sm.generations_executed, result_sha256: sm.result_sha256, interpolation: "DISPLAY_ONLY", frames: sm.frames, science_unchanged_by_playback_duration: true }) : done(404, { detail: `'${m[1]}'` });
    }
    if (method === "POST" && path === `${V}/evolution/simulations`) return this.runSim((body ?? {}) as Record<string, unknown>, headers, done);
    if (method === "GET" && (m = path!.match(/^\/api\/v10\/evolution\/simulations\/([^/]+)$/))) {
      const s = this.sims.get(m[1]!);
      return s ? done(200, s) : done(404, { detail: `'${m[1]}'` });
    }
    return done(404, { detail: "Not Found" });
  }

  private runSim(b: Record<string, unknown>, headers: Record<string, string>, done: (s: number, j: unknown) => FakeResult): FakeResult {
    const key = headers["idempotency-key"] ?? headers["Idempotency-Key"];
    if (key && this.idem.has(key)) return done(200, this.idem.get(key));
    const wsId = String(b.workspace_id ?? this.activeId ?? "");
    const w = this.ws(wsId);
    if (!w) return done(404, { detail: `'${wsId}'` });
    const horizon = Number(b.horizon_years);
    const gt = Number(b.generation_time_years);
    const gens = Math.floor(horizon / gt);
    if (!(gt > 0) || !(horizon > 0)) return done(422, { detail: "horizon and generation time must be positive" });
    if (gens > 2000)
      return done(409, { detail: `${horizon.toExponential(0)} years at ${gt} years/generation is ${gens} generations. The budget is 2000 generations (${2000 * gt} model years). Narrow the horizon or lengthen the declared generation time. Generations are not skipped silently.` });
    const N = Number(b.population_size);
    const sCoef = Number(b.selection_coefficient);
    const mu = Number(b.mutation_forward);
    const seed = Number(b.seed);
    const rng = mulberry32(seed * 7919 + 13);
    let p = Number(b.initial_frequency);
    let pop = N;
    const all: SimulationFrame[] = [{ generation: 0, simulated_years: 0, allele_frequency: p, population_size: pop, extinct: false, interpolated: false }];
    for (let g = 1; g <= gens; g++) {
      if (pop === 0) { all.push({ generation: g, simulated_years: g * gt, allele_frequency: 0, population_size: 0, extinct: true, interpolated: false }); continue; }
      const wbar = p * (1 + sCoef) + (1 - p);
      let ps = (p * (1 + sCoef)) / wbar;
      ps = ps + (1 - ps) * mu;
      p = Math.min(1, Math.max(0, ps + Math.sqrt((p * (1 - p)) / N) * gauss(rng)));
      p = Math.round(p * N) / N;
      all.push({ generation: g, simulated_years: g * gt, allele_frequency: p, population_size: pop, extinct: false, interpolated: false });
    }
    const keep = 240;
    const frames = all.length <= keep ? all : Array.from({ length: keep }, (_, i) => all[Math.round((i * (all.length - 1)) / (keep - 1))]!);
    const sim: Simulation = {
      simulation_id: this.id("sim"),
      workspace_id: w.workspace_id,
      genome_revision_id: w.active_genome_revision_id,
      harness_version_id: w.active_harness_version_id,
      playback_seconds: 60,
      engine: "wright_fisher",
      engine_version: "fake-haploid-1",
      fidelity: "TIER_A_EXACT_GENERATIONS",
      fitness_class: String(b.fitness_class ?? "USER_ASSUMED"),
      fitness_note: "TEST DATA: user-assumed coefficient, not an empirical measurement",
      fitness_focal: 1 + sCoef,
      fitness_other: 1,
      environment_effects: {},
      seed,
      generations_executed: gens,
      generation_time_years: gt,
      simulated_years: horizon,
      population_size: N,
      ploidy: Number(b.ploidy ?? 1),
      recombination: "NOT_MODELED",
      limitations: ["TEST DATA from FakeBackend. One haploid biallelic locus. Not a whole genome and not a human body.", "Environment values are stored and marked NOT_MODELED."],
      frames,
      result_sha256: fakeSha(JSON.stringify(frames) + seed),
      narrative: "TEST DATA narrative.",
    };
    this.sims.set(sim.simulation_id, sim);
    if (key) this.idem.set(key, sim);
    return done(200, sim);
  }
}

export const FAKE_PARAMETERS = [
  { id: "temperature_c", category: "Climate", label: "Mean temperature", unit: "C", default: 12, minimum: -20, maximum: 45, model_effect: "NOT_MODELED", effect_status: "NOT_MODELED", observed_or_assumed: "ASSUMED", scientific_source: "User or HELIXA educational catalog.", help_text: "Shown for context. It does not change allele counts." },
  { id: "precipitation_mm_year", category: "Climate", label: "Annual precipitation", unit: "mm/year", default: 900, minimum: 0, maximum: 5000, model_effect: "NOT_MODELED", effect_status: "NOT_MODELED", observed_or_assumed: "ASSUMED", scientific_source: "User or HELIXA educational catalog.", help_text: "Shown for context. It does not change allele counts." },
  { id: "altitude_m", category: "Terrain", label: "Altitude", unit: "m", default: 180, minimum: 0, maximum: 5000, model_effect: "NOT_MODELED", effect_status: "NOT_MODELED", observed_or_assumed: "ASSUMED", scientific_source: "User or HELIXA educational catalog.", help_text: "Shown for context. It does not change allele counts." },
  { id: "selection_coefficient", category: "Population", label: "Selection coefficient", unit: "", default: 0.01, minimum: -0.5, maximum: 0.5, model_effect: "ACTIVE_MODELED", effect_status: "ACTIVE_MODELED", observed_or_assumed: "ASSUMED", scientific_source: "User assumption.", help_text: "Relative fitness advantage of the focal allele." },
  { id: "population_size", category: "Population", label: "Population size", unit: "individuals", default: 1000, minimum: 10, maximum: 100000, model_effect: "ACTIVE_MODELED", effect_status: "ACTIVE_MODELED", observed_or_assumed: "ASSUMED", scientific_source: "User assumption.", help_text: "Haploid Wright-Fisher population size." },
  { id: "mutation_forward", category: "Population", label: "Forward mutation rate", unit: "per generation", default: 1e-5, minimum: 0, maximum: 0.01, model_effect: "ACTIVE_MODELED", effect_status: "ACTIVE_MODELED", observed_or_assumed: "ASSUMED", scientific_source: "User assumption.", help_text: "Probability per generation." },
  { id: "migration_rate", category: "Population", label: "Migration rate", unit: "per generation", default: 0, minimum: 0, maximum: 1, model_effect: "ACTIVE_MODELED", effect_status: "ACTIVE_MODELED", observed_or_assumed: "ASSUMED", scientific_source: "User assumption.", help_text: "Fraction replaced by migrants." },
];

/** Standard simulation request used across tests. */
export function simRequest(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    workspace_id: null, horizon_years: 2_000_000, generation_time_years: 1000, population_size: 1000, initial_frequency: 0.1,
    selection_coefficient: 0.01, mutation_forward: 1e-5, migration_rate: 0, migrant_frequency: 0, seed: 1,
    fitness_class: "USER_ASSUMED", ploidy: 1, ...over,
  };
}
