import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";
import {
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { EdgeWaypoint, InteractionEdge } from "./types";

const EXIT_PORT_SIZE = 36;
const DRAG_THRESHOLD = 3;

type EdgePoint = EdgeWaypoint;

function getEdgePath(points: EdgePoint[]) {
  return points
    .map((point, index) =>
      index === 0 ? `M ${point.x} ${point.y}` : `L ${point.x} ${point.y}`,
    )
    .join(" ");
}

function getLabelPoint(points: EdgePoint[]): EdgePoint {
  const lengths = points.slice(1).map((point, index) => {
    const start = points[index];
    return start ? Math.hypot(point.x - start.x, point.y - start.y) : 0;
  });
  const halfway = lengths.reduce((total, length) => total + length, 0) / 2;
  let traversed = 0;

  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index];
    const start = points[index];
    const end = points[index + 1];
    if (
      length !== undefined &&
      start &&
      end &&
      traversed + length >= halfway &&
      length > 0
    ) {
      const progress = (halfway - traversed) / length;
      return {
        x: start.x + (end.x - start.x) * progress,
        y: start.y + (end.y - start.y) * progress,
      };
    }
    traversed += length ?? 0;
  }

  return points[0] ?? { x: 0, y: 0 };
}

function translateSegment(
  segmentStart: EdgePoint,
  segmentEnd: EdgePoint,
  offset: EdgePoint,
): EdgePoint[] {
  return [
    { x: segmentStart.x + offset.x, y: segmentStart.y + offset.y },
    { x: segmentEnd.x + offset.x, y: segmentEnd.y + offset.y },
  ];
}

function moveSegment(
  points: EdgePoint[],
  segmentIndex: number,
  offset: EdgePoint,
): EdgePoint[] {
  const pointIndexes =
    segmentIndex === 0
      ? [0]
      : segmentIndex === points.length
        ? [points.length - 1]
        : [segmentIndex - 1, segmentIndex];

  return points.map((point, index) =>
    pointIndexes.includes(index)
      ? { x: point.x + offset.x, y: point.y + offset.y }
      : point,
  );
}

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
  selected,
}: EdgeProps<InteractionEdge>) {
  const { screenToFlowPosition } = useReactFlow();
  const skipNextSegmentClick = useRef(false);
  const originX =
    sourcePosition === Position.Right ? sourceX - EXIT_PORT_SIZE / 2 : sourceX;
  const originY = sourceY;
  const points = data?.points ?? (data?.bend ? [data.bend] : []);
  const pathPoints = [
    { x: originX, y: originY },
    ...points,
    { x: targetX, y: targetY },
  ];
  const edgePath = getEdgePath(pathPoints);
  const labelPoint = getLabelPoint(pathPoints);
  const editing = selected === true;

  const toFlowPoint = (event: Pick<PointerEvent, "clientX" | "clientY">) =>
    screenToFlowPosition({ x: event.clientX, y: event.clientY });

  const onWaypointPointerDown =
    (pointIndex: number) =>
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);

      const onPointerMove = (moveEvent: PointerEvent) => {
        const nextPoint = toFlowPoint(moveEvent);
        data?.onPointsChange?.(
          id,
          points.map((point, index) =>
            index === pointIndex ? nextPoint : point,
          ),
        );
      };
      const onPointerUp = (upEvent: PointerEvent) => {
        event.currentTarget.releasePointerCapture(upEvent.pointerId);
        event.currentTarget.removeEventListener("pointermove", onPointerMove);
        data?.onPointsChangeEnd?.();
      };

      event.currentTarget.addEventListener("pointermove", onPointerMove);
      event.currentTarget.addEventListener("pointerup", onPointerUp, {
        once: true,
      });
    };

  const onSegmentPointerDown =
    (segmentIndex: number) => (event: ReactPointerEvent<SVGPathElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const segmentStart = pathPoints[segmentIndex];
      const segmentEnd = pathPoints[segmentIndex + 1];
      if (!segmentStart || !segmentEnd) return;

      const start = toFlowPoint(event);
      const startPoints = points.map((point) => ({ ...point }));
      const startClientPosition = { x: event.clientX, y: event.clientY };
      let moved = false;

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (
          !moved &&
          Math.hypot(
            moveEvent.clientX - startClientPosition.x,
            moveEvent.clientY - startClientPosition.y,
          ) < DRAG_THRESHOLD
        ) {
          return;
        }
        moved = true;
        const current = toFlowPoint(moveEvent);
        const offset = { x: current.x - start.x, y: current.y - start.y };
        const nextPoints =
          startPoints.length === 0
            ? translateSegment(segmentStart, segmentEnd, offset)
            : moveSegment(startPoints, segmentIndex, offset);
        data?.onPointsChange?.(id, nextPoints);
      };
      const onPointerUp = () => {
        window.removeEventListener("pointermove", onPointerMove);
        if (moved) {
          skipNextSegmentClick.current = true;
          data?.onPointsChangeEnd?.();
        }
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp, { once: true });
    };

  const onSegmentClick =
    (segmentIndex: number) => (event: ReactMouseEvent<SVGPathElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (skipNextSegmentClick.current) {
        skipNextSegmentClick.current = false;
        return;
      }
      const nextPoints = [...points];
      nextPoints.splice(segmentIndex, 0, toFlowPoint(event));
      data?.onPointsChange?.(id, nextPoints);
      data?.onPointsChangeEnd?.();
    };

  const onWaypointDoubleClick =
    (pointIndex: number) => (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      data?.onPointsChange?.(
        id,
        points.filter((_, index) => index !== pointIndex),
      );
      data?.onPointsChangeEnd?.();
    };

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={style}
        interactionWidth={editing ? 20 : 12}
      />
      <circle className="edge-terminal" cx={originX} cy={originY} r={6} />
      {editing
        ? pathPoints.slice(1).map((point, index) => {
            const start = pathPoints[index];
            if (!start) return null;
            return (
              <path
                key={`${id}-segment-${index}`}
                className="edge-segment-hit"
                d={getEdgePath([start, point])}
                onClick={onSegmentClick(index)}
                onPointerDown={onSegmentPointerDown(index)}
              />
            );
          })
        : null}
      {editing ? (
        <EdgeLabelRenderer>
          {points.map((point, index) => (
            <div
              key={`${id}-waypoint-${index}`}
              className="edge-waypoint"
              style={{
                transform: `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)`,
              }}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={onWaypointDoubleClick(index)}
              onPointerDown={onWaypointPointerDown(index)}
            />
          ))}
          {label ? (
            <div
              className="edge-label"
              style={{
                transform: `translate(-50%, -50%) translate(${labelPoint.x}px,${labelPoint.y + 18}px)`,
              }}
            >
              {String(label)}
            </div>
          ) : null}
        </EdgeLabelRenderer>
      ) : label ? (
        <EdgeLabelRenderer>
          <div
            className="edge-label"
            style={{
              transform: `translate(-50%, -50%) translate(${labelPoint.x}px,${labelPoint.y + 18}px)`,
            }}
          >
            {String(label)}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
