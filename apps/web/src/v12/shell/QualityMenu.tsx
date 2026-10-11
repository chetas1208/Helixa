import { useEffect, useId, useRef, useState } from "react";
import { Gauge } from "lucide-react";
import { useSession } from "../state/session";
import { useRenderPrefs, useRenderSettings } from "./renderPrefs";
import type { MotionPref, QualityPref } from "./renderPrefs";

const QUALITY: { id: QualityPref; label: string; hint: string }[] = [
  { id: "auto", label: "Auto", hint: "Match this device" },
  { id: "low", label: "Low power", hint: "30 fps cap, 1x pixels" },
  { id: "balanced", label: "Balanced", hint: "Up to 1.5x pixels" },
  { id: "high", label: "High", hint: "Up to 2x pixels" },
];
const MOTION: { id: MotionPref; label: string }[] = [
  { id: "system", label: "Follow system" },
  { id: "reduce", label: "Reduce motion" },
];

function Radio<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: { id: T; label: string; hint?: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={name} className="grid gap-1">
      {options.map((o) => {
        const checked = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onChange(o.id)}
            className={`flex items-center justify-between gap-3 rounded-control border px-2.5 py-1.5 text-left text-sm transition-colors duration-fast ${
              checked ? "border-glacier/45 bg-glacier/10 text-fg" : "border-transparent text-fg-2 hover:bg-ink-700/60"
            }`}
          >
            <span className="flex items-center gap-2">
              <span aria-hidden className={`grid h-3.5 w-3.5 place-items-center rounded-full border ${checked ? "border-glacier" : "border-fg-3"}`}>
                {checked && <span className="h-1.5 w-1.5 rounded-full bg-glacier" />}
              </span>
              {o.label}
            </span>
            {o.hint && <span className="text-xs text-fg-3">{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Rendering quality + motion preference. A disclosure (not a modal): Escape / outside click closes. */
export function QualityMenu() {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const qualityPref = useRenderPrefs((s) => s.qualityPref);
  const motionPref = useRenderPrefs((s) => s.motionPref);
  const setQualityPref = useRenderPrefs((s) => s.setQualityPref);
  const setMotionPref = useRenderPrefs((s) => s.setMotionPref);
  const webgl = useRenderPrefs((s) => s.webgl);
  const retryWebgl = useRenderPrefs((s) => s.retryWebgl);
  const settings = useRenderSettings();
  const reduced = useSession((s) => s.reducedMotion);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        root.current?.querySelector<HTMLButtonElement>("button[aria-haspopup]")?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const tierName = settings.tier === "low" ? "low power" : settings.tier;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`Display quality and motion (${tierName}${reduced ? ", reduced motion" : ""})`}
        title={`Display: ${tierName}${reduced ? ", reduced motion" : ""}`}
        onClick={() => setOpen((v) => !v)}
        className="btn-quiet grid h-9 w-9 place-items-center rounded-control"
      >
        <Gauge aria-hidden className="h-[1.125rem] w-[1.125rem]" />
      </button>
      {open && (
        <div id={id} role="group" aria-label="Display settings" className="glass-solid absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[min(19rem,calc(100vw-1.5rem))] space-y-4 p-3.5">
          <div>
            <p className="mb-1.5 text-sm font-semibold text-fg">Graphics quality</p>
            <Radio name="Graphics quality" value={qualityPref} options={QUALITY} onChange={setQualityPref} />
            <p className="mt-1.5 text-xs text-fg-3">
              Now rendering at <strong className="text-fg-2">{tierName}</strong>
              {settings.fpsCap ? `, capped at ${settings.fpsCap} fps` : ""}. The 3D scene pauses when this tab is hidden.
            </p>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-semibold text-fg">Motion</p>
            <Radio name="Motion" value={motionPref} options={MOTION} onChange={setMotionPref} />
            {reduced && <p className="mt-1.5 text-xs text-fg-3">Reduced motion is on: rotation is held still and transitions are instant.</p>}
          </div>
          <p className="hairline border-t pt-2.5 text-xs text-fg-3">
            3D renderer:{" "}
            <span className="text-fg-2">
              {webgl === "ok" ? "WebGL running" : webgl === "checking" ? "starting" : webgl === "lost" ? "context lost (2D fallback)" : "unavailable (2D fallback)"}
            </span>
            {webgl !== "ok" && webgl !== "checking" && (
              <button type="button" onClick={retryWebgl} className="btn mt-2 !min-h-8 w-full text-xs">
                Retry 3D
              </button>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
