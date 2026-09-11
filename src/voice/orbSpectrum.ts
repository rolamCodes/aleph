export type OrbReact = {
  blur: number;
  size: number;
};

const MIN_SIZE = 4;
const MAX_SIZE = 24;
const SIZE_RANGE = MAX_SIZE - MIN_SIZE;

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

function bandPeak(
  data: Uint8Array<ArrayBufferLike>,
  start: number,
  end: number,
): number {
  let peak = 0;
  for (let index = start; index < end && index < data.length; index += 1) {
    peak = Math.max(peak, (data[index] ?? 0) / 255);
  }
  return peak;
}

export function computeOrbReact(
  data: Uint8Array<ArrayBufferLike>,
): OrbReact {
  const body = bandEnergy(data, 2, 14);
  const formant = bandEnergy(data, 10, 52);
  const air = bandEnergy(data, 39, 96);
  const peak = bandPeak(data, 2, 52);

  const mass = body * 0.35 + formant * 0.45 + peak * 0.2;
  const boosted = 1 - Math.exp(-mass * 5.5);
  const size = MIN_SIZE + Math.pow(boosted, 0.55) * SIZE_RANGE;

  const whisper = air * (1 - body * 0.6);
  const blur = Math.min(10, Math.max(1, 1 + whisper * 6 + air * 3));

  return { blur, size };
}

export function smoothOrbReact(
  current: OrbReact,
  next: OrbReact,
  factor: number,
): OrbReact {
  return {
    blur: current.blur + (next.blur - current.blur) * factor,
    size: current.size + (next.size - current.size) * factor,
  };
}

export const DEFAULT_ORB_REACT: OrbReact = {
  blur: 1,
  size: 12,
};
