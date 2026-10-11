import type { AnatomyQuality, QualityPreset } from "./types";

export const QUALITY_PRESETS: Record<AnatomyQuality, QualityPreset> = {
  high: { radial: 28, perSegment: 7, cap: 5, particles: 1600, organRadial: 18 },
  balanced: { radial: 16, perSegment: 4, cap: 3, particles: 600, organRadial: 12 },
  low: { radial: 10, perSegment: 3, cap: 2, particles: 0, organRadial: 8 },
};

export function qualityPreset(quality: AnatomyQuality): QualityPreset {
  return QUALITY_PRESETS[quality] ?? QUALITY_PRESETS.balanced;
}

export const BODY_PULSE_S = 0.85;
