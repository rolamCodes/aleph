import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Position,
  type EdgeProps,
} from "@xyflow/react";

const EXIT_PORT_SIZE = 36;
const RECONNECT_RADIUS = 14;

function offsetEndpoint(
  x: number,
  y: number,
  position: Position,
  distance: number,
) {
  if (position === Position.Left) return { x: x - distance, y };
  if (position === Position.Right) return { x: x + distance, y };
  if (position === Position.Top) return { x, y: y - distance };
  return { x, y: y + distance };
}

export default function InteractionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  style,
}: EdgeProps) {
  const originX =
    sourcePosition === Position.Right ? sourceX - EXIT_PORT_SIZE / 2 : sourceX;
  const originY = sourceY;
  const sourceGrip = offsetEndpoint(
    sourceX,
    sourceY,
    sourcePosition,
    RECONNECT_RADIUS,
  );
  const targetGrip = offsetEndpoint(
    targetX,
    targetY,
    targetPosition,
    RECONNECT_RADIUS,
  );

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX: originX,
    sourceY: originY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} />
      <circle className="edge-terminal" cx={originX} cy={originY} r={6} />
      <circle
        className="edge-grip"
        cx={sourceGrip.x}
        cy={sourceGrip.y}
        r={5}
      />
      <circle
        className="edge-grip"
        cx={targetGrip.x}
        cy={targetGrip.y}
        r={5}
      />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="edge-label"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
          >
            {String(label)}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
