import { useEffect, useRef } from "react";

const IDLE_SIZE = 16;
const ATTACHMENT_RADIUS = 40;
const PADDING = 2;
const EDGE_SNAP_DISTANCE = 12;
const MARKED_SELECTOR = "[data-reticle]";
const EDGE_PATH_SELECTOR = ".react-flow__edge-path";

type Box = {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: string;
};

type Target =
  | { kind: "box"; el: Element }
  | { kind: "path"; el: SVGPathElement };

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
  const radius = getComputedStyle(el).borderRadius || "8px";
  return {
    left: r.left - PADDING,
    top: r.top - PADDING,
    width: r.width + PADDING * 2,
    height: r.height + PADDING * 2,
    radius,
  };
}

function closestPointOnPath(
  x: number,
  y: number,
  path: SVGPathElement,
): { distance: number; x: number; y: number } {
  const ctm = path.getScreenCTM();
  if (!ctm) {
    return { distance: Infinity, x, y };
  }

  const length = path.getTotalLength();
  if (length === 0) {
    return { distance: Infinity, x, y };
  }

  let best = { distance: Infinity, x, y };
  const steps = 24;
  for (let i = 0; i <= steps; i += 1) {
    const point = path.getPointAtLength((length * i) / steps);
    const screen = new DOMPoint(point.x, point.y).matrixTransform(ctm);
    const distance = Math.hypot(screen.x - x, screen.y - y);
    if (distance < best.distance) {
      best = { distance, x: screen.x, y: screen.y };
    }
  }

  return best;
}

function boxFromPathPoint(x: number, y: number): Box {
  const size = IDLE_SIZE + 8;
  return {
    left: x - size / 2,
    top: y - size / 2,
    width: size,
    height: size,
    radius: "50%",
  };
}

function pickHit(x: number, y: number): Target | null {
  let bestEl: Element | null = null;
  let bestArea = Infinity;

  for (const el of document.querySelectorAll(MARKED_SELECTOR)) {
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

  if (bestEl) {
    return { kind: "box", el: bestEl };
  }

  let bestPath: SVGPathElement | null = null;
  let bestDistance = EDGE_SNAP_DISTANCE;

  for (const el of document.querySelectorAll<SVGPathElement>(
    EDGE_PATH_SELECTOR,
  )) {
    const { distance } = closestPointOnPath(x, y, el);
    if (distance <= bestDistance) {
      bestPath = el;
      bestDistance = distance;
    }
  }

  return bestPath ? { kind: "path", el: bestPath } : null;
}

function stillAttached(target: Target, x: number, y: number): boolean {
  if (!document.contains(target.el)) {
    return false;
  }

  if (target.kind === "box") {
    return (
      distanceToRect(x, y, target.el.getBoundingClientRect()) <=
      ATTACHMENT_RADIUS
    );
  }

  return closestPointOnPath(x, y, target.el).distance <= ATTACHMENT_RADIUS;
}

function boxForTarget(target: Target, x: number, y: number): Box {
  if (target.kind === "box") {
    return boxFromElement(target.el);
  }

  const nearest = closestPointOnPath(x, y, target.el);
  return boxFromPathPoint(nearest.x, nearest.y);
}

export default function Reticle() {
  const elRef = useRef<HTMLDivElement>(null);
  const attachedRef = useRef<Target | null>(null);
  const pointerRef = useRef({ x: 0, y: 0, inside: false });

  useEffect(() => {
    const node = elRef.current;
    if (!node) {
      return;
    }

    const applyIdle = (x: number, y: number) => {
      node.classList.remove("reticle--snapped");
      node.style.transition =
        "width 150ms ease, height 150ms ease, border-radius 150ms ease";
      node.style.width = `${IDLE_SIZE}px`;
      node.style.height = `${IDLE_SIZE}px`;
      node.style.left = `${x - IDLE_SIZE / 2}px`;
      node.style.top = `${y - IDLE_SIZE / 2}px`;
      node.style.borderRadius = "50%";
    };

    const applySnap = (box: Box) => {
      node.classList.add("reticle--snapped");
      node.style.transition =
        "left 150ms ease, top 150ms ease, width 150ms ease, height 150ms ease, border-radius 150ms ease";
      node.style.width = `${box.width}px`;
      node.style.height = `${box.height}px`;
      node.style.left = `${box.left}px`;
      node.style.top = `${box.top}px`;
      node.style.borderRadius = box.radius;
    };

    const update = () => {
      const { x, y, inside } = pointerRef.current;
      if (!inside) {
        node.style.opacity = "0";
        return;
      }

      node.style.opacity = "1";

      const attached = attachedRef.current;
      if (attached && stillAttached(attached, x, y)) {
        applySnap(boxForTarget(attached, x, y));
        return;
      }

      attachedRef.current = null;
      const hit = pickHit(x, y);
      if (hit) {
        attachedRef.current = hit;
        applySnap(boxForTarget(hit, x, y));
        return;
      }

      applyIdle(x, y);
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
      if (attachedRef.current && pointerRef.current.inside) {
        update();
      }
      raf = requestAnimationFrame(loop);
    };

    window.addEventListener("pointermove", onMove);
    document.documentElement.addEventListener("pointerleave", onLeave);
    raf = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(raf);
    };
  }, []);

  return <div ref={elRef} className="reticle" aria-hidden="true" />;
}
