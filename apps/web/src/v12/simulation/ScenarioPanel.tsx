import { useId } from "react";
import { SIM_GENERATION_BUDGET } from "../types";
import type { EnvironmentPreset, ParameterSpec } from "../types";
import { EvidenceBadge } from "../design/EvidenceBadge";
import { Disclosure } from "./Disclosure";
import { HORIZON_CHOICES, FITNESS_CLASSES, SOFT_RANGE, budgetCheck, minGenerationTime } from "./scenario";
import type { ScenarioDraft } from "./scenario";
import { fmtInt, fmtYears } from "./runData";
import { btn, btnPrimary, chip, focusRing, input, muted } from "./ui";

interface FieldProps {
  id: string;
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  soft?: { min: number; max: number; step: number };
  help?: string;
  onChange: (v: number) => void;
  disabled?: boolean;
}

function NumberField({ id, label, unit, value, min, max, soft, help, onChange, disabled }: FieldProps) {
  const uid = useId();
  const clampSoft = (v: number) => (soft ? Math.min(soft.max, Math.max(soft.min, v)) : v);
  return (
    <div className="space-y-1" data-param={id}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={`${uid}-n`} className="text-[13px] text-slate-100">{label}</label>
        <span className="text-xs text-slate-300">{unit}</span>
      </div>
      <div className="flex items-center gap-2">
        {soft && (
          <input
            type="range"
            aria-label={`${label} slider`}
            min={soft.min}
            max={soft.max}
            step={soft.step}
            value={clampSoft(value)}
            disabled={disabled}
            onChange={(e) => onChange(Number(e.target.value))}
            className={`h-6 min-w-0 flex-1 accent-cyan-300 ${focusRing}`}
          />
        )}
        <input
          id={`${uid}-n`}
          type="number"
          className={`${input} ${soft ? "w-24" : "w-full"}`}
          min={min}
          max={max}
          step="any"
          value={Number.isFinite(value) ? value : ""}
          disabled={disabled}
          onChange={(e) => e.target.value !== "" && onChange(Math.min(max, Math.max(min, Number(e.target.value))))}
        />
      </div>
      {help && <p className="truncate text-xs text-slate-300" title={help}>{help}</p>}
    </div>
  );
}

const fmtNum = (v: number) => (Math.abs(v) >= 1000 ? fmtInt(v) : `${+v.toPrecision(3)}`);

interface Props {
  draft: ScenarioDraft;
  specs: ParameterSpec[];
  presets: EnvironmentPreset[];
  disabled: boolean;
  pending: boolean;
  revisionLabel: string;
  onPatch: (p: Partial<ScenarioDraft>) => void;
  onReset: () => void;
  onRun: () => void;
}

const MODELED_FIELDS = ["population_size", "initial_frequency", "selection_coefficient", "mutation_forward", "migration_rate"] as const;
const CONTEXT_FIELDS = ["temperature_c", "precipitation_mm_year", "altitude_m"] as const;

export function ScenarioPanel({ draft, specs, presets, disabled, pending, revisionLabel, onPatch, onReset, onRun }: Props) {
  const spec = (id: string) => specs.find((s) => s.id === id);
  const bc = budgetCheck(draft);
  const modeled = specs.filter((s) => s.effect_status === "ACTIVE_MODELED");
  const context = specs.filter((s) => s.effect_status === "NOT_MODELED");

  const modeledHelps = [...new Set(modeled.map((s) => s.help_text))];
  const sharedHelp = modeled.length > 1 && modeledHelps.length === 1 ? modeledHelps[0] : null;
  const field = (id: (typeof MODELED_FIELDS)[number]) => {
    const s = spec(id);
    return (
      <NumberField
        key={id}
        id={id}
        label={s?.label ?? id}
        unit={s?.unit ?? ""}
        value={draft[id]}
        min={s?.minimum ?? 0}
        max={s?.maximum ?? 1}
        soft={SOFT_RANGE[id]}
        help={sharedHelp ? undefined : s?.help_text}
        onChange={(v) => onPatch({ [id]: v })}
      />
    );
  };
  const presetSel = presets.find((p) => p.id === draft.presetId);
  const contextHint = `${fmtNum(draft.temperature_c)} °C · ${fmtNum(draft.precipitation_mm_year)} mm/y · ${fmtNum(draft.altitude_m)} m`;
  const modelHint = `N ${fmtInt(draft.population_size)} · p₀ ${fmtNum(draft.initial_frequency)} · s ${fmtNum(draft.selection_coefficient)}`;
  const seedHint = draft.replicates > 1 ? `seeds ${draft.seed} to ${draft.seed + draft.replicates - 1}` : `seed ${draft.seed} · 1 run`;

  return (
    <form
      className="flex min-h-full flex-col"
      aria-label="Scenario draft"
      onSubmit={(e) => {
        e.preventDefault();
        if (bc.ok) onRun();
      }}
    >
      <div className="flex-1 space-y-2 p-4 pb-3">
        <Disclosure title="Time" hint={`${fmtYears(draft.horizon_years)} · ${fmtInt(draft.generation_time_years)} y/gen`} defaultOpen>
          <div role="group" aria-label="Horizon choices" className="flex flex-wrap gap-1.5">
            {HORIZON_CHOICES.map((h) => (
              <button key={h} type="button" className={chip(draft.horizon_years === h)} aria-pressed={draft.horizon_years === h} onClick={() => onPatch({ horizon_years: h })}>
                {fmtYears(h)}
              </button>
            ))}
          </div>
          <NumberField
            id="horizon_years"
            label="Simulated horizon"
            unit="years"
            value={draft.horizon_years}
            min={spec("horizon_years")?.minimum ?? 0}
            max={spec("horizon_years")?.maximum ?? 2_000_000}
            onChange={(v) => onPatch({ horizon_years: v })}
          />
          <NumberField
            id="generation_time_years"
            label="Generation time (declared assumption)"
            unit="y / generation"
            value={draft.generation_time_years}
            min={spec("generation_time_years")?.minimum ?? 1}
            max={spec("generation_time_years")?.maximum ?? 100000}
            onChange={(v) => onPatch({ generation_time_years: v })}
          />
          <div className="space-y-0.5" data-testid="gen-hint">
            <p className={`font-mono text-xs ${bc.ok ? "text-slate-100" : "text-amber-200"}`} role={bc.ok ? undefined : "alert"}>
              {fmtInt(draft.generation_time_years)} y/generation: {fmtInt(bc.generations)} generations{bc.ok ? "" : ` (budget ${fmtInt(SIM_GENERATION_BUDGET)})`}
            </p>
            <details className="text-xs text-slate-300">
              <summary className={`cursor-pointer list-none rounded ${focusRing}`}>
                {fmtYears(draft.horizon_years)} needs at least {fmtInt(Math.ceil(minGenerationTime(draft.horizon_years)))} y/gen · <span className="text-cyan-200 underline-offset-2 hover:underline">Why?</span>
              </summary>
              <p className="mt-1 leading-relaxed">
                The engine runs at most {fmtInt(SIM_GENERATION_BUDGET)} generations per run, so the minimum generation time is horizon / {fmtInt(SIM_GENERATION_BUDGET)} ={" "}
                <span className="font-mono">{fmtInt(minGenerationTime(draft.horizon_years))} y</span>. At 2,000,000 years that is at least 1,000 y per generation. It is an assumption you declare, not a
                measured human generation time (about 25 y). Frames are never skipped silently.
              </p>
            </details>
          </div>
          {!bc.ok && (
            <button type="button" className={btn} onClick={() => onPatch({ generation_time_years: Math.ceil(bc.minGenerationTime) })}>
              Set to minimum ({fmtInt(Math.ceil(bc.minGenerationTime))} y/gen)
            </button>
          )}
        </Disclosure>

        <Disclosure
          title={
            <span className="flex items-center gap-2">
              Model inputs
              <span className="rounded-full border border-emerald-300/40 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-normal text-emerald-100">Supported (wired to model)</span>
            </span>
          }
          hint={modelHint}
          defaultOpen
        >
          {modeled.length === 0 && <p className={muted}>Parameter catalog not loaded.</p>}
          {sharedHelp && <p className="truncate text-xs text-slate-300" title={sharedHelp}>Catalog note for each input: {sharedHelp}</p>}
          {MODELED_FIELDS.map((id) => (modeled.length === 0 || spec(id) ? field(id) : null))}
          <NumberField
            id="migrant_frequency"
            label="Migrant allele frequency"
            unit="fraction"
            value={draft.migrant_frequency}
            min={0}
            max={1}
            soft={SOFT_RANGE.migrant_frequency}
            help="Request field of the same Wright-Fisher step; matters only when migration rate > 0."
            onChange={(v) => onPatch({ migrant_frequency: v })}
          />
          <div className="space-y-1">
            <label htmlFor="fitness-class" className="text-[13px] text-slate-100">Fitness class</label>
            <select id="fitness-class" className={`${input} w-full`} value={draft.fitness_class} onChange={(e) => onPatch({ fitness_class: e.target.value })}>
              {FITNESS_CLASSES.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
            <p className="truncate text-xs text-slate-300" title={`${FITNESS_CLASSES.find((f) => f.id === draft.fitness_class)?.note ?? ""} Climate is never converted into fitness.`}>
              {FITNESS_CLASSES.find((f) => f.id === draft.fitness_class)?.note}
            </p>
          </div>
        </Disclosure>

        <Disclosure
          title={
            <span className="flex items-center gap-2">
              Environment
              <span className="rounded-full border border-slate-400/40 bg-slate-400/10 px-2 py-0.5 text-[11px] font-normal text-slate-200">Exploratory / not supported</span>
            </span>
          }
          hint={<span title={contextHint}>does not change allele counts</span>}
        >
          <p className={muted}>Stored with the run as context ({contextHint}); it only tints the scene lighting.</p>
          {presets.length > 0 && (
            <div className="space-y-1">
              <label htmlFor="env-preset" className="text-[13px] text-slate-100">Preset (fictional / educational)</label>
              <select
                id="env-preset"
                className={`${input} w-full`}
                value={draft.presetId ?? ""}
                onChange={(e) => {
                  const p = presets.find((x) => x.id === e.target.value);
                  onPatch(p ? { presetId: p.id, temperature_c: p.values.temperature_c ?? draft.temperature_c, precipitation_mm_year: p.values.precipitation_mm_year ?? draft.precipitation_mm_year, altitude_m: p.values.altitude_m ?? draft.altitude_m } : { presetId: null });
                }}
              >
                <option value="">Custom values</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              {presetSel && (
                <p className="truncate text-xs text-slate-300" title={`Source: ${presetSel.source}`}>
                  {presetSel.scope.replace(/_/g, " ").toLowerCase()} · source: {presetSel.source}
                </p>
              )}
            </div>
          )}
          {CONTEXT_FIELDS.map((id) => {
            const s = spec(id);
            return (
              <NumberField
                key={id}
                id={id}
                label={s?.label ?? id}
                unit={s?.unit ?? ""}
                value={draft[id]}
                min={s?.minimum ?? -1000}
                max={s?.maximum ?? 10000}
                soft={{ min: s?.minimum ?? -20, max: s?.maximum ?? 100, step: (((s?.maximum ?? 100) - (s?.minimum ?? 0)) / 200) || 1 }}
                onChange={(v) => onPatch({ [id]: v, presetId: null })}
              />
            );
          })}
          {context.filter((s) => !(CONTEXT_FIELDS as readonly string[]).includes(s.id)).map((s) => (
            <p key={s.id} className="truncate text-xs text-slate-300" title={s.help_text}>
              <strong className="text-slate-100">{s.label}</strong> ({s.unit}): NOT_MODELED, not sent.
            </p>
          ))}
        </Disclosure>

        <Disclosure title="Seed and replicates" hint={seedHint} defaultOpen>
          <div className="grid grid-cols-2 gap-3">
            <NumberField id="seed" label="Seed" unit="integer" value={draft.seed} min={0} max={2_147_483_647} onChange={(v) => onPatch({ seed: Math.round(v) })} />
            <NumberField id="replicates" label="Replicates" unit="1 to 8" value={draft.replicates} min={1} max={8} onChange={(v) => onPatch({ replicates: Math.round(v) })} />
          </div>
          <p className="truncate text-xs text-slate-300" title="Replicates are client-orchestrated: separate backend requests with consecutive seeds. Each is a real, independent result.">
            Client-orchestrated: {draft.replicates} real request{draft.replicates > 1 ? "s" : ""}, consecutive seeds.
          </p>
        </Disclosure>
      </div>

      <div className="sticky bottom-0 z-10 space-y-1.5 border-t border-white/10 bg-[#080d18] px-4 py-3">
        <div className="flex gap-2">
          <button type="submit" className={`${btnPrimary} flex-1`} disabled={disabled || pending || !bc.ok} aria-describedby={!bc.ok ? "run-blocked" : undefined}>
            {pending ? "Waiting for the engine..." : draft.replicates > 1 ? `Run simulation (${draft.replicates} replicates)` : "Run simulation"}
          </button>
          <button type="button" className={btn} onClick={onReset} disabled={pending}>Reset</button>
        </div>
        {!bc.ok && (
          <p id="run-blocked" className="text-xs text-amber-200">
            Run disabled: {fmtInt(bc.generations)} generations exceeds the {fmtInt(SIM_GENERATION_BUDGET)}-generation budget.
          </p>
        )}
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-300">
          <EvidenceBadge kind="HYPOTHESIS" label="Draft (editing)" />
          <span className="min-w-0 truncate">nothing computed until you run · genome <span className="font-mono text-slate-100">{revisionLabel}</span></span>
        </p>
      </div>
    </form>
  );
}
