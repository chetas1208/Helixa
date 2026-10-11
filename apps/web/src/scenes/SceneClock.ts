/**
 * Deterministic injectable time clock for the revolving DNA scene.
 * Clock is based on elapsed real-world seconds, not frame rate or delta accumulation,
 * ensuring frame-rate independence and exact state convergence on reload.
 */

export interface SceneVisualParams {
  cycleIndex: number;
  phase: number; // 0.0 to 1.0 within 300s
  rotationAngle: number;
  radius: number;
  pitch: number;
  backboneThickness: number;
  emissiveIntensity: number;
  primaryColor: string;
  secondaryColor: string;
  styleName: string;
}

const STYLES = [
  { name: "Molecular Glass", primary: "#00f0ff", secondary: "#0070f3", radius: 1.2, pitch: 0.8, emissive: 0.4 },
  { name: "Luminous Strand", primary: "#a855f7", secondary: "#ec4899", radius: 1.3, pitch: 0.9, emissive: 0.6 },
  { name: "Scientific Wireframe", primary: "#10b981", secondary: "#06b6d4", radius: 1.1, pitch: 0.75, emissive: 0.35 },
  { name: "Chromatin Abstraction", primary: "#f59e0b", secondary: "#ef4444", radius: 1.4, pitch: 0.85, emissive: 0.5 },
  { name: "Bioluminescent Deep", primary: "#38bdf8", secondary: "#818cf8", radius: 1.25, pitch: 0.8, emissive: 0.65 },
];

export class SceneClock {
  private static manualOverrideSeconds: number | null = null;
  private static epoch: number = 1776000000; // stable reference epoch
  private static cycleDuration: number = 300.0; // 300s = 5 minutes
  private static rotationSpeed: number = 0.15; // rad per second

  public static setManualTime(seconds: number | null) {
    this.manualOverrideSeconds = seconds;
  }

  public static getElapsedSeconds(): number {
    if (this.manualOverrideSeconds !== null) {
      return this.manualOverrideSeconds;
    }
    const now = Date.now() / 1000;
    return Math.max(0, now - this.epoch);
  }

  public static computeVisualParams(elapsedSeconds?: number): SceneVisualParams {
    const elapsed = elapsedSeconds !== undefined ? elapsedSeconds : this.getElapsedSeconds();
    const cycleDuration = this.cycleDuration;
    const cycleIndex = Math.floor(elapsed / cycleDuration);
    const phase = (elapsed % cycleDuration) / cycleDuration;
    const rotationAngle = (elapsed * this.rotationSpeed) % (Math.PI * 2);

    const currIdx = cycleIndex % STYLES.length;
    const nextIdx = (cycleIndex + 1) % STYLES.length;
    const curr = STYLES[currIdx];
    const next = STYLES[nextIdx];

    // Morph transition window: last 30 seconds of the 300s cycle (phase 0.90 to 1.0)
    let t = 0;
    if (phase >= 0.90) {
      t = (phase - 0.90) / 0.10; // smooth interpolation 0 to 1
      t = t * t * (3 - 2 * t); // smoothstep
    }

    return {
      cycleIndex,
      phase,
      rotationAngle,
      radius: curr.radius + (next.radius - curr.radius) * t,
      pitch: curr.pitch + (next.pitch - curr.pitch) * t,
      backboneThickness: 0.08 + 0.02 * (1 - t),
      emissiveIntensity: curr.emissive + (next.emissive - curr.emissive) * t,
      primaryColor: t > 0.5 ? next.primary : curr.primary,
      secondaryColor: t > 0.5 ? next.secondary : curr.secondary,
      styleName: t > 0.5 ? next.name : curr.name,
    };
  }
}
