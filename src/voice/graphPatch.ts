import type {
  ContextItem,
  ContextKind,
  ContextNode,
  ElementKind,
  InteractionEdge,
  UIElement,
} from "../types";

const contextKinds = new Set<ContextKind>([
  "screen",
  "modal",
  "popover",
  "sheet",
  "drawer",
]);
const elementKinds = new Set<ElementKind>(["text", "button", "input", "image"]);
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type AddContextOperation = {
  op: "addContext";
  id: string;
  kind: ContextKind;
  name: string;
  anchorContextId?: string;
};

type GraphOperation =
  | AddContextOperation
  | {
      op: "updateContext";
      contextId: string;
      name?: string;
      kind?: ContextKind;
    }
  | { op: "removeContext"; contextId: string }
  | {
      op: "addElement";
      contextId: string;
      id: string;
      kind: ElementKind;
      label: string;
      interactive: boolean;
      componentId?: string;
      afterId?: string;
    }
  | {
      op: "addComponent";
      contextId: string;
      id: string;
      name: string;
      afterId?: string;
    }
  | {
      op: "updateElement";
      contextId: string;
      elementId: string;
      label?: string;
      kind?: ElementKind;
      interactive?: boolean;
    }
  | {
      op: "updateComponent";
      contextId: string;
      componentId: string;
      name?: string;
    }
  | {
      op: "moveItem";
      contextId: string;
      itemId: string;
      componentId?: string;
      afterId?: string;
    }
  | { op: "removeItem"; contextId: string; itemId: string }
  | {
      op: "addEdge";
      id: string;
      sourceContextId: string;
      sourceElementId: string;
      targetContextId: string;
      interaction: string;
    }
  | { op: "updateEdge"; edgeId: string; interaction: string }
  | { op: "removeEdge"; edgeId: string };

type PatchLayout = {
  defaultAnchorContextId?: string;
  defaultPosition: { x: number; y: number };
};

type PatchResult = {
  nodes: ContextNode[];
  edges: InteractionEdge[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
): string {
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
  if (result === undefined) {
    return undefined;
  }
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

function requiredBoolean(
  value: Record<string, unknown>,
  key: string,
): boolean {
  const result = optionalBoolean(value, key);
  if (result === undefined) {
    throw new Error(`Graph patch requires ${key}`);
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

function parseOperation(value: unknown): GraphOperation {
  if (!isRecord(value)) {
    throw new Error("Every graph operation must be an object");
  }

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
      if (!name && !rawKind) {
        throw new Error("updateContext requires name or kind");
      }
      return {
        op,
        contextId: requiredString(value, "contextId"),
        name,
        kind: rawKind ? parseContextKind(rawKind) : undefined,
      };
    }
    case "removeContext":
      return { op, contextId: requiredString(value, "contextId") };
    case "addElement":
      return {
        op,
        contextId: requiredString(value, "contextId"),
        id: requiredString(value, "id"),
        kind: parseElementKind(requiredString(value, "kind")),
        label: requiredString(value, "label"),
        interactive: requiredBoolean(value, "interactive"),
        componentId: optionalString(value, "componentId"),
        afterId: optionalString(value, "afterId"),
      };
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
        throw new Error(
          "updateElement requires label, kind, or interactive",
        );
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
    case "updateComponent": {
      const name = optionalString(value, "name");
      if (!name) {
        throw new Error("updateComponent requires name");
      }
      return {
        op,
        contextId: requiredString(value, "contextId"),
        componentId: requiredString(value, "componentId"),
        name,
      };
    }
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

function parseOperations(value: unknown): GraphOperation[] {
  if (!isRecord(value) || !Array.isArray(value.operations)) {
    throw new Error("applyGraphPatch requires an operations array");
  }
  if (value.operations.length === 0) {
    throw new Error("Graph patch must contain at least one operation");
  }
  return value.operations.map(parseOperation);
}

function cloneItem(item: ContextItem): ContextItem {
  return item.type === "component"
    ? { ...item, elements: item.elements.map((element) => ({ ...element })) }
    : { ...item };
}

function cloneNodes(nodes: ContextNode[]): ContextNode[] {
  return nodes.map((node) => ({
    ...node,
    position: { ...node.position },
    data: { ...node.data, items: node.data.items.map(cloneItem) },
  }));
}

function getContext(nodes: ContextNode[], contextId: string): ContextNode {
  const context = nodes.find((node) => node.id === contextId);
  if (!context) {
    throw new Error(`Context not found: ${contextId}`);
  }
  return context;
}

function getElement(context: ContextNode, elementId: string): UIElement {
  for (const item of context.data.items) {
    if (item.type === "element" && item.id === elementId) {
      return item;
    }
    if (item.type === "component") {
      const element = item.elements.find((candidate) => candidate.id === elementId);
      if (element) {
        return element;
      }
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

function allIds(nodes: ContextNode[], edges: InteractionEdge[]): Set<string> {
  const ids = new Set(edges.map((edge) => edge.id));
  for (const node of nodes) {
    ids.add(node.id);
    for (const item of node.data.items) {
      ids.add(item.id);
      if (item.type === "component") {
        for (const element of item.elements) {
          ids.add(element.id);
        }
      }
    }
  }
  return ids;
}

function assertNewId(
  id: string,
  nodes: ContextNode[],
  edges: InteractionEdge[],
): void {
  if (!idPattern.test(id)) {
    throw new Error(`ID must be unique kebab-case: ${id}`);
  }
  if (allIds(nodes, edges).has(id)) {
    throw new Error(`ID is already in use: ${id}`);
  }
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
  if (index === -1) {
    throw new Error(`afterId not found in destination: ${afterId}`);
  }
  items.splice(index + 1, 0, item);
}

function removeEdgesForElements(
  edges: InteractionEdge[],
  contextId: string,
  elementIds: Set<string>,
): InteractionEdge[] {
  return edges.filter(
    (edge) =>
      !(
        edge.source === contextId &&
        elementIds.has((edge.sourceHandle ?? "").replace(/^exit:/, ""))
      ),
  );
}

function removeItem(
  context: ContextNode,
  itemId: string,
): { item: ContextItem; elementIds: Set<string> } {
  const topLevelIndex = context.data.items.findIndex((item) => item.id === itemId);
  if (topLevelIndex !== -1) {
    const [item] = context.data.items.splice(topLevelIndex, 1);
    if (!item) {
      throw new Error(`Item not found: ${itemId}`);
    }
    return {
      item,
      elementIds: new Set(
        item.type === "component"
          ? item.elements.map((element) => element.id)
          : [item.id],
      ),
    };
  }

  for (const item of context.data.items) {
    if (item.type !== "component") {
      continue;
    }
    const elementIndex = item.elements.findIndex(
      (element) => element.id === itemId,
    );
    if (elementIndex !== -1) {
      const [element] = item.elements.splice(elementIndex, 1);
      if (!element) {
        break;
      }
      return {
        item: { type: "element", ...element },
        elementIds: new Set([element.id]),
      };
    }
  }

  throw new Error(`Item not found: ${itemId}`);
}

export function applyGraphPatch(
  currentNodes: ContextNode[],
  currentEdges: InteractionEdge[],
  value: unknown,
  layout: PatchLayout,
): PatchResult {
  const operations = parseOperations(value);
  const nodes = cloneNodes(currentNodes);
  let edges = currentEdges.map((edge) => ({
    ...edge,
    data: edge.data ? { ...edge.data } : undefined,
  }));
  let addedContextCount = 0;

  for (const operation of operations) {
    switch (operation.op) {
      case "addContext": {
        assertNewId(operation.id, nodes, edges);
        const anchorId =
          operation.anchorContextId ?? layout.defaultAnchorContextId;
        const anchor = anchorId
          ? nodes.find((node) => node.id === anchorId)
          : undefined;
        if (anchorId && !anchor) {
          throw new Error(`Anchor context not found: ${anchorId}`);
        }
        const basePosition = anchor?.position ?? layout.defaultPosition;
        nodes.push({
          id: operation.id,
          type: "context",
          position: {
            x: anchor ? basePosition.x + 360 : basePosition.x,
            y: basePosition.y + addedContextCount * 120,
          },
          data: {
            kind: operation.kind,
            name: operation.name,
            items: [],
          },
        });
        addedContextCount += 1;
        break;
      }
      case "updateContext": {
        const context = getContext(nodes, operation.contextId);
        if (operation.name) {
          context.data.name = operation.name;
        }
        if (operation.kind) {
          context.data.kind = operation.kind;
        }
        break;
      }
      case "removeContext":
        getContext(nodes, operation.contextId);
        nodes.splice(
          nodes.findIndex((node) => node.id === operation.contextId),
          1,
        );
        edges = edges.filter(
          (edge) =>
            edge.source !== operation.contextId &&
            edge.target !== operation.contextId,
        );
        break;
      case "addElement": {
        assertNewId(operation.id, nodes, edges);
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
      case "addComponent": {
        assertNewId(operation.id, nodes, edges);
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
      case "updateElement": {
        const context = getContext(nodes, operation.contextId);
        const element = getElement(context, operation.elementId);
        if (operation.label) {
          element.label = operation.label;
        }
        if (operation.kind) {
          element.kind = operation.kind;
        }
        if (operation.interactive !== undefined) {
          element.interactive = operation.interactive;
          if (!operation.interactive) {
            edges = removeEdgesForElements(
              edges,
              context.id,
              new Set([element.id]),
            );
          }
        }
        break;
      }
      case "updateComponent": {
        const context = getContext(nodes, operation.contextId);
        const component = getComponent(context, operation.componentId);
        if (operation.name) {
          component.name = operation.name;
        }
        break;
      }
      case "moveItem": {
        const context = getContext(nodes, operation.contextId);
        const removed = removeItem(context, operation.itemId);
        if (operation.componentId) {
          if (removed.item.type === "component") {
            throw new Error("A component cannot be nested in another component");
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
        edges = removeEdgesForElements(edges, context.id, removed.elementIds);
        break;
      }
      case "addEdge": {
        assertNewId(operation.id, nodes, edges);
        const source = getContext(nodes, operation.sourceContextId);
        getContext(nodes, operation.targetContextId);
        const sourceElement = getElement(source, operation.sourceElementId);
        if (!sourceElement.interactive) {
          throw new Error(
            `Edge source is not interactive: ${operation.sourceElementId}`,
          );
        }
        edges.push({
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
        const edge = edges.find((candidate) => candidate.id === operation.edgeId);
        if (!edge) {
          throw new Error(`Edge not found: ${operation.edgeId}`);
        }
        edge.label = operation.interaction;
        edge.data = { interaction: operation.interaction };
        break;
      }
      case "removeEdge": {
        const index = edges.findIndex(
          (candidate) => candidate.id === operation.edgeId,
        );
        if (index === -1) {
          throw new Error(`Edge not found: ${operation.edgeId}`);
        }
        edges.splice(index, 1);
        break;
      }
    }
  }

  return { nodes, edges };
}
