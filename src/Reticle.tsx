import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { PointedTarget, VoiceStatus } from "./types";

const IDLE_SIZE = 8;
const ACTIVE_IDLE_SIZE = IDLE_SIZE * 3;
const CURSOR_OFFSET = 12;
const ATTACHMENT_RADIUS = 80;
const PADDING = 2;
const TARGET_SELECTOR = "[data-reticle], .react-flow__edge";

type Box = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function distanceToRect(x: number, y: number, r: DOMRect): number {
  const dx = Math.max(r.left - x, 0, x - r.right);
  const dy = Math.max(r.top - y, 0, y - r.bottom);
  return Math.hypot(dx, dy);
}

function containsPoint(x: number, y: number, r: DOMRect): boolean {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function boxFromElement(el: Element): Box {
  const r = el.getBoundingClientRect();
  return {
    left: r.left - PADDING,
    top: r.top - PADDING,
    width: r.width + PADDING * 2,
    height: r.height + PADDING * 2,
  };
}

function pickHit(x: number, y: number): Element | null {
  let bestEl: Element | null = null;
  let bestArea = Infinity;

  for (const el of document.querySelectorAll(TARGET_SELECTOR)) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      continue;
    }
    if (containsPoint(x, y, rect)) {
      const area = rect.width * rect.height;
      if (area < bestArea) {
        bestEl = el;
        bestArea = area;
      }
    }
  }

  return bestEl;
}

function stillAttached(target: Element, x: number, y: number): boolean {
  if (!document.contains(target)) {
    return false;
  }

  return (
    distanceToRect(x, y, target.getBoundingClientRect()) <= ATTACHMENT_RADIUS
  );
}

function pointedTargetFromElement(element: Element): PointedTarget {
  const reticleTarget = element.closest<HTMLElement>("[data-reticle-kind]");
  const kind = reticleTarget?.dataset.reticleKind;
  const id = reticleTarget?.dataset.reticleId;

  if (kind === "context" && id) {
    return { kind, id };
  }

  const contextId = reticleTarget?.dataset.reticleContextId;
  if ((kind === "component" || kind === "element") && id && contextId) {
    return { kind, id, contextId };
  }

  const edge = element.closest<HTMLElement>(".react-flow__edge");
  const edgeId = edge?.dataset.id;
  return edgeId ? { kind: "edge", id: edgeId } : { kind: "canvas" };
}

function targetKey(target: PointedTarget): string {
  return target.kind === "canvas" ? target.kind : `${target.kind}:${target.id}`;
}

function elementForTarget(target: PointedTarget): Element | null {
  if (target.kind === "canvas") {
    return null;
  }
  if (target.kind === "edge") {
    for (const edge of document.querySelectorAll<HTMLElement>(
      ".react-flow__edge",
    )) {
      if (edge.dataset.id === target.id) {
        return edge;
      }
    }
    return null;
  }

  for (const element of document.querySelectorAll<HTMLElement>(
    "[data-reticle-kind]",
  )) {
    if (
      element.dataset.reticleKind === target.kind &&
      element.dataset.reticleId === target.id &&
      (target.kind === "context" ||
        element.dataset.reticleContextId === target.contextId)
    ) {
      return element;
    }
  }
  return null;
}

export default function Reticle({
  analyserRef,
  focusTarget,
  frozen = false,
  onTargetChange,
  status,
}: {
  analyserRef: RefObject<AnalyserNode | null>;
  focusTarget?: PointedTarget;
  frozen?: boolean;
  onTargetChange: (target: PointedTarget) => void;
  status: VoiceStatus;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const glowSvgRef = useRef<SVGSVGElement>(null);
  const attachedRef = useRef<Element | null>(null);
  const pointerRef = useRef({ x: 0, y: 0, inside: false });
  const frozenPositionRef = useRef<{ x: number; y: number } | null>(null);
  const glowAngleRef = useRef(0);
  const glowVelocityRef = useRef(0);
  const glowBottomRef = useRef(62.5);
  const glowGeometryRef = useRef("");
  const glowLevelRef = useRef(0);
  const glowPeakRef = useRef(0);
  const targetKeyRef = useRef("canvas");

  useEffect(() => {
    const node = elRef.current;
    if (!node) {
      return;
    }
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (!frozen) {
      frozenPositionRef.current = null;
    }

    const applyGlowGeometry = (
      width: number,
      height: number,
      circular: boolean,
    ) => {
      const svg = glowSvgRef.current;
      const geometryKey = `${width}:${height}:${circular}`;
      if (!svg || geometryKey === glowGeometryRef.current) {
        return;
      }

      glowGeometryRef.current = geometryKey;
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      const inset = 2;
      const rectWidth = Math.max(1, width - inset * 2);
      const rectHeight = Math.max(1, height - inset * 2);
      const radius = circular
        ? Math.max(0, Math.min(rectWidth, rectHeight) / 2)
        : 3;
      for (const rect of svg.querySelectorAll("rect")) {
        rect.setAttribute("x", `${inset}`);
        rect.setAttribute("y", `${inset}`);
        rect.setAttribute("width", `${rectWidth}`);
        rect.setAttribute("height", `${rectHeight}`);
        rect.setAttribute("rx", `${radius}`);
      }
      glowBottomRef.current =
        ((rectWidth * 1.5 + rectHeight) /
          (2 * (rectWidth + rectHeight))) *
        100;
    };

    const applyIdle = (x: number, y: number) => {
      const active = status === "listening" || status === "processing";
      const size = active ? ACTIVE_IDLE_SIZE : IDLE_SIZE;
      node.classList.remove("reticle--snapped");
      node.classList.toggle("reticle--active-idle", active);
      node.style.width = `${size}px`;
      node.style.height = `${size}px`;
      node.style.left = `${x - CURSOR_OFFSET - size}px`;
      node.style.top = `${y - CURSOR_OFFSET - size}px`;
      applyGlowGeometry(size, size, active);
    };

    const applySnap = (box: Box) => {
      node.classList.add("reticle--snapped");
      node.classList.remove("reticle--active-idle");
      node.style.width = `${box.width}px`;
      node.style.height = `${box.height}px`;
      node.style.left = `${box.left}px`;
      node.style.top = `${box.top}px`;
      applyGlowGeometry(box.width, box.height, false);
    };

    const reportTarget = (target: PointedTarget) => {
      const key = targetKey(target);
      if (key !== targetKeyRef.current) {
        targetKeyRef.current = key;
        onTargetChange(target);
      }
    };

    const update = () => {
      const { x, y, inside } = pointerRef.current;
      if (status === "processing" && frozen) {
        if (!frozenPositionRef.current) {
          frozenPositionRef.current = { x, y };
        }
        node.style.opacity = inside ? "1" : "0";
        applyIdle(frozenPositionRef.current.x, frozenPositionRef.current.y);
        return;
      }

      if (status === "processing") {
        const focused =
          focusTarget && focusTarget.kind !== "canvas"
            ? elementForTarget(focusTarget)
            : null;
        const processingElement =
          focused ??
          (attachedRef.current && document.contains(attachedRef.current)
            ? attachedRef.current
            : null);
        if (processingElement) {
          node.style.opacity = "1";
          attachedRef.current = processingElement;
          applySnap(boxFromElement(processingElement));
          return;
        }
      }

      if (!inside) {
        node.style.opacity = "0";
        reportTarget({ kind: "canvas" });
        return;
      }

      node.style.opacity = "1";

      const hit = pickHit(x, y);
      if (hit) {
        attachedRef.current = hit;
        applySnap(boxFromElement(hit));
        reportTarget(pointedTargetFromElement(hit));
        return;
      }

      const attached = attachedRef.current;
      if (attached && stillAttached(attached, x, y)) {
        applySnap(boxFromElement(attached));
        reportTarget(pointedTargetFromElement(attached));
        return;
      }

      attachedRef.current = null;
      applyIdle(x, y);
      reportTarget({ kind: "canvas" });
    };

    const onMove = (event: PointerEvent) => {
      pointerRef.current = {
        x: event.clientX,
        y: event.clientY,
        inside: true,
      };
      update();
    };

    const onLeave = () => {
      pointerRef.current.inside = false;
      attachedRef.current = null;
      update();
    };

    let raf = 0;
    let previousFrame = performance.now();
    let meterSamples = new Float32Array(1024);
    const setDash = (name: string, length: number, position: number) => {
      node.style.setProperty(
        `--reticle-${name}-dash-array`,
        `${length} ${100 - length}`,
      );
      node.style.setProperty(
        `--reticle-${name}-dash-offset`,
        `${length / 2 - position}`,
      );
    };
    const loop = (frame: number) => {
      const elapsed = Math.min(frame - previousFrame, 50);
      previousFrame = frame;

      const processingPulse =
        status === "processing" ? Math.sin(frame / 720) * 0.055 : 0;
      let targetGlowLevel =
        status === "processing" ? 0.62 + processingPulse : 0;
      let targetPeakLevel =
        status === "processing" ? 0.72 + processingPulse : 0;
      const analyser = analyserRef.current;
      if (status === "listening" && analyser) {
        if (meterSamples.length !== analyser.fftSize) {
          meterSamples = new Float32Array(analyser.fftSize);
        }
        analyser.getFloatTimeDomainData(meterSamples);
        let peak = 0;
        let sumSquares = 0;
        for (const sample of meterSamples) {
          const magnitude = Math.abs(sample);
          peak = Math.max(peak, magnitude);
          sumSquares += sample * sample;
        }
        const rms = Math.sqrt(sumSquares / meterSamples.length);
        const rmsLevel = Math.pow(
          Math.min(1, Math.max(0, (rms - 0.0025) / 0.055)),
          0.65,
        );
        const peakLevel = Math.pow(
          Math.min(1, Math.max(0, (peak - 0.012) / 0.25)),
          0.72,
        );
        targetGlowLevel = Math.min(1, Math.max(rmsLevel, peakLevel * 0.45));
        targetPeakLevel = Math.min(1, Math.max(peakLevel, rmsLevel * 0.65));
      }
      const response =
        1 -
        Math.exp(
          -elapsed /
            (targetGlowLevel > glowLevelRef.current ? 36 : 190),
        );
      const peakResponse =
        1 -
        Math.exp(
          -elapsed /
            (targetPeakLevel > glowPeakRef.current ? 22 : 125),
        );
      glowLevelRef.current +=
        (targetGlowLevel - glowLevelRef.current) * response;
      glowPeakRef.current +=
        (targetPeakLevel - glowPeakRef.current) * peakResponse;

      if (status === "processing" && !reduceMotion) {
        const velocityResponse = 1 - Math.exp(-elapsed / 420);
        glowVelocityRef.current +=
          (0.1 - glowVelocityRef.current) * velocityResponse;
        glowAngleRef.current =
          (glowAngleRef.current + elapsed * glowVelocityRef.current) % 360;
      } else {
        glowAngleRef.current = 0;
        glowVelocityRef.current = 0;
      }

      const glowPosition =
        glowBottomRef.current + (glowAngleRef.current / 360) * 100;
      setDash("outer", 17 + glowLevelRef.current * 9, glowPosition);
      setDash("halo", 8 + glowLevelRef.current * 8, glowPosition);
      setDash("core-tail", 6 + glowPeakRef.current * 6, glowPosition);
      setDash("core-shoulder", 4 + glowPeakRef.current * 5, glowPosition);
      setDash("core", 2 + glowPeakRef.current * 3, glowPosition);
      node.style.setProperty(
        "--reticle-outer-opacity",
        `${0.08 + glowLevelRef.current * 0.42}`,
      );
      node.style.setProperty(
        "--reticle-halo-opacity",
        `${0.2 + glowLevelRef.current * 0.72}`,
      );
      node.style.setProperty(
        "--reticle-core-tail-opacity",
        `${0.36 + glowPeakRef.current * 0.34}`,
      );
      node.style.setProperty(
        "--reticle-core-shoulder-opacity",
        `${0.52 + glowPeakRef.current * 0.38}`,
      );
      node.style.setProperty(
        "--reticle-core-opacity",
        `${0.72 + glowPeakRef.current * 0.28}`,
      );
      node.style.setProperty(
        "--reticle-glow-width",
        `${8 + glowLevelRef.current * 30}px`,
      );
      node.style.setProperty(
        "--reticle-outer-width",
        `${24 + glowLevelRef.current * 58}px`,
      );
      node.style.setProperty(
        "--reticle-halo-blur",
        `${5 + glowLevelRef.current * 9}px`,
      );
      node.style.setProperty(
        "--reticle-outer-blur",
        `${14 + glowLevelRef.current * 22}px`,
      );
      node.style.setProperty(
        "--reticle-core-tail-width",
        `${1 + glowPeakRef.current}px`,
      );
      node.style.setProperty(
        "--reticle-core-shoulder-width",
        `${1.8 + glowPeakRef.current * 2.7}px`,
      );
      node.style.setProperty(
        "--reticle-core-width",
        `${2.8 + glowPeakRef.current * 3.7}px`,
      );

      if (
        status === "listening" ||
        status === "processing" ||
        frozen ||
        (attachedRef.current && pointerRef.current.inside)
      ) {
        update();
      }
      raf = requestAnimationFrame(loop);
    };

    window.addEventListener("pointermove", onMove);
    document.documentElement.addEventListener("pointerleave", onLeave);
    update();
    raf = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(raf);
    };
  }, [analyserRef, focusTarget, frozen, onTargetChange, status]);

  return (
    <div
      ref={elRef}
      className={`reticle reticle--${status}`}
      aria-hidden="true"
    >
      <svg
        ref={glowSvgRef}
        className="reticle-glow"
        preserveAspectRatio="none"
      >
        <rect pathLength="100" className="reticle-glow__outer" />
        <rect pathLength="100" className="reticle-glow__halo" />
        <rect pathLength="100" className="reticle-glow__core-tail" />
        <rect pathLength="100" className="reticle-glow__core-shoulder" />
        <rect pathLength="100" className="reticle-glow__core" />
      </svg>
    </div>
  );
}
