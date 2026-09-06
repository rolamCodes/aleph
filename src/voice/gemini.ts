import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  type FunctionCall,
  type FunctionDeclaration,
} from "@google/genai";
import type {
  ContextNode,
  InteractionEdge,
  PointedTarget,
} from "../types";
import { applyGraphPatch } from "./graphPatch";

const DEFAULT_MODEL = "gemini-3.8-flash";
const MAX_TOOL_STEPS = 24;

const idProperty = {
  type: "string",
  description: "An existing exact ID, or a globally unique kebab-case ID when creating.",
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
    "Create one TOP-LEVEL canvas node representing a distinct UI surface such as a screen, modal, sheet, drawer, or popover. Never use this for a section or grouping inside another context.",
    {
      id: idProperty,
      kind: contextKindProperty,
      name: {
        type: "string",
        description: "Visible, meaningful name for the context.",
      },
      anchorContextId: idProperty,
    },
    ["id", "kind", "name"],
  ),
  declareTool(
    "updateContext",
    "Rename or change the kind of an existing TOP-LEVEL context node.",
    {
      contextId: idProperty,
      name: stringProperty,
      kind: contextKindProperty,
    },
    ["contextId"],
  ),
  declareTool(
    "removeContext",
    "Remove one TOP-LEVEL context and its connected interaction edges.",
    { contextId: idProperty },
    ["contextId"],
  ),
  declareTool(
    "addComponent",
    "Create one NAMED component inside an existing context. A component is a meaningful group or section such as Header, Login form, Navigation, or Profile card. It is never a top-level canvas node and must always have a useful name.",
    {
      contextId: idProperty,
      id: idProperty,
      name: {
        type: "string",
        description: "Required visible component name; never blank or generic.",
      },
      afterId: idProperty,
    },
    ["contextId", "id", "name"],
  ),
  declareTool(
    "updateComponent",
    "Rename an existing NAMED grouping inside a context. Do not use this for contexts or atomic elements.",
    {
      contextId: idProperty,
      componentId: idProperty,
      name: stringProperty,
    },
    ["contextId", "componentId", "name"],
  ),
  declareTool(
    "addElement",
    "Create one atomic, visibly LABELED UI element inside a context, optionally within a named component. Elements are leaves such as text, buttons, inputs, and images; they are not contexts or groupings.",
    {
      contextId: idProperty,
      id: idProperty,
      kind: elementKindProperty,
      label: {
        type: "string",
        description: "Required visible label describing this element; never blank.",
      },
      interactive: {
        type: "boolean",
        description: "True only when the element can initiate an interaction edge.",
      },
      componentId: idProperty,
      afterId: idProperty,
    },
    ["contextId", "id", "kind", "label", "interactive"],
  ),
  declareTool(
    "updateElement",
    "Change the label, element kind, or interactivity of one atomic element.",
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
    "Reorder a component or element within its context, or move an element into or out of a named component. Components cannot be nested.",
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
    "Remove one component or element from a context. Removing a component also removes its child elements.",
    {
      contextId: idProperty,
      itemId: idProperty,
    },
    ["contextId", "itemId"],
  ),
  declareTool(
    "addEdge",
    "Connect one interactive source ELEMENT to the entry of a target CONTEXT. Edges never originate from components or contexts.",
    {
      id: idProperty,
      sourceContextId: idProperty,
      sourceElementId: idProperty,
      targetContextId: idProperty,
      interaction: {
        type: "string",
        description: "Concise interaction label such as click, submit, or select.",
      },
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
    "Change the interaction label of an existing edge.",
    {
      edgeId: idProperty,
      interaction: stringProperty,
    },
    ["edgeId", "interaction"],
  ),
  declareTool(
    "removeEdge",
    "Remove one interaction edge.",
    { edgeId: idProperty },
    ["edgeId"],
  ),
  declareTool(
    "finish",
    "Call only when the spoken intent has been fully achieved and no more graph mutations are needed.",
    {},
    [],
  ),
];

const allowedFunctionNames = functionDeclarations.flatMap((tool) =>
  tool.name ? [tool.name] : [],
);
const mutationToolNames = new Set(
  allowedFunctionNames.filter((name) => name !== "finish"),
);

const systemInstruction = `You are a precise editor for an attention graph. Work iteratively:
1. Call exactly one mutation tool.
2. Inspect its returned result and updated graph.
3. Call one more mutation tool if needed.
4. Call finish only when the user's complete intent is achieved.
Never output prose. Never call multiple tools in one turn.

ONTOLOGY — these words are not interchangeable:
- CONTEXT: a top-level canvas node and distinct UI surface. Context kinds are screen, modal, popover, sheet, and drawer. Examples: Home screen, Sign-in modal, Settings sheet.
- COMPONENT: a required-name grouping inside exactly one context. It organizes related elements and never appears as a top-level node. Examples: Header, Login form, Navigation, Profile card. Never create an unnamed component.
- ELEMENT: an atomic labeled leaf inside a context or component. Element kinds are text, button, input, and image. Examples: Email input, Submit button, Logo image.
- EDGE: an interaction from an interactive element's exit to a context's entry. Components and contexts cannot be edge sources.
Direct elements may visually appear together without being a component. Only create a component when the user describes a meaningful named group.

Examples:
- "Create a settings screen" means addContext(kind=screen, name=Settings).
- "Add a login form here with email and submit" means addComponent(name=Login form), then addElement for Email input and Submit button inside that component.
- "Add a cancel button" means addElement, not addComponent or addContext.

The pointed target is the primary referent for "this", "that", "here", and "it".
Use exact IDs from the latest returned graph. Creation IDs must be globally unique lowercase kebab-case.
After every tool result, reassess the original spoken request and continue until all requested structure and interactions exist.`;

type GraphState = {
  nodes: ContextNode[];
  edges: InteractionEdge[];
};

type ToolLoopLayout = {
  defaultAnchorContextId?: string;
  defaultPosition: { x: number; y: number };
};

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const pieces: string[] = [];
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    pieces.push(
      String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)),
    );
  }

  return btoa(pieces.join(""));
}

function graphSnapshot(nodes: ContextNode[], edges: InteractionEdge[]): object {
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

function requireOneCall(calls: FunctionCall[] | undefined): FunctionCall {
  if (calls?.length !== 1 || !calls[0]?.name) {
    throw new Error("Gemini must return exactly one tool call per step");
  }
  return calls[0];
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Mutation failed";
}

export async function runVoiceCommand({
  audio,
  target,
  initialGraph,
  layout,
  onMutation,
}: {
  audio: Blob;
  target: PointedTarget;
  initialGraph: GraphState;
  layout: ToolLoopLayout;
  onMutation: (graph: GraphState) => void;
}): Promise<void> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("VITE_GEMINI_API_KEY is not configured");
  }

  const ai = new GoogleGenAI({ apiKey });
  const chat = ai.chats.create({
    model: import.meta.env.VITE_GEMINI_MODEL || DEFAULT_MODEL,
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
  const audioData = bytesToBase64(await audio.arrayBuffer());
  let graph = initialGraph;
  let response = await chat.sendMessage({
    message: [
      {
        text: JSON.stringify({
          pointedTarget: target,
          graph: graphSnapshot(graph.nodes, graph.edges),
        }),
      },
      {
        inlineData: {
          data: audioData,
          mimeType: "audio/wav",
        },
      },
    ],
  });

  for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
    const call = requireOneCall(response.functionCalls);
    if (call.name === "finish") {
      return;
    }
    if (!mutationToolNames.has(call.name)) {
      throw new Error(`Gemini called an unknown tool: ${call.name}`);
    }

    let result: Record<string, unknown>;
    try {
      graph = applyGraphPatch(
        graph.nodes,
        graph.edges,
        {
          operations: [{ op: call.name, ...(call.args ?? {}) }],
        },
        layout,
      );
      onMutation(graph);
      result = {
        ok: true,
        applied: call.name,
        graph: graphSnapshot(graph.nodes, graph.edges),
      };
    } catch (reason) {
      result = {
        ok: false,
        error: errorMessage(reason),
        graph: graphSnapshot(graph.nodes, graph.edges),
      };
    }

    response = await chat.sendMessage({
      message: [
        {
          functionResponse: {
            id: call.id,
            name: call.name,
            response: result,
          },
        },
      ],
    });
  }

  throw new Error(`Gemini exceeded ${MAX_TOOL_STEPS} mutation steps`);
}
