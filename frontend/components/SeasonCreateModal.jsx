"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { BUILTIN_TEMPLATES, listToTableOrZero, tableToList } from "@/lib/pointsTemplates";

// Quick "start a new season" dialog, opened from the Schedule page while a
// series is selected but no single season is — the moment an admin is most
// likely to want one. It captures the handful of fields a season needs to be
// usable straight away; everything else (classes, drop weeks, bonuses, the full
// points editor) stays on League Setup, which this links to.
//
// Points: a season with no `race_points` of its own scores on the app's default
// scale, so "Standard" here means exactly that — no points written. Picking a
// template writes its tables onto the season, the same shape League Setup saves.
const STANDARD = "__standard";

export function SeasonCreateModal({ gameId, seriesId, seriesName, onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", car: "", template: STANDARD });
  const [saved, setSaved] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Saved templates sit alongside the built-ins, same as the League Setup picker.
  useEffect(() => { api("/api/points-templates").then(setSaved).catch(() => setSaved([])); }, []);

  // Mirrors League Setup's save exactly: a template's blank scale is written as
  // an explicit zero table, never left unset — unset is what falls through to
  // the app's default scale, which is only what "Standard" is supposed to mean.
  // (A template like NASCAR carries no qualifying points on purpose.)
  function pointsFor(id) {
    if (id === STANDARD) return {};
    const builtin = BUILTIN_TEMPLATES.find(t => t.id === id);
    if (builtin) {
      return {
        race_points: listToTableOrZero(builtin.race),
        qual_points: listToTableOrZero(builtin.qual),
        bonus_points: builtin.bonuses,
      };
    }
    const t = saved.find(x => x.id === id);
    if (!t) return {};
    return {
      race_points: listToTableOrZero(tableToList(t.race_points)),
      qual_points: listToTableOrZero(tableToList(t.qual_points)),
      bonus_points: t.bonus_points || {},
    };
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const season = await api("/api/seasons", {
        method: "POST",
        body: {
          name: form.name.trim(),
          car: form.car.trim(),
          series_id: seriesId,
          game_id: gameId,
          ...pointsFor(form.template),
        },
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
          season so you can start adding races right away.
        </p>
        <div className="field"><label>Season Name</label>
          <input required autoFocus value={form.name} placeholder="Season 4"
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
        <div className="field"><label>Car Type</label>
          <input value={form.car} placeholder="e.g. NASCAR Next Gen, GT3"
            onChange={e => setForm(f => ({ ...f, car: e.target.value }))} />
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
            Optional. Each race defaults to this — a class or a single race can override it.
          </span></div>
        <div className="field"><label>Points System</label>
          <select value={form.template} onChange={e => setForm(f => ({ ...f, template: e.target.value }))}>
            <option value={STANDARD}>Standard scale (350, 320, 300…)</option>
            <optgroup label="Templates">
              {BUILTIN_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </optgroup>
            {saved.length > 0 && (
              <optgroup label="My Templates">
                {saved.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </optgroup>
            )}
          </select>
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
            Fine-tune the scale, bonuses, drop weeks and classes any time on League Setup.
          </span></div>
        {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy || !form.name.trim()}>
          {busy ? "Creating…" : "Create Season"}
        </button>
        <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={onClose} disabled={busy}>Cancel</button>
      </form>
    </Modal>
  );
}
