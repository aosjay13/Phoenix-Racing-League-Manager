"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { api } from "@/lib/api";
import { todayDateString } from "@/lib/raceDate";
import {
  WEEKDAYS, buildMonthGrid, calendarFeedPath, calendarScopeQuery, eventPillLabel,
  eventTitle, groupRacesByDate, initialMonth, monthLabel, monthsWithRaces,
  seriesAbbrev, shiftMonth,
} from "@/lib/calendar";
import { getActiveLeagueId } from "@/lib/leagueClient";
import { hasSessionTimes, localZoneLabel, raceSessionTimes, sessionTimeLine } from "@/lib/raceTimes";

// The league's whole year on one screen: every event in the league, past and
// future, plotted on the day it runs. The Schedule answers "what's next and what
// just happened"; this answers "what does June look like".
//
// It reads the same master feed the Schedule's "All Games" view does
// (/api/schedule with no season_id), so an event appears here the moment it's
// created and carries the same series/season context — no second source of
// truth for what's on the calendar. Clicking any event goes to that race's own
// page, which is the results screen once it has run.
//
// This is also the ONLY screen that reads a race's session times. An admin can
// opt an event into showing when Practice, Qualifying and the Race start (Race
// Info → Calendar Session Times); every reader sees those times converted into
// their own timezone, here and nowhere else. See lib/raceTimes.js.

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
  // Whether anything on screen quotes a clock at all — the note below the
  // toolbar only earns its line when some event actually carries times.
  const anyTimes = useMemo(() => (rows || []).some(hasSessionTimes), [rows]);
  const zoneLabel = useMemo(() => (anyTimes ? localZoneLabel() : ""), [anyTimes]);
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

      <SubscribeFeed gameId={gameId} seriesId={seriesId} scopeLabel={scopeLabel} />

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

      {/* Session times are converted in the reader's browser, from the reader's
          own clock — so say whose clock it is rather than leaving them to guess
          whether "7:00 PM" is theirs or the league's. */}
      {anyTimes && (
        <p className="calendar-tz-note">
          <span aria-hidden="true">🕒</span> Session times are shown in{" "}
          <strong>your local time{zoneLabel ? ` (${zoneLabel})` : ""}</strong> —{" "}
          <span className="calendar-tz-key">P</span> Practice ·{" "}
          <span className="calendar-tz-key">Q</span> Qualifying ·{" "}
          <span className="calendar-tz-key">R</span> Race. A date beside a time means
          it falls on that day where you are.
        </p>
      )}

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

// Subscribing this calendar into a real one — Google, Apple, Outlook.
//
// The feed (/api/calendar.ics) is a live URL, not a download: whoever subscribes
// keeps getting new rounds, moved dates and published session times without ever
// coming back here. It covers whatever scope is on screen, because the URL is
// built from the same rule the grid's fetch is (see calendarFeedPath).
//
// The address is only knowable in the browser — it depends on where this
// deployment is served from and on which league is active — so it's assembled
// after mount rather than rendered on the server.
function SubscribeFeed({ gameId, seriesId, scopeLabel }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const path = calendarFeedPath({ gameId, seriesId, leagueId: getActiveLeagueId() });
    setUrl(`${window.location.origin}${path}`);
    setCopied(false);
  }, [gameId, seriesId]);

  // webcal:// is the same URL under the scheme calendar apps register for, so
  // one click hands it to the desktop client instead of showing a wall of text
  // in a browser tab. Google's "add by URL" screen takes it as a parameter.
  const webcal = url.replace(/^https?:/, "webcal:");
  const googleUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard blocked (insecure context, or the browser said no) — the
      // field is selectable, which is the fallback that always works.
      document.getElementById("calendar_feed_url")?.select();
    }
  }

  return (
    <div className="calendar-subscribe">
      <button type="button" className="btn btn-ghost calendar-subscribe-btn"
        aria-expanded={open}
        title="Subscribe to this calendar in Google Calendar, Apple Calendar or Outlook"
        onClick={() => setOpen(o => !o)}>
        📆 Subscribe{open ? " ▾" : " ▸"}
      </button>
      {open && (
        <div className="calendar-subscribe-panel">
          <p>
            Add <strong>{scopeLabel}</strong> to your own calendar. It stays in sync on its own —
            new rounds, changed dates and session times all follow, and every session lands at the
            right time for wherever you are.
          </p>
          <div className="calendar-subscribe-row">
            <input id="calendar_feed_url" readOnly value={url}
              onFocus={e => e.target.select()} aria-label="Calendar feed address" />
            <button type="button" className="btn btn-primary" style={{ marginTop: 0 }} onClick={copy}>
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <div className="calendar-subscribe-links">
            <a href={googleUrl} target="_blank" rel="noopener noreferrer">Add to Google Calendar →</a>
            <a href={webcal}>Open in Apple Calendar / Outlook →</a>
          </div>
          <p className="calendar-subscribe-help">
            In Google Calendar you can also paste the address by hand:{" "}
            <strong>Other calendars ＋ → From URL</strong>. Google refreshes subscribed calendars on
            its own schedule, so a brand-new race can take a few hours to appear there.
          </p>
        </div>
      )}
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
//
// An event the admin has given session times to grows a second line — P / Q / R
// with each start in the READER's timezone. The times are rendered on the pill
// rather than only in its tooltip because a tooltip doesn't exist on a phone,
// which is where most people check what time they're racing.
//
// The pill never leaves the square for the race's own date. A US evening race
// is tomorrow morning in Europe, and moving it would put an event on a day the
// league never scheduled (and break the one invariant the calendar is tested
// on) — so the shifted day is shown next to the time instead.
function EventPill({ race }) {
  const done = !!race.summary?.has_results;
  const abbrev = seriesAbbrev(race.series_name);
  const times = raceSessionTimes(race);
  const title = [
    `${eventTitle(race)}${done ? " — results available" : ""}`,
    ...times.map(sessionTimeLine),
  ].join("\n");
  return (
    <Link href={`/races/${race.id}`}
      className={`calendar-event${done ? " is-done" : ""}${times.length ? " has-times" : ""}`}
      title={title}>
      <span className="calendar-event-main">
        {abbrev && (
          <span className="calendar-event-series" title={race.series_name || ""}>{abbrev}</span>
        )}
        <span className="calendar-event-track">{eventPillLabel(race)}</span>
        {done && <span className="calendar-event-flag" aria-hidden="true">🏁</span>}
      </span>
      {times.length > 0 && <SessionTimes times={times} />}
    </Link>
  );
}

// The P / Q / R line under a pill. The one-letter tag is what makes three
// sessions fit in a calendar square; the full session name rides along on each
// one for anyone reading with a screen reader or hovering it.
function SessionTimes({ times }) {
  return (
    <span className="calendar-event-times">
      {times.map(s => (
        <span key={s.key} className="calendar-event-time" title={sessionTimeLine(s)}>
          <span className="calendar-event-time-key" aria-hidden="true">{s.short}</span>
          <span className="sr-only">{s.label}</span>
          {s.time}
          {s.dayOffset !== 0 && <em className="calendar-event-time-day"> {s.dateLabel}</em>}
        </span>
      ))}
    </span>
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
