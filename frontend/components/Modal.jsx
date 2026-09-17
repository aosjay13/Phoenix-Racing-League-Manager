"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Minimal overlay dialog. Clicking the backdrop (not the card itself) closes it.
// Rendered through a portal to document.body so the dialog (and its own <form>)
// never nests inside a caller's form — nested forms misroute the submit button,
// which broke the inline "Add Track" modal opened from the race edit form.
//
// How wide the card is allowed to get. A dialog that ASKS SOMETHING is a form,
// and a form is easier to read in a narrow column. A dialog that is a
// WORKSPACE is not: the duplicate eliminator reviews several venues side by
// side, and the season schedule importer puts a whole calendar and a row per
// venue — a name, a dropdown of every track in the league, a text field and a
// type — in front of you at once. Squeezed into a form column those become a
// horizontal scrollbar, which is the one thing a table of twelve rounds must
// not have: you cannot check a schedule you can only see a third of.
//
// Every one of these only lifts the CEILING. The card is `width: 100%` under
// it, so on a phone they are all the same full-width dialog they were.
const WIDTHS = { form: 480, wide: 760, workspace: 1080 };

export function Modal({ title, onClose, wide = false, size = "", children }) {
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
      <div className="form-card"
        style={{
          maxWidth: WIDTHS[size] || (wide ? WIDTHS.wide : WIDTHS.form),
          width: "100%", maxHeight: "85vh", overflowY: "auto",
        }}
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
