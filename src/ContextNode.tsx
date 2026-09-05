import { Handle, Position, useStore, type NodeProps } from "@xyflow/react";
import type {
  ContextItem,
  ContextNode as ContextNodeType,
  UIElement,
} from "./types";

type Section = {
  id: string;
  name?: string;
  elements: UIElement[];
};

function toSections(items: ContextItem[]): Section[] {
  const sections: Section[] = [];
  let loose: UIElement[] = [];
  let looseId = "";

  for (const item of items) {
    if (item.type === "component") {
      if (loose.length > 0) {
        sections.push({ id: looseId, elements: loose });
        loose = [];
        looseId = "";
      }
      sections.push({
        id: item.id,
        name: item.name,
        elements: item.elements,
      });
      continue;
    }

    if (loose.length === 0) {
      looseId = item.id;
    }
    loose.push(item);
  }

  if (loose.length > 0) {
    sections.push({ id: looseId, elements: loose });
  }

  return sections;
}

function ElementRow({
  element,
  nodeId,
}: {
  element: UIElement;
  nodeId: string;
}) {
  const isConnected = useStore((state) =>
    state.edges.some(
      (edge) =>
        edge.source === nodeId && edge.sourceHandle === `exit:${element.id}`,
    ),
  );

  return (
    <div className="element-row" data-reticle>
      <span className="element-label">{element.label}</span>
      {element.interactive ? (
        <Handle
          type="source"
          position={Position.Right}
          id={`exit:${element.id}`}
          className={
            isConnected
              ? "element-exit element-exit--connected"
              : "element-exit"
          }
        />
      ) : (
        <span className="row-port" aria-hidden="true" />
      )}
    </div>
  );
}

export default function ContextNode({ id, data }: NodeProps<ContextNodeType>) {
  const isConnected = useStore((state) =>
    state.edges.some(
      (edge) => edge.target === id && (edge.targetHandle ?? "entry") === "entry",
    ),
  );
  const sections = toSections(data.items);

  return (
    <div
      className={`context-node context-node--${data.kind}`}
      data-reticle
    >
      <header className="context-header">
        <Handle
          type="target"
          position={Position.Left}
          id="entry"
          className={
            isConnected
              ? "context-entry context-entry--connected"
              : "context-entry"
          }
        />
        <span className="context-name">{data.name}</span>
        <span className={`context-kind context-kind--${data.kind}`}>
          {data.kind}
        </span>
      </header>
      {sections.length > 0 ? (
        <div className="context-sections">
          {sections.map((section) => (
            <section
              key={section.id}
              className={
                section.name
                  ? "component-group"
                  : "component-group component-group--untitled"
              }
              data-reticle
            >
              {section.name ? (
                <div className="component-name">{section.name}</div>
              ) : null}
              {section.elements.map((element) => (
                <ElementRow
                  key={element.id}
                  element={element}
                  nodeId={id}
                />
              ))}
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
