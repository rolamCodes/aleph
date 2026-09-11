export type OrbReact = {
  blur: number;
  glowBlur: number;
  glowOpacity: number;
  glowSpread: number;
  scale: number;
};

export type OrbEnvelopeState = {
  calibrationFrames: number;
  calibrationLevels: number[];
  ceiling: number;
  envelope: number;
  gateOpen: boolean;
  loudFrames: number;
  noiseFloor: number;
  quietFrames: number;
};

const CALIBRATION_FRAMES = 24;
const GATE_OPEN_FRAMES = 3;
const GATE_HOLD_FRAMES = 12;
const RESTING_ENVELOPE = (1 - 0.65) / 1.35;

function rootMeanSquare(data: Float32Array<ArrayBufferLike>): number {
  let mean = 0;
  for (const sample of data) {
    mean += sample;
  }
  mean /= data.length;

  let sum = 0;
  for (const sample of data) {
    const centered = sample - mean;
    sum += centered * centered;
  }
  return Math.sqrt(sum / data.length);
}

export function createOrbEnvelopeState(): OrbEnvelopeState {
  return {
    calibrationFrames: 0,
    calibrationLevels: [],
    ceiling: 0.05,
    envelope: RESTING_ENVELOPE,
    gateOpen: false,
    loudFrames: 0,
    noiseFloor: 0,
    quietFrames: 0,
  };
}

function orbReactFromState(state: OrbEnvelopeState): OrbReact {
  return {
    blur: 1 + state.envelope * 0.75,
    glowBlur: 4 + state.envelope * 16,
    glowOpacity: 0.45 + state.envelope * 0.55,
    glowSpread: state.envelope * 6,
    scale: 0.65 + state.envelope * 1.35,
  };
}

export function computeOrbReact(
  data: Float32Array<ArrayBufferLike>,
  state: OrbEnvelopeState,
): OrbReact {
  const loudness = rootMeanSquare(data);

  if (state.calibrationFrames < CALIBRATION_FRAMES) {
    state.calibrationLevels.push(loudness);
    state.calibrationFrames += 1;
    state.envelope *= 0.88;
    if (state.calibrationFrames === CALIBRATION_FRAMES) {
      const levels = [...state.calibrationLevels].sort(
        (left, right) => left - right,
      );
      state.noiseFloor =
        levels[Math.floor(levels.length * 0.25)] ?? loudness;
    }
    return orbReactFromState(state);
  }

  const openThreshold = Math.max(0.015, state.noiseFloor * 2.5 + 0.004);
  const closeThreshold = Math.max(0.009, state.noiseFloor * 1.7 + 0.002);

  if (!state.gateOpen && loudness < openThreshold) {
    state.noiseFloor += (loudness - state.noiseFloor) * 0.01;
  }

  if (state.gateOpen) {
    state.quietFrames =
      loudness < closeThreshold ? state.quietFrames + 1 : 0;
    if (state.quietFrames >= GATE_HOLD_FRAMES) {
      state.gateOpen = false;
      state.loudFrames = 0;
    }
  } else {
    state.loudFrames =
      loudness > openThreshold ? state.loudFrames + 1 : 0;
    if (state.loudFrames >= GATE_OPEN_FRAMES) {
      state.gateOpen = true;
      state.quietFrames = 0;
    }
  }

  state.ceiling = Math.max(
    openThreshold * 2.5,
    loudness,
    state.ceiling * 0.995,
  );

  const rawActivity = state.gateOpen
    ? Math.min(
        1,
        Math.max(0, loudness - closeThreshold) /
          Math.max(0.02, state.ceiling - closeThreshold),
      )
    : 0;
  const compressed = rawActivity * rawActivity * (3 - 2 * rawActivity);
  const envelopeFactor = compressed > state.envelope ? 0.35 : 0.08;
  state.envelope += (compressed - state.envelope) * envelopeFactor;

  return orbReactFromState(state);
}
