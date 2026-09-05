import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Position,
  type EdgeProps,
} from "@xyflow/react";

const EXIT_PORT_SIZE = 36;

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
