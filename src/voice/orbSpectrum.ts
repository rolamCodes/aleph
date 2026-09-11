export type OrbReact = {
  blur: number;
  glowBlur: number;
  glowSpread: number;
};

export type OrbSpectrumState = {
  activity: number;
  calibrationFrames: number;
  ceiling: number;
  gateOpen: boolean;
  loudFrames: number;
  noiseFloor: Float32Array;
  quietFrames: number;
};

const VOICE_BIN_END = 48;
const AIR_BIN_START = 39;
const AIR_BIN_END = 96;
const CALIBRATION_FRAMES = 18;
const GATE_OPEN_ENERGY = 0.045;
const GATE_CLOSE_ENERGY = 0.025;
const GATE_OPEN_FRAMES = 2;
const GATE_HOLD_FRAMES = 10;
const NOISE_MARGIN = 0.022;

function voiceWeight(index: number): number {
  if (index < 5) return 0.65;
  if (index < 18) return 1;
  if (index < 32) return 0.6;
  return 0.25;
}

export function createOrbSpectrumState(binCount: number): OrbSpectrumState {
  return {
    activity: 0,
    calibrationFrames: 0,
    ceiling: 0.065,
    gateOpen: false,
    loudFrames: 0,
    noiseFloor: new Float32Array(binCount),
    quietFrames: 0,
  };
}

export function computeOrbReact(
  data: Uint8Array<ArrayBufferLike>,
  state: OrbSpectrumState,
): OrbReact {
  let airEnergy = 0;
  let airBins = 0;
  let weightedEnergy = 0;
  let totalWeight = 0;

  for (let index = 1; index < data.length; index += 1) {
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
    } else if (!state.gateOpen) {
      state.noiseFloor[index] = floor + (value - floor) * 0.002;
    }

    const excess = Math.max(0, value - floor - NOISE_MARGIN);
    if (index < VOICE_BIN_END) {
      const weight = voiceWeight(index);
      weightedEnergy += excess * excess * weight;
      totalWeight += weight;
    }
    if (index >= AIR_BIN_START && index < AIR_BIN_END) {
      airEnergy += excess * excess;
      airBins += 1;
    }
  }

  if (state.calibrationFrames < CALIBRATION_FRAMES) {
    state.calibrationFrames += 1;
    return { blur: 1, glowBlur: 2, glowSpread: 0 };
  }

  const energy = Math.sqrt(weightedEnergy / Math.max(1, totalWeight));
  if (state.gateOpen) {
    state.quietFrames =
      energy < GATE_CLOSE_ENERGY ? state.quietFrames + 1 : 0;
    if (state.quietFrames >= GATE_HOLD_FRAMES) {
      state.gateOpen = false;
      state.loudFrames = 0;
    }
  } else {
    state.loudFrames =
      energy > GATE_OPEN_ENERGY ? state.loudFrames + 1 : 0;
    if (state.loudFrames >= GATE_OPEN_FRAMES) {
      state.gateOpen = true;
      state.quietFrames = 0;
    }
  }

  state.ceiling = Math.max(0.065, energy, state.ceiling * 0.99);
  const normalized = state.gateOpen
    ? Math.min(
        1,
        Math.max(0, energy - GATE_CLOSE_ENERGY) /
          Math.max(0.04, state.ceiling - GATE_CLOSE_ENERGY),
      )
    : 0;
  const activityFactor = normalized > state.activity ? 0.32 : 0.08;
  state.activity += (normalized - state.activity) * activityFactor;

  const air = Math.sqrt(airEnergy / Math.max(1, airBins));
  const airResponse = Math.min(1, air / 0.1);
  const blur = 1 + state.activity * airResponse * 9;
  const glowBlur = 2 + state.activity * 18;
  const glowSpread = state.activity * 8;

  return { blur, glowBlur, glowSpread };
}

export function smoothOrbReact(
  current: OrbReact,
  next: OrbReact,
): OrbReact {
  const glowFactor =
    next.glowSpread > current.glowSpread ? 0.4 : 0.1;
  return {
    blur: current.blur + (next.blur - current.blur) * 0.18,
    glowBlur:
      current.glowBlur + (next.glowBlur - current.glowBlur) * glowFactor,
    glowSpread:
      current.glowSpread +
      (next.glowSpread - current.glowSpread) * glowFactor,
  };
}

export const DEFAULT_ORB_REACT: OrbReact = {
  blur: 1,
  glowBlur: 2,
  glowSpread: 0,
};
