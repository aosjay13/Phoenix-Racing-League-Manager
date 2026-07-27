"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { SeasonForm } from "@/components/SeasonForm";
import { BLANK_SEASON_FORM, seasonFormToBody } from "@/lib/seasonForm";

// Quick "start a new season" dialog, opened from the Schedule page while a
// series is selected but no single season is — the moment an admin is most
// likely to want one.
//
// It offers exactly the fields League Setup's Seasons panel does, because it
// renders the same <SeasonForm>; the only things this adds are the series it
// belongs to (taken from the page's scope) and switching into the new season
// once it exists. Classes and races are still built on League Setup / the
// calendar afterwards.
export function SeasonCreateModal({ gameId, seriesId, seriesName, onClose, onCreated }) {
  const [form, setForm] = useState(BLANK_SEASON_FORM);
  const [templates, setTemplates] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const loadTemplates = useCallback(() => {
    api("/api/points-templates").then(setTemplates).catch(() => setTemplates([]));
  }, []);
  useEffect(loadTemplates, [loadTemplates]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const season = await api("/api/seasons", {
        method: "POST",
        body: { ...seasonFormToBody(form), name: form.name.trim(), series_id: seriesId, game_id: gameId },
      });
      onCreated(season);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="New Season" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <p style={{ marginTop: 0, color: "var(--ink-2)", fontSize: "0.82rem" }}>
          In <strong>{seriesName || "this series"}</strong>. You&rsquo;ll be switched into the new
          season so you can start adding races right away — add its classes on League Setup.
        </p>
        <SeasonForm
          value={form} onChange={setForm}
          templates={templates} onTemplatesChanged={loadTemplates}
          onError={setError}
        />
        {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy || !form.name.trim()}>
          {busy ? "Creating…" : "Create Season"}
        </button>
        <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={onClose} disabled={busy}>Cancel</button>
      </form>
    </Modal>
  );
}
