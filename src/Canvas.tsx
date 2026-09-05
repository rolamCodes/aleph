import { useCallback, useRef } from "react";
import {
  addEdge,
  Background,
  Controls,
  Panel,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type NodeTypes,
} from "@xyflow/react";
import ContextNode from "./ContextNode";
import type { ContextNode as ContextNodeType, InteractionEdge } from "./types";

const nodeTypes = {
  context: ContextNode,
} satisfies NodeTypes;

const initialNodes: ContextNodeType[] = [
  {
    id: "home",
    type: "context",
    position: { x: 40, y: 80 },
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
    position: { x: 420, y: 40 },
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
    position: { x: 800, y: 40 },
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
    position: { x: 420, y: 320 },
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

const initialEdges: InteractionEdge[] = [
  {
    id: "home-cta-sign-in",
    source: "home",
    sourceHandle: "exit:home-cta",
    target: "sign-in",
    targetHandle: "entry",
    label: "click",
    data: { interaction: "click" },
  },
  {
    id: "sign-in-submit-dashboard",
    source: "sign-in",
    sourceHandle: "exit:sign-in-submit",
    target: "dashboard",
    targetHandle: "entry",
    label: "submit",
    data: { interaction: "submit" },
  },
  {
    id: "home-settings-sheet",
    source: "home",
    sourceHandle: "exit:home-settings",
    target: "settings",
    targetHandle: "entry",
    label: "click",
    data: { interaction: "click" },
  },
];

function isValidInteraction(
  connection: Connection | InteractionEdge,
): boolean {
  const sourceHandle = connection.sourceHandle ?? "";
  const targetHandle = connection.targetHandle ?? "";
  return sourceHandle.startsWith("exit:") && targetHandle === "entry";
}

export default function Canvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const nextContextId = useRef(1);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!isValidInteraction(connection)) {
        return;
      }

      setEdges((current) =>
        addEdge(
          {
            ...connection,
            label: "click",
            data: { interaction: "click" },
          },
          current,
        ),
      );
    },
    [setEdges],
  );

  const addContext = useCallback(() => {
    const n = nextContextId.current;
    nextContextId.current += 1;
    const id = `context-${n}`;

    const newNode: ContextNodeType = {
      id,
      type: "context",
      position: {
        x: 40 + ((n - 1) % 3) * 280,
        y: 520 + Math.floor((n - 1) / 3) * 140,
      },
      data: {
        kind: "screen",
        name: `Screen ${n}`,
        items: [],
      },
    };

    setNodes((current) => [...current, newNode]);
  }, [setNodes]);

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
        fitView
      >
        <Background />
        <Controls />
        <Panel position="top-left">
          <button type="button" className="add-node" onClick={addContext}>
            Add context
          </button>
        </Panel>
      </ReactFlow>
    </div>
  );
}
