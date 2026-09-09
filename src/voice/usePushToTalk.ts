import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { PointedTarget, VoiceStatus } from "../types";

const MAX_RECORDING_MS = 30_000;
const BUFFER_SIZE = 4096;

type ActiveCapture = {
  audioContext: AudioContext;
  chunks: Float32Array[];
  processor: ScriptProcessorNode;
  silentGain: GainNode;
  source: MediaStreamAudioSourceNode;
  stream: MediaStream;
  target: PointedTarget;
  timeout: ReturnType<typeof setTimeout>;
};

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT")
  );
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function encodeWav(chunks: Float32Array[], sampleRate: number): Blob | null {
  const frameCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  if (frameCount === 0) {
    return null;
  }

  const buffer = new ArrayBuffer(44 + frameCount * 2);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + frameCount * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, frameCount * 2, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (const sample of chunk) {
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(
        offset,
        clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
        true,
      );
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function releaseCapture(capture: ActiveCapture): void {
  clearTimeout(capture.timeout);
  capture.processor.onaudioprocess = null;
  capture.source.disconnect();
  capture.processor.disconnect();
  capture.silentGain.disconnect();
  for (const track of capture.stream.getTracks()) {
    track.stop();
  }
  void capture.audioContext.close();
}

export function usePushToTalk({
  pointedTarget,
  onRecording,
}: {
  pointedTarget: PointedTarget;
  onRecording: (audio: Blob, target: PointedTarget) => Promise<void>;
}): {
  error: string | null;
  levelRef: RefObject<number>;
  status: VoiceStatus;
} {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef<ActiveCapture | null>(null);
  const levelRef = useRef(0);
  const mountedRef = useRef(true);
  const onRecordingRef = useRef(onRecording);
  const pointedTargetRef = useRef(pointedTarget);
  const pressedRef = useRef(false);
  const requestIdRef = useRef(0);
  const statusRef = useRef<VoiceStatus>("idle");

  useEffect(() => {
    onRecordingRef.current = onRecording;
    pointedTargetRef.current = pointedTarget;
  }, [onRecording, pointedTarget]);

  useEffect(() => {
    mountedRef.current = true;

    const updateStatus = (nextStatus: VoiceStatus): void => {
      statusRef.current = nextStatus;
      if (mountedRef.current) {
        setStatus(nextStatus);
      }
    };

    const cancel = (): void => {
      pressedRef.current = false;
      requestIdRef.current += 1;
      levelRef.current = 0;
      const active = activeRef.current;
      activeRef.current = null;
      if (active) {
        releaseCapture(active);
      }
      updateStatus("idle");
    };

    const fail = (reason: unknown): void => {
      const message =
        reason instanceof Error ? reason.message : "Voice command failed";
      levelRef.current = 0;
      setError(message);
      updateStatus("error");
    };

    const finish = async (): Promise<void> => {
      const active = activeRef.current;
      if (!active) {
        return;
      }

      activeRef.current = null;
      levelRef.current = 0;
      const sampleRate = active.audioContext.sampleRate;
      releaseCapture(active);
      const audio = encodeWav(active.chunks, sampleRate);
      if (!audio) {
        updateStatus("idle");
        return;
      }

      updateStatus("processing");
      try {
        await onRecordingRef.current(audio, active.target);
        updateStatus("idle");
      } catch (reason) {
        fail(reason);
      }
    };

    const start = async (): Promise<void> => {
      if (!navigator.mediaDevices?.getUserMedia) {
        fail(new Error("Microphone recording is not supported"));
        return;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      const target = pointedTargetRef.current;
      updateStatus("listening");

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        if (
          !mountedRef.current ||
          !pressedRef.current ||
          requestId !== requestIdRef.current
        ) {
          for (const track of stream.getTracks()) {
            track.stop();
          }
          updateStatus("idle");
          return;
        }

        const audioContext = new AudioContext();
        await audioContext.resume();
        if (
          !mountedRef.current ||
          !pressedRef.current ||
          requestId !== requestIdRef.current
        ) {
          for (const track of stream.getTracks()) {
            track.stop();
          }
          await audioContext.close();
          updateStatus("idle");
          return;
        }
        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
        const silentGain = audioContext.createGain();
        const chunks: Float32Array[] = [];

        silentGain.gain.value = 0;
        processor.onaudioprocess = (event) => {
          const samples = event.inputBuffer.getChannelData(0);
          chunks.push(new Float32Array(samples));

          let sumSquares = 0;
          for (const sample of samples) {
            sumSquares += sample * sample;
          }
          const rms = Math.sqrt(sumSquares / samples.length);
          const normalized = Math.min(1, Math.max(0, (rms - 0.008) / 0.12));
          const smoothing =
            normalized > levelRef.current ? 0.55 : 0.18;
          levelRef.current +=
            (normalized - levelRef.current) * smoothing;
        };
        source.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(audioContext.destination);

        const timeout = setTimeout(() => {
          pressedRef.current = false;
          void finish();
        }, MAX_RECORDING_MS);

        activeRef.current = {
          audioContext,
          chunks,
          processor,
          silentGain,
          source,
          stream,
          target,
          timeout,
        };
        updateStatus("listening");
      } catch (reason) {
        fail(reason);
      }
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.code !== "Space" ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        isEditableTarget(event.target) ||
        (statusRef.current !== "idle" && statusRef.current !== "error")
      ) {
        return;
      }

      event.preventDefault();
      pressedRef.current = true;
      setError(null);
      void start();
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code !== "Space" || !pressedRef.current) {
        return;
      }

      event.preventDefault();
      pressedRef.current = false;
      if (!activeRef.current) {
        requestIdRef.current += 1;
        updateStatus("idle");
        return;
      }
      void finish();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", cancel);

    return () => {
      mountedRef.current = false;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", cancel);
      cancel();
    };
  }, []);

  return { error, levelRef, status };
}
