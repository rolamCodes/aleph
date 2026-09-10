import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { PointedTarget } from "./types";

const DISC_SIZE = 28;
const CURSOR_OFFSET = 12;
const ATTACHMENT_RADIUS = 80;
const TARGET_PADDING = 2;
const DOCK_GAP = 8;
const RETICLE_OUTSET = 3;
const IDLE_RETICLE_SIZE = DISC_SIZE + RETICLE_OUTSET * 2;
const TARGET_SELECTOR = "[data-reticle], .react-flow__edge";

type Point = { x: number; y: number };

function distanceToRect(x: number, y: number, r: DOMRect): number {
  const dx = Math.max(r.left - x, 0, x - r.right);
  const dy = Math.max(r.top - y, 0, y - r.bottom);
  return Math.hypot(dx, dy);
}

function containsPoint(x: number, y: number, r: DOMRect): boolean {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function boxFromElement(el: Element): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const r = el.getBoundingClientRect();
  return {
    left: r.left - TARGET_PADDING,
    top: r.top - TARGET_PADDING,
    width: r.width + TARGET_PADDING * 2,
    height: r.height + TARGET_PADDING * 2,
  };
}

function pickHit(x: number, y: number): Element | null {
  let bestEl: Element | null = null;
  let bestArea = Infinity;

  for (const el of document.querySelectorAll(TARGET_SELECTOR)) {
    if (el.closest("[data-companion]")) {
      continue;
    }
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

function companionContains(x: number, y: number, companion: Element | null): boolean {
  if (!companion) {
    return false;
  }
  return containsPoint(x, y, companion.getBoundingClientRect());
}

function stillAttached(
  target: Element,
  x: number,
  y: number,
  companion: Element | null,
): boolean {
  if (companionContains(x, y, companion)) {
    return document.contains(target);
  }
  if (!document.contains(target)) {
    return false;
  }
  return distanceToRect(x, y, target.getBoundingClientRect()) <= ATTACHMENT_RADIUS;
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
    for (const edge of document.querySelectorAll<HTMLElement>(".react-flow__edge")) {
      if (edge.dataset.id === target.id) {
        return edge;
      }
    }
    return null;
  }

  for (const element of document.querySelectorAll<HTMLElement>("[data-reticle-kind]")) {
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

function freePosition(x: number, y: number): Point {
  return {
    x: x - CURSOR_OFFSET - DISC_SIZE,
    y: y - CURSOR_OFFSET - DISC_SIZE,
  };
}

function dockPosition(el: Element): Point {
  const r = el.getBoundingClientRect();
  return { x: r.right + DOCK_GAP, y: r.bottom + DOCK_GAP };
}

function stylePosition(el: HTMLElement | null): Point | null {
  if (!el || el.style.left === "" || el.style.top === "") {
    return null;
  }
  return {
    x: Number.parseFloat(el.style.left),
    y: Number.parseFloat(el.style.top),
  };
}

function placeCompanion(node: HTMLElement, pos: Point): void {
  node.style.left = `${pos.x}px`;
  node.style.top = `${pos.y}px`;
}

function placeCircularReticle(reticle: HTMLElement, companionPos: Point): void {
  reticle.classList.remove("reticle--snapped");
  reticle.style.width = `${IDLE_RETICLE_SIZE}px`;
  reticle.style.height = `${IDLE_RETICLE_SIZE}px`;
  reticle.style.left = `${companionPos.x - RETICLE_OUTSET}px`;
  reticle.style.top = `${companionPos.y - RETICLE_OUTSET}px`;
}

function placeTargetReticle(reticle: HTMLElement, el: Element): void {
  const box = boxFromElement(el);
  reticle.classList.add("reticle--snapped");
  reticle.style.width = `${box.width}px`;
  reticle.style.height = `${box.height}px`;
  reticle.style.left = `${box.left}px`;
  reticle.style.top = `${box.top}px`;
}

export function useCompanionPosition({
  active,
  locked,
  freeze,
  focusTarget,
  onTargetChange,
}: {
  active: boolean;
  locked: boolean;
  freeze: boolean;
  focusTarget?: PointedTarget;
  onTargetChange: (target: PointedTarget) => void;
}): {
  companionRef: RefObject<HTMLDivElement | null>;
  reticleRef: RefObject<HTMLDivElement | null>;
} {
  const companionRef = useRef<HTMLDivElement>(null);
  const reticleRef = useRef<HTMLDivElement>(null);
  const attachedRef = useRef<Element | null>(null);
  const pointerRef = useRef({ x: 0, y: 0, inside: false });
  const frozenPositionRef = useRef<Point | null>(null);
  const lastAnchorRef = useRef<Point | null>(null);
  const targetKeyRef = useRef("canvas");
  const lockedRef = useRef(locked);
  const freezeRef = useRef(freeze);
  const focusTargetRef = useRef(focusTarget);
  const onTargetChangeRef = useRef(onTargetChange);
  const updateRef = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    lockedRef.current = locked;
    freezeRef.current = freeze;
    focusTargetRef.current = focusTarget;
    onTargetChangeRef.current = onTargetChange;
    updateRef.current();
  }, [locked, freeze, focusTarget, onTargetChange]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const reportTarget = (target: PointedTarget) => {
      const key = targetKey(target);
      if (key !== targetKeyRef.current) {
        targetKeyRef.current = key;
        onTargetChangeRef.current(target);
      }
    };

    const setVisible = (
      companion: HTMLElement,
      reticle: HTMLElement,
      visible: boolean,
    ) => {
      const opacity = visible ? "1" : "0";
      companion.style.opacity = opacity;
      companion.style.pointerEvents = visible ? "auto" : "none";
      reticle.style.opacity = opacity;
    };

    const applyDock = (
      companion: HTMLElement,
      reticle: HTMLElement,
      el: Element,
    ) => {
      const pos = dockPosition(el);
      lastAnchorRef.current = pos;
      attachedRef.current = el;
      placeCompanion(companion, pos);
      placeTargetReticle(reticle, el);
    };

    const applyFreeAt = (
      companion: HTMLElement,
      reticle: HTMLElement,
      pos: Point,
    ) => {
      placeCompanion(companion, pos);
      placeCircularReticle(reticle, pos);
    };

    const update = () => {
      const companion = companionRef.current;
      const reticle = reticleRef.current;
      if (!companion || !reticle) {
        return;
      }

      const { x, y, inside } = pointerRef.current;
      const lockedNow = lockedRef.current;
      const freezeNow = freezeRef.current;
      const focus = focusTargetRef.current;

      if (!inside && !lockedNow) {
        frozenPositionRef.current = null;
        attachedRef.current = null;
        setVisible(companion, reticle, false);
        reportTarget({ kind: "canvas" });
        return;
      }

      setVisible(companion, reticle, true);

      if (!lockedNow || !freezeNow) {
        frozenPositionRef.current = null;
      }

      if (lockedNow && (freezeNow || !focus || focus.kind === "canvas")) {
        if (!frozenPositionRef.current) {
          frozenPositionRef.current =
            stylePosition(companion) ??
            lastAnchorRef.current ??
            freePosition(x, y);
        }
        applyFreeAt(companion, reticle, frozenPositionRef.current);
        reportTarget(focus ?? { kind: "canvas" });
        return;
      }

      if (lockedNow && focus) {
        const focused = elementForTarget(focus);
        const fallback =
          attachedRef.current && document.contains(attachedRef.current)
            ? attachedRef.current
            : null;
        const el = focused ?? fallback;
        if (el) {
          applyDock(companion, reticle, el);
          reportTarget(pointedTargetFromElement(el));
          return;
        }
        const anchor =
          lastAnchorRef.current ??
          frozenPositionRef.current ??
          stylePosition(companion) ??
          freePosition(x, y);
        applyFreeAt(companion, reticle, anchor);
        reportTarget(focus);
        return;
      }

      if (companionContains(x, y, companion)) {
        const attached = attachedRef.current;
        if (attached && document.contains(attached)) {
          applyDock(companion, reticle, attached);
          reportTarget(pointedTargetFromElement(attached));
          return;
        }
      }

      const hit = pickHit(x, y);
      if (hit) {
        applyDock(companion, reticle, hit);
        reportTarget(pointedTargetFromElement(hit));
        return;
      }

      const attached = attachedRef.current;
      if (attached && stillAttached(attached, x, y, companion)) {
        applyDock(companion, reticle, attached);
        reportTarget(pointedTargetFromElement(attached));
        return;
      }

      attachedRef.current = null;
      applyFreeAt(companion, reticle, freePosition(x, y));
      reportTarget({ kind: "canvas" });
    };

    updateRef.current = update;

    const onMove = (event: PointerEvent) => {
      pointerRef.current = {
        x: event.clientX,
        y: event.clientY,
        inside: true,
      };
      update();
    };

    const onLeave = (event: PointerEvent) => {
      if (event.relatedTarget !== null) {
        return;
      }
      pointerRef.current.inside = false;
      if (!lockedRef.current) {
        attachedRef.current = null;
      }
      update();
    };

    let raf = 0;
    const loop = () => {
      if (
        lockedRef.current ||
        freezeRef.current ||
        (attachedRef.current && pointerRef.current.inside)
      ) {
        update();
      }
      raf = requestAnimationFrame(loop);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerout", onLeave);
    update();
    raf = requestAnimationFrame(loop);

    return () => {
      updateRef.current = () => {};
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerout", onLeave);
      cancelAnimationFrame(raf);
    };
  }, [active]);

  return { companionRef, reticleRef };
}
