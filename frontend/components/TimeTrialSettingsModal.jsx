"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { TrackSelect } from "@/components/TrackSelect";
import { LAPS_UNLIMITED, MAX_LAPS_CAP } from "@/lib/timeTrials";

// Editing a session after it was created — the other half of "create, view and
// manage" a trial from the hub.
//
// The field that matters most here is the SEASON. A placement night is usually
// run before the season it feeds exists, so attaching it afterwards is the
// normal path, not an edge case: it is what gives the sheet its divisions to
// place into and its roster to build.
export function TimeTrialSettingsModal({ trial, seasons = [], onClose, onSaved }) {
  const [form, setForm] = useState({
    name: trial.name || "",
    date: trial.date || "",
    track: trial.track || "",
    track_id: trial.track_id || "",
    car: trial.car || "",
    notes: trial.notes || "",
    max_laps: trial.max_laps ? String(trial.max_laps) : "",
    average_laps: trial.average_laps ? String(trial.average_laps) : "",
    is_placement: !!trial.is_placement,
    sort_key: trial.sort_key === "average" ? "average" : "best",
    season_id: trial.season_id || "",
    class_ids: trial.class_ids || [],
  });
  const [tracks, setTracks] = useState([]);
  const [classes, setClasses] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { api("/api/tracks").then(setTracks).catch(() => setTracks([])); }, []);

  // The divisions on offer follow the season being attached, so switching
  // season here immediately shows that season's classes rather than the ones
  // the trial was created against.
  useEffect(() => {
    if (!form.season_id) { setClasses([]); return; }
    let live = true;
    api(`/api/classes?season_id=${form.season_id}`)
      .then(list => { if (live) setClasses(list); })
      .catch(() => { if (live) setClasses([]); });
    return () => { live = false; };
  }, [form.season_id]);

  const set = field => e => setForm(f => ({ ...f, [field]: e.target.value }));

  function toggleClass(id) {
    setForm(f => ({
      ...f,
      class_ids: f.class_ids.includes(id) ? f.class_ids.filter(c => c !== id) : [...f.class_ids, id],
    }));
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const season = seasons.find(s => s.id === form.season_id) || null;
      const updated = await api(`/api/time-trials/${trial.id}`, {
        method: "PATCH",
        body: {
          ...form,
          max_laps: form.max_laps === "" ? LAPS_UNLIMITED : Number(form.max_laps),
          average_laps: form.average_laps === "" ? 0 : Number(form.average_laps),
          // A season pins the game and series the trial belongs to, which is
          // what scopes its laps in the record books.
          ...(season ? { game_id: season.game_id || "", series_id: season.series_id || "" } : {}),
          // Divisions only exist against a season; detaching one drops them.
          class_ids: form.season_id ? form.class_ids.filter(id => classes.some(c => c.id === id)) : [],
        },
      });
      onSaved(updated);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Session settings" onClose={busy ? () => {} : onClose}>
      <form onSubmit={submit}>
        <div className="field"><label>Session Name</label>
          <input required value={form.name} onChange={set("name")} /></div>

        <div className="field"><label>Track</label>
          <TrackSelect tracks={tracks} valueId={form.track_id} valueName={form.track}
            onChange={({ id, name }) => setForm(f => ({ ...f, track: name, track_id: id || "" }))}
            onTrackCreated={track => setTracks(ts => [...ts, track])}
            placeholder="Search tracks…" /></div>

        <div className="field"><label>Date</label>
          <input type="date" value={form.date} onChange={set("date")} /></div>

        <div className="field"><label>Car</label>
          <input value={form.car} onChange={set("car")} placeholder="GT3, Late Model, …" /></div>

        <div className="field"><label>Season</label>
          <select value={form.season_id} onChange={e => setForm(f => ({ ...f, season_id: e.target.value, class_ids: [] }))}>
            <option value="">Not attached to a season</option>
            {seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
            Attaching a season is what gives this sheet its divisions to place into and its roster to
            build. A placement night run before the season existed is attached here.
          </span></div>

        <div className="field"><label>Maximum Laps</label>
          <input type="number" min="0" max={MAX_LAPS_CAP} value={form.max_laps} onChange={set("max_laps")}
            placeholder="Leave blank for unlimited" />
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
            Lowering this on a sheet that already has laps trims each driver to their first{" "}
            {form.max_laps || "N"} laps the next time it is saved.
          </span></div>

        <div className="field"><label>Best Average Time counts…</label>
          <input type="number" min="0" max={MAX_LAPS_CAP} value={form.average_laps} onChange={set("average_laps")}
            placeholder="Every lap submitted" /></div>

        <div className="field"><label>Order the sheet by</label>
          <select value={form.sort_key} onChange={set("sort_key")}>
            <option value="best">Best Time (single fastest lap)</option>
            <option value="average">Best Average Time</option>
          </select></div>

        <div className="field check-row">
          <input type="checkbox" id="tt_settings_placement" checked={form.is_placement}
            onChange={e => setForm(f => ({ ...f, is_placement: e.target.checked }))} />
          <label htmlFor="tt_settings_placement" style={{ margin: 0 }}>Placement Session</label>
        </div>

        {form.is_placement && form.season_id && (
          classes.length > 0 ? (
            <div className="field">
              <span className="field-label">Divisions to place into</span>
              <div className="option-rows">
                {classes.map(c => (
                  <label key={c.id} className="check-row" style={{ margin: 0 }}>
                    <input type="checkbox" checked={form.class_ids.includes(c.id)} onChange={() => toggleClass(c.id)} />
                    <span>{c.car ? `${c.name} · ${c.car}` : c.name}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <p style={{ fontSize: "0.8rem", color: "var(--accent-gold)" }}>
              That season has no classes yet — add them in League Setup and they&rsquo;ll appear here.
            </p>
          )
        )}

        <div className="field"><label>Notes</label>
          <textarea rows={2} value={form.notes} onChange={set("notes")} /></div>

        {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>⚠ {error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save Settings"}</button>
        <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={onClose} disabled={busy}>Cancel</button>
      </form>
    </Modal>
  );
}
