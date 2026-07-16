"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { AdminGate } from "@/components/AdminGate";
import { RaceResultsEditor } from "@/components/RaceResultsEditor";
import { api } from "@/lib/api";

function RaceEntryInner() {
  const { seasonId, season } = useLeague();
  const [races, setRaces] = useState([]);
  const [entries, setEntries] = useState([]);
  const [raceId, setRaceId] = useState("");

  const load = useCallback(async () => {
    if (!seasonId) { setRaces([]); setEntries([]); setRaceId(""); return; }
    const [r, e] = await Promise.all([
      api(`/api/races?season_id=${seasonId}`),
      api(`/api/entries?season_id=${seasonId}`),
    ]);
    setRaces(r);
    setEntries(e);
    setRaceId("");
  }, [seasonId]);

  // Refreshes just the driver list, without resetting the selected race —
  // used after a driver is added inline from within the results editor.
  const reloadEntries = useCallback(async () => {
    if (!seasonId) return;
    setEntries(await api(`/api/entries?season_id=${seasonId}`));
  }, [seasonId]);

  useEffect(() => { load().catch(() => {}); }, [load]);

  if (!seasonId) {
    return <div className="empty-state"><span className="empty-state-icon">⏱</span><p>Select a game, series and season above.</p></div>;
  }

  const selectedRace = races.find(r => r.id === raceId);

  return (
    <section>
      <div className="page-title">
        <h2>Race Entry · {season?.name ?? ""}</h2>
        <span className="page-badge">{entries.length} Drivers</span>
      </div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.85rem" }}>
        Pick an event to enter or edit its results. To also rename a race or change its date, use the
        pencil on the <Link href="/schedule" style={{ color: "var(--accent-cyan)" }}>Schedule</Link>.
      </p>

      <div className="form-card" style={{ maxWidth: "100%" }}>
        <div className="field" style={{ maxWidth: 480 }}>
          <label>Event</label>
          <select value={raceId} onChange={e => setRaceId(e.target.value)}>
            <option value="">Select an event…</option>
            {races.map(r => <option key={r.id} value={r.id}>R{r.round_number} · {r.name}{r.track ? ` — ${r.track}` : ""}</option>)}
          </select>
        </div>

        {selectedRace && (
          <RaceResultsEditor key={selectedRace.id} race={selectedRace} seasonId={seasonId} entries={entries} onEntriesChanged={reloadEntries} />
        )}
      </div>
    </section>
  );
}

export default function RaceEntryPage() {
  return <AdminGate><RaceEntryInner /></AdminGate>;
}
