"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { matchScheduleToRaces } from "@/lib/srhSeasonResults";
import { formatRaceDate } from "@/lib/raceDate";

// Import a whole season's RESULTS from SimRacerHub — one round per line, one
// press for the lot.
//
// The schedule importer (SrhSeasonImportModal) builds a season's calendar from
// one link. This is the other half: the calendar exists, the season has been
// raced, and every round's results are sitting on a SimRacerHub page of its
// own. Entering them a session at a time through Smart Import is sixty passes
// through a dialog for a twelve-round season, which is how a season ends up
// half entered.
//
// So the dialog is the season's own schedule, in round order, with a bar under
// each round to paste that round's SimRacerHub link into — and a press that
// works down the list. Each round reports for itself as it goes: which
// sessions it found, how many drivers it matched, and anything it couldn't
// place. A round that fails doesn't stop the rest.
//
// Every round is a request of its own (see the route): twelve SimRacerHub pages
// in one request is one timeout away from a half-imported season with nothing
// to say about which half.
//
// Nothing here decides anything. Which session a SimRacerHub session belongs
// in, which roster place each driver is and what a row becomes are all
// lib/srhSeasonResults.js, server-side, so the same rules apply whichever way
// results arrive.

const CHIP = {
  ok: { bg: "rgba(46,160,67,0.18)", fg: "#3fb950" },
  warn: { bg: "rgba(210,153,34,0.18)", fg: "#d29922" },
  error: { bg: "rgba(248,81,73,0.18)", fg: "#f85149" },
  busy: { bg: "rgba(255,255,255,0.08)", fg: "var(--ink-2)" },
};

function Chip({ kind = "busy", children, title }) {
  const c = CHIP[kind] || CHIP.busy;
  return (
    <span title={title} style={{
      padding: "1px 8px", borderRadius: 10, fontSize: "0.7rem", whiteSpace: "nowrap",
      background: c.bg, color: c.fg,
    }}>{children}</span>
  );
}

// What one round's report says once it has been read or written.
function RoundReport({ state }) {
  if (!state) return null;
  if (state.status === "busy") return <Chip kind="busy">Reading…</Chip>;
  if (state.status === "error") return <Chip kind="error" title={state.error}>Failed</Chip>;

  const r = state.report || {};
  const sessions = r.sessions || [];
  const names = sessions.map(s => s.session).join(", ");
  const rows = r.rows_total || 0;
  const unmatched = (r.unmatched || []).length;
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <Chip kind="ok" title={names}>
        {state.status === "done" ? "✓ " : ""}{sessions.length} session{sessions.length === 1 ? "" : "s"} · {rows} row{rows === 1 ? "" : "s"}
      </Chip>
      {sessions.some(s => s.new) && (
        <Chip kind="ok" title={sessions.filter(s => s.new).map(s => s.session).join(", ")}>
          +{sessions.filter(s => s.new).length} new session{sessions.filter(s => s.new).length === 1 ? "" : "s"}
        </Chip>
      )}
      {r.race_update?.heat_format && (
        <Chip kind="ok" title="SimRacerHub ran heats here, so the event is switched to heat format — Heats, Consolations and a Feature instead of one Race">
          → heat format
        </Chip>
      )}
      {r.stats && <Chip kind="ok" title={`${r.stats.caution_flags ?? 0} cautions · ${r.stats.caution_laps ?? 0} caution laps · ${r.stats.lead_changes ?? 0} lead changes, from ${r.stats_session}`}>race stats</Chip>}
      {unmatched > 0 && (
        <Chip kind="warn" title={`Not on this season's roster, so their rows were left out:\n${(r.unmatched || []).join("\n")}`}>
          {unmatched} not on roster
        </Chip>
      )}
      {(r.skipped || []).length > 0 && (
        <Chip kind="warn" title={(r.skipped || []).map(s => `${s.srh_name}: ${s.reason}`).join("\n")}>
          {(r.skipped || []).length} skipped
        </Chip>
      )}
    </div>
  );
}

export function SrhSeasonResultsModal({ seasonId, seasonName, races = [], onClose, onImported }) {
  const ordered = useMemo(
    () => [...races].sort((a, b) => (Number(a.round_number) || 0) - (Number(b.round_number) || 0)),
    [races],
  );

  const [urls, setUrls] = useState({});
  const [seasonUrl, setSeasonUrl] = useState("");
  const [filling, setFilling] = useState(false);
  const [fillNote, setFillNote] = useState("");
  const [state, setState] = useState({});     // race id -> { status, report, error }
  const [busy, setBusy] = useState("");        // "" | "checking" | "importing"
  const [at, setAt] = useState(0);             // rounds handled this run
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);

  const filled = ordered.filter(r => (urls[r.id] || "").trim());
  const running = !!busy;

  const setUrl = (id, value) => {
    setUrls(u => ({ ...u, [id]: value }));
    setState(s => (s[id] ? { ...s, [id]: undefined } : s));
    setSummary(null);
    setError(null);
  };

  // One season link → a results link on every round. The schedule importer's
  // preview already reads the page this needs, so it is asked rather than a
  // second reader of the same HTML being written.
  async function fillFromSeason() {
    if (!seasonUrl.trim()) return;
    setFilling(true);
    setError(null);
    setFillNote("");
    try {
      const res = await api("/api/import-srh-season", { method: "POST", body: { url: seasonUrl.trim(), preview: true } });
      const found = matchScheduleToRaces(ordered, res.rows || []);
      const n = Object.keys(found).length;
      if (!n) {
        setFillNote("That schedule has no rounds this season's calendar could be paired with — paste each round's link below instead.");
      } else {
        setUrls(u => ({ ...u, ...found }));
        setState({});
        setSummary(null);
        setFillNote(
          `Filled in ${n} of ${ordered.length} round${ordered.length === 1 ? "" : "s"} from ${
            [res.source?.series, res.source?.season].filter(Boolean).join(" · ") || "that schedule"
          }. Check them before importing.`,
        );
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setFilling(false);
    }
  }

  // Work down the list, one round at a time. Sequential on purpose: these are
  // requests to SimRacerHub, and firing twelve of them at once is how you get
  // throttled into half-sent pages.
  async function run(preview) {
    if (!filled.length) return;
    setBusy(preview ? "checking" : "importing");
    setError(null);
    setSummary(null);
    setAt(0);

    let ok = 0, failed = 0, rows = 0, unmatched = new Set();
    let lastWrote = false;
    for (let i = 0; i < filled.length; i++) {
      const race = filled[i];
      setState(s => ({ ...s, [race.id]: { status: "busy" } }));
      try {
        const res = await api("/api/import-srh-season-results", {
          method: "POST",
          body: {
            season_id: seasonId,
            race_id: race.id,
            url: (urls[race.id] || "").trim(),
            preview,
            // Skill Ratings are replayed from scratch across the whole game, so
            // the season pays for it once, on the last round in.
            recalc: !preview && i === filled.length - 1,
          },
        });
        setState(s => ({ ...s, [race.id]: { status: preview ? "read" : "done", report: res } }));
        ok += 1;
        rows += res.rows_total || 0;
        lastWrote = true;
        for (const name of res.unmatched || []) unmatched.add(name);
      } catch (err) {
        setState(s => ({ ...s, [race.id]: { status: "error", error: err.message, report: err.data } }));
        failed += 1;
        lastWrote = false;
      }
      setAt(i + 1);
    }

    // The Skill Rating replay rides on the last round, and the last round is
    // the one that can fail. A run that wrote eleven rounds and lost the
    // twelfth still has to leave the ratings sound, so it is asked for on its
    // own — quietly, because it changes a derived number and nothing an admin
    // is looking at.
    if (!preview && ok > 0 && !lastWrote) {
      await api("/api/import-srh-season-results", {
        method: "POST", body: { season_id: seasonId, recalc_only: true },
      }).catch(() => {});
    }

    setBusy("");
    setSummary({ preview, ok, failed, rows, unmatched: [...unmatched] });
    if (!preview && ok) onImported?.();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onMouseDown={e => { if (e.target === e.currentTarget && !running) onClose(); }}>
      <div className="form-card" style={{ maxWidth: 820, width: "100%", maxHeight: "88vh", overflowY: "auto" }}
        onMouseDown={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Import Season Results · {seasonName || "Season"}</h3>
          <button className="btn btn-ghost" type="button" style={{ marginTop: 0, padding: "4px 10px" }}
            disabled={running} onClick={onClose}>✕</button>
        </div>

        <p style={{ marginTop: 8, marginBottom: 12, color: "var(--ink-2)", fontSize: "0.82rem" }}>
          Paste each round&rsquo;s SimRacerHub race link below and one press brings the whole season across.
          Every session on a page comes with it — qualifying, each heat, the consolation and the feature —
          and each round&rsquo;s cautions and lead changes land on the event. Your own points structure still
          scores every finishing position; only what it can&rsquo;t work out for itself (a SimRacerHub penalty
          or bonus) rides across in the Adj column.
        </p>

        {/* One link instead of twelve. The season's schedule page carries an id
            for every round, which is exactly what each round's results page is
            addressed by. */}
        <div style={{ border: "1.5px solid var(--border)", borderRadius: 10, padding: "10px 12px", marginBottom: 14, background: "var(--bg-elevated)" }}>
          <label htmlFor="srh_results_season_url" style={{ display: "block", fontSize: "0.78rem", color: "var(--ink-2)", marginBottom: 4 }}>
            Fill them all in from the season link (optional)
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input id="srh_results_season_url" value={seasonUrl} disabled={running || filling}
              onChange={e => { setSeasonUrl(e.target.value); setFillNote(""); }}
              placeholder="https://www.simracerhub.com/scoring/season_schedule.php?season_id=…"
              style={{ flex: "1 1 340px", minWidth: 0 }} />
            <button className="btn btn-ghost" type="button" style={{ marginTop: 0 }}
              disabled={running || filling || !seasonUrl.trim()} onClick={fillFromSeason}>
              {filling ? "Reading…" : "Fill in links"}
            </button>
          </div>
          {fillNote && <p style={{ margin: "6px 0 0", fontSize: "0.78rem", color: "var(--ink-1)" }}>{fillNote}</p>}
        </div>

        {ordered.length === 0 ? (
          <div className="empty-state"><span className="empty-state-icon">📅</span><p>This season has no rounds yet.</p></div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {ordered.map((race, i) => {
              const s = state[race.id];
              return (
                <div key={race.id}>
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", marginBottom: 4 }}>
                    <strong style={{ fontSize: "0.9rem" }}>
                      Race {race.round_number ?? i + 1} &mdash; {race.name}
                    </strong>
                    <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
                      {[race.track, race.date ? formatRaceDate(race.date, "short") : ""].filter(Boolean).join(" · ")}
                    </span>
                    <span style={{ marginLeft: "auto" }}><RoundReport state={s} /></span>
                  </div>
                  <label htmlFor={`srh_url_${race.id}`} style={{ display: "block", fontSize: "0.76rem", color: "var(--ink-2)", marginBottom: 3 }}>
                    SimRacerHub URL:
                  </label>
                  <input id={`srh_url_${race.id}`} value={urls[race.id] || ""} disabled={running}
                    onChange={e => setUrl(race.id, e.target.value)}
                    placeholder="https://www.simracerhub.com/scoring/season_race.php?schedule_id=…"
                    style={{ width: "100%" }} />
                  {s?.status === "error" && (
                    <p style={{ margin: "4px 0 0", fontSize: "0.78rem", color: "#e5484d" }}>{s.error}</p>
                  )}
                  {s?.report?.sessions?.length > 0 && (
                    <p style={{ margin: "4px 0 0", fontSize: "0.76rem", color: "var(--ink-2)" }}>
                      {s.report.sessions.map(x => `${x.session} (${x.matched})`).join(" · ")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>{error}</p>}

        {summary && (
          <div style={{ border: "1.5px solid var(--border)", borderRadius: 10, padding: "10px 12px", margin: "14px 0 0", background: "var(--bg-elevated)" }}>
            <div style={{ fontSize: "0.86rem" }}>
              {summary.preview
                ? `Read ${summary.ok} round${summary.ok === 1 ? "" : "s"} · ${summary.rows} rows ready`
                : `Imported ${summary.ok} round${summary.ok === 1 ? "" : "s"} · ${summary.rows} rows written`}
              {summary.failed ? ` · ${summary.failed} failed` : ""}
            </div>
            {summary.unmatched.length > 0 && (
              <p style={{ margin: "6px 0 0", fontSize: "0.78rem", color: "var(--accent-amber, #d29922)" }}>
                ⚠ {summary.unmatched.length} driver{summary.unmatched.length === 1 ? "" : "s"} on those pages
                {summary.unmatched.length === 1 ? " is" : " are"} not on this season&rsquo;s roster, so
                {summary.unmatched.length === 1 ? " their row" : " their rows"} went nowhere:{" "}
                {summary.unmatched.slice(0, 12).join(", ")}
                {summary.unmatched.length > 12 ? `, and ${summary.unmatched.length - 12} more` : ""}.
                Add them to the roster and run this again — re-importing a round replaces what it wrote.
              </p>
            )}
            {!summary.preview && summary.ok > 0 && (
              <p style={{ margin: "6px 0 0", fontSize: "0.78rem", color: "var(--ink-2)" }}>
                Standings, stats and every driver&rsquo;s profile are already showing them.
              </p>
            )}
          </div>
        )}

        <div style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-primary" type="button" style={{ marginTop: 0 }}
            disabled={running || !filled.length} onClick={() => run(false)}>
            {busy === "importing"
              ? `Importing ${at + 1} of ${filled.length}…`
              : `Import ${filled.length || ""} round${filled.length === 1 ? "" : "s"}`}
          </button>
          <button className="btn btn-ghost" type="button" style={{ marginTop: 0 }}
            disabled={running || !filled.length} onClick={() => run(true)}>
            {busy === "checking" ? `Checking ${at + 1} of ${filled.length}…` : "Check first"}
          </button>
          <button className="btn btn-ghost" type="button" style={{ marginTop: 0 }} disabled={running} onClick={onClose}>
            {summary && !summary.preview ? "Done" : "Cancel"}
          </button>
          <span style={{ fontSize: "0.76rem", color: "var(--ink-2)" }}>
            {filled.length
              ? `Importing a round replaces whatever those sessions already had saved. Rounds with no link are left alone.`
              : "Paste at least one round's link to import."}
          </span>
        </div>
      </div>
    </div>
  );
}
