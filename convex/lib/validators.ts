import { v } from "convex/values";

export const contextKindValidator = v.union(
  v.literal("screen"),
  v.literal("modal"),
  v.literal("popover"),
  v.literal("sheet"),
  v.literal("drawer"),
);

export const elementKindValidator = v.union(
  v.literal("text"),
  v.literal("button"),
  v.literal("input"),
  v.literal("image"),
);

export const elementValidator = v.object({
  id: v.string(),
  kind: elementKindValidator,
  label: v.string(),
  interactive: v.boolean(),
});

export const contextItemValidator = v.union(
  v.object({
    type: v.literal("element"),
    id: v.string(),
    kind: elementKindValidator,
    label: v.string(),
    interactive: v.boolean(),
  }),
  v.object({
    type: v.literal("component"),
    id: v.string(),
    name: v.string(),
    elements: v.array(elementValidator),
  }),
);

export const contextNodeValidator = v.object({
  id: v.string(),
  type: v.literal("context"),
  position: v.object({
    x: v.number(),
    y: v.number(),
  }),
  data: v.object({
    kind: contextKindValidator,
    name: v.string(),
    items: v.array(contextItemValidator),
  }),
});

export const interactionEdgeValidator = v.object({
  id: v.string(),
  type: v.literal("interaction"),
  source: v.string(),
  sourceHandle: v.string(),
  target: v.string(),
  targetHandle: v.literal("entry"),
  label: v.string(),
  data: v.object({
    interaction: v.string(),
    bend: v.optional(
      v.object({
        x: v.number(),
        y: v.number(),
      }),
    ),
  }),
});

export const graphValidator = v.object({
  nodes: v.array(contextNodeValidator),
  edges: v.array(interactionEdgeValidator),
});

export const pointedTargetValidator = v.union(
  v.object({ kind: v.literal("context"), id: v.string() }),
  v.object({
    kind: v.union(v.literal("component"), v.literal("element")),
    id: v.string(),
    contextId: v.string(),
  }),
  v.object({ kind: v.literal("edge"), id: v.string() }),
  v.object({ kind: v.literal("canvas") }),
);

export const patchLayoutValidator = v.object({
  defaultAnchorContextId: v.optional(v.string()),
  defaultPosition: v.object({ x: v.number(), y: v.number() }),
});

const optionalString = v.optional(v.string());

export const graphOperationValidator = v.union(
  v.object({
    op: v.literal("addContext"),
    id: v.string(),
    kind: contextKindValidator,
    name: v.string(),
    anchorContextId: optionalString,
  }),
  v.object({
    op: v.literal("updateContext"),
    contextId: v.string(),
    name: optionalString,
    kind: v.optional(contextKindValidator),
  }),
  v.object({ op: v.literal("removeContext"), contextId: v.string() }),
  v.object({
    op: v.literal("addElement"),
    contextId: v.string(),
    id: v.string(),
    kind: elementKindValidator,
    label: v.string(),
    interactive: v.boolean(),
    componentId: optionalString,
    afterId: optionalString,
  }),
  v.object({
    op: v.literal("addComponent"),
    contextId: v.string(),
    id: v.string(),
    name: v.string(),
    afterId: optionalString,
  }),
  v.object({
    op: v.literal("updateElement"),
    contextId: v.string(),
    elementId: v.string(),
    label: optionalString,
    kind: v.optional(elementKindValidator),
    interactive: v.optional(v.boolean()),
  }),
  v.object({
    op: v.literal("updateComponent"),
    contextId: v.string(),
    componentId: v.string(),
    name: v.string(),
  }),
  v.object({
    op: v.literal("moveItem"),
    contextId: v.string(),
    itemId: v.string(),
    componentId: optionalString,
    afterId: optionalString,
  }),
  v.object({
    op: v.literal("removeItem"),
    contextId: v.string(),
    itemId: v.string(),
  }),
  v.object({
    op: v.literal("addEdge"),
    id: v.string(),
    sourceContextId: v.string(),
    sourceElementId: v.string(),
    targetContextId: v.string(),
    interaction: v.string(),
  }),
  v.object({
    op: v.literal("updateEdge"),
    edgeId: v.string(),
    interaction: v.string(),
  }),
  v.object({ op: v.literal("removeEdge"), edgeId: v.string() }),
);

export const userDocumentValidator = v.object({
  _id: v.id("users"),
  _creationTime: v.number(),
  clerkId: v.string(),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const projectDocumentValidator = v.object({
  _id: v.id("projects"),
  _creationTime: v.number(),
  userId: v.id("users"),
  name: v.string(),
  nodes: v.array(contextNodeValidator),
  edges: v.array(interactionEdgeValidator),
  createdAt: v.number(),
  updatedAt: v.number(),
});
