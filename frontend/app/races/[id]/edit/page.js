"use client";

import Link from "next/link";
import { Suspense, useEffect, useState, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { AdminGate } from "@/components/AdminGate";
import { ImageUpload } from "@/components/ImageUpload";
import { RaceResultsEditor } from "@/components/RaceResultsEditor";
import { QualifyingEditor } from "@/components/QualifyingEditor";
import { api } from "@/lib/api";

const BLANK_INFO = { name: "", track: "", date: "", round_number: "", track_logo_url: "", sessions: "Race" };

function RaceInfoTab({ race, onSaved }) {
  const router = useRouter();
  const [form, setForm] = useState(BLANK_INFO);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!race) return;
    setForm({
      name: race.name || "",
      track: race.track || "",
      date: race.date || "",
      round_number: String(race.round_number ?? ""),
      track_logo_url: race.track_logo_url || "",
      sessions: Array.isArray(race.sessions) && race.sessions.length ? race.sessions.join(", ") : "Race",
    });
  }, [race]);

  function set(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }));
  }
  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const sessions = form.sessions.split(",").map(s => s.trim()).filter(Boolean);
      const body = {
        name: form.name,
        track: form.track,
        date: form.date,
        round_number: Number(form.round_number),
        track_logo_url: form.track_logo_url,
        sessions: sessions.length ? sessions : ["Race"],
      };
      const updated = await api(`/api/races/${race.id}`, { method: "PATCH", body });
      onSaved?.(updated);
      showToast("success", "Race info saved.");
    } catch (err) {
      showToast("error", err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${race.name}" and all its results? This cannot be undone.`)) return;
    try {
      await api(`/api/races/${race.id}`, { method: "DELETE" });
      router.push("/schedule");
    } catch (err) {
      showToast("error", err.message);
    }
  }

  return (
    <div className="form-card" style={{ maxWidth: 560 }}>
      <form onSubmit={save}>
        <div className="field"><label>Race Name</label>
          <input required value={form.name} onChange={set("name")} placeholder="Race 1 — Daytona Duel" /></div>
        <div className="field"><label>Track</label>
          <input value={form.track} onChange={set("track")} placeholder="Daytona International Speedway" /></div>
        <div className="field"><label>Round Number</label>
          <input type="number" min="1" required value={form.round_number} onChange={set("round_number")} /></div>
        <div className="field"><label>Date</label>
          <input type="date" value={form.date} onChange={set("date")} /></div>
        <div className="field"><label>Races in this event — comma-separated (e.g. Race 1, Race 2, Sprint)</label>
          <input value={form.sessions} onChange={set("sessions")} placeholder="Race" /></div>
        <ImageUpload label="Track Logo" kind="track-logo" value={form.track_logo_url}
          onUploaded={url => setForm(f => ({ ...f, track_logo_url: url }))} />

        {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save Race Info"}</button>
        <button className="btn btn-danger" type="button" style={{ marginLeft: 8 }} onClick={remove}>Delete Race</button>
      </form>
    </div>
  );
}

function UnifiedEditInner() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab = ["results", "qualifying"].includes(tabParam) ? tabParam : "info";
  const initialSession = searchParams.get("session") || undefined;

  const [tab, setTab] = useState(initialTab);
  const [race, setRace] = useState(null);
  const [seasonId, setSeasonId] = useState(null);
  const [seasonName, setSeasonName] = useState("");
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ev = await api(`/api/events/${id}`);
        if (cancelled) return;
        setRace({ id: ev.event.id, ...ev.event });
        setSeasonId(ev.event.season_id);
        setSeasonName(ev.season?.name ?? "");
        const e = await api(`/api/entries?season_id=${ev.event.season_id}`);
        if (!cancelled) setEntries(e);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Refreshes just the driver list, without re-fetching the race — used
  // after a driver is added inline from within a results/qualifying editor.
  const reloadEntries = useCallback(async () => {
    if (!seasonId) return;
    setEntries(await api(`/api/entries?season_id=${seasonId}`));
  }, [seasonId]);

  if (error) return <div className="empty-state"><span className="empty-state-icon">🏁</span><p>{error}</p></div>;
  if (!race) return <div className="skeleton" style={{ height: 260 }} />;

  return (
    <section>
      <div className="page-title">
        <div>
          <h2>Edit · {race.name}</h2>
          <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "var(--ink-1)" }}>
            {race.track ? `${race.track} · ` : ""}{seasonName}
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Link href={`/races/${race.id}`} style={{ color: "var(--accent-cyan)", fontSize: "0.85rem" }}>View results →</Link>
          <Link href="/schedule" style={{ color: "var(--ink-1)", fontSize: "0.85rem" }}>Schedule</Link>
        </div>
      </div>

      <div className="tab-row" style={{ marginTop: 16 }}>
        <button className={`tab${tab === "info" ? " active" : ""}`} onClick={() => setTab("info")}>Race Info</button>
        <button className={`tab${tab === "qualifying" ? " active" : ""}`} onClick={() => setTab("qualifying")}>Qualifying</button>
        <button className={`tab${tab === "results" ? " active" : ""}`} onClick={() => setTab("results")}>Race Results</button>
      </div>

      {tab === "info" && (
        <RaceInfoTab race={race} onSaved={updated => setRace(r => ({ ...r, ...updated }))} />
      )}
      {tab === "qualifying" && (
        <div className="form-card" style={{ maxWidth: "100%" }}>
          <QualifyingEditor race={race} seasonId={seasonId} entries={entries} onEntriesChanged={reloadEntries} />
        </div>
      )}
      {tab === "results" && (
        <div className="form-card" style={{ maxWidth: "100%" }}>
          <RaceResultsEditor race={race} seasonId={seasonId} entries={entries} initialSession={initialSession} onEntriesChanged={reloadEntries} />
        </div>
      )}
    </section>
  );
}

export default function RaceEditPage() {
  return (
    <AdminGate>
      <Suspense fallback={<div className="skeleton" style={{ height: 260 }} />}>
        <UnifiedEditInner />
      </Suspense>
    </AdminGate>
  );
}
