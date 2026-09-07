import { useEffect, useRef } from "react";
import { MAX_RECORDING_MS } from "./usePushToTalk";

const BAR_WIDTH = 2;
const BAR_GAP = 2;
const BAR_COLOR = "#ffffff";
const MIN_BAR_HEIGHT = 2;
const PLAYHEAD_COLOR = "#ff3b30";
const PLAYHEAD_WIDTH = 1.5;
const REST_COLOR = "#747474";
const REST_SIZE = 2;

// Mic hiss sits just above zero, so gate it out and rescale what is left to
// keep speech off the ceiling.
const NOISE_FLOOR = 0.02;
const GAIN = 2.5;

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
  context.roundRect(x, y, width, height, width / 2);
  context.fill();
}

function draw(
  context: CanvasRenderingContext2D,
  levels: number[],
  recorded: number,
  width: number,
  height: number,
): void {
  const middle = height / 2;
  const pitch = BAR_WIDTH + BAR_GAP;
  context.clearRect(0, 0, width, height);

  levels.forEach((level, index) => {
    const x = index * pitch;
    if (index < recorded) {
      const barHeight = Math.max(MIN_BAR_HEIGHT, level * height);
      context.fillStyle = BAR_COLOR;
      fillBar(context, x, middle - barHeight / 2, BAR_WIDTH, barHeight);
      return;
    }
    context.fillStyle = REST_COLOR;
    fillBar(context, x, middle - REST_SIZE / 2, REST_SIZE, REST_SIZE);
  });

  if (recorded < levels.length) {
    context.fillStyle = PLAYHEAD_COLOR;
    context.fillRect(recorded * pitch, 0, PLAYHEAD_WIDTH, height);
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

    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    const source = audioContext.createMediaStreamSource(mediaRecorder.stream);
    source.connect(analyser);
    void audioContext.resume();

    const slotCount = Math.max(1, Math.floor(width / (BAR_WIDTH + BAR_GAP)));
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
      draw(context, levels, slot + 1, width, height);
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
