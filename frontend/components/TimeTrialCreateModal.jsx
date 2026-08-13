"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { TrackSelect } from "@/components/TrackSelect";
import { PlacementTargetFields } from "@/components/PlacementTargetFields";
import { LAPS_UNLIMITED, MAX_LAPS_CAP } from "@/lib/timeTrials";

const blank = {
  name: "", date: "", track: "", track_id: "", car: "", notes: "",
  // 0 / blank = infinite laps, which is what an open hot-lapping window is.
  max_laps: "",
  // 0 = average every lap submitted; N = the best N-consecutive-lap average.
  average_laps: "",
  is_placement: false,
  // What a placement night sorts into: classes of this session's own season,
  // and/or separate series (each naming the season whose roster it builds).
  class_ids: [],
  series_ids: [],
  series_seasons: {},
  sort_key: "best",
};

// New standalone Time Trial session.
//
// Everything except the name is optional, deliberately. A placement night
// usually happens BEFORE the season it feeds exists, so the session can be
// created with nothing but a name and a track and attached to a season later —
// which is the point at which it can build that season's roster.
export function TimeTrialCreateModal({
  gameId = "", seriesId = "", seasonId = "", classes = [], seriesList = [], onClose, onCreated,
}) {
  const [form, setForm] = useState({ ...blank, class_ids: classes.map(c => c.id) });
  const [tracks, setTracks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { api("/api/tracks").then(setTracks).catch(() => setTracks([])); }, []);

  const set = field => e => setForm(f => ({ ...f, [field]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const trial = await api("/api/time-trials", {
        method: "POST",
        body: {
          ...form,
          max_laps: form.max_laps === "" ? LAPS_UNLIMITED : Number(form.max_laps),
          average_laps: form.average_laps === "" ? 0 : Number(form.average_laps),
          game_id: gameId,
          series_id: seriesId,
          season_id: seasonId,
          // Classes only mean something against a season; a trial floating free
          // of one carries none until it's attached. Series placement needs no
          // season of its own — each series names the one it builds.
          class_ids: seasonId ? form.class_ids : [],
        },
      });
      onCreated(trial);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="New Time Trial" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field"><label>Session Name</label>
          <input required autoFocus value={form.name} onChange={set("name")}
            placeholder="Pre-Season Placement Night" /></div>

        <div className="field"><label>Track</label>
          <TrackSelect tracks={tracks} valueId={form.track_id} valueName={form.track}
            onChange={({ id, name }) => setForm(f => ({ ...f, track: name, track_id: id || "" }))}
            onTrackCreated={track => setTracks(ts => [...ts, track])}
            placeholder="Search tracks…" />
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
            Pick from the Tracks database so the laps set here are eligible for that venue&rsquo;s
            <strong> track records</strong>.
          </span></div>

        <div className="field"><label>Date</label>
          <input type="date" value={form.date} onChange={set("date")} /></div>

        <div className="field"><label>Car</label>
          <input value={form.car} onChange={set("car")} placeholder="GT3, Late Model, …" /></div>

        <div className="field"><label>Maximum Laps</label>
          <input type="number" min="0" max={MAX_LAPS_CAP} value={form.max_laps} onChange={set("max_laps")}
            placeholder="Leave blank for unlimited" />
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
            How many laps each driver may submit. Leave it blank (or 0) for an <strong>unlimited</strong>{" "}
            hot-lapping window — drivers keep adding laps until you close the session.
          </span></div>

        <div className="field"><label>Best Average Time counts…</label>
          <input type="number" min="0" max={MAX_LAPS_CAP} value={form.average_laps} onChange={set("average_laps")}
            placeholder="Every lap submitted" />
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
            Blank (or 0) averages <strong>every lap</strong> a driver submits — the consistency
            measure. Enter a number for the classic best <strong>N-consecutive-lap</strong> average
            (e.g. 3 for a best 3-lap average).
          </span></div>

        <div className="field"><label>Order the sheet by</label>
          <select value={form.sort_key} onChange={set("sort_key")}>
            <option value="best">Best Time (single fastest lap)</option>
            <option value="average">Best Average Time</option>
          </select>
          <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
            Which column places drivers when you sort the field or auto-assign divisions. Either
            column is still one click away on the sheet itself.
          </span></div>

        <div className="field check-row">
          <input type="checkbox" id="tt_is_placement" checked={form.is_placement}
            onChange={e => setForm(f => ({ ...f, is_placement: e.target.checked }))} />
          <label htmlFor="tt_is_placement" style={{ margin: 0 }}>
            Placement Session
            <span style={{ display: "block", fontWeight: 400, fontSize: "0.78rem", color: "var(--ink-2)" }}>
              This session sorts drivers into divisions — <strong>classes</strong> inside one season,
              or <strong>separate series</strong>, whichever your league runs. The sheet grows a
              column for each kind you pick, fillable by hand or straight from the times, and{" "}
              <strong>Complete Session</strong> then pushes the field onto the official roster of
              every season it places into.
            </span>
          </label>
        </div>

        {form.is_placement && (
          <PlacementTargetFields
            idPrefix="tt_new"
            seriesList={seriesList}
            classes={classes}
            seasonId={seasonId}
            seriesIds={form.series_ids}
            seriesSeasons={form.series_seasons}
            classIds={form.class_ids}
            onChange={patch => setForm(f => ({ ...f, ...patch }))}
          />
        )}

        <div className="field"><label>Notes</label>
          <textarea rows={2} value={form.notes} onChange={set("notes")}
            placeholder="Track conditions, tyre rules, anything the sheet should remember." /></div>

        {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Creating…" : "Create Session"}</button>
        <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={onClose} disabled={busy}>Cancel</button>
      </form>
    </Modal>
  );
}
