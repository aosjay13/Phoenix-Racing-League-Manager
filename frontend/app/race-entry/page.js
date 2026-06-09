"use client";

import { useState, useEffect, useCallback } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
const CURRENT_SEASON = 2026;

function blankRow(drivers) {
  return drivers.map(d => ({
    driver_uid: d.uid,
    driver_name: d.name,
    driver_number: d.number,
    finish_pos: "",
    laps_led: "0",
    incidents: "0",
    status: "finished",
  }));
}

export default function RaceEntryPage() {
  const [races, setRaces] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [selectedRace, setSelectedRace] = useState("");
  const [rows, setRows] = useState([]);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [raceRes, driverRes] = await Promise.all([
        fetch(`${API}/api/races?season=${CURRENT_SEASON}`),
        fetch(`${API}/api/drivers?season=${CURRENT_SEASON}`),
      ]);
      const raceJson = raceRes.ok ? await raceRes.json() : [];
      const driverJson = driverRes.ok ? await driverRes.json() : [];
      const sorted = [...raceJson].sort((a, b) => a.round_number - b.round_number);
      setRaces(sorted);
      setDrivers(driverJson);
      if (driverJson.length) setRows(blankRow(driverJson));
    } catch {
      showToast("error", "Could not load data — is the API running?");
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4500);
  }

  function updateRow(idx, field, value) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  }

  function handleClear() {
    setRows(blankRow(drivers));
    setSelectedRace("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!selectedRace) { showToast("error", "Please select a race first."); return; }

    const filled = rows.filter(r => r.finish_pos !== "");
    if (!filled.length) { showToast("error", "Enter at least one finish position."); return; }

    const posSet = new Set();
    for (const r of filled) {
      const pos = Number(r.finish_pos);
      if (!pos || pos < 1) { showToast("error", `Invalid finish position for ${r.driver_name}.`); return; }
      if (posSet.has(pos)) { showToast("error", `Duplicate finish position: P${pos}.`); return; }
      posSet.add(pos);
    }

    setLoading(true);
    const errors = [];
    for (const r of filled) {
      try {
        const res = await fetch(`${API}/api/results`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            driver_uid: r.driver_uid,
            race_id: selectedRace,
            finish_pos: Number(r.finish_pos),
            laps_led: Number(r.laps_led) || 0,
            incidents: Number(r.incidents) || 0,
            status: r.status,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          errors.push(`${r.driver_name}: ${body.detail || res.status}`);
        }
      } catch {
        errors.push(`${r.driver_name}: network error`);
      }
    }
    setLoading(false);

    if (errors.length) {
      showToast("error", errors.join(" · "));
    } else {
      showToast("success", `✓ ${filled.length} result(s) submitted successfully.`);
      setRows(blankRow(drivers));
      setSelectedRace("");
    }
  }

  const noDrivers = drivers.length === 0;
  const noRaces = races.length === 0;

  return (
    <section>
      <div className="page-title">
        <h2>Race Entry</h2>
        <span className="page-badge">Season {CURRENT_SEASON}</span>
      </div>

      {noDrivers || noRaces ? (
        <div className="empty-state" style={{ textAlign: "left", padding: "32px 0" }}>
          <span className="empty-state-icon">⚠️</span>
          <p>
            {noDrivers && noRaces
              ? "Add drivers and races before entering results."
              : noDrivers
              ? "Add drivers to the roster before entering results."
              : "Add races to the schedule before entering results."}
          </p>
        </div>
      ) : (
        <form style={{ marginTop: 16 }} onSubmit={handleSubmit}>
          <div className="field" style={{ maxWidth: 400 }}>
            <label>Select Race</label>
            <select value={selectedRace} onChange={e => setSelectedRace(e.target.value)} required>
              <option value="">— Choose a race —</option>
              {races.map(r => (
                <option key={r.race_id} value={r.race_id}>
                  Round {r.round_number} — {r.track} ({r.date})
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginTop: 22, overflowX: "auto" }}>
            <div className="result-grid" style={{ minWidth: 500 }}>
              <span className="grid-header">Finish</span>
              <span className="grid-header">Driver</span>
              <span className="grid-header">Laps Led</span>
              <span className="grid-header">Inc.</span>
              <span className="grid-header">Status</span>

              {rows.map((row, idx) => (
                <div key={row.driver_uid} style={{ display: "contents" }}>
                  <input
                    type="number" min={1} max={99}
                    placeholder="—"
                    value={row.finish_pos}
                    onChange={e => updateRow(idx, "finish_pos", e.target.value)}
                    style={{ textAlign: "center" }}
                  />
                  <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.9rem", padding: "8px 0" }}>
                    <span className="badge">#{row.driver_number}</span>
                    <span style={{ color: "var(--ink-0)" }}>{row.driver_name}</span>
                  </span>
                  <input
                    type="number" min={0}
                    value={row.laps_led}
                    onChange={e => updateRow(idx, "laps_led", e.target.value)}
                    style={{ textAlign: "center" }}
                  />
                  <input
                    type="number" min={0}
                    value={row.incidents}
                    onChange={e => updateRow(idx, "incidents", e.target.value)}
                    style={{ textAlign: "center" }}
                  />
                  <select value={row.status} onChange={e => updateRow(idx, "status", e.target.value)}>
                    <option value="finished">Finished</option>
                    <option value="dnf">DNF</option>
                    <option value="dns">DNS</option>
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? "Submitting…" : "Submit Race Results"}
            </button>
            <button className="btn btn-ghost" type="button" onClick={handleClear} style={{ marginTop: 0 }}>
              Clear All
            </button>
          </div>

          {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
        </form>
      )}
    </section>
  );
}
