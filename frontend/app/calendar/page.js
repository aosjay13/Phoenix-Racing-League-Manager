"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { api } from "@/lib/api";
import { todayDateString } from "@/lib/raceDate";
import {
  WEEKDAYS, buildMonthGrid, calendarScopeQuery, eventPillLabel, eventTitle,
  groupRacesByDate, initialMonth, monthLabel, monthsWithRaces, seriesAbbrev,
  shiftMonth,
} from "@/lib/calendar";

// The league's whole year on one screen: every event in the league, past and
// future, plotted on the day it runs. The Schedule answers "what's next and what
// just happened"; this answers "what does June look like".
//
// It reads the same master feed the Schedule's "All Games" view does
// (/api/schedule with no season_id), so an event appears here the moment it's
// created and carries the same series/season context — no second source of
// truth for what's on the calendar. Clicking any event goes to that race's own
// page, which is the results screen once it has run.

export default function CalendarPage() {
  const { gameId, seriesId, game, series } = useLeague();
  const [rows, setRows] = useState(null);
  const today = useMemo(() => todayDateString(), []);
  const [view, setView] = useState(() => {
    const [y, m] = todayDateString().split("-").map(Number);
    return { year: y, month: m - 1 };
  });
  // Once the reader has moved the calendar themselves, loading a new scope must
  // not yank them back to wherever the races happen to be.
  const moved = useRef(false);
  // Which fetch is the current one. A scope change can fire two requests in
  // quick succession (the tiers settle one at a time — see calendarScopeQuery),
  // and the first can answer last; without this, a narrower earlier response
  // could overwrite the wide "every game" one and leave the calendar showing a
  // single game's races under an "All Games" heading.
  const fetchSeq = useRef(0);

  useEffect(() => {
    const qs = calendarScopeQuery({ gameId, seriesId });
    const seq = ++fetchSeq.current;
    setRows(null);
    api(`/api/schedule${qs ? `?${qs}` : ""}`)
      .then(data => { if (seq === fetchSeq.current) setRows(data); })
      .catch(() => { if (seq === fetchSeq.current) setRows([]); });
  }, [gameId, seriesId]);

  // Open on the month with racing in it — this one if it has any, else the next
  // that does. A league between seasons shouldn't land on an empty grid.
  useEffect(() => {
    if (!rows || moved.current) return;
    setView(initialMonth(rows, today));
  }, [rows, today]);

  const { byDate, undated } = useMemo(() => groupRacesByDate(rows || []), [rows]);
  const months = useMemo(() => monthsWithRaces(rows || []), [rows]);
  const cells = useMemo(() => buildMonthGrid(view.year, view.month, today), [view, today]);
  const monthCount = cells.reduce(
    (n, c) => n + (c.inMonth ? (byDate[c.iso]?.length || 0) : 0), 0);

  const go = delta => { moved.current = true; setView(v => shiftMonth(v.year, v.month, delta)); };
  const jump = (year, month) => { moved.current = true; setView({ year, month }); };

  // The heading follows the same rule the fetch does, so it can never claim a
  // scope the grid isn't showing: with no game selected this is the whole
  // league, whatever a half-settled series selection still says.
  const allGames = !gameId;
  const scopeLabel = allGames ? "All Games" : (series?.name || game?.name || "All Games");

  return (
    <section>
      <div className="page-title">
        <h2>Calendar</h2>
        <span className="page-badge">{scopeLabel}</span>
        {rows && <span className="page-badge">{rows.length} Event{rows.length === 1 ? "" : "s"}</span>}
      </div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.9rem", maxWidth: 760 }}>
        {allGames
          ? <>Every upcoming race in the league — <strong>every game</strong>, every series — month by
              month, alongside what has already run. Pick a Game below to narrow it.</>
          : <>Every race in this scope, month by month — what has run and what is still to come. Set
              Game back to &ldquo;All Games&rdquo; for the whole league.</>}
        {" "}Click any event to open its race page.
      </p>

      <CalendarFilters />

      <div className="calendar-toolbar">
        <div className="calendar-nav">
          <button className="icon-btn" title="Previous month" aria-label="Previous month"
            onClick={() => go(-1)}>‹</button>
          <span className="calendar-month">{monthLabel(view.year, view.month)}</span>
          <button className="icon-btn" title="Next month" aria-label="Next month"
            onClick={() => go(1)}>›</button>
          <button className="btn btn-ghost calendar-today-btn" onClick={() => {
            const [y, m] = today.split("-").map(Number);
            jump(y, m - 1);
          }}>Today</button>
        </div>
        <span className="calendar-count">
          {monthCount === 0 ? "No events this month" : `${monthCount} event${monthCount === 1 ? "" : "s"} this month`}
        </span>
      </div>

      {months.length > 0 && <MonthJumper months={months} view={view} onPick={jump} />}

      {rows == null ? (
        <div className="skeleton" style={{ height: 460, marginTop: 16 }} />
      ) : (
        <>
          <MonthGrid cells={cells} byDate={byDate} />
          <UndatedEvents rows={undated} />
          {rows.length === 0 && (
            <div className="empty-state">
              <span className="empty-state-icon">📅</span>
              <p>
                {allGames
                  ? "No races scheduled yet — in any game in this league."
                  : "No races scheduled yet in this scope. Set Game to “All Games” to see the whole league."}
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// The standard Game ▸ Series pair, bound to the same league selection the rest
// of the app uses — so narrowing the calendar to a series narrows the Standings
// and the Schedule to it too, and a link copied from here opens on the same
// scope. Series stays disabled until a game is picked, exactly as in the topbar.
function CalendarFilters() {
  const { games, seriesList, gameId, seriesId, setGameId, setSeriesId } = useLeague();
  return (
    <div className="context-bar calendar-filters">
      <div className="context-select">
        <label htmlFor="calendar_game">Game</label>
        <select id="calendar_game" value={gameId || ""} onChange={e => setGameId(e.target.value)}>
          <option value="">{games.length ? "All Games" : "No games yet"}</option>
          {games.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>
      <div className="context-select">
        <label htmlFor="calendar_series">Series</label>
        <select id="calendar_series" value={seriesId || ""} disabled={!gameId}
          onChange={e => setSeriesId(e.target.value)}>
          <option value="">{gameId ? "All Series" : "— Pick a game first —"}</option>
          {seriesList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <span className="calendar-filter-hint">
        {gameId
          ? "Set Game back to “All Games” for every game in the league."
          : "Showing every game in the league. Pick a game to narrow it."}
      </span>
    </div>
  );
}

// Shortcut row to the months that actually have racing in them, so a reader
// never has to click ‹ twelve times to find the season they're after.
function MonthJumper({ months, view, onPick }) {
  return (
    <div className="calendar-jumper">
      <span className="calendar-jumper-label">Jump to</span>
      {months.map(m => {
        const active = m.year === view.year && m.month === view.month;
        return (
          <button key={m.key} type="button"
            className={`calendar-jump-chip${active ? " active" : ""}`}
            title={`${monthLabel(m.year, m.month)} — ${m.count} event${m.count === 1 ? "" : "s"}`}
            onClick={() => onPick(m.year, m.month)}>
            {monthLabel(m.year, m.month)}
            <span className="calendar-jump-count">{m.count}</span>
          </button>
        );
      })}
    </div>
  );
}

function MonthGrid({ cells, byDate }) {
  return (
    <div className="calendar-wrap">
      <div className="calendar-grid" role="grid" aria-label="Race calendar">
        {WEEKDAYS.map(d => (
          <div key={d} className="calendar-weekday" role="columnheader">
            <span className="calendar-weekday-long">{d}</span>
            <span className="calendar-weekday-short">{d[0]}</span>
          </div>
        ))}
        {cells.map(cell => (
          <div key={cell.iso} role="gridcell"
            className={`calendar-cell${cell.inMonth ? "" : " is-outside"}${cell.isToday ? " is-today" : ""}${cell.isWeekend ? " is-weekend" : ""}`}>
            <span className="calendar-daynum">{cell.day}</span>
            <div className="calendar-events">
              {(byDate[cell.iso] || []).map(race => <EventPill key={race.id} race={race} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// One race on the grid: the series it belongs to, abbreviated so it fits, and
// the track it's run at. A finished event carries the chequered flag and reads
// as history; one still to come reads as live.
function EventPill({ race }) {
  const done = !!race.summary?.has_results;
  const abbrev = seriesAbbrev(race.series_name);
  return (
    <Link href={`/races/${race.id}`}
      className={`calendar-event${done ? " is-done" : ""}`}
      title={`${eventTitle(race)}${done ? " — results available" : ""}`}>
      {abbrev && (
        <span className="calendar-event-series" title={race.series_name || ""}>{abbrev}</span>
      )}
      <span className="calendar-event-track">{eventPillLabel(race)}</span>
      {done && <span className="calendar-event-flag" aria-hidden="true">🏁</span>}
    </Link>
  );
}

// Races an admin has created but not dated yet. They belong to no square on the
// grid, so they'd silently vanish from a calendar-only view — listed here
// instead, and they disappear the moment a date is set.
function UndatedEvents({ rows }) {
  if (!rows.length) return null;
  return (
    <div className="calendar-undated">
      <h3>Date to be announced</h3>
      <p>These events have no date set yet, so they aren&rsquo;t on the grid above.</p>
      <div className="calendar-undated-list">
        {rows.map(r => (
          <Link key={r.id} href={`/races/${r.id}`} className="calendar-event" title={eventTitle(r)}>
            {seriesAbbrev(r.series_name) && (
              <span className="calendar-event-series">{seriesAbbrev(r.series_name)}</span>
            )}
            <span className="calendar-event-track">{r.name}{r.track ? ` · ${r.track}` : ""}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
