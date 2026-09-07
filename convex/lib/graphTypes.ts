import type { Infer } from "convex/values";
import type {
  contextItemValidator,
  contextKindValidator,
  contextNodeValidator,
  elementKindValidator,
  elementValidator,
  graphOperationValidator,
  graphValidator,
  interactionEdgeValidator,
  patchLayoutValidator,
  pointedTargetValidator,
} from "./validators";

export type ContextKind = Infer<typeof contextKindValidator>;
export type ElementKind = Infer<typeof elementKindValidator>;
export type UIElement = Infer<typeof elementValidator>;
export type ContextItem = Infer<typeof contextItemValidator>;
export type ContextNode = Infer<typeof contextNodeValidator>;
export type InteractionEdge = Infer<typeof interactionEdgeValidator>;
export type GraphState = Infer<typeof graphValidator>;
export type GraphOperation = Infer<typeof graphOperationValidator>;
export type PatchLayout = Infer<typeof patchLayoutValidator>;
export type PointedTarget = Infer<typeof pointedTargetValidator>;
