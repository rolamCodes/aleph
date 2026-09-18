import { useState } from "react";

const STORAGE_KEY = "aleph-hide-how-it-works";

function shouldShow(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "true";
  } catch {
    return true;
  }
}

export default function HowItWorks() {
  const [open, setOpen] = useState(shouldShow);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  if (!open) {
    return null;
  }

  const close = () => {
    if (dontShowAgain) {
      try {
        localStorage.setItem(STORAGE_KEY, "true");
      } catch {
        // Ignore storage failures and still close the popup.
      }
    }
    setOpen(false);
  };

  return (
    <div
      className="how-it-works"
      role="dialog"
      aria-modal="true"
      aria-labelledby="how-it-works-title"
    >
      <div className="how-it-works-card">
        <h2 id="how-it-works-title">How it works</h2>
        <p>
          Point at the canvas, a screen, a component, or a connection. Then:
        </p>
        <ul>
          <li>Hold Space and speak to add or change what you are pointing at</li>
          <li>Press / to rename or delete the pointed item</li>
          <li>Drag screens to move them</li>
          <li>Connect an element to another screen to describe an interaction</li>
        </ul>
        <label className="how-it-works-opt-out">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(event) => setDontShowAgain(event.target.checked)}
          />
          Don&apos;t show this again
        </label>
        <button type="button" autoFocus onClick={close}>
          Got it
        </button>
      </div>
    </div>
  );
}
