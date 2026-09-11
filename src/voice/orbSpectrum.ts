export type OrbReact = {
  blur: number;
  hue: number;
  size: number;
};

const BASE_HUE = 200;
const HUE_RANGE = 7.2; // ±2% of the hue wheel

function bandEnergy(
  data: Uint8Array<ArrayBufferLike>,
  start: number,
  end: number,
): number {
  let sum = 0;
  const count = Math.min(end, data.length) - start;
  if (count <= 0) {
    return 0;
  }
  for (let index = start; index < end && index < data.length; index += 1) {
    sum += data[index] ?? 0;
  }
  return sum / (count * 255);
}

export function computeOrbReact(
  data: Uint8Array<ArrayBufferLike>,
): OrbReact {
  // Chest voice and plosives — the orb's "mass"
  const body = bandEnergy(data, 2, 11);
  // Vowel formants — timbre and openness
  const formant = bandEnergy(data, 12, 38);
  // Fricatives, sibilance, room air — softness and shimmer
  const air = bandEnergy(data, 39, 96);

  const punch = Math.pow(body * 0.5 + formant * 0.5, 0.7);
  const size = 4 + punch * 10;

  const whisper = air * (1 - body * 0.6);
  const blur = Math.min(10, Math.max(1, 1 + whisper * 6 + air * 3));

  const tilt = (formant - body) / (formant + body + 0.04);
  const hue = BASE_HUE + Math.max(-1, Math.min(1, tilt)) * HUE_RANGE;

  return { blur, hue, size };
}

export function smoothOrbReact(
  current: OrbReact,
  next: OrbReact,
  factor: number,
): OrbReact {
  return {
    blur: current.blur + (next.blur - current.blur) * factor,
    hue: current.hue + (next.hue - current.hue) * factor,
    size: current.size + (next.size - current.size) * factor,
  };
}

export const DEFAULT_ORB_REACT: OrbReact = {
  blur: 1,
  hue: BASE_HUE,
  size: 12,
};
