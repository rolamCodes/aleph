import { useCallback, useEffect, useRef, useState } from "react";
import {
  addEdge,
  Background,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import ContextNode from "./ContextNode";
import type { EdgeTypes } from "@xyflow/react";
import InteractionEdge from "./InteractionEdge";
import Reticle from "./Reticle";
import type {
  ContextNode as ContextNodeType,
  InteractionEdge as InteractionEdgeType,
  PointedTarget,
} from "./types";
import { runVoiceCommand } from "./voice/gemini";
import { usePushToTalk } from "./voice/usePushToTalk";

const nodeTypes = {
  context: ContextNode,
} satisfies NodeTypes;

const edgeTypes = {
  interaction: InteractionEdge,
} satisfies EdgeTypes;

const initialNodes: ContextNodeType[] = [
  {
    id: "home",
    type: "context",
    position: { x: 168, y: 160 },
    data: {
      kind: "screen",
      name: "Home",
      items: [
        {
          type: "component",
          id: "home-header",
          name: "Header",
          elements: [
            {
              id: "home-logo",
              kind: "image",
              label: "Logo",
              interactive: false,
            },
            {
              id: "home-search",
              kind: "input",
              label: "Search",
              interactive: false,
            },
          ],
        },
        {
          type: "element",
          id: "home-cta",
          kind: "button",
          label: "Get started",
          interactive: true,
        },
        {
          type: "element",
          id: "home-settings",
          kind: "button",
          label: "Settings",
          interactive: true,
        },
      ],
    },
  },
  {
    id: "sign-in",
    type: "context",
    position: { x: 599, y: 318 },
    data: {
      kind: "modal",
      name: "Sign in",
      items: [
        {
          type: "element",
          id: "sign-in-email",
          kind: "input",
          label: "Email",
          interactive: false,
        },
        {
          type: "element",
          id: "sign-in-password",
          kind: "input",
          label: "Password",
          interactive: false,
        },
        {
          type: "element",
          id: "sign-in-submit",
          kind: "button",
          label: "Submit",
          interactive: true,
        },
      ],
    },
  },
  {
    id: "dashboard",
    type: "context",
    position: { x: 900, y: 318 },
    data: {
      kind: "screen",
      name: "Dashboard",
      items: [
        {
          type: "element",
          id: "dash-welcome",
          kind: "text",
          label: "Welcome back",
          interactive: false,
        },
      ],
    },
  },
  {
    id: "settings",
    type: "context",
    position: { x: 599, y: 560 },
    data: {
      kind: "sheet",
      name: "Settings",
      items: [
        {
          type: "element",
          id: "settings-title",
          kind: "text",
          label: "Preferences",
          interactive: false,
        },
      ],
    },
  },
];

const defaultEdgeOptions = {
  type: "interaction",
} as const;

const initialEdges: InteractionEdgeType[] = [
  {
    id: "home-cta-sign-in",
    type: "interaction",
    source: "home",
    sourceHandle: "exit:home-cta",
    target: "sign-in",
    targetHandle: "entry",
    label: "click",
    data: { interaction: "click" },
  },
  {
    id: "sign-in-submit-dashboard",
    type: "interaction",
    source: "sign-in",
    sourceHandle: "exit:sign-in-submit",
    target: "dashboard",
    targetHandle: "entry",
    label: "submit",
    data: { interaction: "submit" },
  },
  {
    id: "home-settings-sheet",
    type: "interaction",
    source: "home",
    sourceHandle: "exit:home-settings",
    target: "settings",
    targetHandle: "entry",
    label: "click",
    data: { interaction: "click" },
  },
];

function isValidInteraction(
  connection: Connection | InteractionEdgeType,
): boolean {
  const sourceHandle = connection.sourceHandle ?? "";
  const targetHandle = connection.targetHandle ?? "";
  return sourceHandle.startsWith("exit:") && targetHandle === "entry";
}

export default function Canvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [pointedTarget, setPointedTarget] = useState<PointedTarget>({
    kind: "canvas",
  });
  const edgesRef = useRef(edges);
  const instanceRef =
    useRef<ReactFlowInstance<ContextNodeType, InteractionEdgeType>>(null);
  const nodesRef = useRef(nodes);

  useEffect(() => {
    edgesRef.current = edges;
    nodesRef.current = nodes;
  }, [edges, nodes]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!isValidInteraction(connection)) {
        return;
      }

      setEdges((current) =>
        addEdge(
          {
            ...connection,
            type: "interaction",
            label: "click",
            data: { interaction: "click" },
          },
          current,
        ),
      );
    },
    [setEdges],
  );

  const onRecording = useCallback(
    async (audio: Blob, target: PointedTarget): Promise<void> => {
      const pointedContextId =
        target.kind === "context"
          ? target.id
          : target.kind === "component" || target.kind === "element"
            ? target.contextId
            : target.kind === "edge"
              ? edgesRef.current.find((edge) => edge.id === target.id)?.target
              : undefined;
      const defaultPosition =
        instanceRef.current?.screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        }) ?? { x: 200, y: 200 };

      await runVoiceCommand({
        audio,
        target,
        initialGraph: {
          nodes: nodesRef.current,
          edges: edgesRef.current,
        },
        layout: {
          defaultAnchorContextId: pointedContextId,
          defaultPosition,
        },
        onMutation: (graph) => {
          nodesRef.current = graph.nodes;
          edgesRef.current = graph.edges;
          setNodes(graph.nodes);
          setEdges(graph.edges);
        },
      });
    },
    [setEdges, setNodes],
  );

  const voice = usePushToTalk({ pointedTarget, onRecording });

  return (
    <div className="canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidInteraction}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onInit={(instance) => {
          instanceRef.current = instance;
        }}
        panActivationKeyCode={null}
      >
        <Background color="#303435" gap={20} size={2} />
      </ReactFlow>
      <Reticle onTargetChange={setPointedTarget} status={voice.status} />
      {voice.status !== "idle" ? (
        <div
          className={`voice-status voice-status--${voice.status}`}
          role="status"
          aria-live="polite"
          title={voice.error ?? undefined}
        >
          {voice.status === "requesting"
            ? "mic"
            : voice.status === "error"
              ? "voice error"
              : voice.status}
        </div>
      ) : null}
    </div>
  );
}
