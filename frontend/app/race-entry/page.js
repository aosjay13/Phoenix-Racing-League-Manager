"use client";

import { useEffect, useState, useCallback } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { AdminGate } from "@/components/AdminGate";
import { api } from "@/lib/api";

const RESULT_FIELDS = ["finish_pos", "start_pos", "qual_time", "laps", "laps_led", "incidents", "fastest_lap", "halfway_leader", "hard_charger", "provisional", "status"];

function blankRows(entries) {
  return entries.map((e, i) => ({
    entry_id: e.id,
    driver_name: e.name,
    driver_number: e.number,
    finish_pos: String(i + 1),
    start_pos: "",
    qual_time: "",
    laps: "",
    laps_led: "0",
    incidents: "0",
    fastest_lap: false,
    halfway_leader: false,
    hard_charger: false,
    provisional: false,
    status: "finished",
  }));
}

function RaceEntryInner() {
  const { seasonId, season } = useLeague();
  const [races, setRaces] = useState([]);
  const [entries, setEntries] = useState([]);
  const [raceId, setRaceId] = useState("");
  const [session, setSession] = useState("");
  const [rows, setRows] = useState([]);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!seasonId) return;
    const [r, e] = await Promise.all([
      api(`/api/races?season_id=${seasonId}`),
      api(`/api/entries?season_id=${seasonId}`),
    ]);
    setRaces(r);
    setEntries(e);
    setRows(blankRows(e));
    setRaceId("");
  }, [seasonId]);

  useEffect(() => { load().catch(() => showToast("error", "Could not load season data.")); }, [load]);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }

  function sessionsFor(id) {
    const race = races.find(r => r.id === id);
    return Array.isArray(race?.sessions) && race.sessions.length ? race.sessions : ["Race"];
  }

  // Pre-fill with any existing results so admins can edit past races.
  async function selectRace(id, sessionName) {
    setRaceId(id);
    if (!id) { setSession(""); return; }
    const sess = sessionName ?? sessionsFor(id)[0];
    setSession(sess);
    try {
      const all = await api(`/api/results?race_id=${id}`);
      const first = sessionsFor(id)[0];
      const existing = all.filter(r => (r.session || first) === sess);
      if (existing.length) {
        const byEntry = Object.fromEntries(existing.map(r => [r.entry_id, r]));
        setRows(blankRows(entries).map(row => {
          const prev = byEntry[row.entry_id];
          if (!prev) return row;
          const merged = { ...row };
          for (const f of RESULT_FIELDS) {
            if (prev[f] == null) continue;
            merged[f] = typeof row[f] === "boolean" ? !!prev[f] : String(prev[f]);
          }
          return merged;
        }));
        showToast("success", "Loaded existing results — saving will overwrite them.");
      } else {
        setRows(blankRows(entries));
      }
    } catch {}
  }

  function updateRow(idx, field, value) {
    setRows(prev => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }

  async function handleSave() {
    const filled = rows.filter(r => r.finish_pos !== "");
    if (!raceId) return showToast("error", "Pick a race first.");
    if (!filled.length) return showToast("error", "Enter at least one finishing position.");
    const positions = filled.map(r => Number(r.finish_pos));
    if (new Set(positions).size !== positions.length) {
      return showToast("error", "Two drivers share the same finishing position.");
    }
    setBusy(true);
    try {
      await api("/api/results", { method: "POST", body: { race_id: raceId, season_id: seasonId, session, rows: filled } });
      showToast("success", "Race results saved. Standings and profiles update instantly.");
    } catch (err) {
      showToast("error", err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!seasonId) {
    return <div className="empty-state"><span className="empty-state-icon">⏱</span><p>Select a game, series and season above.</p></div>;
  }

  return (
    <section>
      <div className="page-title">
        <h2>Race Entry · {season?.name ?? ""}</h2>
        <span className="page-badge">{entries.length} Drivers</span>
      </div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.85rem" }}>
        Start = qualifying position (P1 counts as pole). FL = fastest lap, ½ = halfway-point leader,
        HC = hard charger, Prov = provisional start. Bonus points are applied automatically from the season settings.
      </p>

      <div className="form-card" style={{ maxWidth: "100%" }}>
        <div className="field">
          <label>Event</label>
          <select value={raceId} onChange={e => selectRace(e.target.value)}>
            <option value="">Select an event…</option>
            {races.map(r => <option key={r.id} value={r.id}>R{r.round_number} · {r.name}{r.track ? ` — ${r.track}` : ""}</option>)}
          </select>
        </div>

        {raceId && sessionsFor(raceId).length > 1 && (
          <div className="field">
            <label>Race (this event has {sessionsFor(raceId).length})</label>
            <select value={session} onChange={e => selectRace(raceId, e.target.value)}>
              {sessionsFor(raceId).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}

        {entries.length === 0 ? (
          <p style={{ color: "var(--ink-1)", fontSize: "0.9rem" }}>No drivers on the roster yet — add them in Roster &amp; Teams.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <div className="result-grid result-grid-wide">
              {["Fin", "Driver", "Start", "Qual Time", "Laps", "Led", "Inc", "FL", "½", "HC", "Prov", "Status"].map(h => (
                <span className="grid-header" key={h}>{h}</span>
              ))}
              {rows.map((row, idx) => (
                <RowInputs key={row.entry_id} row={row} idx={idx} updateRow={updateRow} />
              ))}
            </div>
          </div>
        )}

        {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

        <button className="btn btn-primary" onClick={handleSave} disabled={busy || !raceId}>
          {busy ? "Saving…" : "Save Race Results"}
        </button>
        <button className="btn btn-ghost" style={{ marginLeft: 8 }} onClick={() => setRows(blankRows(entries))}>
          Reset Grid
        </button>
      </div>
    </section>
  );
}

function Check({ value, onChange, title }) {
  return (
    <input type="checkbox" title={title} checked={value} onChange={e => onChange(e.target.checked)}
      style={{ width: 18, height: 18, accentColor: "var(--accent-cyan)", margin: "auto" }} />
  );
}

function RowInputs({ row, idx, updateRow }) {
  const num = (field, min = 0) => (
    <input type="number" min={min} value={row[field]} onChange={e => updateRow(idx, field, e.target.value)} />
  );
  return (
    <>
      {num("finish_pos", 1)}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.92rem", whiteSpace: "nowrap" }}>
        {row.driver_number != null && <span className="badge">#{row.driver_number}</span>}
        {row.driver_name}
      </div>
      {num("start_pos", 1)}
      <input placeholder="01:43.863" value={row.qual_time} onChange={e => updateRow(idx, "qual_time", e.target.value)} />
      {num("laps")}
      {num("laps_led")}
      {num("incidents")}
      <Check title="Fastest lap" value={row.fastest_lap} onChange={v => updateRow(idx, "fastest_lap", v)} />
      <Check title="Halfway-point leader" value={row.halfway_leader} onChange={v => updateRow(idx, "halfway_leader", v)} />
      <Check title="Hard charger" value={row.hard_charger} onChange={v => updateRow(idx, "hard_charger", v)} />
      <Check title="Provisional" value={row.provisional} onChange={v => updateRow(idx, "provisional", v)} />
      <select value={row.status} onChange={e => updateRow(idx, "status", e.target.value)}>
        <option value="finished">Running</option>
        <option value="dnf">DNF</option>
        <option value="dns">DNS</option>
        <option value="dq">DQ</option>
      </select>
    </>
  );
}

export default function RaceEntryPage() {
  return <AdminGate><RaceEntryInner /></AdminGate>;
}
