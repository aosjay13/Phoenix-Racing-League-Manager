"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { AddDriverToRace } from "@/components/AddDriverToRace";

function blankRows(entries) {
  return entries.map((e, i) => ({
    entry_id: e.id,
    driver_name: e.name,
    driver_number: e.number,
    finish_pos: String(i + 1), // qualifying position (P1 = pole)
    qual_time: "",
  }));
}

function rowFromEntry(entry, position) {
  return {
    entry_id: entry.id,
    driver_name: entry.name,
    driver_number: entry.number ?? null,
    finish_pos: String(position),
    qual_time: "",
  };
}

// Enter the qualifying order for an event. Position 1 is the pole. This order
// feeds the Start column of the race results and drives Poles / Average Start.
// `onEntriesChanged` is optional: fired after a driver is added mid-entry so
// the parent's own roster list stays in sync.
export function QualifyingEditor({ race, seasonId, entries, onEntriesChanged, seriesName }) {
  const [rows, setRows] = useState(() => blankRows(entries));
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [justAddedId, setJustAddedId] = useState(null);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const all = await api(`/api/results?race_id=${race.id}`);
        if (cancelled) return;
        const quali = all.filter(r => r.session_type === "qualifying");
        const byEntry = Object.fromEntries(quali.map(r => [r.entry_id, r]));
        setRows(blankRows(entries).map(row => {
          const prev = byEntry[row.entry_id];
          return prev
            ? { ...row, finish_pos: String(prev.finish_pos), qual_time: prev.qual_time || "" }
            : row;
        }));
      } catch {
        setRows(blankRows(entries));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // Deliberately not keyed on `entries` — see RaceResultsEditor for why.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [race?.id]);

  function updateRow(idx, field, value) {
    setRows(prev => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }

  function handleDriverAdded(entry) {
    setRows(prev => [...prev, rowFromEntry(entry, prev.length + 1)]);
    setJustAddedId(entry.id);
    onEntriesChanged?.();
  }

  async function handleSave() {
    const filled = rows.filter(r => r.finish_pos !== "");
    if (!filled.length) return showToast("error", "Enter at least one qualifying position.");
    const positions = filled.map(r => Number(r.finish_pos));
    if (new Set(positions).size !== positions.length) {
      return showToast("error", "Two drivers share the same qualifying position.");
    }
    setBusy(true);
    try {
      await api("/api/results", {
        method: "POST",
        body: {
          race_id: race.id,
          season_id: seasonId,
          session: "Qualifying",
          session_type: "qualifying",
          rows: filled.map(r => ({ entry_id: r.entry_id, finish_pos: r.finish_pos, qual_time: r.qual_time })),
        },
      });
      showToast("success", "Qualifying saved. It feeds the race Start column, Poles, and Average Start.");
    } catch (err) {
      showToast("error", err.message);
    } finally {
      setBusy(false);
    }
  }

  const existingNames = new Set(rows.map(r => r.driver_name.trim().toLowerCase()));

  if (!rows.length) {
    return (
      <div>
        <p style={{ color: "var(--ink-1)", fontSize: "0.9rem" }}>No drivers on the roster yet.</p>
        <AddDriverToRace seasonId={seasonId} seriesName={seriesName} existingNames={existingNames} onCreated={handleDriverAdded} onError={msg => showToast("error", msg)} />
        {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
      </div>
    );
  }

  return (
    <div>
      <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.85rem" }}>
        Position 1 is the pole. This order auto-fills the <strong>Start</strong> column on the Race Results tab
        and drives each driver&apos;s Poles and Average Start in the stats.
      </p>

      {loading ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <div className="qual-grid">
            <span className="grid-header">Pos</span>
            <span className="grid-header">Driver</span>
            <span className="grid-header">Qual Time</span>
            {rows.map((row, idx) => (
              <QualRow key={row.entry_id} row={row} idx={idx} updateRow={updateRow} autoFocus={row.entry_id === justAddedId} />
            ))}
          </div>
        </div>
      )}

      <AddDriverToRace seasonId={seasonId} seriesName={seriesName} existingNames={existingNames} onCreated={handleDriverAdded} onError={msg => showToast("error", msg)} />

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      <button className="btn btn-primary" onClick={handleSave} disabled={busy || loading}>
        {busy ? "Saving…" : "Save Qualifying"}
      </button>
      <button className="btn btn-ghost" style={{ marginLeft: 8 }}
        onClick={() => setRows(prev => prev.map((r, i) => rowFromEntry({ id: r.entry_id, name: r.driver_name, number: r.driver_number }, i + 1)))}>
        Reset
      </button>
    </div>
  );
}

function QualRow({ row, idx, updateRow, autoFocus = false }) {
  return (
    <>
      <input type="number" min="1" value={row.finish_pos} onChange={e => updateRow(idx, "finish_pos", e.target.value)} autoFocus={autoFocus} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.92rem", whiteSpace: "nowrap" }}>
        {row.driver_number != null && <span className="badge">#{row.driver_number}</span>}
        {row.driver_name}
      </div>
      <input placeholder="01:43.863" value={row.qual_time} onChange={e => updateRow(idx, "qual_time", e.target.value)} />
    </>
  );
}
