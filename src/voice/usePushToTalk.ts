import { useCallback, useEffect, useRef } from "react";
import type { PointedTarget } from "../types";
import { toUserFacingError } from "../companionActions";

const MAX_RECORDING_MS = 30_000;
const BUFFER_SIZE = 4096;
const ANALYSER_FFT_SIZE = 1024;
const MIN_DB = -55;
const MAX_DB = -20;
const ATTACK_MS = 50;
const RELEASE_MS = 200;

type CapturePhase = "idle" | "preparing" | "listening" | "processing";

type ActiveCapture = {
  analyser: AnalyserNode;
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
  capture.analyser.disconnect();
  capture.processor.disconnect();
  capture.silentGain.disconnect();
  for (const track of capture.stream.getTracks()) {
    track.stop();
  }
  void capture.audioContext.close();
}

function createAmplitudeReader(analyser: AnalyserNode): () => number {
  const samples = new Float32Array(analyser.fftSize);
  let level = 0;
  let last = performance.now();
  return () => {
    analyser.getFloatTimeDomainData(samples);
    let sumSquares = 0;
    for (const sample of samples) {
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / samples.length);
    const db = 20 * Math.log10(Math.max(rms, 1e-8));
    const target = Math.min(1, Math.max(0, (db - MIN_DB) / (MAX_DB - MIN_DB)));
    const now = performance.now();
    const dt = Math.max(0, now - last);
    last = now;
    const tau = target > level ? ATTACK_MS : RELEASE_MS;
    const alpha = 1 - Math.exp(-dt / Math.max(1, tau));
    level += (target - level) * alpha;
    return level;
  };
}

export function usePushToTalk({
  pointedTarget,
  isEnabled,
  onPreparing,
  onListening,
  onWorking,
  onIdle,
  onError,
  onRecording,
}: {
  pointedTarget: PointedTarget;
  isEnabled: () => boolean;
  onPreparing: (target: PointedTarget) => void;
  onListening: () => void;
  onWorking: () => void;
  onIdle: () => void;
  onError: (message: string) => void;
  onRecording: (audio: Blob, target: PointedTarget) => Promise<void>;
}): {
  cancelCapture: () => void;
  readAmplitude: () => number;
} {
  const activeRef = useRef<ActiveCapture | null>(null);
  const mountedRef = useRef(true);
  const onRecordingRef = useRef(onRecording);
  const pointedTargetRef = useRef(pointedTarget);
  const enabledRef = useRef(isEnabled);
  const pressedRef = useRef(false);
  const requestIdRef = useRef(0);
  const phaseRef = useRef<CapturePhase>("idle");
  const readAmplitudeRef = useRef<() => number>(() => 0);
  const onPreparingRef = useRef(onPreparing);
  const onListeningRef = useRef(onListening);
  const onWorkingRef = useRef(onWorking);
  const onIdleRef = useRef(onIdle);
  const onErrorRef = useRef(onError);
  const cancelCaptureRef = useRef(() => {});

  useEffect(() => {
    onRecordingRef.current = onRecording;
    pointedTargetRef.current = pointedTarget;
    enabledRef.current = isEnabled;
    onPreparingRef.current = onPreparing;
    onListeningRef.current = onListening;
    onWorkingRef.current = onWorking;
    onIdleRef.current = onIdle;
    onErrorRef.current = onError;
  }, [
    isEnabled,
    onError,
    onIdle,
    onListening,
    onPreparing,
    onRecording,
    onWorking,
    pointedTarget,
  ]);

  useEffect(() => {
    mountedRef.current = true;

    const setPhase = (phase: CapturePhase): void => {
      phaseRef.current = phase;
    };

    const clearAmplitude = (): void => {
      readAmplitudeRef.current = () => 0;
    };

    const cancel = (): void => {
      if (phaseRef.current === "processing") {
        return;
      }
      pressedRef.current = false;
      requestIdRef.current += 1;
      clearAmplitude();
      const active = activeRef.current;
      activeRef.current = null;
      if (active) {
        releaseCapture(active);
      }
      if (phaseRef.current !== "idle") {
        setPhase("idle");
        onIdleRef.current();
      }
    };

    const fail = (reason: unknown): void => {
      pressedRef.current = false;
      clearAmplitude();
      const active = activeRef.current;
      activeRef.current = null;
      if (active) {
        releaseCapture(active);
      }
      setPhase("idle");
      onErrorRef.current(toUserFacingError(reason));
    };

    const finish = async (): Promise<void> => {
      const active = activeRef.current;
      if (!active) {
        return;
      }

      activeRef.current = null;
      clearAmplitude();
      const sampleRate = active.audioContext.sampleRate;
      const target = active.target;
      releaseCapture(active);
      const audio = encodeWav(active.chunks, sampleRate);
      if (!audio) {
        setPhase("idle");
        onIdleRef.current();
        return;
      }

      setPhase("processing");
      onWorkingRef.current();
      try {
        await onRecordingRef.current(audio, target);
        setPhase("idle");
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
      setPhase("preparing");
      onPreparingRef.current(target);

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
          return;
        }
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        const processor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
        const silentGain = audioContext.createGain();
        const chunks: Float32Array[] = [];

        analyser.fftSize = ANALYSER_FFT_SIZE;
        analyser.smoothingTimeConstant = 0;
        silentGain.gain.value = 0;
        processor.onaudioprocess = (event) => {
          chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
        };
        source.connect(analyser);
        analyser.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(audioContext.destination);

        const timeout = setTimeout(() => {
          pressedRef.current = false;
          void finish();
        }, MAX_RECORDING_MS);

        activeRef.current = {
          analyser,
          audioContext,
          chunks,
          processor,
          silentGain,
          source,
          stream,
          target,
          timeout,
        };
        readAmplitudeRef.current = createAmplitudeReader(analyser);
        setPhase("listening");
        onListeningRef.current();
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
        event.isComposing ||
        isEditableTarget(event.target) ||
        !enabledRef.current()
      ) {
        return;
      }

      event.preventDefault();
      pressedRef.current = true;
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
        if (phaseRef.current !== "processing") {
          setPhase("idle");
          onIdleRef.current();
        }
        return;
      }
      void finish();
    };

    const onBlur = (): void => {
      if (phaseRef.current === "processing") {
        pressedRef.current = false;
        return;
      }
      cancel();
    };

    cancelCaptureRef.current = cancel;
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    return () => {
      mountedRef.current = false;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      if (phaseRef.current !== "processing") {
        cancel();
      }
    };
  }, []);

  const readAmplitude = useCallback(() => readAmplitudeRef.current(), []);
  const cancelCapture = useCallback(() => {
    cancelCaptureRef.current();
  }, []);

  return { cancelCapture, readAmplitude };
}
