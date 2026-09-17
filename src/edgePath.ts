import { getSmoothStepPath, Position } from "@xyflow/react";

export const EXIT_PORT_SIZE = 36;

const MIN_OFFSET = 20;
const PADDING = 24;
const LANE_GAP = 18;

export type NodeBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type FlowNodeBounds = {
  internals: { positionAbsolute: { x: number; y: number } };
  measured: { width?: number; height?: number };
};

export function originXForHandle(
  sourceX: number,
  sourcePosition: Position,
): number {
  return sourcePosition === Position.Right
    ? sourceX - EXIT_PORT_SIZE / 2
    : sourceX;
}

export function boxFromNode(
  node: FlowNodeBounds | undefined | null,
): NodeBox | undefined {
  if (!node) return undefined;
  const width = node.measured.width;
  const height = node.measured.height;
  if (width == null || height == null) return undefined;
  const { x, y } = node.internals.positionAbsolute;
  return {
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
  };
}

function detourSpansOverlap(
  sourceA: NodeBox,
  targetA: NodeBox,
  sourceB: NodeBox,
  targetB: NodeBox,
): boolean {
  const startA = Math.min(sourceA.right, targetA.left);
  const endA = Math.max(sourceA.right, targetA.left);
  const startB = Math.min(sourceB.right, targetB.left);
  const endB = Math.max(sourceB.right, targetB.left);
  return startA < endB && startB < endA;
}

export function laneForEdge(
  edgeId: string,
  sourceId: string,
  targetId: string,
  edges: readonly { id: string; source: string; target: string }[],
  nodeLookup: ReadonlyMap<string, FlowNodeBounds>,
): number {
  const sourceBox = boxFromNode(nodeLookup.get(sourceId));
  const targetBox = boxFromNode(nodeLookup.get(targetId));
  if (!sourceBox || !targetBox) return 0;

  const overlapping = edges.filter((edge) => {
    const otherSource = boxFromNode(nodeLookup.get(edge.source));
    const otherTarget = boxFromNode(nodeLookup.get(edge.target));
    if (!otherSource || !otherTarget) return false;
    if (otherSource.right < otherTarget.left) return false;
    return detourSpansOverlap(sourceBox, targetBox, otherSource, otherTarget);
  });
  overlapping.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const index = overlapping.findIndex((edge) => edge.id === edgeId);
  return index < 0 ? 0 : index;
}

export function getInteractionPath({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  sourceBox,
  targetBox,
  lane = 0,
}: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  sourceBox?: NodeBox;
  targetBox?: NodeBox;
  lane?: number;
}): {
  path: string;
  labelX: number;
  labelY: number;
  originX: number;
  originY: number;
} {
  const originX = originXForHandle(sourceX, sourcePosition);
  const originY = sourceY;
  const offset = sourceBox
    ? Math.max(MIN_OFFSET, sourceBox.right - originX + PADDING)
    : MIN_OFFSET;
  const isBackward = originX + 2 * offset >= targetX;

  let centerY: number | undefined;
  if (isBackward) {
    const boxes = [sourceBox, targetBox].filter((box): box is NodeBox =>
      Boolean(box),
    );
    if (boxes.length > 0) {
      const aboveY = Math.min(...boxes.map((box) => box.top)) - PADDING;
      const belowY = Math.max(...boxes.map((box) => box.bottom)) + PADDING;
      const costAbove = boxes.reduce(
        (sum, box) => sum + (box.top + box.bottom) / 2 - aboveY,
        0,
      );
      const costBelow = boxes.reduce(
        (sum, box) => sum + (belowY - (box.top + box.bottom) / 2),
        0,
      );
      const goBelow = costBelow <= costAbove;
      centerY = goBelow
        ? belowY + lane * LANE_GAP
        : aboveY - lane * LANE_GAP;
    }
  }

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: originX,
    sourceY: originY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    offset,
    centerY,
  });

  return { path, labelX, labelY, originX, originY };
}
