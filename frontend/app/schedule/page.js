"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLeague } from "@/components/LeagueProvider";
import { useAuth } from "@/components/AuthProvider";
import { RaceCreateModal } from "@/components/RaceCreateModal";
import { RaceCopyModal } from "@/components/RaceCopyModal";
import { SeasonCreateModal } from "@/components/SeasonCreateModal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ShareGraphicButton, ShareGraphicModal } from "@/components/ShareGraphicModal";
import { leagueLogos, specToGraphicTable } from "@/lib/shareGraphic";
import { api } from "@/lib/api";
import { formatRaceDate, isPastRaceDate, todayDateString } from "@/lib/raceDate";
import { splitScheduleFeed } from "@/lib/scheduleFeed";
import { racePerClassResults } from "@/lib/classFilter";
import { lapsAreSecondary } from "@/lib/raceLength";
import { hasSessionTimes, localZoneLabel, raceSessionTimes, sessionTimeLine } from "@/lib/raceTimes";

// A driver cell that links to the profile when we can resolve one, else plain
// text. Falls back to an em-dash for events with no recorded pole/winner yet.
function Person({ p }) {
  if (!p || !p.name) return <span style={{ color: "var(--ink-2)" }}>—</span>;
  const id = p.driver_id || p.user_id;
  return id
    ? <Link href={`/drivers/${id}`} style={{ color: "var(--accent-cyan)" }}>{p.name}</Link>
    : <span>{p.name}</span>;
}

// A race date is a bare calendar date, rendered exactly as the admin picked it
// in every timezone — see lib/raceDate.js.
const fmtDate = d => formatRaceDate(d, "short");

// ── Session times, beside the date ────────────────────────────────────────
//
// The same opt-in the Calendar reads (Race Info → "Show session times on the
// Calendar"), shown here in the column right of the date so the schedule
// answers "what time do we go green" as well as "what day".
//
// The column only exists when something in the table actually carries times, so
// a league that has never used the toggle sees the schedule exactly as before.
// The date to its left is untouched — still the bare calendar date the admin
// picked (lib/raceDate.js) — while these times are converted to whoever is
// reading them, which is why the header says whose clock they're on.
function anySessionTimes(rows = []) {
  return rows.some(hasSessionTimes);
}

function SessionTimesHeader({ zoneLabel }) {
  return (
    <th style={{ whiteSpace: "nowrap" }}
      title="Practice, Qualifying and Race start times — converted to your own timezone">
      Session Times
      <span style={{ display: "block", fontWeight: 400, textTransform: "none", fontSize: "0.68rem", color: "var(--ink-2)" }}>
        your time{zoneLabel ? ` (${zoneLabel})` : ""}
      </span>
    </th>
  );
}

// One race's sessions, stacked P / Q / R. A session whose start lands on a
// different day for THIS reader carries that day beside it — the row still
// belongs to the race's own date, exactly as the calendar pill does.
function SessionTimesCell({ race }) {
  const times = raceSessionTimes(race);
  if (!times.length) return <td style={{ color: "var(--ink-2)" }}>—</td>;
  return (
    <td style={{ whiteSpace: "nowrap" }}>
      <span className="session-times">
        {times.map(s => (
          <span key={s.key} className="session-time" title={sessionTimeLine(s)}>
            <span className="session-time-key" aria-hidden="true">{s.short}</span>
            <span className="sr-only">{s.label}</span>
            {s.time}
            {s.dayOffset !== 0 && <em className="session-time-day"> {s.dateLabel}</em>}
          </span>
        ))}
      </span>
    </td>
  );
}

// The Car cell. Normally one car for the round. At "All Classes" on a season
// whose classes race different machinery, the server sends `class_cars` instead
// — one line per class, so the calendar shows which car goes with which class
// rather than picking one of them arbitrarily.
function CarCell({ summary, classCars }) {
  if (classCars?.length) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {classCars.map(c => (
          <span key={c.class_id} style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}>
            <span className="badge" style={{ marginRight: 6 }}>{c.class_name}</span>
            {c.car || <span style={{ color: "var(--ink-2)" }}>—</span>}
          </span>
        ))}
      </div>
    );
  }
  return summary.car || <span style={{ color: "var(--ink-2)" }}>—</span>;
}

// The Pole / Winner cells. Normally one driver for the round. At "All Classes"
// on a multi-class season, a round several classes run carries
// `class_summaries` — each class has its own pole and winner, so the cell
// stacks one line per class instead of showing one class's driver as if it were
// the round's.
function PersonCell({ summary, classSummaries, field }) {
  if (classSummaries?.length && summary?.has_results) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {classSummaries.map(cs => (
          <span key={cs.class_id} style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}>
            <span className="badge" style={{ marginRight: 6 }}>{cs.class_name}</span>
            <Person p={cs[field]} />
          </span>
        ))}
      </div>
    );
  }
  return <Person p={summary?.[field]} />;
}

// ── Share Graphic helpers ───────────────────────────────────────────────────
// The exporter draws its own table, so the cells that stack per class on screen
// (a round several classes ran has a pole and a winner each) are flattened to
// one line — "Pro: Ana · Am: Bo" — rather than losing all but one class.

function personText(summary, classSummaries, field) {
  if (classSummaries?.length && summary?.has_results) {
    return classSummaries.map(cs => `${cs.class_name}: ${cs[field]?.name || "—"}`).join(" · ");
  }
  return summary?.[field]?.name || "—";
}

// A row's Length as flat text, for the share graphic: a timed event reads
// "45 Min (78 laps)", one run in rounds "6 Rounds (12 laps)", a lap race
// "100 Laps".
function lengthText(summary) {
  if (!summary?.length_label) return "—";
  if (lapsAreSecondary(summary.length_type) && summary.laps) return `${summary.length_label} (${summary.laps} laps)`;
  return summary.length_label;
}

function carText(summary, classCars) {
  if (classCars?.length) return classCars.map(c => `${c.class_name}: ${c.car || "—"}`).join(" · ");
  return summary?.car || "—";
}

export default function SchedulePage() {
  const { seasonId } = useLeague();
  // A concrete season shows that season's full event table (with admin tools);
  // "All Games" / "All Series" show a master feed of recent + upcoming racing.
  return seasonId ? <SeasonSchedule /> : <GlobalSchedule />;
}

// ── Master feed across seasons (no single season selected) ─────────────────

function GlobalSchedule() {
  const { gameId, seriesId, game, series, games, seriesList, setGameId, setSeriesId, setSeasonId, refresh } = useLeague();
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState(null);
  const [showCreateSeason, setShowCreateSeason] = useState(false);

  useEffect(() => {
    const qs = seriesId ? `series_id=${seriesId}` : gameId ? `game_id=${gameId}` : "";
    setRows(null);
    api(`/api/schedule${qs ? `?${qs}` : ""}`).then(setRows).catch(() => setRows([]));
  }, [gameId, seriesId]);

  // Upcoming (soonest first) and Archive (most recent first), split on the
  // CALENDAR rather than on whether anybody entered results — see
  // lib/scheduleFeed.js. A race whose day has passed is history even if its
  // results sheet was never filled in; leaving it in Upcoming is what used to
  // put a two-year-old round at the top of the table.
  const today = useMemo(() => todayDateString(), []);
  const { upcoming, archive } = useMemo(() => splitScheduleFeed(rows || [], today), [rows, today]);

  const scopeLabel = series?.name || game?.name || "All Games";
  // Available at every scope, including "All Games": whatever the scope leaves
  // unnamed — the game, the series, or both — the dialog asks for and creates if
  // it doesn't exist yet. That's what keeps a game with no seasons (or a league
  // with no games) from dead-ending on an empty calendar.
  const canCreateSeason = isAdmin;

  return (
    <section>
      <div className="page-title">
        <h2>Schedule</h2>
        <span className="page-badge">{scopeLabel}</span>
        {canCreateSeason && (
          <div style={{ marginLeft: "auto" }}>
            <button className="btn btn-primary" style={{ marginTop: 0 }}
              title={series?.name || game?.name
                ? `Start a new season in ${series?.name || game?.name}`
                : "Start a new season — you'll pick (or name) the game and series it belongs to"}
              onClick={() => setShowCreateSeason(true)}>
              + New Season
            </button>
          </div>
        )}
      </div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.9rem", maxWidth: 720 }}>
        Racing across every series and season. Pick a specific Season above to manage its events; otherwise
        here&apos;s what&apos;s coming up and what recently ran. Narrow with the Game / Series menus.
        {canCreateSeason && " Starting a fresh season? Use + New Season — you'll land straight on its empty calendar."}
      </p>

      {showCreateSeason && (
        <SeasonCreateModal
          gameId={gameId} games={games}
          seriesId={seriesId} seriesName={series?.name} seriesList={seriesList}
          onClose={() => setShowCreateSeason(false)}
          onCreated={(season, scope) => {
            setShowCreateSeason(false);
            // Pull the new season — and the game/series the dialog made or
            // picked for it — into the league selector, then select it. The page
            // re-renders as that season's own (empty) calendar, ready for its
            // first race.
            refresh();
            if (scope.gameId !== gameId) setGameId(scope.gameId);
            if (scope.seriesId !== seriesId) setSeriesId(scope.seriesId);
            setSeasonId(season.id);
          }}
        />
      )}

      {rows == null ? (
        <div className="skeleton" style={{ height: 240, marginTop: 16 }} />
      ) : upcoming.length === 0 && archive.length === 0 ? (
        <div className="empty-state"><span className="empty-state-icon">📅</span><p>No races scheduled yet in this scope.</p></div>
      ) : (
        <>
          <FeedSection title="Upcoming" icon="🟢" rows={upcoming} kind="upcoming" />
          <FeedSection title="Archive · Recent Results" icon="🏁" rows={archive} kind="archive" />
        </>
      )}
    </section>
  );
}

function FeedSection({ title, icon, rows, kind }) {
  const { league, game, series } = useLeague();
  const [sharing, setSharing] = useState(false);
  if (!rows.length) return null;
  const archive = kind === "archive";

  // Each half of the feed exports on its own — an "Upcoming" graphic and a
  // "Recent Results" one are different posts. The last column follows the table:
  // who won for the archive, what they're driving for what's still to come.
  const shareSpec = [
    { key: "date", label: "Date", locked: true, get: r => fmtDate(r.date) },
    { key: "event", label: "Event", align: "left", locked: true, wrap: true, get: r => r.name },
    { key: "track", label: "Track", align: "left", wrap: true, get: r => r.track || "—" },
    { key: "series", label: "Series · Season", align: "left", wrap: true, get: r => [r.series_name, r.season_name].filter(Boolean).join(" · ") || "—" },
    { key: "game", label: "Game", align: "left", get: r => r.game_name || "—" },
    archive
      ? { key: "winner", label: "Winner", align: "left", wrap: true, get: r => personText(r.summary, r.class_summaries, "winner") }
      : { key: "car", label: "Car", align: "left", wrap: true, get: r => carText(r.summary || {}, r.class_cars) },
  ];
  const shareTable = specToGraphicTable(shareSpec, rows);
  const scopeLabel = series?.name || game?.name || "All Games";
  // Session times are the READER's, so they stay out of the share graphic — an
  // exported image would freeze one person's clock and hand it to everybody.
  const showTimes = anySessionTimes(rows);
  const zoneLabel = showTimes ? localZoneLabel() : "";

  return (
    <div style={{ marginTop: 22 }}>
      <h3 style={{ margin: "0 0 10px", display: "flex", alignItems: "center", gap: 8 }}>
        <span>{icon}</span>{title}
        <span className="page-badge" style={{ marginLeft: 4 }}>{rows.length}</span>
        <ShareGraphicButton onClick={() => setSharing(true)} />
      </h3>
      <ShareGraphicModal
        open={sharing}
        onClose={() => setSharing(false)}
        kind={archive ? "Recent Results" : "Upcoming Races"}
        defaultTitle={`${scopeLabel} — ${archive ? "Recent Results" : "Upcoming Races"}`}
        subtitle={[game?.name, series?.name].filter(Boolean).join(" · ")}
        columns={shareTable.columns}
        rows={shareTable.rows}
        meta={[
          { label: "Scope", value: [game?.name, series?.name].filter(Boolean).join(" · ") || "All Games", wide: true },
          { label: "Events", value: rows.length },
        ]}
        logos={leagueLogos({ league, game, series })}
        leagueName={league?.name ?? ""}
        leagueLogoUrl={league?.logo_url ?? ""}
      />
      <div className="table-wrap">
        <table className="stats-table" style={{ width: "100%", minWidth: 720 }}>
          <thead>
            <tr>
              <th style={{ whiteSpace: "nowrap" }}>Date</th>
              {showTimes && <SessionTimesHeader zoneLabel={zoneLabel} />}
              <th style={{ textAlign: "left" }}>Event / Track</th>
              <th style={{ textAlign: "left" }}>Series · Season</th>
              <th style={{ textAlign: "left" }}>{archive ? "Winner" : "Car"}</th>
              <th>{archive ? "Results" : "Status"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const s = r.summary || {};
              return (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.date)}</td>
                  {showTimes && <SessionTimesCell race={r} />}
                  <td style={{ textAlign: "left" }}>
                    <Link href={`/races/${r.id}`} style={{ color: "var(--accent-cyan)", fontWeight: 600 }}>{r.name}</Link>
                    {r.track && <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.78rem" }}>{r.track}</span>}
                  </td>
                  <td style={{ textAlign: "left", color: "var(--ink-1)", fontSize: "0.82rem" }}>
                    {[r.series_name, r.season_name].filter(Boolean).join(" · ") || "—"}
                    {r.game_name && <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.74rem" }}>{r.game_name}</span>}
                  </td>
                  {/* Same per-class stacking as a season's own calendar: a
                      round several classes ran lists each class's winner (or
                      each class's car, before it runs) rather than picking one
                      of them. */}
                  <td style={{ textAlign: "left", fontWeight: archive && s.winner ? 600 : undefined }}>
                    {archive
                      ? <PersonCell summary={s} classSummaries={r.class_summaries} field="winner" />
                      : <CarCell summary={s} classCars={r.class_cars} />}
                  </td>
                  {/* The archive is "days that have been", so it also holds
                      rounds that ran without anybody entering a sheet — those
                      say TBD rather than offering a results link to nothing,
                      exactly as a season's own table does. An event still to
                      come but with no date yet reads TBA. */}
                  <td>
                    {archive
                      ? (s.has_results
                        ? <Link href={`/races/${r.id}`} title="View race results" style={{ fontSize: "1.1rem" }}>🏁</Link>
                        : <span className="race-status status-completed" style={{ fontSize: "0.7rem" }}
                          title="This event's date has passed — no results entered yet">TBD</span>)
                      : <span className="race-status status-upcoming" style={{ fontSize: "0.7rem" }}
                        title={r.date ? "" : "No date set for this event yet"}>{r.date ? "UPCOMING" : "TBA"}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── One season's full event table (a concrete season is selected) ──────────

function SeasonSchedule() {
  const { seasonId, season, classId, className, classes, raceClass, refresh, league, game, series } = useLeague();
  const { isAdmin } = useAuth();
  const router = useRouter();
  const [races, setRaces] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showCopy, setShowCopy] = useState(false);
  const [toDelete, setToDelete] = useState(null); // race pending delete confirmation
  const [toggleComplete, setToggleComplete] = useState(false); // season completion pending confirmation

  const completed = season?.status === "completed";

  async function confirmToggleComplete() {
    // Mirrors the "Mark Completed" control on League Setup: a completed season
    // credits its champion(s) with a Championship in career/team stats — each
    // class's winner, plus the overall winner when the season runs one.
    // refresh() pulls
    // the updated season back into the league selector so the button re-labels.
    await api(`/api/seasons/${seasonId}`, { method: "PATCH", body: { status: completed ? "active" : "completed" } });
    refresh();
  }

  // With a class selected, the calendar narrows to that class's schedule — the
  // rounds pinned to it plus every shared round.
  const loadRaces = () => {
    if (!seasonId) { setRaces(null); return; }
    const qs = `season_id=${seasonId}${classId ? `&class_id=${classId}&class_name=${encodeURIComponent(className)}` : ""}`;
    api(`/api/schedule?${qs}`).then(setRaces).catch(() => setRaces([]));
  };
  useEffect(loadRaces, [seasonId, classId]);

  async function confirmDelete() {
    // Deleting the event removes its race doc and cascades to every saved
    // result (qualifying + all race/heat/consolation/feature sessions) in the
    // DELETE route; stats/standings recompute from results on read, so they
    // scrub automatically once the results are gone.
    await api(`/api/races/${toDelete.id}`, { method: "DELETE" });
    loadRaces();
  }

  if (!races) return <div className="skeleton" style={{ height: 240 }} />;

  const ordered = [...races].sort((a, b) => (Number(a.round_number) || 0) - (Number(b.round_number) || 0));
  const nextRound = races.reduce((m, r) => Math.max(m, Number(r.round_number) || 0), 0) + 1;
  const perClassSchedules = !!season?.per_class_schedules;
  // Does this event run each class's sessions separately? Resolved per event,
  // falling back to the season default.
  const splitResults = r => racePerClassResults(r, season);
  // The Class column carries two things: which class's calendar a round is on,
  // and whether the round's results are split per class. It's only meaningful
  // while looking at the whole season — inside one class every visible round is
  // either that class's or shared, and its results are already that class's.
  const showClassCol = classes.length > 0 && !classId && (perClassSchedules || ordered.some(splitResults));

  // The calendar as a shareable image: every column the table shows, in the same
  // order, with the round and event locked on since a row is unreadable without
  // them. Rounds that haven't run yet export with em-dashes for pole/winner,
  // which is what makes this useful as a "season ahead" graphic as well as a
  // season-in-review one.
  const shareSpec = [
    { key: "round", label: "Rd", locked: true, get: r => r.round_number ?? "—" },
    { key: "date", label: "Date", get: r => fmtDate(r.date) },
    { key: "event", label: "Event", align: "left", locked: true, wrap: true, get: r => r.name },
    { key: "track", label: "Track", align: "left", wrap: true, get: r => r.track || "—" },
    ...(showClassCol ? [{ key: "class", label: "Class", align: "left", wrap: true, get: r => r.class_name || "All Classes" }] : []),
    // Timed events export as their clock ("45 Min") with the winner's lap count
    // alongside; lap races export as the distance they ran.
    { key: "length", label: "Length", get: r => lengthText(r.summary || {}) },
    { key: "car", label: "Car", align: "left", wrap: true, get: r => carText(r.summary || {}, r.class_cars) },
    { key: "pole", label: "Pole", align: "left", wrap: true, get: r => personText(r.summary, r.class_summaries, "pole") },
    { key: "winner", label: "Winner", align: "left", wrap: true, get: r => personText(r.summary, r.class_summaries, "winner") },
    { key: "drivers", label: "Drivers", get: r => r.summary?.num_drivers || "—" },
  ];
  const shareTable = specToGraphicTable(shareSpec, ordered);
  const scopeName = [season?.name, raceClass?.name].filter(Boolean).join(" · ");
  // As on the cross-season feed: the column appears only when some round in
  // this season actually carries times, and stays out of the share graphic
  // because the times are the reader's own, not the season's.
  const showTimes = anySessionTimes(ordered);
  const zoneLabel = showTimes ? localZoneLabel() : "";

  return (
    <section>
      <div className="page-title">
        <h2>Schedule · {season?.name ?? ""}{raceClass ? ` · ${raceClass.name}` : ""}</h2>
        <span className="page-badge">{races.length} Event{races.length === 1 ? "" : "s"}</span>
        {perClassSchedules && raceClass && (
          <span className="page-badge" title={`${raceClass.name} rounds plus every shared round`}>
            {raceClass.name} Calendar
          </span>
        )}
        {raceClass && (
          <span className="page-badge" title={`Pole, winner and field size are ${raceClass.name}'s own, on every event that runs its classes separately`}>
            {raceClass.name} Results
          </span>
        )}
        {races.length > 0 && <ShareGraphicButton onClick={() => setSharing(true)} />}
        {isAdmin && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <button
              className="btn btn-ghost"
              style={{ marginTop: 0 }}
              title={completed
                ? "This season is complete: its champion holds a Title, and it's closed to sign-ups and car changes. Click to reopen it."
                : "Mark this season complete — its champion(s) earn a Championship in career stats, and it closes to player sign-ups and car lock-ins."}
              onClick={() => setToggleComplete(true)}>
              {completed ? "✓ Season Complete" : "Mark Season Complete"}
            </button>
            {/* Copy an event (and its results) between seasons — either
                direction, any series. Sits beside + New Race because it's the
                other way a round joins a calendar. */}
            <button
              className="btn btn-ghost"
              style={{ marginTop: 0 }}
              title="Copy a race — and the results it scored — from one season into another, in this series or a different one"
              onClick={() => setShowCopy(true)}>
              ⧉ Copy Race
            </button>
            <button className="btn btn-primary" style={{ marginTop: 0 }} onClick={() => setShowCreate(true)}>
              + New Race
            </button>
          </div>
        )}
      </div>

      <ShareGraphicModal
        open={sharing}
        onClose={() => setSharing(false)}
        kind="Schedule"
        defaultTitle={`${scopeName || "Season"} Schedule`}
        subtitle={[game?.name, series?.name, raceClass?.name].filter(Boolean).join(" · ")}
        columns={shareTable.columns}
        rows={shareTable.rows}
        meta={[
          { label: "Series", value: [game?.name, series?.name].filter(Boolean).join(" · "), wide: true },
          { label: "Season", value: season?.name },
          { label: "Class", value: raceClass?.name },
          { label: "Events", value: races.length },
        ]}
        logos={leagueLogos({ league, game, series, season })}
        leagueName={league?.name ?? ""}
        leagueLogoUrl={league?.logo_url ?? ""}
      />

      {isAdmin && (
        <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.85rem" }}>
          Every event is managed from this table: <strong>⏱</strong> opens its results grid (qualifying,
          races, heats and points), <strong>✎</strong> edits the event itself — name, date, track, sessions
          and heat racing — and <strong>🗑</strong> deletes it. <strong>⧉ Copy Race</strong> above brings an
          event and its results across from another season, in this series or a different one.
        </p>
      )}

      {isAdmin && toggleComplete && (
        <ConfirmDialog
          title={completed ? "Reopen this season?" : "Mark season complete?"}
          message={completed
            ? `Reopen "${season?.name}"? It will no longer count as a finished season, and its champion's Title will be removed until you mark it complete again. Players will be able to sign up for it and change their locked-in car again.`
            : `Mark "${season?.name}" complete? This closes out the season and credits its champion(s) with a Championship in their career and team stats — ${
                classes.length
                  ? `each class's points leader${season?.combined_championship === false ? " (this season awards no overall title)" : ", plus the overall points leader"}`
                  : "the points leader"
              }. It also closes the season to players: nobody else can sign up for it, and nobody can change the car they locked in. Their Dashboard reads "Season over — sign-ups are done". Nothing is deleted, and reopening it undoes all of that.`}
          confirmLabel={completed ? "Reopen season" : "Mark complete"}
          onConfirm={confirmToggleComplete}
          onClose={() => setToggleComplete(false)}
        />
      )}

      {showCreate && (
        <RaceCreateModal
          seasonId={seasonId}
          defaultRound={nextRound}
          classes={classes}
          perClassSchedules={perClassSchedules}
          defaultClassId={classId}
          perClassResults={!!season?.per_class_results}
          // A heat-racing season starts each new round in heat format.
          heatFormat={!!season?.heat_format}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadRaces(); }}
        />
      )}

      {isAdmin && showCopy && (
        <RaceCopyModal
          seasonId={seasonId}
          onClose={() => { setShowCopy(false); loadRaces(); }}
          // A copy INTO the season being viewed lands on this calendar, so
          // reload it as soon as the copy reports back rather than waiting for
          // the dialog to be dismissed.
          onCopied={() => loadRaces()}
        />
      )}

      {isAdmin && toDelete && (
        <ConfirmDialog
          title="Delete this event?"
          message={`Are you sure you want to delete "${toDelete.name}"? This removes the event and all associated qualifying, heat, main, and race results — and the points and stats those results gave every driver. This cannot be undone.`}
          confirmLabel="Delete event"
          onConfirm={confirmDelete}
          onClose={() => setToDelete(null)}
        />
      )}

      {races.length === 0 ? (
        <div className="empty-state"><span className="empty-state-icon">📅</span><p>No races scheduled yet.</p></div>
      ) : (
        <div className="table-wrap">
          <table className="stats-table schedule-table">
            <thead>
              <tr>
                <th>Race</th>
                <th>Race Date</th>
                {showTimes && <SessionTimesHeader zoneLabel={zoneLabel} />}
                <th className="sticky-col" style={{ textAlign: "left" }}>Event / Track</th>
                {showClassCol && <th style={{ textAlign: "left" }}>Class</th>}
                <th>Race Length</th>
                <th style={{ textAlign: "left" }}>Car</th>
                <th style={{ textAlign: "left" }}>Pole</th>
                <th style={{ textAlign: "left" }}>Winner</th>
                <th>Num Drivers</th>
                <th>Results</th>
                {isAdmin && <th>Admin</th>}
              </tr>
            </thead>
            <tbody>
              {ordered.map(r => {
                const s = r.summary || {};
                const done = isPastRaceDate(r.date);
                return (
                  <tr key={r.id}>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.round_number ?? "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.date)}</td>
                    {showTimes && <SessionTimesCell race={r} />}
                    <td className="sticky-col" style={{ textAlign: "left" }}>
                      <Link href={`/races/${r.id}`} style={{ color: "var(--accent-cyan)", fontWeight: 600 }}>{r.name}</Link>
                      {r.track && <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.78rem" }}>{r.track}</span>}
                    </td>
                    {showClassCol && (
                      <td style={{ textAlign: "left" }}>
                        {r.class_name
                          ? <span className="badge">{r.class_name}</span>
                          : <span style={{ color: "var(--ink-2)", fontSize: "0.8rem" }}>All Classes</span>}
                        {splitResults(r) && (
                          <span style={{ display: "block", color: "var(--accent-cyan)", fontSize: "0.72rem" }}
                            title="Each class runs its own qualifying and race at this event">
                            separate results
                          </span>
                        )}
                      </td>
                    )}
                    <td style={{ whiteSpace: "nowrap" }}>
                      {s.length_label || "—"}
                      {lapsAreSecondary(s.length_type) && !!s.laps && (
                        <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.72rem" }}
                          title="Laps the winner completed">{s.laps} laps</span>
                      )}
                      {s.laps_extended && (
                        <span title={`Scheduled ${s.scheduled_laps} laps — extended by a green-white-checkered / overtime finish`}
                          style={{ marginLeft: 5, fontSize: "0.7rem", color: "var(--accent-cyan)", fontWeight: 700 }}>GWC</span>
                      )}
                    </td>
                    <td style={{ textAlign: "left" }}><CarCell summary={s} classCars={r.class_cars} /></td>
                    <td style={{ textAlign: "left" }}><PersonCell summary={s} classSummaries={r.class_summaries} field="pole" /></td>
                    <td style={{ textAlign: "left", fontWeight: s.winner ? 600 : undefined }}><PersonCell summary={s} classSummaries={r.class_summaries} field="winner" /></td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{s.num_drivers || "—"}</td>
                    <td>
                      {s.has_results
                        ? <Link href={`/races/${r.id}`} title="View race results" style={{ fontSize: "1.1rem" }}>🏁</Link>
                        : <span className={`race-status ${done ? "status-completed" : "status-upcoming"}`} style={{ fontSize: "0.7rem" }}>{done ? "TBD" : "UPCOMING"}</span>}
                    </td>
                    {isAdmin && (
                      <td style={{ whiteSpace: "nowrap" }}>
                        {/* Results entry lives on the event's own edit screen —
                            this jumps straight to the right grid (the Feature
                            on a heat-racing event, the Race otherwise), which
                            is what the old Race Entry menu did. */}
                        <button className="icon-btn" title="Enter / edit results"
                          onClick={() => router.push(`/races/${r.id}/edit?tab=${r.heat_format ? "feature" : "results"}`)}>⏱</button>
                        <button className="icon-btn" title="Edit race details" onClick={() => router.push(`/races/${r.id}/edit`)}>✎</button>
                        <button className="icon-btn icon-btn-danger" title="Delete race" onClick={() => setToDelete(r)}>🗑</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
