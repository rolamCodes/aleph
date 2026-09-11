import { useEffect, useRef } from "react";
import type { PointedTarget, VoiceStatus } from "./types";
import {
  orbReactFromEnvelope,
  processingOrbEnvelope,
  RESTING_ENVELOPE,
  type OrbReact,
} from "./voice/orbEnvelope";

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

function boxFromElement(el: Element, padding = PADDING): Box {
  const r = el.getBoundingClientRect();
  return {
    left: r.left - padding,
    top: r.top - padding,
    width: r.width + padding * 2,
    height: r.height + padding * 2,
  };
}

function setBox(el: HTMLElement, box: Box) {
  el.style.left = `${box.left}px`;
  el.style.top = `${box.top}px`;
  el.style.width = `${box.width}px`;
  el.style.height = `${box.height}px`;
}

function setPosition(el: HTMLElement, left: number, top: number) {
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.width = "";
  el.style.height = "";
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

const ENVELOPE_ATTACK = 0.35;
const ENVELOPE_RELEASE = 0.08;
const SETTLE_MS = 280;

function applyOrbReact(orb: HTMLElement, react: OrbReact) {
  orb.style.transform = `scale(${react.scale})`;
  orb.style.filter = `blur(${react.blur}px)`;
  orb.style.boxShadow =
    `0 0 ${react.glowBlur}px ${react.glowSpread}px ` +
    `hsl(200 100% 50% / ${react.glowOpacity})`;
}

function resetOrb(orb: HTMLElement) {
  orb.style.removeProperty("transform");
  orb.style.removeProperty("filter");
  orb.style.removeProperty("box-shadow");
}

function envelopeFromReact(react: OrbReact): number {
  return (react.scale - 0.65) / 1.35;
}

function blendEnvelope(current: number, target: number): number {
  const factor = target > current ? ENVELOPE_ATTACK : ENVELOPE_RELEASE;
  return current + (target - current) * factor;
}

export default function Companion({
  focusTarget,
  frozen = false,
  onTargetChange,
  readOrbReact,
  status,
}: {
  focusTarget?: PointedTarget;
  frozen?: boolean;
  onTargetChange: (target: PointedTarget) => void;
  readOrbReact: () => OrbReact | null;
  status: VoiceStatus;
}) {
  const reticleRef = useRef<HTMLDivElement>(null);
  const wellRef = useRef<HTMLDivElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const attachedRef = useRef<Element | null>(null);
  const pointerRef = useRef({ x: 0, y: 0, inside: false });
  const frozenPositionRef = useRef<{ x: number; y: number } | null>(null);
  const lastEnvelopeRef = useRef(RESTING_ENVELOPE);
  const processingStartedAtRef = useRef<number | null>(null);
  const readOrbReactRef = useRef(readOrbReact);
  const targetKeyRef = useRef("canvas");
  readOrbReactRef.current = readOrbReact;

  useEffect(() => {
    const reticle = reticleRef.current;
    const well = wellRef.current;
    if (!reticle || !well) {
      return;
    }

    if (!frozen) {
      frozenPositionRef.current = null;
    }

    const setVisible = (visible: boolean) => {
      const opacity = visible ? "1" : "0";
      reticle.style.opacity = opacity;
      well.style.opacity = opacity;
    };

    const snapToWell = () => {
      reticle.classList.add("reticle--snapped");
      reticle.classList.add("reticle--on-well");
      setBox(reticle, boxFromElement(well, 0));
    };

    const applyIdle = (x: number, y: number) => {
      const width = well.offsetWidth;
      const height = well.offsetHeight;
      const left = x - CURSOR_OFFSET - width;
      const top = y - CURSOR_OFFSET - height;
      if (well.style.left !== "" && well.style.top !== "") {
        snapToWell();
      } else {
        reticle.classList.add("reticle--snapped");
        reticle.classList.add("reticle--on-well");
        setBox(reticle, { left, top, width, height });
      }
      setPosition(well, left, top);
    };

    const applySnap = (focus: Box) => {
      reticle.classList.add("reticle--snapped");
      reticle.classList.remove("reticle--on-well");
      setBox(reticle, focus);
      setPosition(well, focus.left + focus.width, focus.top + focus.height);
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
        setVisible(inside);
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
          setVisible(true);
          attachedRef.current = processingElement;
          applySnap(boxFromElement(processingElement));
          return;
        }
      }

      if (!inside) {
        setVisible(false);
        reportTarget({ kind: "canvas" });
        return;
      }

      setVisible(true);

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
    const loop = () => {
      if (status === "processing" || frozen || pointerRef.current.inside) {
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
  }, [focusTarget, frozen, onTargetChange, status]);

  useEffect(() => {
    const orb = orbRef.current;
    if (!orb) {
      return;
    }

    const live = status === "listening" || status === "processing";
    if (status !== "processing") {
      processingStartedAtRef.current = null;
    } else if (processingStartedAtRef.current === null) {
      processingStartedAtRef.current = performance.now();
    }

    if (live) {
      orb.classList.add("companion-orb--live");
      let raf = 0;
      const tick = () => {
        if (status === "listening") {
          const sample = readOrbReactRef.current();
          if (sample) {
            lastEnvelopeRef.current = envelopeFromReact(sample);
            applyOrbReact(orb, sample);
          }
        } else {
          const startedAt = processingStartedAtRef.current ?? performance.now();
          const target = processingOrbEnvelope(performance.now() - startedAt);
          lastEnvelopeRef.current = blendEnvelope(
            lastEnvelopeRef.current,
            target,
          );
          applyOrbReact(orb, orbReactFromEnvelope(lastEnvelopeRef.current));
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => {
        cancelAnimationFrame(raf);
      };
    }

    const from = lastEnvelopeRef.current;
    if (Math.abs(from - RESTING_ENVELOPE) < 0.01) {
      lastEnvelopeRef.current = RESTING_ENVELOPE;
      resetOrb(orb);
      orb.classList.remove("companion-orb--live");
      return;
    }

    orb.classList.add("companion-orb--live");
    const origin = performance.now();
    let raf = 0;
    const tick = () => {
      const t = Math.min(1, (performance.now() - origin) / SETTLE_MS);
      const eased = 1 - (1 - t) * (1 - t);
      lastEnvelopeRef.current = from + (RESTING_ENVELOPE - from) * eased;
      applyOrbReact(orb, orbReactFromEnvelope(lastEnvelopeRef.current));
      if (t < 1) {
        raf = requestAnimationFrame(tick);
        return;
      }
      lastEnvelopeRef.current = RESTING_ENVELOPE;
      resetOrb(orb);
      orb.classList.remove("companion-orb--live");
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [status]);

  return (
    <div className="companion" aria-hidden="true">
      <div ref={wellRef} className="companion-well">
        <div ref={orbRef} className="companion-orb" />
      </div>
      <div ref={reticleRef} className="reticle" />
    </div>
  );
}
