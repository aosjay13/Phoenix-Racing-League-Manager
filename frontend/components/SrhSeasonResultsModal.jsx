"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { matchScheduleToRaces, unmatchedRoster } from "@/lib/srhSeasonResults";
import { SrhUnmatchedDrivers } from "@/components/SrhUnmatchedDrivers";
import { SrhScaleMismatch } from "@/components/SrhScaleMismatch";
import { scaleReport } from "@/lib/srhPointsScale";
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
// A driver no roster place could be found for has their rows left out and
// their name said out loud, which on its own is a dead end — so the names come
// with the results screen's own driver picker (see SrhUnmatchedDrivers), and
// the rounds they were missing from can be re-run without leaving the dialog.
//
// The other thing an import can be quietly wrong about is the SCALE. Finishing
// points are never brought across — your own structure pays for every position
// — so a season SimRacerHub scored on a different scale imports looking fine
// and scores a championship nobody recognises. The two scales are compared per
// session and any disagreement is flagged with the decision attached (see
// SrhScaleMismatch), for that round or, when most of the season is scored that
// way, for all of them at once.
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
  // Read fine, wrote nothing, because nobody on the page is on the roster yet
  // — the normal answer on a brand new season, and the one the driver panel
  // below exists to deal with.
  if (r.needs_roster) {
    return (
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <Chip kind="warn" title={(r.unmatched || []).join("\n")}>
          {(r.unmatched || []).length} to add to the roster
        </Chip>
        <Chip kind="busy" title={sessions.map(x => x.session).join(", ")}>
          {sessions.length} session{sessions.length === 1 ? "" : "s"} ready
        </Chip>
      </div>
    );
  }
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

export function SrhSeasonResultsModal({ seasonId, seasonName, seriesName = "", races = [], onClose, onImported }) {
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
  // The season roster, so the driver picker below doesn't offer somebody who
  // is already on it. Reloaded after every add.
  const [entries, setEntries] = useState([]);
  const [notice, setNotice] = useState("");
  // The answers given to the missing drivers, held here rather than in the
  // panel: the panel comes down while a re-import runs, and a decision made
  // before it must survive the remount.
  const [resolvedDrivers, setResolvedDrivers] = useState({});
  const [ignoredDrivers, setIgnoredDrivers] = useState({});
  // The points structure chosen for a session whose scale disagreed with
  // SimRacerHub's: race id -> session name -> points_templates id. Held here
  // rather than in the panel for the same reason the driver answers are — the
  // panel comes down while a re-import runs.
  const [sessionTemplates, setSessionTemplates] = useState({});
  // Take what SimRacerHub paid each driver as that row's points. On by default:
  // a league scored there wants a table here that agrees with the one they
  // already have, and no points structure can reproduce its per-driver bonuses,
  // penalties and stage points. Turned off, this season's own structure scores
  // every position as it always did.
  const [takeSrhPoints, setTakeSrhPoints] = useState(true);

  const filled = ordered.filter(r => (urls[r.id] || "").trim());
  const running = !!busy;

  const loadEntries = useCallback(() => {
    if (!seasonId) return;
    api(`/api/entries?season_id=${seasonId}`).then(setEntries).catch(() => {});
  }, [seasonId]);
  useEffect(() => { loadEntries(); }, [loadEntries]);

  // Every name the rounds read so far couldn't place, folded into one list of
  // people — the same driver missing from nine rounds is one person to resolve,
  // not nine warnings. See unmatchedRoster.
  const labelFor = useCallback(
    id => {
      const race = ordered.find(r => r.id === id);
      return race ? `Race ${race.round_number ?? "?"} — ${race.name}` : "";
    },
    [ordered],
  );
  const unmatched = useMemo(
    () => unmatchedRoster(
      Object.entries(state)
        .filter(([, v]) => v?.report?.unmatched?.length)
        .map(([id, v]) => ({ race_id: id, label: labelFor(id), unmatched: v.report.unmatched })),
    ),
    [state, labelFor],
  );
  // Checking a season is what turns up the drivers the roster hasn't got, so a
  // check that finds any takes you straight to them with the first one open —
  // "check" starts the job rather than filing a report about it. Only when the
  // list goes from empty to not, so answering one name doesn't yank the page
  // back up, and a later check that finds more rearms it.
  const rosterPanelRef = useRef(null);
  const hadUnmatched = useRef(false);
  useEffect(() => {
    if (running) return;
    const has = unmatched.length > 0;
    if (has && !hadUnmatched.current) {
      rosterPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    hadUnmatched.current = has;
  }, [running, unmatched.length]);

  // The rounds those drivers were missing from — the ones worth running again
  // once the roster has them.
  const affected = useMemo(() => {
    const ids = new Set(unmatched.flatMap(u => u.rounds.map(r => r.race_id)));
    return filled.filter(r => ids.has(r.id));
  }, [unmatched, filled]);

  // Where SimRacerHub's own scale disagrees with the one that will score the
  // session here, across every round read so far.
  const scales = useMemo(
    () => ({
      ...scaleReport(
        Object.entries(state)
          .filter(([, v]) => v?.report?.sessions?.length)
          .map(([id, v]) => ({ race_id: id, label: labelFor(id), sessions: v.report.sessions })),
      ),
      season_name: seasonName,
    }),
    [state, labelFor, seasonName],
  );

  const chooseTemplate = (raceId, session, templateId) =>
    setSessionTemplates(t => ({ ...t, [raceId]: { ...(t[raceId] || {}), [session]: templateId } }));
  // One answer for every round flagged — what a season scored on another scale
  // needs, rather than the same dropdown twelve times.
  const chooseTemplateForAll = templateId => setSessionTemplates(t => {
    const next = { ...t };
    for (const round of scales.flagged) {
      next[round.race_id] = { ...(next[round.race_id] || {}) };
      for (const s of [...round.sessions, ...round.unscored]) next[round.race_id][s.session] = templateId;
    }
    return next;
  });

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
  // `only` runs a subset — the rounds that were missing drivers, after the
  // roster has been given them. Everything else about the pass is the same, so
  // re-importing a round replaces exactly what it wrote the first time.
  async function run(preview, only = null) {
    const list = only && only.length ? only : filled;
    if (!list.length) return;
    setBusy(preview ? "checking" : "importing");
    setError(null);
    setSummary(null);
    setNotice("");
    setAt(0);

    let ok = 0, failed = 0, rows = 0, structures = 0, srhPoints = false, waiting = 0;
    let lastWrote = false;
    for (let i = 0; i < list.length; i++) {
      const race = list[i];
      // Reset per round: the Skill Rating fallback below asks whether the LAST
      // round wrote, and a round that failed or is waiting on the roster did
      // not — leaving this true from an earlier round would skip the replay.
      lastWrote = false;
      setState(s => ({ ...s, [race.id]: { status: "busy" } }));
      try {
        const res = await api("/api/import-srh-season-results", {
          method: "POST",
          body: {
            season_id: seasonId,
            race_id: race.id,
            url: (urls[race.id] || "").trim(),
            preview,
            // The points structures named for this round's sessions, where
            // SimRacerHub's scale disagreed with ours. Left out of a preview,
            // which writes nothing.
            ...(preview ? {} : { session_templates: sessionTemplates[race.id] || {} }),
            take_srh_points: takeSrhPoints,
            // Skill Ratings are replayed from scratch across the whole game, so
            // the season pays for it once, on the last round in.
            recalc: !preview && i === list.length - 1,
          },
        });
        setState(s => ({ ...s, [race.id]: { status: preview ? "read" : "done", report: res } }));
        // A round that read fine but is waiting on the roster hasn't imported
        // anything, so it must not be counted as one that did.
        if (res.needs_roster) { waiting += 1; setAt(i + 1); continue; }
        ok += 1;
        rows += res.rows_total || 0;
        structures += res.written?.points_structures || 0;
        srhPoints = srhPoints || !!res.written?.srh_points;
        lastWrote = true;
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
    setSummary({ preview, ok, failed, rows, structures, srhPoints, waiting, partial: !!(only && only.length) });
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

        {/* The one switch that decides whether the two championships agree. */}
        <div className="check-row" style={{ marginBottom: 12 }}>
          <input id="srh_take_points" type="checkbox" checked={takeSrhPoints}
            disabled={running} onChange={e => setTakeSrhPoints(e.target.checked)} />
          <label htmlFor="srh_take_points" style={{ fontSize: "0.82rem" }}>
            <strong>Score every driver on the points SimRacerHub paid them</strong>
            <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.78rem", marginTop: 2 }}>
              {takeSrhPoints
                ? "Each row is imported holding SimRacerHub's own figure — its scale, its bonuses, its penalties and its stage points — so this season's standings match SimRacerHub's exactly, with nothing to edit. Every figure is still editable per row on the results screen afterwards, and clearing one hands that row back to your own points structure."
                : "Your own points structure scores every finishing position instead, and only what it can't work out for itself (a SimRacerHub penalty or bonus) rides across in the Adj column. The standings here will differ from SimRacerHub's wherever the two scales do."}
            </span>
          </label>
        </div>

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
              {summary.waiting ? ` · ${summary.waiting} waiting on the roster` : ""}
              {summary.failed ? ` · ${summary.failed} failed` : ""}
              {summary.partial ? " · the rounds that were short of drivers" : ""}
              {summary.structures ? ` · ${summary.structures} session${summary.structures === 1 ? "" : "s"} scored on a chosen structure` : ""}
              {!summary.preview && summary.srhPoints ? " · scored on SimRacerHub's own points" : ""}
            </div>
            {unmatched.length > 0 && (
              <p style={{ margin: "6px 0 0", fontSize: "0.78rem", color: "var(--accent-amber, #d29922)" }}>
                ⚠ {unmatched.length} driver{unmatched.length === 1 ? "" : "s"} on those pages
                {unmatched.length === 1 ? " is" : " are"} not on this season&rsquo;s roster, so
                {unmatched.length === 1 ? " their row" : " their rows"} went nowhere. Put
                {unmatched.length === 1 ? " them" : " each of them"} right below, then re-import the rounds
                they were missing from.
              </p>
            )}
            {!summary.preview && summary.ok > 0 && (
              <p style={{ margin: "6px 0 0", fontSize: "0.78rem", color: "var(--ink-2)" }}>
                Standings, stats and every driver&rsquo;s profile are already showing them.
              </p>
            )}
          </div>
        )}

        {/* Where SimRacerHub paid a different scale from the one that will
            score the session here. Flagged with the decision attached: name the
            structure that round should score on, or all of them at once when
            most of the season is scored that way. */}
        {!running && !takeSrhPoints && scales.flagged.length > 0 && (
          <SrhScaleMismatch
            report={scales}
            choices={sessionTemplates}
            onChoose={chooseTemplate}
            onChooseAll={chooseTemplateForAll}
            onError={setError}
          />
        )}

        {/* The drivers the rounds couldn't place, with the results screen's own
            picker against each one. Resolving them writes roster entries; the
            rounds they were missing from are then run again, which is when
            their rows actually land. */}
        <div ref={rosterPanelRef} />
        {!running && unmatched.length > 0 && (
          <SrhUnmatchedDrivers
            seasonId={seasonId}
            seriesName={seriesName}
            unmatched={unmatched}
            entries={entries}
            done={resolvedDrivers}
            onDone={(key, entry) => setResolvedDrivers(d => ({ ...d, [key]: entry }))}
            ignored={ignoredDrivers}
            onIgnore={(key, on) => setIgnoredDrivers(g => ({ ...g, [key]: on }))}
            onRosterChanged={() => loadEntries()}
            onNotice={setNotice}
            onError={setError}
          />
        )}
        {notice && (
          <p style={{ margin: "0 0 8px", fontSize: "0.78rem", color: "#3fb950" }}>{notice}</p>
        )}

        <div style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-primary" type="button" style={{ marginTop: 0 }}
            disabled={running || !filled.length} onClick={() => run(false)}>
            {busy === "importing"
              ? `Importing ${at + 1}…`
              : `Import ${filled.length || ""} round${filled.length === 1 ? "" : "s"}`}
          </button>
          <button className="btn btn-ghost" type="button" style={{ marginTop: 0 }}
            disabled={running || !filled.length} onClick={() => run(true)}>
            {busy === "checking" ? `Checking ${at + 1}…` : "Check first"}
          </button>
          {affected.length > 0 && (
            <button className="btn btn-ghost" type="button" style={{ marginTop: 0 }}
              title="Run only the rounds that had drivers off the roster — the rest are already in, and a round re-imported replaces exactly what it wrote"
              disabled={running} onClick={() => run(false, affected)}>
              ↻ Re-import {affected.length} round{affected.length === 1 ? "" : "s"} with missing drivers
            </button>
          )}
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
