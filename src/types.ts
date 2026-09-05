import type { Edge, Node } from "@xyflow/react";

export type ContextKind = "screen" | "modal" | "popover" | "sheet" | "drawer";

export type ElementKind = "text" | "button" | "input" | "image";

export type InteractionType = string;

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
