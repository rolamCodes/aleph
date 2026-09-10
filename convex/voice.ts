"use node";

import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  type FunctionCall,
  type FunctionDeclaration,
} from "@google/genai";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { parseGraphOperation } from "./lib/graphPatch";
import type { GraphState } from "./lib/graphTypes";
import {
  patchLayoutValidator,
  pointedTargetValidator,
} from "./lib/validators";

const DEFAULT_MODEL = "gemini-3.8-flash";
const MAX_TOOL_STEPS = 24;

const idProperty = {
  type: "string",
  description:
    "An existing exact ID, or a globally unique kebab-case ID when creating.",
};
const stringProperty = { type: "string" };
const contextKindProperty = {
  type: "string",
  enum: ["screen", "modal", "popover", "sheet", "drawer"],
};
const elementKindProperty = {
  type: "string",
  enum: ["text", "button", "input", "image"],
};

function declareTool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): FunctionDeclaration {
  return {
    name,
    description,
    parametersJsonSchema: {
      type: "object",
      additionalProperties: false,
      properties,
      required,
    },
  };
}

const functionDeclarations: FunctionDeclaration[] = [
  declareTool(
    "addContext",
    "Create one top-level canvas node representing a distinct UI surface.",
    {
      id: idProperty,
      kind: contextKindProperty,
      name: stringProperty,
      anchorContextId: idProperty,
    },
    ["id", "kind", "name"],
  ),
  declareTool(
    "updateContext",
    "Rename or change the kind of an existing top-level context.",
    { contextId: idProperty, name: stringProperty, kind: contextKindProperty },
    ["contextId"],
  ),
  declareTool(
    "removeContext",
    "Remove a top-level context and its connected edges.",
    { contextId: idProperty },
    ["contextId"],
  ),
  declareTool(
    "addComponent",
    "Create a named component inside an existing context.",
    {
      contextId: idProperty,
      id: idProperty,
      name: stringProperty,
      afterId: idProperty,
    },
    ["contextId", "id", "name"],
  ),
  declareTool(
    "updateComponent",
    "Rename an existing component inside a context.",
    {
      contextId: idProperty,
      componentId: idProperty,
      name: stringProperty,
    },
    ["contextId", "componentId", "name"],
  ),
  declareTool(
    "addElement",
    "Create one atomic labeled UI element in a context or component.",
    {
      contextId: idProperty,
      id: idProperty,
      kind: elementKindProperty,
      label: stringProperty,
      interactive: { type: "boolean" },
      componentId: idProperty,
      afterId: idProperty,
    },
    ["contextId", "id", "kind", "label", "interactive"],
  ),
  declareTool(
    "updateElement",
    "Change the label, kind, or interactivity of an element.",
    {
      contextId: idProperty,
      elementId: idProperty,
      label: stringProperty,
      kind: elementKindProperty,
      interactive: { type: "boolean" },
    },
    ["contextId", "elementId"],
  ),
  declareTool(
    "moveItem",
    "Reorder an item or move an element into or out of a component.",
    {
      contextId: idProperty,
      itemId: idProperty,
      componentId: idProperty,
      afterId: idProperty,
    },
    ["contextId", "itemId"],
  ),
  declareTool(
    "removeItem",
    "Remove one component or element from a context.",
    { contextId: idProperty, itemId: idProperty },
    ["contextId", "itemId"],
  ),
  declareTool(
    "addEdge",
    "Connect one interactive source element to a target context.",
    {
      id: idProperty,
      sourceContextId: idProperty,
      sourceElementId: idProperty,
      targetContextId: idProperty,
      interaction: stringProperty,
    },
    [
      "id",
      "sourceContextId",
      "sourceElementId",
      "targetContextId",
      "interaction",
    ],
  ),
  declareTool(
    "updateEdge",
    "Change an interaction edge label.",
    { edgeId: idProperty, interaction: stringProperty },
    ["edgeId", "interaction"],
  ),
  declareTool(
    "removeEdge",
    "Remove one interaction edge.",
    { edgeId: idProperty },
    ["edgeId"],
  ),
  declareTool("finish", "Finish after the spoken intent is complete.", {}, []),
];

const allowedFunctionNames = functionDeclarations.flatMap((tool) =>
  tool.name ? [tool.name] : [],
);
const mutationToolNames = new Set(
  allowedFunctionNames.filter((name) => name !== "finish"),
);

const systemInstruction = `You are a precise editor for an attention graph.
Call exactly one mutation tool at a time, inspect its result, continue until the
spoken request is complete, then call finish. Never output prose.

A CONTEXT is a top-level UI surface: screen, modal, popover, sheet, or drawer.
A COMPONENT is a named grouping inside one context and cannot be nested.
An ELEMENT is a labeled leaf: text, button, input, or image.
An EDGE connects an interactive element to a context.

The pointed target is the referent for "this", "that", "here", and "it".
Use exact IDs from the latest graph. New IDs must be globally unique kebab-case.`;

function graphSnapshot(graph: GraphState): object {
  return {
    contexts: graph.nodes.map((node) => ({
      id: node.id,
      kind: node.data.kind,
      name: node.data.name,
      items: node.data.items,
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      sourceContextId: edge.source,
      sourceElementId: edge.sourceHandle.replace(/^exit:/, ""),
      targetContextId: edge.target,
      interaction: edge.data.interaction,
    })),
  };
}

function requireOneCall(
  calls: FunctionCall[] | undefined,
): FunctionCall & { name: string } {
  if (calls?.length !== 1 || !calls[0]?.name) {
    throw new Error("Gemini must return exactly one tool call per step");
  }
  return calls[0] as FunctionCall & { name: string };
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Mutation failed";
}

const appliedCountsValidator = v.object({
  contexts: v.number(),
  components: v.number(),
  elements: v.number(),
  edges: v.number(),
  updates: v.number(),
  removals: v.number(),
});

const voiceResultValidator = v.object({
  status: v.union(
    v.literal("complete"),
    v.literal("partial"),
    v.literal("failed"),
    v.literal("unknown"),
  ),
  applied: appliedCountsValidator,
  message: v.optional(v.string()),
});

type VoiceRunResult = {
  status: "complete" | "partial" | "failed" | "unknown";
  applied: {
    contexts: number;
    components: number;
    elements: number;
    edges: number;
    updates: number;
    removals: number;
  };
  message?: string;
};

function emptyApplied(): VoiceRunResult["applied"] {
  return {
    contexts: 0,
    components: 0,
    elements: 0,
    edges: 0,
    updates: 0,
    removals: 0,
  };
}

function snapshotApplied(
  applied: VoiceRunResult["applied"],
): VoiceRunResult["applied"] {
  return { ...applied };
}

function incrementApplied(
  applied: VoiceRunResult["applied"],
  op: string,
): void {
  switch (op) {
    case "addContext":
      applied.contexts += 1;
      return;
    case "addComponent":
      applied.components += 1;
      return;
    case "addElement":
      applied.elements += 1;
      return;
    case "addEdge":
      applied.edges += 1;
      return;
    case "removeContext":
    case "removeItem":
    case "removeEdge":
      applied.removals += 1;
      return;
    default:
      applied.updates += 1;
  }
}

function appliedTotal(applied: VoiceRunResult["applied"]): number {
  return (
    applied.contexts +
    applied.components +
    applied.elements +
    applied.edges +
    applied.updates +
    applied.removals
  );
}

function finishResult(
  applied: VoiceRunResult["applied"],
  unresolvedFailure: boolean,
): VoiceRunResult {
  const copy = snapshotApplied(applied);
  if (!unresolvedFailure) {
    return { status: "complete", applied: copy };
  }
  if (appliedTotal(copy) > 0) {
    return { status: "partial", applied: copy };
  }
  return {
    status: "failed",
    applied: copy,
    message: "The voice command could not be completed.",
  };
}

export const run = action({
  args: {
    projectId: v.id("projects"),
    storageId: v.id("_storage"),
    target: pointedTargetValidator,
    layout: patchLayoutValidator,
  },
  returns: voiceResultValidator,
  handler: async (ctx, args) => {
    let uploadVerified = false;
    const applied = emptyApplied();
    let unresolvedFailure = false;
    let result: VoiceRunResult = finishResult(applied, true);

    try {
      const identity = await ctx.auth.getUserIdentity();
      if (!identity) throw new Error("Not authenticated");

      const input = await ctx.runQuery(internal.projects.getVoiceInput, {
        projectId: args.projectId,
        clerkId: identity.subject,
        storageId: args.storageId,
      });
      uploadVerified = true;
      const response = await fetch(input.audioUrl);
      if (!response.ok) throw new Error("Unable to read voice recording");
      const audioData = Buffer.from(await response.arrayBuffer()).toString(
        "base64",
      );
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

      const ai = new GoogleGenAI({ apiKey });
      const chat = ai.chats.create({
        model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
        config: {
          systemInstruction,
          temperature: 0,
          tools: [{ functionDeclarations }],
          toolConfig: {
            functionCallingConfig: {
              mode: FunctionCallingConfigMode.ANY,
              allowedFunctionNames,
            },
          },
        },
      });

      let graph = input.graph;
      let geminiResponse = await chat.sendMessage({
        message: [
          {
            text: JSON.stringify({
              pointedTarget: args.target,
              graph: graphSnapshot(graph),
            }),
          },
          {
            inlineData: { data: audioData, mimeType: "audio/wav" },
          },
        ],
      });

      for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
        const call = requireOneCall(geminiResponse.functionCalls);
        if (call.name === "finish") {
          result = finishResult(applied, unresolvedFailure);
          return result;
        }
        if (!mutationToolNames.has(call.name)) {
          throw new Error(`Gemini called an unknown tool: ${call.name}`);
        }

        let toolResult: Record<string, unknown>;
        try {
          const operation = parseGraphOperation({
            op: call.name,
            ...(call.args ?? {}),
          });
          graph = await ctx.runMutation(internal.projects.applyVoiceOperation, {
            projectId: args.projectId,
            clerkId: identity.subject,
            operation,
            layout: args.layout,
          });
          incrementApplied(applied, call.name);
          unresolvedFailure = false;
          toolResult = {
            ok: true,
            applied: call.name,
            graph: graphSnapshot(graph),
          };
        } catch (reason) {
          unresolvedFailure = true;
          toolResult = {
            ok: false,
            error: errorMessage(reason),
            graph: graphSnapshot(graph),
          };
        }

        geminiResponse = await chat.sendMessage({
          message: [
            {
              functionResponse: {
                id: call.id,
                name: call.name,
                response: toolResult,
              },
            },
          ],
        });
      }
      throw new Error(`Gemini exceeded ${MAX_TOOL_STEPS} mutation steps`);
    } catch (reason) {
      console.error(reason);
      result = finishResult(applied, true);
      return result;
    } finally {
      try {
        if (uploadVerified) {
          await ctx.runMutation(internal.projects.deleteVoiceAudio, {
            storageId: args.storageId,
          });
        }
      } catch (cleanupReason) {
        console.error("Voice audio cleanup failed", cleanupReason);
      }
    }

    return result;
  },
});
