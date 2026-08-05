"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { SeasonForm } from "@/components/SeasonForm";
import { BLANK_SEASON_FORM, seasonFormToBody } from "@/lib/seasonForm";

// Sentinel for the "start a brand new series" choice in the series picker.
const NEW_SERIES = "__new__";

// Quick "start a new season" dialog, opened from the Schedule page while no
// single season is selected — the moment an admin is most likely to want one.
//
// It offers exactly the fields League Setup's Seasons panel does, because it
// renders the same <SeasonForm>; the only things this adds are the series it
// belongs to and switching into the new season once it exists. Classes and
// races are still built on League Setup / the calendar afterwards.
//
// A season has to hang off a series, so when the page's scope doesn't name one
// — "All Series", or a game whose series list is still empty — the dialog asks
// for it: pick an existing series, or name a new one and it's created first.
// That's what makes this dialog enough to get a brand new game racing without a
// detour through League Setup.
export function SeasonCreateModal({ gameId, seriesId, seriesName, seriesList = [], onClose, onCreated }) {
  const [form, setForm] = useState(BLANK_SEASON_FORM);
  const [templates, setTemplates] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Only used when the scope didn't name a series.
  const [pickedSeries, setPickedSeries] = useState(seriesList[0]?.id ?? NEW_SERIES);
  const [newSeriesName, setNewSeriesName] = useState("");

  const needsSeries = !seriesId;
  const creatingSeries = needsSeries && pickedSeries === NEW_SERIES;
  const seriesReady = !needsSeries || (creatingSeries ? !!newSeriesName.trim() : !!pickedSeries);

  const loadTemplates = useCallback(() => {
    api("/api/points-templates").then(setTemplates).catch(() => setTemplates([]));
  }, []);
  useEffect(loadTemplates, [loadTemplates]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim() || !seriesReady) return;
    setBusy(true);
    setError(null);
    try {
      // The series comes first when there isn't one yet — the season is created
      // inside whatever series this resolves to.
      const targetSeriesId = creatingSeries
        ? (await api("/api/series", { method: "POST", body: { name: newSeriesName.trim(), game_id: gameId } })).id
        : (seriesId || pickedSeries);
      const season = await api("/api/seasons", {
        method: "POST",
        body: { ...seasonFormToBody(form), name: form.name.trim(), series_id: targetSeriesId, game_id: gameId },
      });
      onCreated(season, targetSeriesId);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="New Season" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <p style={{ marginTop: 0, color: "var(--ink-2)", fontSize: "0.82rem" }}>
          {needsSeries
            ? "A season runs inside a series — pick the one it belongs to, or name a new series and it'll be created too. "
            : <>In <strong>{seriesName || "this series"}</strong>. </>}
          You&rsquo;ll be switched into the new season so you can start adding races right away — add
          its classes on League Setup.
        </p>
        {needsSeries && (
          <>
            <div className="field">
              <label>Series</label>
              <select value={pickedSeries} onChange={e => setPickedSeries(e.target.value)}>
                {seriesList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                <option value={NEW_SERIES}>+ New series…</option>
              </select>
            </div>
            {creatingSeries && (
              <div className="field">
                <label>New Series Name</label>
                <input required value={newSeriesName} onChange={e => setNewSeriesName(e.target.value)}
                  placeholder="Asphalt Assault Series" />
              </div>
            )}
          </>
        )}
        <SeasonForm
          value={form} onChange={setForm}
          templates={templates} onTemplatesChanged={loadTemplates}
          onError={setError}
        />
        {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy || !form.name.trim() || !seriesReady}>
          {busy ? "Creating…" : "Create Season"}
        </button>
        <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={onClose} disabled={busy}>Cancel</button>
      </form>
    </Modal>
  );
}
