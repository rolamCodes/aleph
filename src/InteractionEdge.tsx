import {
  BaseEdge,
  EdgeLabelRenderer,
  useInternalNode,
  useStore,
  type ConnectionLineComponentProps,
  type EdgeProps,
} from "@xyflow/react";
import { boxFromNode, getInteractionPath, laneForEdge } from "./edgePath";

export default function InteractionEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  style,
}: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const lane = useStore((state) =>
    laneForEdge(id, source, target, state.edges, state.nodeLookup),
  );
  const { path, labelX, labelY, originX, originY } = getInteractionPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    sourceBox: boxFromNode(sourceNode),
    targetBox: boxFromNode(targetNode),
    lane,
  });

  return (
    <>
      <BaseEdge id={id} path={path} style={style} />
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

export function InteractionConnectionLine({
  fromX,
  fromY,
  fromPosition,
  toX,
  toY,
  toPosition,
  fromNode,
  toNode,
  connectionLineStyle,
}: ConnectionLineComponentProps) {
  const { path } = getInteractionPath({
    sourceX: fromX,
    sourceY: fromY,
    targetX: toX,
    targetY: toY,
    sourcePosition: fromPosition,
    targetPosition: toPosition,
    sourceBox: boxFromNode(fromNode),
    targetBox: boxFromNode(toNode),
    lane: 0,
  });

  return (
    <path
      d={path}
      className="react-flow__connection-path"
      fill="none"
      style={connectionLineStyle}
    />
  );
}
