import { useEffect, useRef } from "react";
import { MAX_RECORDING_MS } from "./usePushToTalk";

const BAR_COLOR = "#ffffff";
const MIN_BAR_HEIGHT = 1;
const PLAYHEAD_COLOR = "#ff3b30";
const PLAYHEAD_WIDTH = 1.5;
const REST_COLOR = "#747474";
const REST_HEIGHT = 1;

// Mic hiss sits just above zero, so gate it out and rescale what is left to
// keep speech off the ceiling.
const NOISE_FLOOR = 0.02;
const GAIN = 2.5;

type Tape = {
  barWidth: number;
  height: number;
  pitch: number;
  width: number;
};

function peakLevel(samples: Uint8Array): number {
  let peak = 0;
  for (const sample of samples) {
    const amplitude = Math.abs(sample - 128) / 128;
    if (amplitude > peak) {
      peak = amplitude;
    }
  }
  if (peak <= NOISE_FLOOR) {
    return 0;
  }
  return Math.min(1, ((peak - NOISE_FLOOR) / (1 - NOISE_FLOOR)) * GAIN);
}

function fillBar(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  context.beginPath();
  context.roundRect(x, y, width, height, Math.min(width, height) / 2);
  context.fill();
}

function draw(
  context: CanvasRenderingContext2D,
  levels: number[],
  recorded: number,
  tape: Tape,
): void {
  const middle = tape.height / 2;
  context.clearRect(0, 0, tape.width, tape.height);

  levels.forEach((level, index) => {
    const x = index * tape.pitch;
    if (index < recorded) {
      const barHeight = Math.max(MIN_BAR_HEIGHT, level * tape.height);
      context.fillStyle = BAR_COLOR;
      fillBar(context, x, middle - barHeight / 2, tape.barWidth, barHeight);
      return;
    }
    context.fillStyle = REST_COLOR;
    fillBar(
      context,
      x,
      middle - REST_HEIGHT / 2,
      tape.barWidth,
      REST_HEIGHT,
    );
  });

  if (recorded < levels.length) {
    context.fillStyle = PLAYHEAD_COLOR;
    context.fillRect(recorded * tape.pitch, 0, PLAYHEAD_WIDTH, tape.height);
  }
}

export default function RecordingWaveform({
  mediaRecorder,
  width,
  height,
}: {
  mediaRecorder: MediaRecorder;
  width: number;
  height: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mediaRecorder.stream) {
      return;
    }

    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.scale(ratio, ratio);

    // One bar plus one gap per pair of device pixels, so the tape carries as
    // many slots as the display can draw crisply.
    const tape: Tape = {
      barWidth: 1 / ratio,
      height,
      pitch: 2 / ratio,
      width,
    };

    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    const source = audioContext.createMediaStreamSource(mediaRecorder.stream);
    source.connect(analyser);
    void audioContext.resume();

    const slotCount = Math.max(1, Math.floor(width / tape.pitch));
    const levels = Array.from({ length: slotCount }, () => 0);
    const samples = new Uint8Array(analyser.fftSize);
    const startedAt = Date.now();
    let frame = 0;

    const render = (): void => {
      if (mediaRecorder.state !== "recording") {
        return;
      }
      const elapsedMs = Math.min(MAX_RECORDING_MS, Date.now() - startedAt);
      const slot = Math.min(
        slotCount - 1,
        Math.floor((elapsedMs / MAX_RECORDING_MS) * slotCount),
      );
      analyser.getByteTimeDomainData(samples);
      levels[slot] = Math.max(levels[slot] ?? 0, peakLevel(samples));
      draw(context, levels, slot + 1, tape);
      frame = requestAnimationFrame(render);
    };

    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      analyser.disconnect();
      if (audioContext.state !== "closed") {
        void audioContext.close();
      }
    };
  }, [height, mediaRecorder, width]);

  return <canvas ref={canvasRef} style={{ width, height }} />;
}
