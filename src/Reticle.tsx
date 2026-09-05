import { useEffect, useRef } from "react";

const IDLE_SIZE = 8;
const CURSOR_OFFSET = 12;
const ATTACHMENT_RADIUS = 40;
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

export default function Reticle() {
  const elRef = useRef<HTMLDivElement>(null);
  const attachedRef = useRef<Element | null>(null);
  const pointerRef = useRef({ x: 0, y: 0, inside: false });

  useEffect(() => {
    const node = elRef.current;
    if (!node) {
      return;
    }

    const applyIdle = (x: number, y: number) => {
      node.classList.remove("reticle--snapped");
      node.style.transition = "width 150ms ease, height 150ms ease";
      node.style.width = `${IDLE_SIZE}px`;
      node.style.height = `${IDLE_SIZE}px`;
      node.style.left = `${x - CURSOR_OFFSET - IDLE_SIZE}px`;
      node.style.top = `${y - CURSOR_OFFSET - IDLE_SIZE}px`;
    };

    const applySnap = (box: Box) => {
      node.classList.add("reticle--snapped");
      node.style.transition =
        "left 150ms ease, top 150ms ease, width 150ms ease, height 150ms ease";
      node.style.width = `${box.width}px`;
      node.style.height = `${box.height}px`;
      node.style.left = `${box.left}px`;
      node.style.top = `${box.top}px`;
    };

    const update = () => {
      const { x, y, inside } = pointerRef.current;
      if (!inside) {
        node.style.opacity = "0";
        return;
      }

      node.style.opacity = "1";

      const hit = pickHit(x, y);
      if (hit) {
        attachedRef.current = hit;
        applySnap(boxFromElement(hit));
        return;
      }

      const attached = attachedRef.current;
      if (attached && stillAttached(attached, x, y)) {
        applySnap(boxFromElement(attached));
        return;
      }

      attachedRef.current = null;
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
