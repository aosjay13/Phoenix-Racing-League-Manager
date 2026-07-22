"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Minimal overlay dialog. Clicking the backdrop (not the card itself) closes it.
// Rendered through a portal to document.body so the dialog (and its own <form>)
// never nests inside a caller's form — nested forms misroute the submit button,
// which broke the inline "Add Track" modal opened from the race edit form.
export function Modal({ title, onClose, children }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="form-card" style={{ maxWidth: 480, width: "100%", maxHeight: "85vh", overflowY: "auto" }}
        onMouseDown={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button className="btn btn-ghost" type="button" style={{ marginTop: 0, padding: "4px 10px" }} onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
