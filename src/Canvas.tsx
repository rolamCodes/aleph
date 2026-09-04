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
  type Edge,
  type Node,
} from "@xyflow/react";

const initialNodes: Node[] = [];
const initialEdges: Edge[] = [];

export default function Canvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const nextNodeId = useRef(1);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) => addEdge(connection, current));
    },
    [setEdges],
  );

  const addNode = useCallback(() => {
    const id = String(nextNodeId.current);
    const index = nextNodeId.current - 1;
    nextNodeId.current += 1;

    const newNode: Node = {
      id,
      position: {
        x: 80 + (index % 4) * 200,
        y: 80 + Math.floor(index / 4) * 120,
      },
      data: { label: `Node ${id}` },
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
      >
        <Background />
        <Controls />
        <Panel position="top-left">
          <button type="button" className="add-node" onClick={addNode}>
            Add node
          </button>
        </Panel>
      </ReactFlow>
    </div>
  );
}
