import type {
  ContextNode,
  InteractionEdge,
  PointedTarget,
} from "./types";

function collectItemIds(node: ContextNode): Set<string> {
  const ids = new Set<string>();
  for (const item of node.data.items) {
    ids.add(item.id);
    if (item.type === "component") {
      for (const element of item.elements) {
        ids.add(element.id);
      }
    }
  }
  return ids;
}

function findNewElements(
  prevNodes: ContextNode[],
  nextNodes: ContextNode[],
): PointedTarget | null {
  let last: PointedTarget | null = null;
  for (const nextNode of nextNodes) {
    const prevNode = prevNodes.find((node) => node.id === nextNode.id);
    const prevIds = prevNode ? collectItemIds(prevNode) : new Set<string>();
    for (const item of nextNode.data.items) {
      if (item.type === "element" && !prevIds.has(item.id)) {
        last = { kind: "element", id: item.id, contextId: nextNode.id };
      }
      if (item.type === "component") {
        for (const element of item.elements) {
          if (!prevIds.has(element.id)) {
            last = {
              kind: "element",
              id: element.id,
              contextId: nextNode.id,
            };
          }
        }
      }
    }
  }
  return last;
}

function findNewComponents(
  prevNodes: ContextNode[],
  nextNodes: ContextNode[],
): PointedTarget | null {
  let last: PointedTarget | null = null;
  for (const nextNode of nextNodes) {
    const prevNode = prevNodes.find((node) => node.id === nextNode.id);
    const prevIds = prevNode ? collectItemIds(prevNode) : new Set<string>();
    for (const item of nextNode.data.items) {
      if (item.type === "component" && !prevIds.has(item.id)) {
        last = { kind: "component", id: item.id, contextId: nextNode.id };
      }
    }
  }
  return last;
}

function findNewContexts(
  prevNodes: ContextNode[],
  nextNodes: ContextNode[],
): PointedTarget | null {
  const prevIds = new Set(prevNodes.map((node) => node.id));
  const newNodes = nextNodes.filter((node) => !prevIds.has(node.id));
  const lastNode = newNodes.at(-1);
  if (!lastNode) {
    return null;
  }
  return { kind: "context", id: lastNode.id };
}

function findNewEdges(
  prevEdges: InteractionEdge[],
  nextEdges: InteractionEdge[],
): PointedTarget | null {
  const prevIds = new Set(prevEdges.map((edge) => edge.id));
  const newEdges = nextEdges.filter((edge) => !prevIds.has(edge.id));
  const lastEdge = newEdges.at(-1);
  if (!lastEdge) {
    return null;
  }
  return { kind: "edge", id: lastEdge.id };
}

function findModifiedEntity(
  prevNodes: ContextNode[],
  nextNodes: ContextNode[],
): PointedTarget | null {
  let last: PointedTarget | null = null;
  for (const nextNode of nextNodes) {
    const prevNode = prevNodes.find((node) => node.id === nextNode.id);
    if (!prevNode) {
      continue;
    }
    if (JSON.stringify(prevNode.data) !== JSON.stringify(nextNode.data)) {
      last = { kind: "context", id: nextNode.id };
      for (let i = 0; i < nextNode.data.items.length; i += 1) {
        const nextItem = nextNode.data.items[i];
        const prevItem = prevNode.data.items[i];
        if (!nextItem || JSON.stringify(prevItem) === JSON.stringify(nextItem)) {
          continue;
        }
        if (nextItem.type === "element") {
          last = {
            kind: "element",
            id: nextItem.id,
            contextId: nextNode.id,
          };
        } else {
          last = {
            kind: "component",
            id: nextItem.id,
            contextId: nextNode.id,
          };
          for (const nextElement of nextItem.elements) {
            const prevElement =
              prevItem?.type === "component"
                ? prevItem.elements.find(
                    (element) => element.id === nextElement.id,
                  )
                : undefined;
            if (JSON.stringify(prevElement) !== JSON.stringify(nextElement)) {
              last = {
                kind: "element",
                id: nextElement.id,
                contextId: nextNode.id,
              };
            }
          }
        }
      }
    }
  }
  return last;
}

export function inferPointedTargetFromGraphChange(
  prevNodes: ContextNode[],
  prevEdges: InteractionEdge[],
  nextNodes: ContextNode[],
  nextEdges: InteractionEdge[],
): PointedTarget {
  return (
    findNewElements(prevNodes, nextNodes) ??
    findNewComponents(prevNodes, nextNodes) ??
    findNewContexts(prevNodes, nextNodes) ??
    findNewEdges(prevEdges, nextEdges) ??
    findModifiedEntity(prevNodes, nextNodes) ?? { kind: "canvas" }
  );
}
