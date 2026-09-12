import { useCallback, useEffect, useRef, useState } from "react";
import {
  addEdge,
  Background,
  ReactFlow,
  reconnectEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type EdgeTypes,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { Id } from "../convex/_generated/dataModel";
import { api } from "../convex/_generated/api";
import ContextNode from "./ContextNode";
import InteractionEdge from "./InteractionEdge";
import { inferPointedTargetFromGraphChange } from "./inferPointedTarget";
import Companion from "./Companion";
import { usePushToTalk } from "./voice/usePushToTalk";
import type {
  ContextNode as ContextNodeType,
  InteractionEdge as InteractionEdgeType,
  PointedTarget,
} from "./types";

const nodeTypes = { context: ContextNode } satisfies NodeTypes;
const edgeTypes = { interaction: InteractionEdge } satisfies EdgeTypes;
const defaultEdgeOptions = { type: "interaction" } as const;

function isValidInteraction(
  connection: Connection | InteractionEdgeType,
): boolean {
  return (
    (connection.sourceHandle ?? "").startsWith("exit:") &&
    connection.targetHandle === "entry"
  );
}

function serializeNodes(nodes: ContextNodeType[]) {
  return nodes.map((node) => ({
    id: node.id,
    type: "context" as const,
    position: { x: node.position.x, y: node.position.y },
    data: {
      kind: node.data.kind,
      name: node.data.name,
      items: node.data.items.map((item) =>
        item.type === "component"
          ? {
              type: "component" as const,
              id: item.id,
              name: item.name,
              elements: item.elements.map((element) => ({ ...element })),
            }
          : { ...item },
      ),
    },
  }));
}

function serializeEdges(edges: InteractionEdgeType[]) {
  return edges.map((edge) => ({
    id: edge.id,
    type: "interaction" as const,
    source: edge.source,
    sourceHandle: edge.sourceHandle ?? "",
    target: edge.target,
    targetHandle: "entry" as const,
    label: edge.data?.interaction ?? String(edge.label ?? "click"),
    data: {
      interaction: edge.data?.interaction ?? String(edge.label ?? "click"),
    },
  }));
}

function parseStorageId(value: unknown): Id<"_storage"> {
  if (
    typeof value !== "object" ||
    value === null ||
    !("storageId" in value) ||
    typeof value.storageId !== "string"
  ) {
    throw new Error("Voice upload returned an invalid storage ID");
  }
  return value.storageId as Id<"_storage">;
}

export default function Canvas() {
  const project = useQuery(api.projects.current);
  const replaceGraph = useMutation(api.projects.replaceGraph);
  const generateUploadUrl = useMutation(api.projects.generateUploadUrl);
  const registerVoiceUpload = useMutation(api.projects.registerVoiceUpload);
  const runVoiceCommand = useAction(api.voice.run);
  const [nodes, setNodes, onNodesChange] = useNodesState<ContextNodeType>([]);
  const [edges, setEdges, onEdgesChange] =
    useEdgesState<InteractionEdgeType>([]);
  const [pointedTarget, setPointedTarget] = useState<PointedTarget>({
    kind: "canvas",
  });
  const [processingTarget, setProcessingTarget] = useState<PointedTarget>({
    kind: "canvas",
  });
  const [reticleUnlocked, setReticleUnlocked] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const edgesRef = useRef(edges);
  const nodesRef = useRef(nodes);
  const syncedAtRef = useRef<number | null>(null);
  const preProcessingGraphRef = useRef<{
    nodes: ContextNodeType[];
    edges: InteractionEdgeType[];
  }>({ nodes: [], edges: [] });
  const processingGraphUpdatedAtRef = useRef<number | null>(null);
  const instanceRef =
    useRef<ReactFlowInstance<ContextNodeType, InteractionEdgeType>>(null);

  useEffect(() => {
    edgesRef.current = edges;
    nodesRef.current = nodes;
  }, [edges, nodes]);

  useEffect(() => {
    if (!project || syncedAtRef.current === project.updatedAt) return;
    syncedAtRef.current = project.updatedAt;
    nodesRef.current = project.nodes;
    edgesRef.current = project.edges;
    setNodes(project.nodes);
    setEdges(project.edges);
  }, [project, setEdges, setNodes]);

  const persist = useCallback(
    async (
      nextNodes: ContextNodeType[],
      nextEdges: InteractionEdgeType[],
    ): Promise<void> => {
      if (!project) return;
      setSaveError(null);
      try {
        await replaceGraph({
          projectId: project._id,
          nodes: serializeNodes(nextNodes),
          edges: serializeEdges(nextEdges),
        });
      } catch (reason) {
        setSaveError(reason instanceof Error ? reason.message : "Save failed");
      }
    },
    [project, replaceGraph],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!isValidInteraction(connection)) return;
      const nextEdges = addEdge(
        {
          ...connection,
          type: "interaction",
          label: "click",
          data: { interaction: "click" },
        },
        edgesRef.current,
      );
      edgesRef.current = nextEdges;
      setEdges(nextEdges);
      void persist(nodesRef.current, nextEdges);
    },
    [persist, setEdges],
  );

  const onReconnect = useCallback(
    (oldEdge: InteractionEdgeType, connection: Connection) => {
      if (!isValidInteraction(connection)) return;
      const nextEdges = reconnectEdge(oldEdge, connection, edgesRef.current);
      edgesRef.current = nextEdges;
      setEdges(nextEdges);
      void persist(nodesRef.current, nextEdges);
    },
    [persist, setEdges],
  );

  const onRecording = useCallback(
    async (audio: Blob, target: PointedTarget): Promise<void> => {
      if (!project) throw new Error("Project is not ready");
      setProcessingTarget(target);
      if (target.kind === "canvas") {
        preProcessingGraphRef.current = {
          nodes: nodesRef.current,
          edges: edgesRef.current,
        };
        processingGraphUpdatedAtRef.current = project.updatedAt;
        setReticleUnlocked(false);
      } else {
        setReticleUnlocked(true);
      }
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
      const uploadUrl = await generateUploadUrl({});
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": audio.type || "audio/wav" },
        body: audio,
      });
      if (!response.ok) throw new Error("Voice recording upload failed");
      const storageId = parseStorageId(await response.json());
      await registerVoiceUpload({ projectId: project._id, storageId });
      await runVoiceCommand({
        projectId: project._id,
        storageId,
        target,
        layout: {
          defaultAnchorContextId: pointedContextId,
          defaultPosition,
        },
      });
    },
    [generateUploadUrl, project, registerVoiceUpload, runVoiceCommand],
  );

  const voice = usePushToTalk({ pointedTarget, onRecording });

  useEffect(() => {
    if (voice.status !== "processing") {
      setReticleUnlocked(false);
      return;
    }
    if (reticleUnlocked || !project) {
      return;
    }
    if (processingTarget.kind !== "canvas") {
      return;
    }
    if (project.updatedAt === processingGraphUpdatedAtRef.current) {
      return;
    }

    const target = inferPointedTargetFromGraphChange(
      preProcessingGraphRef.current.nodes,
      preProcessingGraphRef.current.edges,
      project.nodes,
      project.edges,
    );
    if (target.kind !== "canvas") {
      setProcessingTarget(target);
      setReticleUnlocked(true);
    }
  }, [processingTarget.kind, project, reticleUnlocked, voice.status]);

  if (project === undefined) {
    return <div className="app-state">Loading project…</div>;
  }
  if (project === null) {
    return <div className="app-state">Project not found.</div>;
  }

  return (
    <div className="canvas">
      <ReactFlow
        proOptions={{ hideAttribution: true }}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={(_event, node) => {
          const nextNodes = nodesRef.current.map((candidate) =>
            candidate.id === node.id
              ? { ...candidate, position: { ...node.position } }
              : candidate,
          );
          nodesRef.current = nextNodes;
          setNodes(nextNodes);
          void persist(nextNodes, edgesRef.current);
        }}
        onNodesDelete={(deleted) => {
          const deletedIds = new Set(deleted.map((node) => node.id));
          const nextNodes = nodesRef.current.filter(
            (node) => !deletedIds.has(node.id),
          );
          const nextEdges = edgesRef.current.filter(
            (edge) =>
              !deletedIds.has(edge.source) && !deletedIds.has(edge.target),
          );
          nodesRef.current = nextNodes;
          edgesRef.current = nextEdges;
          void persist(nextNodes, nextEdges);
        }}
        onEdgesDelete={(deleted) => {
          const deletedIds = new Set(deleted.map((edge) => edge.id));
          const nextEdges = edgesRef.current.filter(
            (edge) => !deletedIds.has(edge.id),
          );
          edgesRef.current = nextEdges;
          void persist(nodesRef.current, nextEdges);
        }}
        onConnect={onConnect}
        onReconnect={onReconnect}
        isValidConnection={isValidInteraction}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        reconnectRadius={14}
        onInit={(instance) => {
          instanceRef.current = instance;
        }}
        panActivationKeyCode={null}
      >
        <Background color="#303435" gap={20} size={2} />
      </ReactFlow>
      <Companion
        frozen={
          voice.status === "processing" &&
          processingTarget.kind === "canvas" &&
          !reticleUnlocked
        }
        focusTarget={
          voice.status === "processing" ? processingTarget : undefined
        }
        onTargetChange={setPointedTarget}
        readOrbReact={voice.readOrbReact}
        status={voice.status}
      />
      {saveError ? <div className="save-error">{saveError}</div> : null}
    </div>
  );
}
