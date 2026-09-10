import type { Edge, Node } from "@xyflow/react";

export type ContextKind = "screen" | "modal" | "popover" | "sheet" | "drawer";

export type ElementKind = "text" | "button" | "input" | "image";

export type InteractionType = string;

export type PointedTarget =
  | { kind: "context"; id: string }
  | {
      kind: "component" | "element";
      id: string;
      contextId: string;
    }
  | { kind: "edge"; id: string }
  | { kind: "canvas" };

export type GraphTarget = Exclude<PointedTarget, { kind: "canvas" }>;

export type VoiceAppliedCounts = {
  contexts: number;
  components: number;
  elements: number;
  edges: number;
  updates: number;
  removals: number;
};

export type VoiceResult = {
  status: "complete" | "partial" | "failed" | "unknown";
  applied: VoiceAppliedCounts;
  message?: string;
};

export type CompanionInteraction =
  | { mode: "idle" }
  | { mode: "menu"; target: GraphTarget; selectedIndex: number }
  | { mode: "rename"; target: GraphTarget; draft: string; notice?: string }
  | { mode: "preparing"; target: PointedTarget }
  | { mode: "listening"; target: PointedTarget }
  | { mode: "working"; target: PointedTarget }
  | {
      mode: "error";
      target: PointedTarget;
      message: string;
      recovery?: { type: "rename"; draft: string };
    }
  | { mode: "summary"; message: string };

export type UIElement = {
  id: string;
  kind: ElementKind;
  label: string;
  interactive: boolean;
};

export type ComponentGroup = {
  type: "component";
  id: string;
  name: string;
  elements: UIElement[];
};

export type ElementItem = {
  type: "element";
} & UIElement;

export type ContextItem = ElementItem | ComponentGroup;

export type ContextData = {
  kind: ContextKind;
  name: string;
  items: ContextItem[];
};

export type ContextNode = Node<ContextData, "context">;

export type InteractionEdgeData = {
  interaction: InteractionType;
};

export type InteractionEdge = Edge<InteractionEdgeData>;

export function isGraphTarget(target: PointedTarget): target is GraphTarget {
  return target.kind !== "canvas";
}

export function interactionLocksCanvas(
  interaction: CompanionInteraction,
): boolean {
  return interaction.mode !== "idle" && interaction.mode !== "summary";
}

export function emptyVoiceApplied(): VoiceAppliedCounts {
  return {
    contexts: 0,
    components: 0,
    elements: 0,
    edges: 0,
    updates: 0,
    removals: 0,
  };
}
