import { useCallback, useEffect, useRef, useState } from "react";
import {
  addEdge,
  Background,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type EdgeTypes,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { GraphState } from "../convex/lib/graphTypes.ts";
import type { Id } from "../convex/_generated/dataModel";
import { api } from "../convex/_generated/api";
import Companion from "./Companion";
import ContextNode from "./ContextNode";
import InteractionEdge from "./InteractionEdge";
import {
  deleteTarget,
  getTargetLabel,
  renameTarget,
  summarizeVoiceResult,
  toUserFacingError,
  unknownVoiceResult,
} from "./companionActions";
import { inferPointedTargetFromGraphChange } from "./inferPointedTarget";
import Reticle from "./Reticle";
import { useCompanionPosition } from "./useCompanionPosition";
import { usePushToTalk } from "./voice/usePushToTalk";
import {
  interactionLocksCanvas,
  isGraphTarget,
  type CompanionInteraction,
  type ContextNode as ContextNodeType,
  type GraphTarget,
  type InteractionEdge as InteractionEdgeType,
  type PointedTarget,
  type VoiceResult,
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

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT")
  );
}

function isComposingKey(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

function serializeNodes(nodes: ContextNodeType[]): GraphState["nodes"] {
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

function serializeEdges(edges: InteractionEdgeType[]): GraphState["edges"] {
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

function toGraphState(
  nodes: ContextNodeType[],
  edges: InteractionEdgeType[],
): GraphState {
  return {
    nodes: serializeNodes(nodes),
    edges: serializeEdges(edges),
  };
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

function visualTargetFor(
  interaction: CompanionInteraction,
  processingTarget: PointedTarget,
): PointedTarget | undefined {
  switch (interaction.mode) {
    case "idle":
    case "summary":
      return undefined;
    case "preparing":
    case "listening":
    case "working":
      return processingTarget;
    default:
      return interaction.target;
  }
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
  const [interaction, setInteraction] = useState<CompanionInteraction>({
    mode: "idle",
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
  const interactionRef = useRef(interaction);
  const pointedTargetRef = useRef(pointedTarget);
  const lockedRef = useRef(false);
  const actionLockRef = useRef(false);
  const instanceRef =
    useRef<ReactFlowInstance<ContextNodeType, InteractionEdgeType>>(null);

  const setInteractionSync = useCallback((next: CompanionInteraction) => {
    interactionRef.current = next;
    lockedRef.current = interactionLocksCanvas(next);
    setInteraction(next);
  }, []);

  const setIdle = useCallback(() => {
    setInteractionSync({ mode: "idle" });
  }, [setInteractionSync]);

  useEffect(() => {
    edgesRef.current = edges;
    nodesRef.current = nodes;
  }, [edges, nodes]);

  useEffect(() => {
    pointedTargetRef.current = pointedTarget;
  }, [pointedTarget]);

  useEffect(() => {
    interactionRef.current = interaction;
    lockedRef.current = interactionLocksCanvas(interaction);
  }, [interaction]);

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

  const persistGraph = useCallback(
    async (graph: GraphState): Promise<void> => {
      if (!project) {
        throw new Error("Project is not ready");
      }
      await replaceGraph({
        projectId: project._id,
        nodes: graph.nodes,
        edges: graph.edges,
      });
    },
    [project, replaceGraph],
  );

  const currentGraph = useCallback(
    () => toGraphState(nodesRef.current, edgesRef.current),
    [],
  );

  const openMenu = useCallback(
    (target: GraphTarget) => {
      setInteractionSync({ mode: "menu", target, selectedIndex: 0 });
    },
    [setInteractionSync],
  );

  const openRename = useCallback(
    (target: GraphTarget, draft?: string) => {
      const label = draft ?? getTargetLabel(currentGraph(), target);
      if (label === null) {
        setInteractionSync({
          mode: "error",
          target,
          message: "That item is no longer on the canvas.",
        });
        return;
      }
      setInteractionSync({ mode: "rename", target, draft: label });
    },
    [currentGraph, setInteractionSync],
  );

  const submitRename = useCallback(async () => {
    const current = interactionRef.current;
    if (current.mode !== "rename") {
      return;
    }
    const trimmed = current.draft.trim();
    if (trimmed === "") {
      setInteractionSync({
        ...current,
        notice: "Enter a name.",
      });
      return;
    }
    if (actionLockRef.current) {
      return;
    }
    const previous = getTargetLabel(currentGraph(), current.target);
    if (previous === trimmed) {
      setIdle();
      return;
    }
    setProcessingTarget(current.target);
    setReticleUnlocked(true);
    actionLockRef.current = true;
    setInteractionSync({ mode: "working", target: current.target });
    try {
      const next = renameTarget(currentGraph(), current.target, trimmed);
      await persistGraph(next.graph);
      setInteractionSync({ mode: "summary", message: next.summary });
    } catch (reason) {
      setInteractionSync({
        mode: "error",
        target: current.target,
        message: toUserFacingError(reason),
        recovery: { type: "rename", draft: current.draft },
      });
    } finally {
      actionLockRef.current = false;
    }
  }, [currentGraph, persistGraph, setIdle, setInteractionSync]);

  const commitDelete = useCallback(
    async (target: GraphTarget) => {
      if (actionLockRef.current) {
        return;
      }
      setProcessingTarget(target);
      setReticleUnlocked(true);
      actionLockRef.current = true;
      setInteractionSync({ mode: "working", target });
      try {
        const next = deleteTarget(currentGraph(), target);
        await persistGraph(next.graph);
        setInteractionSync({ mode: "summary", message: next.summary });
      } catch (reason) {
        setInteractionSync({
          mode: "error",
          target,
          message: toUserFacingError(reason),
        });
      } finally {
        actionLockRef.current = false;
      }
    },
    [currentGraph, persistGraph, setInteractionSync],
  );

  const runMenuSelect = useCallback(
    (index: number) => {
      const current = interactionRef.current;
      if (current.mode !== "menu") {
        return;
      }
      if (index === 0) {
        openRename(current.target);
        return;
      }
      void commitDelete(current.target);
    },
    [commitDelete, openRename],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (lockedRef.current || !isValidInteraction(connection)) return;
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

  const applyVoiceOutcome = useCallback(
    (result: VoiceResult, target: PointedTarget) => {
      const message = summarizeVoiceResult(result);
      if (result.status === "complete") {
        setInteractionSync({ mode: "summary", message });
        return;
      }
      setInteractionSync({ mode: "error", target, message });
    },
    [setInteractionSync],
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
      let submitted = false;
      const uploadUrl = await generateUploadUrl({});
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": audio.type || "audio/wav" },
        body: audio,
      });
      if (!response.ok) throw new Error("Voice recording upload failed");
      const storageId = parseStorageId(await response.json());
      await registerVoiceUpload({ projectId: project._id, storageId });
      submitted = true;
      try {
        const result = await runVoiceCommand({
          projectId: project._id,
          storageId,
          target,
          layout: {
            defaultAnchorContextId: pointedContextId,
            defaultPosition,
          },
        });
        applyVoiceOutcome(result ?? unknownVoiceResult(), target);
      } catch (reason) {
        if (submitted) {
          applyVoiceOutcome(unknownVoiceResult(), target);
          return;
        }
        throw reason;
      }
    },
    [generateUploadUrl, project, registerVoiceUpload, runVoiceCommand, applyVoiceOutcome],
  );

  const isVoiceEnabled = useCallback(() => {
    const mode = interactionRef.current.mode;
    return mode === "idle" || mode === "summary";
  }, []);

  const { cancelCapture, readAmplitude } = usePushToTalk({
    pointedTarget,
    isEnabled: isVoiceEnabled,
    onPreparing: (target) => {
      setProcessingTarget(target);
      if (target.kind === "canvas") {
        setReticleUnlocked(false);
      } else {
        setReticleUnlocked(true);
      }
      setInteractionSync({ mode: "preparing", target });
    },
    onListening: () => {
      const current = interactionRef.current;
      if (current.mode === "preparing") {
        setInteractionSync({ mode: "listening", target: current.target });
      }
    },
    onWorking: () => {
      const current = interactionRef.current;
      if (current.mode === "listening" || current.mode === "preparing") {
        setInteractionSync({ mode: "working", target: current.target });
      }
    },
    onIdle: setIdle,
    onError: (message) => {
      const current = interactionRef.current;
      const target =
        current.mode === "idle" || current.mode === "summary"
          ? pointedTargetRef.current
          : "target" in current
            ? current.target
            : pointedTargetRef.current;
      setInteractionSync({ mode: "error", target, message });
    },
    onRecording,
  });

  const locked = interactionLocksCanvas(interaction);
  const visualTarget = visualTargetFor(interaction, processingTarget);
  const freeze =
    locked && (!visualTarget || visualTarget.kind === "canvas") && !reticleUnlocked;

  const { companionRef, reticleRef } = useCompanionPosition({
    locked,
    freeze,
    focusTarget: visualTarget,
    onTargetChange: setPointedTarget,
  });

  useEffect(() => {
    if (interaction.mode !== "working") {
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
  }, [interaction.mode, processingTarget.kind, project, reticleUnlocked]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isComposingKey(event)) {
        return;
      }

      const current = interactionRef.current;

      if (event.key === "Escape") {
        if (current.mode === "preparing" || current.mode === "listening") {
          event.preventDefault();
          cancelCapture();
          return;
        }
        if (
          current.mode === "menu" ||
          current.mode === "rename" ||
          current.mode === "error" ||
          current.mode === "summary"
        ) {
          event.preventDefault();
          setIdle();
        }
        return;
      }

      if (current.mode === "working") {
        return;
      }

      if (current.mode === "rename") {
        if (event.key === "Enter" && !event.repeat) {
          event.preventDefault();
          void submitRename();
        }
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      if (current.mode === "menu") {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setInteractionSync({
            ...current,
            selectedIndex: (current.selectedIndex + 1) % 2,
          });
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setInteractionSync({
            ...current,
            selectedIndex: (current.selectedIndex + 1) % 2,
          });
          return;
        }
        if (event.key === "Enter" && !event.repeat) {
          event.preventDefault();
          runMenuSelect(current.selectedIndex);
        }
        return;
      }

      if (event.repeat || current.mode === "error") {
        return;
      }

      const canStart = current.mode === "idle" || current.mode === "summary";
      if (!canStart || !isGraphTarget(pointedTargetRef.current)) {
        return;
      }

      if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        openMenu(pointedTargetRef.current);
        return;
      }

      if (event.key === "F2") {
        event.preventDefault();
        openRename(pointedTargetRef.current);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    openMenu,
    openRename,
    runMenuSelect,
    setIdle,
    setInteractionSync,
    submitRename,
    cancelCapture,
  ]);

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
          if (lockedRef.current) return;
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
          if (lockedRef.current) return;
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
          if (lockedRef.current) return;
          const deletedIds = new Set(deleted.map((edge) => edge.id));
          const nextEdges = edgesRef.current.filter(
            (edge) => !deletedIds.has(edge.id),
          );
          edgesRef.current = nextEdges;
          void persist(nodesRef.current, nextEdges);
        }}
        onConnect={onConnect}
        isValidConnection={isValidInteraction}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        nodesDraggable={!locked}
        nodesConnectable={!locked}
        elementsSelectable={!locked}
        panOnDrag={!locked}
        zoomOnScroll={!locked}
        zoomOnPinch={!locked}
        zoomOnDoubleClick={!locked}
        deleteKeyCode={null}
        onInit={(instance) => {
          instanceRef.current = instance;
        }}
        panActivationKeyCode={null}
      >
        <Background color="#303435" gap={20} size={2} />
      </ReactFlow>
      {locked ? <div className="canvas-shield" /> : null}
      <Companion
        companionRef={companionRef}
        interaction={interaction}
        readAmplitude={readAmplitude}
        onDiscClick={() => {
          if (isGraphTarget(pointedTargetRef.current)) {
            openMenu(pointedTargetRef.current);
          }
        }}
        onMenuSelect={runMenuSelect}
        onMenuHover={(index) => {
          const current = interactionRef.current;
          if (current.mode === "menu") {
            setInteractionSync({ ...current, selectedIndex: index });
          }
        }}
        onRenameChange={(draft) => {
          const current = interactionRef.current;
          if (current.mode === "rename") {
            setInteractionSync({ ...current, draft, notice: undefined });
          }
        }}
        onRenameSubmit={() => {
          void submitRename();
        }}
        onRenameCancel={setIdle}
        onDismiss={setIdle}
        onRecoverRename={() => {
          const current = interactionRef.current;
          if (current.mode === "error" && current.recovery?.type === "rename" && isGraphTarget(current.target)) {
            openRename(current.target, current.recovery.draft);
          }
        }}
      />
      <Reticle reticleRef={reticleRef} />
      {saveError ? <div className="save-error">{saveError}</div> : null}
    </div>
  );
}
