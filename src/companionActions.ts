import {
  applyGraphOperation,
  parseGraphOperation,
} from "../convex/lib/graphPatch.ts";
import type { GraphState } from "../convex/lib/graphTypes.ts";
import {
  emptyVoiceApplied,
  type GraphTarget,
  type PointedTarget,
  type VoiceAppliedCounts,
  type VoiceResult,
} from "./types";

const EMPTY_LAYOUT = { defaultPosition: { x: 0, y: 0 } };

function joinAnd(parts: string[]): string {
  const last = parts.at(-1);
  if (parts.length === 0 || !last) {
    return "";
  }
  if (parts.length === 1) {
    return last;
  }
  if (parts.length === 2) {
    return `${parts[0]} and ${last}`;
  }
  return `${parts.slice(0, -1).join(", ")}, and ${last}`;
}

function counted(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatAdded(applied: VoiceAppliedCounts): string | null {
  const parts: string[] = [];
  if (applied.contexts > 0) {
    parts.push(counted(applied.contexts, "context", "contexts"));
  }
  if (applied.components > 0) {
    parts.push(counted(applied.components, "component", "components"));
  }
  if (applied.elements > 0) {
    parts.push(counted(applied.elements, "element", "elements"));
  }
  if (applied.edges > 0) {
    parts.push(counted(applied.edges, "edge", "edges"));
  }
  if (parts.length === 0) {
    return null;
  }
  return `Added ${joinAnd(parts)}.`;
}

export function getTargetLabel(
  graph: GraphState,
  target: PointedTarget,
): string | null {
  if (target.kind === "canvas") {
    return null;
  }
  if (target.kind === "edge") {
    const edge = graph.edges.find((edge) => edge.id === target.id);
    return edge?.data.interaction ?? null;
  }
  const contextId = target.kind === "context" ? target.id : target.contextId;
  const context = graph.nodes.find((node) => node.id === contextId);
  if (!context) {
    return null;
  }
  if (target.kind === "context") {
    return context.data.name;
  }
  for (const item of context.data.items) {
    if (target.kind === "component" && item.type === "component" && item.id === target.id) {
      return item.name;
    }
    if (target.kind === "element" && item.type === "element" && item.id === target.id) {
      return item.label;
    }
    if (target.kind === "element" && item.type === "component") {
      const element = item.elements.find((candidate) => candidate.id === target.id);
      if (element) {
        return element.label;
      }
    }
  }
  return null;
}

function renameOperation(target: GraphTarget, name: string): unknown {
  switch (target.kind) {
    case "context":
      return { op: "updateContext", contextId: target.id, name };
    case "component":
      return {
        op: "updateComponent",
        contextId: target.contextId,
        componentId: target.id,
        name,
      };
    case "element":
      return {
        op: "updateElement",
        contextId: target.contextId,
        elementId: target.id,
        label: name,
      };
    case "edge":
      return { op: "updateEdge", edgeId: target.id, interaction: name };
  }
}

function deleteOperation(target: GraphTarget): unknown {
  switch (target.kind) {
    case "context":
      return { op: "removeContext", contextId: target.id };
    case "component":
    case "element":
      return {
        op: "removeItem",
        contextId: target.contextId,
        itemId: target.id,
      };
    case "edge":
      return { op: "removeEdge", edgeId: target.id };
  }
}

export function renameTarget(
  graph: GraphState,
  target: GraphTarget,
  name: string,
): { graph: GraphState; summary: string } {
  const previous = getTargetLabel(graph, target);
  if (previous === null) {
    throw new Error("That item is no longer on the canvas.");
  }
  return {
    graph: applyGraphOperation(
      graph,
      parseGraphOperation(renameOperation(target, name)),
      EMPTY_LAYOUT,
    ),
    summary: `Renamed ${previous} to ${name}.`,
  };
}

export function deleteTarget(
  graph: GraphState,
  target: GraphTarget,
): { graph: GraphState; summary: string } {
  const name = getTargetLabel(graph, target);
  if (name === null) {
    throw new Error("That item is no longer on the canvas.");
  }
  return {
    graph: applyGraphOperation(
      graph,
      parseGraphOperation(deleteOperation(target)),
      EMPTY_LAYOUT,
    ),
    summary: `Deleted ${name}.`,
  };
}

export function summarizeVoiceResult(result: VoiceResult): string {
  if (result.status === "unknown") {
    return "Couldn't confirm whether the changes finished. Check the canvas.";
  }

  const added = formatAdded(result.applied);
  const updated =
    result.applied.updates > 0
      ? `Updated ${counted(result.applied.updates, "item", "items")}.`
      : null;
  const removed =
    result.applied.removals > 0
      ? `Removed ${counted(result.applied.removals, "item", "items")}.`
      : null;
  const done = [added, updated, removed].filter(Boolean).join(" ");

  if (result.status === "complete") {
    return done || "Done.";
  }
  if (result.status === "partial") {
    return done
      ? `${done} The remaining changes could not be completed.`
      : "The remaining request could not be confirmed.";
  }
  return result.message ?? "The voice command could not be completed.";
}

export function toUserFacingError(reason: unknown): string {
  const raw = reason instanceof Error ? reason.message : "";
  console.error(reason);
  if (/not authenticated/i.test(raw)) {
    return "You need to sign in again to continue.";
  }
  if (/not supported/i.test(raw)) {
    return "Microphone recording is not supported in this browser.";
  }
  if (/microphone|notallowed|permission denied/i.test(raw)) {
    return "Microphone access is blocked. Allow it to use voice commands.";
  }
  if (/failed to fetch|networkerror|network|load failed/i.test(raw)) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  if (/no longer on the canvas|not found/i.test(raw)) {
    return "That item is no longer on the canvas.";
  }
  if (/Project is not ready/i.test(raw)) {
    return "The project isn't ready yet. Try again in a moment.";
  }
  return "Something went wrong. Try again.";
}

export function unknownVoiceResult(): VoiceResult {
  return { status: "unknown", applied: emptyVoiceApplied() };
}
