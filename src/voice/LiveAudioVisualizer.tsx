import { useEffect, useRef } from "react";

function barHeights(
  frequencyData: Uint8Array,
  width: number,
  barWidth: number,
  gap: number,
): number[] {
  let units = width / (barWidth + gap);
  let step = Math.floor(frequencyData.length / units);
  if (units > frequencyData.length) {
    units = frequencyData.length;
    step = 1;
  }

  const data: number[] = [];
  for (let index = 0; index < units; index += 1) {
    let sum = 0;
    for (
      let offset = 0;
      offset < step && index * step + offset < frequencyData.length;
      offset += 1
    ) {
      sum += frequencyData[index * step + offset] ?? 0;
    }
    data.push(sum / step);
  }
  return data;
}

function drawBars(
  values: number[],
  canvas: HTMLCanvasElement,
  barWidth: number,
  gap: number,
  backgroundColor: string,
  barColor: string,
): void {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  const middle = canvas.height / 2;
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (backgroundColor !== "transparent") {
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  values.forEach((value, index) => {
    context.fillStyle = barColor;
    const x = index * (barWidth + gap);
    const height = value || 1;
    const y = middle - height / 2;
    context.beginPath();
    if (context.roundRect) {
      context.roundRect(x, y, barWidth, height, 50);
      context.fill();
    } else {
      context.fillRect(x, y, barWidth, height);
    }
  });
}

export default function LiveAudioVisualizer({
  mediaRecorder,
  width = 260,
  height = 24,
  barWidth = 2,
  gap = 2,
  backgroundColor = "transparent",
  barColor = "#ffffff",
  fftSize = 128,
  maxDecibels = -10,
  minDecibels = -90,
  smoothingTimeConstant = 0.5,
}: {
  mediaRecorder: MediaRecorder;
  width?: number;
  height?: number;
  barWidth?: number;
  gap?: number;
  backgroundColor?: string;
  barColor?: string;
  fftSize?: number;
  maxDecibels?: number;
  minDecibels?: number;
  smoothingTimeConstant?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!mediaRecorder.stream) {
      return;
    }

    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.minDecibels = minDecibels;
    analyser.maxDecibels = maxDecibels;
    analyser.smoothingTimeConstant = smoothingTimeConstant;
    const source = audioContext.createMediaStreamSource(mediaRecorder.stream);
    source.connect(analyser);
    void audioContext.resume();

    const frequencies = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;

    const report = (): void => {
      const canvas = canvasRef.current;
      if (!canvas || mediaRecorder.state !== "recording") {
        return;
      }
      analyser.getByteFrequencyData(frequencies);
      drawBars(
        barHeights(frequencies, canvas.width, barWidth, gap),
        canvas,
        barWidth,
        gap,
        backgroundColor,
        barColor,
      );
      frame = requestAnimationFrame(report);
    };

    frame = requestAnimationFrame(report);

    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      analyser.disconnect();
      if (audioContext.state !== "closed") {
        void audioContext.close();
      }
    };
  }, [
    backgroundColor,
    barColor,
    barWidth,
    fftSize,
    gap,
    maxDecibels,
    mediaRecorder,
    minDecibels,
    smoothingTimeConstant,
  ]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ aspectRatio: "unset" }}
    />
  );
}
