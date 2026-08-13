"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";

// Bulk roster import — the season-rollover shortcut. Instead of re-adding 30
// drivers by hand every new season, pull them in one shot from either:
//   • every driver who has raced anywhere in this SERIES, or
//   • one specific season — this series' last one, or any season of any series
//     in this game, which is how a brand-new series starts with the drivers the
//     league already has.
//
// It runs in two steps, and the first one is the point of it: REVIEW before
// anything is written. Every driver being imported is resolved against the
// global driver pool — through every name they answer to, not just the one on
// the source entry (see lib/driverMatch.js) — and the table says which of three
// things each one is:
//
//   ✓ already in the app   imports under that existing driver, history intact
//   ⚠ needs checking       resembles someone; the admin says which, or "new"
//   ＋ new to the league    a driver profile is created for them as part of the
//                          import, so no entry is left attached to nobody
//
// Nothing imports until every ⚠ row has been answered. That's the prompt that
// was missing: before this, a whole season's worth of "same person, different
// name" quietly became a whole season's worth of duplicates.
//
// Drivers already on the target roster are skipped rather than erroring, so
// this is safe to run on a roster that's already partly built. Team and class
// aren't carried over — those are per-season records — so the imported drivers
// land unassigned and ready to be slotted in.
const STATUS_CHIP = {
  linked: { bg: "rgba(46,160,67,0.18)", fg: "#3fb950", label: "already in the app" },
  check: { bg: "rgba(210,153,34,0.18)", fg: "#d29922", label: "needs checking" },
  new: { bg: "rgba(88,166,255,0.18)", fg: "#58a6ff", label: "new to the league" },
  on_roster: { bg: "rgba(255,255,255,0.08)", fg: "var(--ink-2)", label: "already on this roster" },
  unusable: { bg: "rgba(255,255,255,0.08)", fg: "var(--ink-2)", label: "no name — skipped" },
};

export function RosterImportModal({ seasonId, seriesId, seasonName, seriesName, seriesList = [], onClose, onImported }) {
  const [source, setSource] = useState("series");
  const [seasonGroups, setSeasonGroups] = useState([]); // [{ series_id, series_name, seasons: [...] }]
  const [fromSeasonId, setFromSeasonId] = useState("");
  const [plan, setPlan] = useState(null);        // { rows, summary } once previewed
  const [decisions, setDecisions] = useState({}); // row key -> "link:<id>" | "create" | "skip"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Every season that could be cloned: this series' other seasons first, then
  // the rest of the game's series. Never the season being imported into.
  useEffect(() => {
    let live = true;
    const list = seriesList.length ? seriesList : (seriesId ? [{ id: seriesId, name: seriesName || "This series" }] : []);
    if (!list.length) return;
    Promise.all(list.map(s =>
      api(`/api/seasons?series_id=${s.id}`)
        .then(seasons => ({ series_id: s.id, series_name: s.name, seasons: seasons.filter(x => x.id !== seasonId) }))
        .catch(() => ({ series_id: s.id, series_name: s.name, seasons: [] }))))
      .then(groups => {
        if (!live) return;
        // This series leads — cloning its own last season is by far the most
        // common thing anyone comes here to do.
        const ordered = [...groups].sort((a, b) => (a.series_id === seriesId ? -1 : b.series_id === seriesId ? 1 : 0));
        const withSeasons = ordered.filter(g => g.seasons.length);
        setSeasonGroups(withSeasons);
        setFromSeasonId(withSeasons[0]?.seasons[0]?.id ?? "");
      });
    return () => { live = false; };
  }, [seriesId, seriesName, seriesList, seasonId]);

  const body = useMemo(() => (source === "season"
    ? { season_id: seasonId, source: "season", from_season_id: fromSeasonId }
    : { season_id: seasonId, source: "series" }), [source, seasonId, fromSeasonId]);

  async function preview(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api("/api/roster/import", { method: "POST", body: { ...body, preview: true } });
      setPlan(res);
      // Everything the app is sure about is pre-answered; the doubtful rows are
      // deliberately left blank, because a default is what a hurried admin
      // clicks past — and clicking past this one is how a duplicate is born.
      setDecisions(Object.fromEntries(res.rows
        .filter(r => r.status === "linked" || r.status === "new")
        .map(r => [r.key, r.status === "linked" ? `link:${r.driver_id}` : "create"])));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const chosen = Object.fromEntries(Object.entries(decisions).map(([key, value]) => {
        if (value === "create" || value === "skip") return [key, { action: value }];
        return [key, { action: "link", driver_id: value.slice("link:".length) }];
      }));
      const res = await api("/api/roster/import", { method: "POST", body: { ...body, decisions: chosen } });
      onImported(res);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const actionable = (plan?.rows ?? []).filter(r => r.status !== "on_roster" && r.status !== "unusable");
  const unanswered = actionable.filter(r => !decisions[r.key]);
  const willImport = actionable.filter(r => decisions[r.key] && decisions[r.key] !== "skip").length;
  const noSeasons = seasonGroups.length === 0;

  // Every driver this row could be, in the order they should be offered.
  function optionsFor(row) {
    const seen = new Set();
    const out = [];
    if (row.driver_id) {
      seen.add(row.driver_id);
      out.push({ value: `link:${row.driver_id}`, label: `Use ${row.driver_name || "the driver they're already linked to"}` });
    }
    for (const m of row.matches || []) {
      if (seen.has(m.driver_id)) continue;
      seen.add(m.driver_id);
      out.push({ value: `link:${m.driver_id}`, label: `Use ${m.name} — ${m.reason}` });
    }
    out.push({ value: "create", label: `Create a new driver called “${row.name}”` });
    out.push({ value: "skip", label: "Don’t import them" });
    return out;
  }

  return (
    <Modal title="Import Roster" onClose={busy ? () => {} : onClose}>
      <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.9rem" }}>
        Bulk-add drivers to <strong>{seasonName || "this season"}</strong>. Anyone already on this
        season&rsquo;s roster is skipped, and everyone else is matched against the drivers the app
        already has before anything is created.
      </p>

      {!plan ? (
        <form onSubmit={preview}>
          <div className="field">
            <label className="check-row" style={{ fontWeight: 400, cursor: "pointer" }}>
              <input type="radio" name="import-source" value="series" checked={source === "series"}
                onChange={() => setSource("series")} />
              <span>
                <strong>All drivers in {seriesName || "this series"}</strong>
                <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.82rem" }}>
                  Everyone who has raced in any season of this series.
                </span>
              </span>
            </label>
          </div>
          <div className="field">
            <label className="check-row" style={{ fontWeight: 400, cursor: noSeasons ? "default" : "pointer" }}>
              <input type="radio" name="import-source" value="season" checked={source === "season"}
                disabled={noSeasons} onChange={() => setSource("season")} />
              <span>
                <strong>Copy one season&rsquo;s roster</strong>
                <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.82rem" }}>
                  {noSeasons
                    ? "No other seasons to copy from yet."
                    : "A past season of this series — or any season of another series in this game, for a brand-new series."}
                </span>
              </span>
            </label>
          </div>

          {source === "season" && !noSeasons && (
            <div className="field">
              <label>Copy from</label>
              <select value={fromSeasonId} onChange={e => setFromSeasonId(e.target.value)}>
                {seasonGroups.map(g => (
                  <optgroup key={g.series_id} label={g.series_name || "Series"}>
                    {g.seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
          )}

          {error && <div className="toast toast-error">{error}</div>}

          <button className="btn btn-primary" type="submit" disabled={busy || (source === "season" && !fromSeasonId)}>
            {busy ? "Checking…" : "Review Drivers"}
          </button>
          <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} disabled={busy} onClick={onClose}>Cancel</button>
        </form>
      ) : (
        <>
          <div className="roster-scope" style={{ marginBottom: 10 }}>
            <span className="roster-scope-icon" aria-hidden="true">⊞</span>
            <div className="roster-scope-body">
              <strong>{actionable.length} driver{actionable.length === 1 ? "" : "s"} to import</strong>
              <span>
                {plan.summary.linked} already in the app · {plan.summary.new} new · {plan.summary.check} to check
                {plan.summary.on_roster ? ` · ${plan.summary.on_roster} already on this roster` : ""}
              </span>
            </div>
          </div>

          {plan.summary.check > 0 && (
            <p style={{ margin: "0 0 10px", fontSize: "0.82rem", color: "var(--accent-amber, #d29922)" }}>
              ⚠ {plan.summary.check} name{plan.summary.check === 1 ? "" : "s"} look like drivers you already have.
              Say which for each one — importing them as new drivers would give the same person two profiles.
            </p>
          )}

          <div style={{ maxHeight: "45vh", overflowY: "auto", overflowX: "auto" }}>
            <table className="stats-table" style={{ fontSize: "0.82rem" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Driver</th>
                  <th style={{ textAlign: "left" }}>Imports as</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map(row => {
                  const chip = STATUS_CHIP[row.status];
                  const inert = row.status === "on_roster" || row.status === "unusable";
                  return (
                    <tr key={row.key} style={inert ? { opacity: 0.5 } : undefined}>
                      <td style={{ textAlign: "left" }}>
                        {row.name || <em style={{ color: "var(--ink-2)" }}>(no name)</em>}
                        {row.number ? <span className="badge" style={{ marginLeft: 6 }}>#{row.number}</span> : null}
                        <span style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 10, fontSize: "0.68rem", background: chip.bg, color: chip.fg }}>
                          {chip.label}
                        </span>
                      </td>
                      <td style={{ textAlign: "left" }}>
                        {inert ? <span style={{ color: "var(--ink-2)" }}>—</span> : (
                          <select
                            value={decisions[row.key] ?? ""}
                            onChange={e => setDecisions(d => ({ ...d, [row.key]: e.target.value }))}
                            style={{ minWidth: 240 }}
                          >
                            {!decisions[row.key] && <option value="">— which driver is this? —</option>}
                            {optionsFor(row).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {unanswered.length > 0 && (
            <button className="btn btn-ghost" type="button" style={{ marginTop: 10 }} disabled={busy}
              onClick={() => setDecisions(d => ({
                ...d,
                ...Object.fromEntries(unanswered.map(r => [r.key, "create"])),
              }))}>
              They&rsquo;re all new drivers ({unanswered.length})
            </button>
          )}

          {error && <div className="toast toast-error">{error}</div>}

          <div style={{ marginTop: 12 }}>
            <button className="btn btn-primary" type="button" disabled={busy || unanswered.length > 0 || !willImport} onClick={submit}>
              {busy ? "Importing…" : `Import ${willImport} driver${willImport === 1 ? "" : "s"}`}
            </button>
            <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} disabled={busy}
              onClick={() => { setPlan(null); setDecisions({}); setError(null); }}>
              Back
            </button>
          </div>
          {unanswered.length > 0 && (
            <p style={{ margin: "8px 0 0", fontSize: "0.78rem", color: "var(--ink-2)" }}>
              {unanswered.length} driver{unanswered.length === 1 ? "" : "s"} still need{unanswered.length === 1 ? "s" : ""} an answer above.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
