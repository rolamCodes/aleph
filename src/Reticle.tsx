import { useEffect, useRef } from "react";
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
  focusTarget,
  frozen = false,
  onTargetChange,
  readAudioLevel,
  status,
}: {
  focusTarget?: PointedTarget;
  frozen?: boolean;
  onTargetChange: (target: PointedTarget) => void;
  readAudioLevel: () => number;
  status: VoiceStatus;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const attachedRef = useRef<Element | null>(null);
  const pointerRef = useRef({ x: 0, y: 0, inside: false });
  const frozenPositionRef = useRef<{ x: number; y: number } | null>(null);
  const previousAudioFrameRef = useRef<number | null>(null);
  const smoothedAudioLevelRef = useRef(0);
  const targetKeyRef = useRef("canvas");

  useEffect(() => {
    smoothedAudioLevelRef.current = 0;
    previousAudioFrameRef.current = null;

    if (status === "listening") {
      const node = elRef.current;
      node?.style.setProperty("--listen-opacity", "0.18");
      node?.style.setProperty("--listen-blur", "3px");
      node?.style.setProperty("--listen-spread", "0px");
    }
  }, [status]);

  useEffect(() => {
    const node = elRef.current;
    if (!node) {
      return;
    }

    if (!frozen) {
      frozenPositionRef.current = null;
    }

    const applyIdle = (x: number, y: number) => {
      const active = status === "listening" || status === "processing";
      const size = active ? ACTIVE_IDLE_SIZE : IDLE_SIZE;
      node.classList.remove("reticle--snapped");
      node.classList.toggle("reticle--active-idle", active);
      node.style.width = `${size}px`;
      node.style.height = `${size}px`;
      node.style.left = `${x - CURSOR_OFFSET - size}px`;
      node.style.top = `${y - CURSOR_OFFSET - size}px`;
    };

    const applySnap = (box: Box) => {
      node.classList.add("reticle--snapped");
      node.classList.remove("reticle--active-idle");
      node.style.width = `${box.width}px`;
      node.style.height = `${box.height}px`;
      node.style.left = `${box.left}px`;
      node.style.top = `${box.top}px`;
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
    const updateAudioAppearance = (timestamp: number) => {
      if (status !== "listening") {
        return;
      }
      if (document.hidden) {
        previousAudioFrameRef.current = null;
        return;
      }

      const previousTimestamp = previousAudioFrameRef.current;
      const dtMs =
        previousTimestamp === null
          ? 1000 / 60
          : Math.min(100, Math.max(0, timestamp - previousTimestamp));
      previousAudioFrameRef.current = timestamp;

      const rawLevel = readAudioLevel();
      const smoothedLevel = smoothedAudioLevelRef.current;
      const tauMs = rawLevel > smoothedLevel ? 50 : 200;
      const alpha = 1 - Math.exp(-dtMs / tauMs);
      const nextLevel =
        smoothedLevel + (rawLevel - smoothedLevel) * alpha;
      smoothedAudioLevelRef.current = nextLevel;

      node.style.setProperty(
        "--listen-opacity",
        `${0.18 + 0.52 * nextLevel}`,
      );
      node.style.setProperty("--listen-blur", `${3 + 9 * nextLevel}px`);
      node.style.setProperty(
        "--listen-spread",
        `${1.5 * nextLevel}px`,
      );
    };

    const loop = (timestamp: number) => {
      if (
        status === "processing" ||
        frozen ||
        (attachedRef.current && pointerRef.current.inside)
      ) {
        update();
      }
      updateAudioAppearance(timestamp);
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
  }, [focusTarget, frozen, onTargetChange, readAudioLevel, status]);

  return (
    <div
      ref={elRef}
      className={`reticle reticle--${status}`}
      aria-hidden="true"
    />
  );
}
