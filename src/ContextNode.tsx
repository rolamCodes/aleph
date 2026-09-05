import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ContextNode as ContextNodeType, UIElement } from "./types";

function ElementRow({ element }: { element: UIElement }) {
  return (
    <div className="element-row">
      <span className="element-kind">{element.kind}</span>
      <span className="element-label">{element.label}</span>
      {element.interactive ? (
        <Handle
          type="source"
          position={Position.Right}
          id={`exit:${element.id}`}
        />
      ) : null}
    </div>
  );
}

export default function ContextNode({ data }: NodeProps<ContextNodeType>) {
  return (
    <div className="context-node">
      <Handle type="target" position={Position.Left} id="entry" />
      <header className="context-header">
        <span className="context-kind">{data.kind}</span>
        <span className="context-name">{data.name}</span>
      </header>
      {data.items.length > 0 ? (
        <ul className="context-items">
          {data.items.map((item) =>
            item.type === "component" ? (
              <li key={item.id} className="component-group">
                <div className="component-name">{item.name}</div>
                {item.elements.map((element) => (
                  <ElementRow key={element.id} element={element} />
                ))}
              </li>
            ) : (
              <li key={item.id}>
                <ElementRow element={item} />
              </li>
            ),
          )}
        </ul>
      ) : null}
    </div>
  );
}
