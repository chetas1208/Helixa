import { useLayoutEffect } from "react";
import { useSession } from "../state/session";
import { useRenderPrefs } from "./renderPrefs";
import { useMediaQuery } from "./useMediaQuery";

/**
 * Effective reduced motion = OS preference OR explicit "Reduce motion" choice.
 * Mirrors into useSession.reducedMotion (read by scenes without React context) and
 * <html data-motion="reduce|full"> (read by CSS).
 */
export function useReducedMotionSync() {
  const os = useMediaQuery("(prefers-reduced-motion: reduce)");
  const pref = useRenderPrefs((s) => s.motionPref);
  const setReducedMotion = useSession((s) => s.setReducedMotion);
  useLayoutEffect(() => {
    const reduce = os || pref === "reduce";
    setReducedMotion(reduce);
    document.documentElement.dataset.motion = reduce ? "reduce" : "full";
  }, [os, pref, setReducedMotion]);
}
