import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  type FunctionDeclaration,
} from "@google/genai";
import type {
  ContextNode,
  InteractionEdge,
  PointedTarget,
} from "../types";

const DEFAULT_MODEL = "gemini-3.8-flash";

const operationProperties = {
  op: {
    type: "string",
    enum: [
      "addContext",
      "updateContext",
      "removeContext",
      "addElement",
      "addComponent",
      "updateElement",
      "updateComponent",
      "moveItem",
      "removeItem",
      "addEdge",
      "updateEdge",
      "removeEdge",
    ],
  },
  id: { type: "string" },
  contextId: { type: "string" },
  anchorContextId: { type: "string" },
  name: { type: "string" },
  kind: {
    type: "string",
    enum: [
      "screen",
      "modal",
      "popover",
      "sheet",
      "drawer",
      "text",
      "button",
      "input",
      "image",
    ],
  },
  label: { type: "string" },
  interactive: { type: "boolean" },
  componentId: { type: "string" },
  afterId: { type: "string" },
  elementId: { type: "string" },
  itemId: { type: "string" },
  sourceContextId: { type: "string" },
  sourceElementId: { type: "string" },
  targetContextId: { type: "string" },
  interaction: { type: "string" },
  edgeId: { type: "string" },
};

const applyGraphPatchDeclaration: FunctionDeclaration = {
  name: "applyGraphPatch",
  description:
    "Apply an ordered, atomic patch to the attention graph. Include every operation needed for the spoken command in one call.",
  parametersJsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      operations: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          properties: operationProperties,
          required: ["op"],
        },
      },
    },
    required: ["operations"],
  },
};

const systemInstruction = `You mutate an attention graph from a spoken command.
Return exactly one applyGraphPatch function call and no prose.
The pointed target is the primary referent for words such as this, here, it, and that.
Use exact existing IDs from the supplied graph. New IDs are required, globally unique, lowercase kebab-case.
Order operations so newly created contexts, components, and elements exist before later operations reference them.
Operation fields:
- addContext: id, kind, name; optional anchorContextId
- updateContext: contextId; name and/or kind
- removeContext: contextId
- addElement: contextId, id, kind, label, interactive; optional componentId and afterId
- addComponent: contextId, id, name; optional afterId
- updateElement: contextId, elementId; label, kind, and/or interactive
- updateComponent: contextId, componentId, name
- moveItem: contextId, itemId; optional componentId and afterId
- removeItem: contextId, itemId
- addEdge: id, sourceContextId, sourceElementId, targetContextId, interaction
- updateEdge: edgeId, interaction
- removeEdge: edgeId
Only interactive elements can be edge sources. Do not invent operations outside this list.`;

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const pieces: string[] = [];
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    pieces.push(String.fromCharCode(...chunk));
  }

  return btoa(pieces.join(""));
}

function graphSnapshot(
  nodes: ContextNode[],
  edges: InteractionEdge[],
): object {
  return {
    contexts: nodes.map((node) => ({
      id: node.id,
      kind: node.data.kind,
      name: node.data.name,
      items: node.data.items,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sourceContextId: edge.source,
      sourceElementId: (edge.sourceHandle ?? "").replace(/^exit:/, ""),
      targetContextId: edge.target,
      interaction: edge.data?.interaction ?? String(edge.label ?? ""),
    })),
  };
}

export async function requestGraphPatch({
  audio,
  target,
  nodes,
  edges,
}: {
  audio: Blob;
  target: PointedTarget;
  nodes: ContextNode[];
  edges: InteractionEdge[];
}): Promise<Record<string, unknown>> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("VITE_GEMINI_API_KEY is not configured");
  }

  const ai = new GoogleGenAI({ apiKey });
  const audioData = bytesToBase64(await audio.arrayBuffer());
  const response = await ai.models.generateContent({
    model: import.meta.env.VITE_GEMINI_MODEL || DEFAULT_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: JSON.stringify({
              pointedTarget: target,
              graph: graphSnapshot(nodes, edges),
            }),
          },
          {
            inlineData: {
              data: audioData,
              mimeType: "audio/wav",
            },
          },
        ],
      },
    ],
    config: {
      systemInstruction,
      temperature: 0,
      tools: [{ functionDeclarations: [applyGraphPatchDeclaration] }],
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.ANY,
          allowedFunctionNames: ["applyGraphPatch"],
        },
      },
    },
  });

  const calls = (response.functionCalls ?? []).filter(
    (call) => call.name === "applyGraphPatch" && call.args,
  );
  if (calls.length !== 1 || !calls[0]?.args) {
    throw new Error("Gemini did not return one graph patch");
  }

  return calls[0].args;
}
