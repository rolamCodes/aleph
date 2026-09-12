import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { InteractionEdge } from "./types";

const EXIT_PORT_SIZE = 36;

export default function InteractionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  label,
  style,
  data,
}: EdgeProps<InteractionEdge>) {
  const { screenToFlowPosition } = useReactFlow();
  const originX =
    sourcePosition === Position.Right ? sourceX - EXIT_PORT_SIZE / 2 : sourceX;
  const originY = sourceY;
  const bend = data?.bend ?? {
    x: (originX + targetX) / 2,
    y: (originY + targetY) / 2,
  };
  const edgePath = `M ${originX} ${originY} L ${bend.x} ${bend.y} L ${targetX} ${targetY}`;

  const onBendPointerDown = (
    event: ReactPointerEvent<SVGCircleElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const onPointerMove = (moveEvent: PointerEvent) => {
      data?.onBendChange?.(
        id,
        screenToFlowPosition({
          x: moveEvent.clientX,
          y: moveEvent.clientY,
        }),
      );
    };
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      data?.onBendChangeEnd?.();
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  };

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} />
      <circle className="edge-terminal" cx={originX} cy={originY} r={6} />
      <circle
        className="edge-stretch-grip"
        cx={bend.x}
        cy={bend.y}
        r={7}
        onPointerDown={onBendPointerDown}
      />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="edge-label"
            style={{
              transform: `translate(-50%, -50%) translate(${bend.x}px,${bend.y + 18}px)`,
            }}
          >
            {String(label)}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
