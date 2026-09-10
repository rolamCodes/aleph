import type { RefObject } from "react";

export default function Reticle({
  reticleRef,
}: {
  reticleRef: RefObject<HTMLDivElement | null>;
}) {
  return <div ref={reticleRef} className="reticle" aria-hidden="true" />;
}
