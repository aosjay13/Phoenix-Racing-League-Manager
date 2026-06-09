"use client";

import { useState, useEffect, useCallback } from "react";

const API = "";
const CURRENT_SEASON = 2026;

const BLANK = { track: "", date: "", round_number: "" };

function raceStatus(dateStr) {
  if (!dateStr) return "upcoming";
  return new Date(dateStr) < new Date() ? "completed" : "upcoming";
}

export default function SchedulePage() {
  const [races, setRaces] = useState([]);
  const [form, setForm] = useState(BLANK);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const fetchRaces = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/races?season=${CURRENT_SEASON}`);
      if (res.ok) {
        const data = await res.json();
        setRaces([...data].sort((a, b) => a.round_number - b.round_number));
      }
    } catch {
      showToast("error", "Could not load races — is the API running?");
    }
  }, []);

  useEffect(() => { fetchRaces(); }, [fetchRaces]);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/races`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          track: form.track,
          date: form.date,
          season: CURRENT_SEASON,
          round_number: Number(form.round_number),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      showToast("success", "Race added to schedule.");
      setForm(BLANK);
      setShowForm(false);
      fetchRaces();
    } catch (err) {
      showToast("error", err.message || "Failed to add race.");
    } finally {
      setLoading(false);
    }
  }

  const completed = races.filter(r => raceStatus(r.date) === "completed").length;

  return (
    <section>
      <div className="page-title">
        <h2>Schedule &amp; Calendar</h2>
        <span className="page-badge">Season {CURRENT_SEASON}</span>
      </div>

      <div className="metrics" style={{ marginTop: 16, gridTemplateColumns: "repeat(3, minmax(100px, 1fr))", maxWidth: 420 }}>
        <article className="metric-card">
          <span className="metric-icon">🗓️</span>
          <div className="metric-num">{races.length}</div>
          <div className="metric-label">Total Races</div>
        </article>
        <article className="metric-card">
          <span className="metric-icon">✅</span>
          <div className="metric-num">{completed}</div>
          <div className="metric-label">Completed</div>
        </article>
        <article className="metric-card">
          <span className="metric-icon">⏩</span>
          <div className="metric-num">{races.length - completed}</div>
          <div className="metric-label">Remaining</div>
        </article>
      </div>

      {/* Toast is always rendered at this level — not inside the conditional form */}
      {toast && <div className={`toast toast-${toast.type}`} style={{ maxWidth: 560 }}>{toast.msg}</div>}

      <div style={{ marginTop: 20 }}>
        <button
          className="btn btn-primary"
          style={{ marginTop: 0 }}
          onClick={() => setShowForm(v => !v)}
        >
          {showForm ? "✕ Hide Form" : "+ Add Race"}
        </button>
      </div>

      {showForm && (
        <form className="form-card" style={{ marginTop: 16 }} onSubmit={handleSubmit}>
          <h3>🏁 New Race Event</h3>
          <div className="field">
            <label>Track Name</label>
            <input required value={form.track} onChange={e => setForm(f => ({ ...f, track: e.target.value }))} placeholder="e.g. Talladega Superspeedway" />
          </div>
          <div className="field">
            <label>Race Date</label>
            <input required type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          </div>
          <div className="field">
            <label>Round Number</label>
            <input required type="number" min={1} value={form.round_number} onChange={e => setForm(f => ({ ...f, round_number: e.target.value }))} placeholder="e.g. 1" />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? "Saving…" : "Add Race"}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div style={{ marginTop: 24 }}>
        {races.length === 0 ? (
          <div className="empty-state" style={{ textAlign: "left", padding: "32px 0" }}>
            <span className="empty-state-icon">🗓️</span>
            <p>No races scheduled yet for Season {CURRENT_SEASON}.</p>
            <button className="btn btn-primary" style={{ marginTop: 0 }} onClick={() => setShowForm(true)}>
              + Add the first race
            </button>
          </div>
        ) : (
          races.map((r, i) => {
            const status = raceStatus(r.date);
            return (
              <div className="race-card" key={r.race_id} style={{ animationDelay: `${i * 50}ms` }}>
                <div className="round-num">{r.round_number}</div>
                <div>
                  <div className="race-card-track">{r.track}</div>
                  <div className="race-card-date">{r.date}</div>
                </div>
                <span className={`race-status status-${status}`}>
                  {status === "completed" ? "✓ Completed" : "Upcoming"}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
