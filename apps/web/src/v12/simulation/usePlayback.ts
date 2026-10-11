import { useEffect, useRef, useState } from "react";
import { PlaybackController } from "./playbackClock";
import type { PlaybackSnapshot } from "./playbackClock";
import { liveClock } from "./earthSceneStore";

/**
 * Owns one PlaybackController per selected run. The controller is the single clock: it writes the mutable
 * `liveClock` every animation frame (read by the 3D scene without React) and publishes a THROTTLED React
 * snapshot (about 15 Hz while playing, immediately on any discrete change) for the DOM readouts.
 */
export function usePlayback(runKey: string | null, playbackS: number, horizonYears: number) {
  const ref = useRef<PlaybackController | null>(null);
  if (!ref.current) ref.current = new PlaybackController(playbackS, horizonYears);
  const controller = ref.current;
  const [snap, setSnap] = useState<PlaybackSnapshot>(controller.snapshot());

  // Reconfigure and restart when the selected run changes (never carry a playhead across runs).
  useEffect(() => {
    controller.pause();
    controller.configure(playbackS, horizonYears);
    controller.seekElapsed(0);
    liveClock.visibleYear = 0;
    liveClock.playing = false;
    setSnap(controller.snapshot());
  }, [controller, runKey, playbackS, horizonYears]);

  useEffect(() => {
    let lastSet = 0;
    const off = controller.subscribe((s) => {
      liveClock.visibleYear = s.visibleYear;
      liveClock.playing = s.playing;
      const t = performance.now();
      if (!s.playing || s.ended || t - lastSet > 66) {
        lastSet = t;
        setSnap(s);
      }
    });
    const onVis = () => (document.hidden ? controller.suspendWallClock() : controller.resumeWallClock());
    document.addEventListener("visibilitychange", onVis);
    return () => {
      off();
      document.removeEventListener("visibilitychange", onVis);
      controller.pause();
      liveClock.playing = false;
    };
  }, [controller]);

  return { controller, snap };
}
