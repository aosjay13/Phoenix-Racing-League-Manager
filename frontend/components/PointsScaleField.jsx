"use client";

import { useMemo, useState } from "react";
import { looksPasted, parsePastedPoints, pointsPasteSummary } from "@/lib/pointsPaste";

const EXAMPLE = `Position\tPoints
1\t350
2\t320
3\t300`;

const monoText = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.8rem" };

const panelBox = {
  border: "1.5px solid var(--border)", borderRadius: 10, padding: "10px 12px",
  margin: "8px 0 4px", background: "var(--bg-elevated)",
};

const noteText = { fontSize: "0.78rem", color: "var(--ink-2)" };

// One points scale — the comma list an admin types, and the spreadsheet they
// would rather paste.
//
// A league's points structure is almost never invented here. It is already in a
// sheet, and retyping forty numbers in order is both tedious and the one place
// a transposed pair goes unnoticed for a season. So this box reads a paste:
// select the column (or the position/points pair of columns) in Excel or Google
// Sheets, paste it in, and the scale arrives in order.
//
// Two ways in, because they answer different moments:
//
//   • paste straight into the box. A paste with tab stops or several lines in
//     it came out of a spreadsheet, so it is read as one rather than dropped in
//     as text. Anything else — a comma list, a single number, a word — lands
//     exactly as it always did, and a paste this can't read is never eaten;
//   • the "Paste from a spreadsheet" panel, which shows what it made of the
//     paste BEFORE filling anything. It is also the reason anyone knows the box
//     takes a paste at all.
//
// Either way the scale it produces is the same comma list as ever, the previous
// one is one click away (Undo), and everything the reader did — which column it
// took as what, the rows it left out, the positions nobody listed — is said out
// loud. See lib/pointsPaste.js; nothing about how a scale is stored or scored
// changes here.
//
// Rendered by both points editors — the Season/Class form (PointsFields) and
// the per-session one (PointsEditorModal) — so Race Points behaves identically
// wherever it is edited.
export function PointsScaleField({
  id, label, value, onChange, what = "these points", rows = 3, placeholder = "",
  disabled = false, textareaStyle = null, children = null,
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [notice, setNotice] = useState(null);

  const read = useMemo(() => (text.trim() ? parsePastedPoints(text) : null), [text]);

  // The notice describes the scale this box is holding. When something else
  // replaces it — a template loaded over the top, another points system picked
  // in the dropdown above — it is describing a scale that is no longer there,
  // so it goes without needing to be told.
  const shown = notice?.result && value !== notice.result.list ? null : notice;

  function apply(result, { inline = false } = {}) {
    if (!result || result.error) return;
    setNotice({ result, previous: value, inline });
    onChange(result.list);
    setOpen(false);
    setText("");
  }

  function undo() {
    if (!notice) return;
    onChange(notice.previous);
    setNotice(null);
  }

  // A paste INTO the box. Spreadsheet-shaped text is read as a scale; anything
  // else is left to the browser, so pasting a comma list, or a number onto the
  // end of one, works exactly as it always has.
  function handlePaste(e) {
    if (disabled) return;
    const pasted = e.clipboardData?.getData("text") ?? "";
    if (!looksPasted(pasted)) return;
    const result = parsePastedPoints(pasted);
    if (!result) return;
    e.preventDefault();
    if (result.error) { setNotice({ error: result.error }); return; }
    apply(result, { inline: true });
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea id={id} rows={rows} value={value} disabled={disabled} placeholder={placeholder}
        style={textareaStyle || undefined}
        onPaste={handlePaste}
        onChange={e => { onChange(e.target.value); setNotice(null); }} />

      {/* .field is a flex column, so a button in it stretches the full width
          unless it says otherwise — and this one is a small way in, not a
          form's submit. */}
      {!disabled && (
        <button type="button" className="btn btn-ghost"
          style={{ marginTop: 4, padding: "3px 10px", fontSize: "0.78rem", alignSelf: "flex-start" }}
          onClick={() => { setOpen(o => !o); setNotice(null); }}>
          {open ? "✕ Close" : "📋 Paste from a spreadsheet"}
        </button>
      )}

      {open && (
        <div style={panelBox}>
          <label htmlFor={id ? `${id}-paste` : undefined} style={{ fontSize: "0.8rem" }}>
            Paste your points column here
          </label>
          <textarea id={id ? `${id}-paste` : undefined} rows={6} value={text} autoFocus
            onChange={e => setText(e.target.value)} placeholder={EXAMPLE}
            style={{ width: "100%", ...monoText }} />
          <span style={noteText}>
            A column of points, or a <strong>Position</strong> and <strong>Points</strong> pair of columns —
            tabs, commas or spaces between them all read the same. A title line above the table and a totals
            line under it are left out. Nothing is filled in until you press the button.
          </span>

          {text.trim() && !read && (
            <p style={{ margin: "8px 0 0", fontSize: "0.8rem", color: "var(--accent-gold, #e2b714)" }}>
              ⚠ No points found in that. It needs a number per finishing position — a column out of your
              spreadsheet, top place first.
            </p>
          )}
          {read?.error && (
            <p style={{ margin: "8px 0 0", fontSize: "0.8rem", color: "#e5484d" }}>⚠ {read.error}</p>
          )}
          {read && !read.error && (
            <div style={{ marginTop: 8 }}>
              <PasteReading read={read} />
              <button type="button" className="btn btn-primary" style={{ marginTop: 8 }}
                onClick={() => apply(read)}>
                Fill {what} with {read.count} position{read.count === 1 ? "" : "s"}
              </button>
              <button type="button" className="btn btn-ghost" style={{ marginTop: 8, marginLeft: 8 }}
                onClick={() => { setOpen(false); setText(""); }}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {shown?.error && (
        <span style={{ fontSize: "0.78rem", color: "#e5484d" }}>⚠ {shown.error}</span>
      )}
      {shown?.result && (
        <div style={{ ...panelBox, borderColor: "var(--accent-green, #3fb950)" }}>
          <div style={{ fontSize: "0.8rem", color: "var(--ink-1)" }}>
            ✓ Read <strong>{pointsPasteSummary(shown.result)}</strong>
            {shown.inline ? " from your paste, replacing what was in the box." : "."}
            <button type="button" className="btn btn-ghost"
              style={{ marginTop: 0, marginLeft: 8, padding: "2px 10px", fontSize: "0.76rem" }}
              onClick={undo}>
              Undo
            </button>
          </div>
          <PasteReading read={shown.result} />
        </div>
      )}

      {children}
    </div>
  );
}

// What the reader made of a paste: which column it took as what, the rows it
// left out and why, and anything it had to decide for itself. A points
// structure is a wall of numbers that all look alike, so a reader that did not
// show its working would be one nobody could check.
function PasteReading({ read }) {
  const { columns = {}, skipped = [], warnings = [], layout } = read;
  return (
    <>
      <div style={{ ...noteText, marginTop: 6 }}>
        {layout === "across"
          ? `Read across ${columns.position ? "two rows — positions, then points" : "the row, left to right"}.`
          : columns.position
            ? `Read “${columns.position}” as the finishing position and “${columns.points}” as the points.`
            : `Read “${columns.points}” as the points, top place first.`}
      </div>
      {warnings.map((w, i) => (
        <div key={i} style={{ fontSize: "0.78rem", color: "var(--accent-gold, #e2b714)", marginTop: 4 }}>⚠ {w}</div>
      ))}
      {skipped.length > 0 && (
        <div style={{ ...noteText, marginTop: 4 }}>
          Left out: {skipped.slice(0, 4).map(s => `“${s.text}” (${s.reason})`).join(" · ")}
          {skipped.length > 4 ? ` and ${skipped.length - 4} more` : ""}
        </div>
      )}
    </>
  );
}
