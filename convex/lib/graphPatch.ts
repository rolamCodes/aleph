import type {
  ContextItem,
  ContextKind,
  ContextNode,
  ElementKind,
  GraphOperation,
  GraphState,
  InteractionEdge,
  PatchLayout,
  UIElement,
} from "./graphTypes";

const contextKinds = new Set<ContextKind>([
  "screen",
  "modal",
  "popover",
  "sheet",
  "drawer",
]);
const elementKinds = new Set<ElementKind>(["text", "button", "input", "image"]);
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const result = value[key];
  if (typeof result !== "string" || result.trim() === "") {
    throw new Error(`Graph patch requires a non-empty ${key}`);
  }
  return result.trim();
}

function optionalString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const result = value[key];
  if (result === undefined) return undefined;
  if (typeof result !== "string" || result.trim() === "") {
    throw new Error(`Graph patch ${key} must be a non-empty string`);
  }
  return result.trim();
}

function optionalBoolean(
  value: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const result = value[key];
  if (result !== undefined && typeof result !== "boolean") {
    throw new Error(`Graph patch ${key} must be a boolean`);
  }
  return result;
}

function parseContextKind(value: string): ContextKind {
  if (!contextKinds.has(value as ContextKind)) {
    throw new Error(`Unknown context kind: ${value}`);
  }
  return value as ContextKind;
}

function parseElementKind(value: string): ElementKind {
  if (!elementKinds.has(value as ElementKind)) {
    throw new Error(`Unknown element kind: ${value}`);
  }
  return value as ElementKind;
}

export function parseGraphOperation(value: unknown): GraphOperation {
  if (!isRecord(value)) throw new Error("Graph operation must be an object");
  const op = requiredString(value, "op");
  switch (op) {
    case "addContext":
      return {
        op,
        id: requiredString(value, "id"),
        kind: parseContextKind(requiredString(value, "kind")),
        name: requiredString(value, "name"),
        anchorContextId: optionalString(value, "anchorContextId"),
      };
    case "updateContext": {
      const name = optionalString(value, "name");
      const rawKind = optionalString(value, "kind");
      if (!name && !rawKind) throw new Error("updateContext requires a change");
      return {
        op,
        contextId: requiredString(value, "contextId"),
        name,
        kind: rawKind ? parseContextKind(rawKind) : undefined,
      };
    }
    case "removeContext":
      return { op, contextId: requiredString(value, "contextId") };
    case "addElement": {
      const interactive = optionalBoolean(value, "interactive");
      if (interactive === undefined) {
        throw new Error("addElement requires interactive");
      }
      return {
        op,
        contextId: requiredString(value, "contextId"),
        id: requiredString(value, "id"),
        kind: parseElementKind(requiredString(value, "kind")),
        label: requiredString(value, "label"),
        interactive,
        componentId: optionalString(value, "componentId"),
        afterId: optionalString(value, "afterId"),
      };
    }
    case "addComponent":
      return {
        op,
        contextId: requiredString(value, "contextId"),
        id: requiredString(value, "id"),
        name: requiredString(value, "name"),
        afterId: optionalString(value, "afterId"),
      };
    case "updateElement": {
      const label = optionalString(value, "label");
      const rawKind = optionalString(value, "kind");
      const interactive = optionalBoolean(value, "interactive");
      if (!label && !rawKind && interactive === undefined) {
        throw new Error("updateElement requires a change");
      }
      return {
        op,
        contextId: requiredString(value, "contextId"),
        elementId: requiredString(value, "elementId"),
        label,
        kind: rawKind ? parseElementKind(rawKind) : undefined,
        interactive,
      };
    }
    case "updateComponent":
      return {
        op,
        contextId: requiredString(value, "contextId"),
        componentId: requiredString(value, "componentId"),
        name: requiredString(value, "name"),
      };
    case "moveItem":
      return {
        op,
        contextId: requiredString(value, "contextId"),
        itemId: requiredString(value, "itemId"),
        componentId: optionalString(value, "componentId"),
        afterId: optionalString(value, "afterId"),
      };
    case "removeItem":
      return {
        op,
        contextId: requiredString(value, "contextId"),
        itemId: requiredString(value, "itemId"),
      };
    case "addEdge":
      return {
        op,
        id: requiredString(value, "id"),
        sourceContextId: requiredString(value, "sourceContextId"),
        sourceElementId: requiredString(value, "sourceElementId"),
        targetContextId: requiredString(value, "targetContextId"),
        interaction: requiredString(value, "interaction"),
      };
    case "updateEdge":
      return {
        op,
        edgeId: requiredString(value, "edgeId"),
        interaction: requiredString(value, "interaction"),
      };
    case "removeEdge":
      return { op, edgeId: requiredString(value, "edgeId") };
    default:
      throw new Error(`Unknown graph operation: ${op}`);
  }
}

function cloneItem(item: ContextItem): ContextItem {
  return item.type === "component"
    ? { ...item, elements: item.elements.map((element) => ({ ...element })) }
    : { ...item };
}

function cloneGraph(graph: GraphState): GraphState {
  return {
    nodes: graph.nodes.map((node) => ({
      ...node,
      position: { ...node.position },
      data: { ...node.data, items: node.data.items.map(cloneItem) },
    })),
    edges: graph.edges.map((edge) => ({ ...edge, data: { ...edge.data } })),
  };
}

function getContext(nodes: ContextNode[], contextId: string): ContextNode {
  const context = nodes.find((node) => node.id === contextId);
  if (!context) throw new Error(`Context not found: ${contextId}`);
  return context;
}

function getElement(context: ContextNode, elementId: string): UIElement {
  for (const item of context.data.items) {
    if (item.type === "element" && item.id === elementId) return item;
    if (item.type === "component") {
      const element = item.elements.find((candidate) => candidate.id === elementId);
      if (element) return element;
    }
  }
  throw new Error(`Element not found: ${elementId}`);
}

function getComponent(context: ContextNode, componentId: string) {
  const component = context.data.items.find(
    (item) => item.type === "component" && item.id === componentId,
  );
  if (!component || component.type !== "component") {
    throw new Error(`Component not found: ${componentId}`);
  }
  return component;
}

function allIds(graph: GraphState): Set<string> {
  const ids = new Set(graph.edges.map((edge) => edge.id));
  for (const node of graph.nodes) {
    ids.add(node.id);
    for (const item of node.data.items) {
      ids.add(item.id);
      if (item.type === "component") {
        for (const element of item.elements) ids.add(element.id);
      }
    }
  }
  return ids;
}

function assertNewId(id: string, graph: GraphState): void {
  if (!idPattern.test(id)) throw new Error(`ID must be kebab-case: ${id}`);
  if (allIds(graph).has(id)) throw new Error(`ID is already in use: ${id}`);
}

function insertAfter<T extends { id: string }>(
  items: T[],
  item: T,
  afterId?: string,
): void {
  if (!afterId) {
    items.push(item);
    return;
  }
  const index = items.findIndex((candidate) => candidate.id === afterId);
  if (index < 0) throw new Error(`afterId not found: ${afterId}`);
  items.splice(index + 1, 0, item);
}

function removeItem(
  context: ContextNode,
  itemId: string,
): { item: ContextItem; elementIds: Set<string> } {
  const topLevelIndex = context.data.items.findIndex((item) => item.id === itemId);
  if (topLevelIndex >= 0) {
    const item = context.data.items.splice(topLevelIndex, 1)[0];
    if (!item) throw new Error(`Item not found: ${itemId}`);
    return {
      item,
      elementIds: new Set(
        item.type === "component"
          ? item.elements.map((element) => element.id)
          : [item.id],
      ),
    };
  }
  for (const component of context.data.items) {
    if (component.type !== "component") continue;
    const index = component.elements.findIndex((element) => element.id === itemId);
    if (index >= 0) {
      const element = component.elements.splice(index, 1)[0];
      if (element) {
        return {
          item: { type: "element", ...element },
          elementIds: new Set([element.id]),
        };
      }
    }
  }
  throw new Error(`Item not found: ${itemId}`);
}

function removeElementEdges(
  edges: InteractionEdge[],
  contextId: string,
  elementIds: Set<string>,
): InteractionEdge[] {
  return edges.filter(
    (edge) =>
      edge.source !== contextId ||
      !elementIds.has(edge.sourceHandle.replace(/^exit:/, "")),
  );
}

export function applyGraphOperation(
  current: GraphState,
  operation: GraphOperation,
  layout: PatchLayout,
): GraphState {
  const graph = cloneGraph(current);
  const { nodes } = graph;

  switch (operation.op) {
    case "addContext": {
      assertNewId(operation.id, graph);
      const anchorId = operation.anchorContextId ?? layout.defaultAnchorContextId;
      const anchor = anchorId
        ? nodes.find((node) => node.id === anchorId)
        : undefined;
      if (anchorId && !anchor) throw new Error(`Context not found: ${anchorId}`);
      const position = anchor
        ? { x: anchor.position.x + 360, y: anchor.position.y }
        : layout.defaultPosition;
      nodes.push({
        id: operation.id,
        type: "context",
        position,
        data: { kind: operation.kind, name: operation.name, items: [] },
      });
      break;
    }
    case "updateContext": {
      const context = getContext(nodes, operation.contextId);
      if (operation.name) context.data.name = operation.name;
      if (operation.kind) context.data.kind = operation.kind;
      break;
    }
    case "removeContext":
      getContext(nodes, operation.contextId);
      graph.nodes = nodes.filter((node) => node.id !== operation.contextId);
      graph.edges = graph.edges.filter(
        (edge) =>
          edge.source !== operation.contextId &&
          edge.target !== operation.contextId,
      );
      break;
    case "addComponent": {
      assertNewId(operation.id, graph);
      const context = getContext(nodes, operation.contextId);
      insertAfter(
        context.data.items,
        {
          type: "component",
          id: operation.id,
          name: operation.name,
          elements: [],
        },
        operation.afterId,
      );
      break;
    }
    case "updateComponent":
      getComponent(
        getContext(nodes, operation.contextId),
        operation.componentId,
      ).name = operation.name;
      break;
    case "addElement": {
      assertNewId(operation.id, graph);
      const context = getContext(nodes, operation.contextId);
      const element: UIElement = {
        id: operation.id,
        kind: operation.kind,
        label: operation.label,
        interactive: operation.interactive,
      };
      if (operation.componentId) {
        insertAfter(
          getComponent(context, operation.componentId).elements,
          element,
          operation.afterId,
        );
      } else {
        insertAfter(
          context.data.items,
          { type: "element", ...element },
          operation.afterId,
        );
      }
      break;
    }
    case "updateElement": {
      const context = getContext(nodes, operation.contextId);
      const element = getElement(context, operation.elementId);
      if (operation.label) element.label = operation.label;
      if (operation.kind) element.kind = operation.kind;
      if (operation.interactive !== undefined) {
        element.interactive = operation.interactive;
        if (!operation.interactive) {
          graph.edges = removeElementEdges(
            graph.edges,
            context.id,
            new Set([element.id]),
          );
        }
      }
      break;
    }
    case "moveItem": {
      const context = getContext(nodes, operation.contextId);
      const removed = removeItem(context, operation.itemId);
      if (operation.componentId) {
        if (removed.item.type === "component") {
          throw new Error("A component cannot be nested");
        }
        insertAfter(
          getComponent(context, operation.componentId).elements,
          removed.item,
          operation.afterId,
        );
      } else {
        insertAfter(context.data.items, removed.item, operation.afterId);
      }
      break;
    }
    case "removeItem": {
      const context = getContext(nodes, operation.contextId);
      const removed = removeItem(context, operation.itemId);
      graph.edges = removeElementEdges(
        graph.edges,
        context.id,
        removed.elementIds,
      );
      break;
    }
    case "addEdge": {
      assertNewId(operation.id, graph);
      const source = getContext(nodes, operation.sourceContextId);
      getContext(nodes, operation.targetContextId);
      if (!getElement(source, operation.sourceElementId).interactive) {
        throw new Error(`Element is not interactive: ${operation.sourceElementId}`);
      }
      graph.edges.push({
        id: operation.id,
        type: "interaction",
        source: operation.sourceContextId,
        sourceHandle: `exit:${operation.sourceElementId}`,
        target: operation.targetContextId,
        targetHandle: "entry",
        label: operation.interaction,
        data: { interaction: operation.interaction },
      });
      break;
    }
    case "updateEdge": {
      const edge = graph.edges.find((candidate) => candidate.id === operation.edgeId);
      if (!edge) throw new Error(`Edge not found: ${operation.edgeId}`);
      edge.label = operation.interaction;
      edge.data.interaction = operation.interaction;
      break;
    }
    case "removeEdge": {
      const index = graph.edges.findIndex(
        (candidate) => candidate.id === operation.edgeId,
      );
      if (index < 0) throw new Error(`Edge not found: ${operation.edgeId}`);
      graph.edges.splice(index, 1);
      break;
    }
  }
  return graph;
}
