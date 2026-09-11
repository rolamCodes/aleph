export type OrbReact = {
  blur: number;
  size: number;
};

export type OrbSpectrumState = {
  calibrationFrames: number;
  ceiling: number;
  noiseFloor: Float32Array;
};

const MIN_SIZE = 4;
const MAX_SIZE = 24;
const SIZE_RANGE = MAX_SIZE - MIN_SIZE;
const VOICE_BIN_END = 48;
const CALIBRATION_FRAMES = 8;

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

function voiceWeight(index: number): number {
  if (index < 5) return 0.65;
  if (index < 18) return 1;
  if (index < 32) return 0.6;
  return 0.25;
}

export function createOrbSpectrumState(binCount: number): OrbSpectrumState {
  return {
    calibrationFrames: 0,
    ceiling: 0.04,
    noiseFloor: new Float32Array(binCount),
  };
}

export function computeOrbReact(
  data: Uint8Array<ArrayBufferLike>,
  state: OrbSpectrumState,
): OrbReact {
  const air = bandEnergy(data, 39, 96);

  let weightedEnergy = 0;
  let totalWeight = 0;
  const end = Math.min(VOICE_BIN_END, data.length);

  for (let index = 1; index < end; index += 1) {
    const value = (data[index] ?? 0) / 255;
    const floor = state.noiseFloor[index] ?? 0;

    if (state.calibrationFrames < CALIBRATION_FRAMES) {
      const count = state.calibrationFrames;
      state.noiseFloor[index] = (floor * count + value) / (count + 1);
      continue;
    }

    // Follow a falling room floor quickly, but only let the floor rise when
    // the bin is close enough to be ambience rather than speech.
    if (value < floor) {
      state.noiseFloor[index] = floor + (value - floor) * 0.08;
    } else if (value < floor + 0.035) {
      state.noiseFloor[index] = floor + (value - floor) * 0.008;
    }

    const excess = Math.max(0, value - floor - 0.018);
    const weight = voiceWeight(index);
    weightedEnergy += excess * excess * weight;
    totalWeight += weight;
  }

  if (state.calibrationFrames < CALIBRATION_FRAMES) {
    state.calibrationFrames += 1;
    return { blur: 1, size: MIN_SIZE };
  }

  const energy = Math.sqrt(weightedEnergy / Math.max(1, totalWeight));
  state.ceiling = Math.max(0.04, energy, state.ceiling * 0.985);
  const gatedEnergy = Math.max(0, energy - 0.012);
  const dynamicRange = Math.max(0.028, state.ceiling - 0.012);
  const normalized = Math.min(1, gatedEnergy / dynamicRange);
  const size = MIN_SIZE + normalized * SIZE_RANGE;

  const blur = Math.min(10, Math.max(1, 1 + air * 9));

  return { blur, size };
}

export function smoothOrbReact(
  current: OrbReact,
  next: OrbReact,
): OrbReact {
  const sizeFactor = next.size > current.size ? 0.72 : 0.2;
  return {
    blur: current.blur + (next.blur - current.blur) * 0.35,
    size: current.size + (next.size - current.size) * sizeFactor,
  };
}

export const DEFAULT_ORB_REACT: OrbReact = {
  blur: 1,
  size: MIN_SIZE,
};
