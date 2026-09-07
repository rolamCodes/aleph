import { useEffect, useRef } from "react";

const BAR_WIDTH = 2;
const BAR_GAP = 2;
const BAR_COLOR = "#ffffff";
const MIN_BAR_HEIGHT = 1;
const PLAYHEAD_COLOR = "#ff3b30";
const PLAYHEAD_WIDTH = 1.5;
const REST_COLOR = "#747474";
const REST_SIZE = 2;
const SAMPLE_INTERVAL_MS = 50;

// Mic hiss sits just above zero, so gate it out and rescale what is left to
// keep speech off the ceiling.
const NOISE_FLOOR = 0.02;
const GAIN = 2.5;

type Tape = {
  height: number;
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
    const x = index * (BAR_WIDTH + BAR_GAP);
    if (index < recorded) {
      const barHeight = Math.max(MIN_BAR_HEIGHT, level * tape.height);
      context.fillStyle = BAR_COLOR;
      fillBar(context, x, middle - barHeight / 2, BAR_WIDTH, barHeight);
      return;
    }
    context.fillStyle = REST_COLOR;
    fillBar(
      context,
      x,
      middle - REST_SIZE / 2,
      REST_SIZE,
      REST_SIZE,
    );
  });

  const playhead = Math.min(recorded, levels.length - 1);
  context.fillStyle = PLAYHEAD_COLOR;
  context.fillRect(
    playhead * (BAR_WIDTH + BAR_GAP),
    0,
    PLAYHEAD_WIDTH,
    tape.height,
  );
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

    const tape: Tape = {
      height,
      width,
    };

    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    const source = audioContext.createMediaStreamSource(mediaRecorder.stream);
    source.connect(analyser);
    void audioContext.resume();

    const slotCount = Math.max(1, Math.floor(width / (BAR_WIDTH + BAR_GAP)));
    const levels = Array.from({ length: slotCount }, () => 0);
    const samples = new Uint8Array(analyser.fftSize);
    let currentPeak = 0;
    let lastSampleAt = performance.now();
    let recorded = 0;
    let frame = 0;

    const render = (): void => {
      if (mediaRecorder.state !== "recording") {
        return;
      }
      analyser.getByteTimeDomainData(samples);
      currentPeak = Math.max(currentPeak, peakLevel(samples));

      const now = performance.now();
      if (now - lastSampleAt >= SAMPLE_INTERVAL_MS) {
        if (recorded < slotCount) {
          levels[recorded] = currentPeak;
          recorded += 1;
        } else {
          levels.copyWithin(0, 1);
          levels[slotCount - 1] = currentPeak;
        }
        currentPeak = 0;
        lastSampleAt = now;
      }

      draw(context, levels, recorded, tape);
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
