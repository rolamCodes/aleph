import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { CompanionInteraction } from "./types";

const MENU_ACTIONS = ["Rename", "Delete"] as const;

function isExpanded(interaction: CompanionInteraction): boolean {
  return (
    interaction.mode === "menu" ||
    interaction.mode === "rename" ||
    interaction.mode === "error" ||
    interaction.mode === "summary"
  );
}

export default function Companion({
  companionRef,
  interaction,
  readAmplitude,
  onDiscClick,
  onMenuSelect,
  onMenuHover,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onDismiss,
  onRecoverRename,
}: {
  companionRef: RefObject<HTMLDivElement | null>;
  interaction: CompanionInteraction;
  readAmplitude: () => number;
  onDiscClick: () => void;
  onMenuSelect: (index: number) => void;
  onMenuHover: (index: number) => void;
  onRenameChange: (draft: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onDismiss: () => void;
  onRecoverRename: () => void;
}) {
  const lightRef = useRef<HTMLSpanElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const expanded = isExpanded(interaction);

  useLayoutEffect(() => {
    const root = companionRef.current;
    const body = bodyRef.current;
    if (!root) {
      return;
    }

    root.classList.toggle("companion--expanded", expanded);
    if (!expanded) {
      root.style.width = "28px";
      root.style.height = "28px";
      root.style.borderRadius = "50%";
      root.classList.remove("companion--text-ready");
      return;
    }

    root.style.width = "248px";
    root.style.borderRadius = "14px";
    const contentHeight = body?.scrollHeight ?? 0;
    const height = Math.min(240, Math.max(48, contentHeight + 20));
    root.style.height = `${height}px`;

    let ready = false;
    const reveal = () => {
      if (ready) {
        return;
      }
      ready = true;
      root.classList.add("companion--text-ready");
    };
    const timeout = window.setTimeout(reveal, 160);
    const onEnd = (event: TransitionEvent) => {
      if (event.propertyName === "width") {
        reveal();
      }
    };
    root.addEventListener("transitionend", onEnd);
    return () => {
      window.clearTimeout(timeout);
      root.removeEventListener("transitionend", onEnd);
    };
  }, [companionRef, expanded, interaction]);

  useEffect(() => {
    if (interaction.mode === "rename") {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [interaction.mode]);

  useEffect(() => {
    const light = lightRef.current;
    if (!light) {
      return;
    }

    if (interaction.mode !== "listening" && interaction.mode !== "working") {
      light.style.opacity = interaction.mode === "preparing" ? "0.3" : "1";
      light.style.transform = "";
      light.style.boxShadow = "0 0 4px #D8E6EA";
      return;
    }

    let raf = 0;
    const loop = () => {
      if (interaction.mode === "listening") {
        const level = readAmplitude();
        light.style.opacity = `${0.3 + 0.6 * level}`;
        light.style.transform = `scale(${(6 + 4 * level) / 6})`;
        light.style.boxShadow = `0 0 ${4 + 6 * level}px #D8E6EA`;
      } else {
        const angle = (performance.now() / 1200) * Math.PI * 2;
        light.style.opacity = "1";
        light.style.boxShadow = "0 0 4px #D8E6EA";
        light.style.transform = `translate(${4 * Math.cos(angle)}px, ${4 * Math.sin(angle)}px)`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [interaction.mode, readAmplitude]);

  const summaryMessage =
    interaction.mode === "summary" ? interaction.message : null;

  useEffect(() => {
    if (summaryMessage === null) {
      return;
    }
    const root = companionRef.current;
    let remaining = 4000;
    let last = performance.now();
    let hovering = false;
    const onEnter = () => {
      hovering = true;
    };
    const onLeave = () => {
      hovering = false;
    };
    root?.addEventListener("pointerenter", onEnter);
    root?.addEventListener("pointerleave", onLeave);
    let raf = 0;
    const loop = (now: number) => {
      const focused = root?.contains(document.activeElement) ?? false;
      if (!hovering && !focused) {
        remaining -= now - last;
        if (remaining <= 0) {
          onDismiss();
          return;
        }
      }
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      root?.removeEventListener("pointerenter", onEnter);
      root?.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(raf);
    };
  }, [companionRef, onDismiss, summaryMessage]);

  return (
    <div
      ref={companionRef}
      className="companion"
      data-companion=""
      data-mode={interaction.mode}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (interaction.mode === "idle" || interaction.mode === "summary") {
          onDiscClick();
        }
      }}
    >
      <span ref={lightRef} className="companion-light" />
      {expanded ? (
        <div ref={bodyRef} className="companion-body">
          {interaction.mode === "menu" ? (
            <div className="companion-menu">
              {MENU_ACTIONS.map((label, index) => (
                <button
                  key={label}
                  type="button"
                  className={
                    interaction.selectedIndex === index
                      ? "companion-row companion-row--active"
                      : "companion-row"
                  }
                  onMouseEnter={() => onMenuHover(index)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onMenuSelect(index);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
          {interaction.mode === "rename" ? (
            <div className="companion-rename">
              <input
                ref={inputRef}
                className="companion-input"
                value={interaction.draft}
                onChange={(event) => onRenameChange(event.target.value)}
                onClick={(event) => event.stopPropagation()}
              />
              {interaction.notice ? (
                <div className="companion-secondary">{interaction.notice}</div>
              ) : null}
              <div className="companion-actions">
                <button type="button" className="companion-text-btn" onClick={onRenameSubmit}>
                  Save
                </button>
                <button
                  type="button"
                  className="companion-text-btn companion-text-btn--secondary"
                  onClick={onRenameCancel}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          {interaction.mode === "error" ? (
            <div className="companion-message">
              <p>{interaction.message}</p>
              <div className="companion-actions">
                {interaction.recovery?.type === "rename" ? (
                  <button
                    type="button"
                    className="companion-text-btn"
                    onClick={onRecoverRename}
                  >
                    Edit
                  </button>
                ) : null}
                <button
                  type="button"
                  className="companion-text-btn companion-text-btn--secondary"
                  onClick={onDismiss}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}
          {interaction.mode === "summary" ? (
            <div className="companion-message">
              <p>{interaction.message}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
