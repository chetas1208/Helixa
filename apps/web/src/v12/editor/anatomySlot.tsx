/**
 * Isolated body mount for the Genome Editor scene.
 * AnatomyStage is rendered here (and only here — not from SceneHost).
 * If Agent 1's export regresses, swap this file back to BodyFigure.
 */
import { forwardRef } from "react";
import type { MutableRefObject } from "react";
import * as THREE from "three";
import { AnatomyStage } from "@/features/anatomy";
import type { AnatomyQuality } from "@/features/anatomy";
import { BodyFigure } from "./BodyFigure";
import type { FadeSetter } from "./BodyFigure";

export { BodyPedestal } from "./BodyFigure";

export const ANATOMY_STAGE_AVAILABLE = true;

export interface AnatomyRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AnatomyBodyProps {
  fadeRef?: FadeSetter;
  reducedMotion?: boolean;
  pulseRef?: MutableRefObject<number>;
  rect?: AnatomyRect;
  quality?: AnatomyQuality | string;
}

function asQuality(q?: string): AnatomyQuality {
  return q === "low" || q === "high" || q === "balanced" ? q : "balanced";
}

export const AnatomyBody = forwardRef<THREE.Group, AnatomyBodyProps>(function AnatomyBody(
  { fadeRef: _fadeRef, reducedMotion, pulseRef, rect, quality },
  ref,
) {
  const r = rect && rect.width > 8 && rect.height > 8 ? rect : { x: 0, y: 0, width: 420, height: 640 };
  return (
    <group ref={ref} name="anatomy-slot">
      <AnatomyStage rect={r} quality={asQuality(quality)} reducedMotion={!!reducedMotion} pulseRef={pulseRef} />
    </group>
  );
});

export function useAnatomySlotAvailable(): boolean {
  return ANATOMY_STAGE_AVAILABLE;
}

/** Kept for the isolated one-import fallback. */
export { BodyFigure };
