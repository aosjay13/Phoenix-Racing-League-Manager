"use client";

import { useMemo } from "react";
import { Modal } from "@/components/Modal";
import { duplicateReport, matchReason } from "@/lib/driverMatch";

// The live version of the same question, shown UNDER a driver-name field as
// it's typed. The prompt below stops a duplicate; this stops the surprise —
// an admin filling in "Add Driver" can see that the app already knows this
// person before they reach the button, which is the "notion that this was
// happening" that was missing entirely.
//
// Says nothing at all when the name is new, so an ordinary add stays silent.
export function DriverMatchNote({ pool = [], games = {}, name = "", user_id = "", exclude_id = "" }) {
  const typed = String(name || "").trim();
  const report = useMemo(
    () => duplicateReport(pool, { name: typed, user_id, exclude_id }, { games }),
    [pool, games, typed, user_id, exclude_id]);

  if (!typed || report.status === "none") return null;

  if (report.status === "linked") {
    return (
      <p style={{ margin: "0 0 10px", fontSize: "0.78rem", color: "var(--accent-cyan, #58a6ff)" }}>
        ✓ This is <strong>{report.match.name}</strong>, already in the app ({matchReason(report.match)}). They&rsquo;ll be
        added under that profile, so their history stays in one place.
      </p>
    );
  }
  return (
    <p style={{ margin: "0 0 10px", fontSize: "0.78rem", color: "var(--accent-amber, #d29922)" }}>
      ⚠ Looks like {report.matches.slice(0, 3).map(m => m.name).join(", ")}
      {report.matches.length > 3 ? ` and ${report.matches.length - 3} more` : ""} — you&rsquo;ll be asked which
      before a new driver is created.
    </p>
  );
}

// "Hang on — is this someone you already have?"
//
// The prompt that was missing. Every screen that can create a driver — the
// roster's Add Driver form, the driver pool, the race-entry autocomplete, the
// Smart Importer's create option — runs the duplicate rules first
// (lib/driverMatch.js) and, when anything comes back, shows this instead of
// writing a second profile.
//
// It is a QUESTION, never a refusal. Two drivers with similar names is an
// ordinary thing in a league, so "No — this is someone new" is always right
// there and always works. What can't happen any more is the third option the
// app used to take on its own: creating the duplicate without saying anything.
//
// Each candidate says WHY it came up ("their PSN Username is “Ryan_Bird_77”",
// "their BeamNG name is “Ryanbirdman”", "used to race as “Ryan M”"), because
// that is the difference between a prompt an admin can answer and one they
// dismiss — especially for the case that started all this, where the same
// person appears under a different name in a different game.
export function DuplicateDriverPrompt({
  typedName,
  matches = [],
  status = "possible",
  busy = false,
  createLabel = "No — create a new driver",
  onUse,
  onCreateAnyway,
  onCancel,
}) {
  const lead = status === "linked" || status === "ambiguous"
    ? `The app already has ${matches.length === 1 ? "a driver" : "drivers"} racing under that name.`
    : "That name looks like someone the app already has.";

  return (
    <Modal title="Is this someone you already have?" onClose={busy ? () => {} : onCancel}>
      <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.9rem" }}>
        {lead} Adding <strong>{typedName}</strong> as a new driver would give the same person two
        profiles, and their race history would be split between them.
      </p>

      <div style={{ margin: "12px 0" }}>
        {matches.map(m => (
          <div className="driver-row" key={m.driver_id} style={{ gap: 8, alignItems: "center" }}>
            <span style={{ flex: 1 }}>
              <strong>{m.name}</strong>
              <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.78rem" }}>
                {m.reason || matchReason(m)}
                {m.user_id ? " · has a player account" : ""}
              </span>
            </span>
            <button className="btn btn-primary" type="button" style={{ marginTop: 0, padding: "4px 10px" }}
              disabled={busy} onClick={() => onUse(m)}>
              Use {m.name}
            </button>
          </div>
        ))}
      </div>

      <p style={{ margin: "0 0 10px", fontSize: "0.78rem", color: "var(--ink-2)" }}>
        Picking someone here adds <strong>them</strong> — every result they already have stays on the
        one profile. If this really is a different person, create them and nothing above is touched.
      </p>

      <button className="btn btn-ghost" type="button" disabled={busy} onClick={onCreateAnyway}>
        {busy ? "Working…" : createLabel}
      </button>
      <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} disabled={busy} onClick={onCancel}>
        Cancel
      </button>
    </Modal>
  );
}
