"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { PlacementTargetFields } from "@/components/PlacementTargetFields";

// "Where are these drivers going?", asked from the placement board itself.
//
// The destinations used to live only in the session's Settings dialog, three
// clicks and one mental model away from the screen where they matter. They are
// the first decision of a placement night — the columns the board is made of —
// so they're now a button on the board, and picking them turns straight into
// the trays the field is dragged into.
//
// Ticking a destination also marks the session as a placement session: that's
// what "these drivers are going to the Pro Class" means, and making an admin
// find a separate checkbox to say so again is how a night ends up with
// divisions assigned and no roster built at the end of it.
export function PlacementDestinationsModal({
  trial, seriesList = [], classes = [], seasonName = "", onClose, onSaved,
}) {
  const [form, setForm] = useState({
    class_ids: trial.class_ids || [],
    series_ids: trial.series_ids || [],
    series_seasons: trial.series_seasons || {},
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const nothingPicked = !form.class_ids.length && !form.series_ids.length;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      onSaved(await api(`/api/time-trials/${trial.id}`, {
        method: "PATCH",
        body: { ...form, is_placement: true },
      }));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Where are these drivers going?" onClose={busy ? () => {} : onClose}>
      <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.9rem", lineHeight: 1.55 }}>
        Tick every division this session is sorting its field into. Each one becomes a column on the
        board, ready to have drivers dropped into it — and when you complete the session, each one
        builds the roster of the season behind it.
      </p>

      <PlacementTargetFields
        idPrefix="tt_dest"
        seriesList={seriesList}
        classes={classes}
        seasonId={trial.season_id || ""}
        seasonName={seasonName}
        seriesIds={form.series_ids}
        seriesSeasons={form.series_seasons}
        classIds={form.class_ids}
        onChange={patch => setForm(f => ({ ...f, ...patch }))}
      />

      {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>⚠ {error}</p>}
      <button className="btn btn-primary" type="button" disabled={busy || nothingPicked} onClick={save}>
        {busy ? "Saving…" : "Use these divisions"}
      </button>
      <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} disabled={busy} onClick={onClose}>
        Cancel
      </button>
    </Modal>
  );
}
