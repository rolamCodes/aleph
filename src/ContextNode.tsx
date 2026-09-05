import { Handle, Position, type NodeProps } from "@xyflow/react";
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

function ElementRow({ element }: { element: UIElement }) {
  return (
    <div className="element-row">
      <span className="element-label">{element.label}</span>
      {element.interactive ? (
        <Handle
          type="source"
          position={Position.Right}
          id={`exit:${element.id}`}
        />
      ) : (
        <span className="row-port" aria-hidden="true" />
      )}
    </div>
  );
}

export default function ContextNode({ data }: NodeProps<ContextNodeType>) {
  const sections = toSections(data.items);

  return (
    <div className={`context-node context-node--${data.kind}`}>
      <header className="context-header">
        <Handle type="target" position={Position.Left} id="entry" />
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
            >
              {section.name ? (
                <div className="component-name">{section.name}</div>
              ) : null}
              {section.elements.map((element) => (
                <ElementRow key={element.id} element={element} />
              ))}
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
