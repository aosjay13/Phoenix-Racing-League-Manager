// Session times on the calendar. The invariants that matter:
//
//   1. an event still lands on the square for the date the admin typed — the
//      times are decoration on that square, never a reason to move it;
//   2. a time entered in the league's zone is the SAME INSTANT for everybody,
//      so a reader converts it to their own clock and gets the real start;
//   3. that stays true across a daylight-saving change, because the offset is
//      resolved for the race's own date rather than for today;
//   4. an event that hasn't opted in produces nothing at all, so every calendar
//      that existed before this feature renders exactly as it did.
import assert from "node:assert";
import {
  cleanSessionTimes, hasSessionTimes, normalizeClockTime, raceSessionTimes,
  sessionTimeLine, sessionTimesBody, sessionTimesForm, zonedWallTimeToInstant,
  zoneOffsetMs,
} from "../raceTimes.js";

let n = 0;
const check = (label, got, want) => {
  n++;
  assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// ── 1. A clock time is "HH:MM", or it is nothing ──────────────────────────
check("a plain time", normalizeClockTime("19:00"), "19:00");
check("a single-digit hour is padded", normalizeClockTime("9:05"), "09:05");
check("seconds are dropped", normalizeClockTime("19:00:30"), "19:00");
check("midnight", normalizeClockTime("00:00"), "00:00");
check("an impossible hour", normalizeClockTime("24:00"), "");
check("an impossible minute", normalizeClockTime("19:60"), "");
check("free text", normalizeClockTime("7pm"), "");
check("nothing in, nothing out", normalizeClockTime(""), "");
check("null", normalizeClockTime(null), "");

// ── 2. Only the three known sessions are stored, cleaned ──────────────────
check("the three sessions", cleanSessionTimes({ practice: "18:00", qualifying: "18:30", race: "19:00" }),
  { practice: "18:00", qualifying: "18:30", race: "19:00" });
check("a blank session is dropped, not stored empty",
  cleanSessionTimes({ practice: "", qualifying: "18:30", race: "19:00" }),
  { qualifying: "18:30", race: "19:00" });
check("junk keys don't survive", cleanSessionTimes({ race: "19:00", warmup: "17:00" }), { race: "19:00" });
check("junk values don't survive", cleanSessionTimes({ race: "later" }), {});
check("a JSON string is read", cleanSessionTimes('{"race":"19:00"}'), { race: "19:00" });
check("nothing at all", cleanSessionTimes(null), {});

// ── 3. A wall-clock time in a zone is one real instant ────────────────────
// 19:00 on 15 August 2026 in New York is EDT (UTC-4) → 23:00 UTC.
check("summer, eastern US",
  zonedWallTimeToInstant("2026-08-15", "19:00", "America/New_York"),
  Date.UTC(2026, 7, 15, 23, 0));
// The SAME wall-clock time in January is EST (UTC-5) → 00:00 UTC the next day.
// This is the one that would be wrong if the offset were read off "now".
check("winter, eastern US — the offset moved with the date",
  zonedWallTimeToInstant("2026-01-15", "19:00", "America/New_York"),
  Date.UTC(2026, 0, 16, 0, 0));
// A zone that doesn't observe DST at all.
check("Phoenix never changes",
  zonedWallTimeToInstant("2026-08-15", "19:00", "America/Phoenix"),
  Date.UTC(2026, 7, 16, 2, 0));
check("UTC is itself", zonedWallTimeToInstant("2026-08-15", "19:00", "UTC"), Date.UTC(2026, 7, 15, 19, 0));
// Southern hemisphere: Sydney is UTC+10 in August (their winter).
check("Sydney, ahead of UTC",
  zonedWallTimeToInstant("2026-08-15", "19:00", "Australia/Sydney"),
  Date.UTC(2026, 7, 15, 9, 0));
check("no zone, no instant", zonedWallTimeToInstant("2026-08-15", "19:00", ""), null);
check("a zone the runtime doesn't know", zonedWallTimeToInstant("2026-08-15", "19:00", "Mars/Olympus"), null);
check("no date, no instant", zonedWallTimeToInstant("", "19:00", "UTC"), null);
check("no time, no instant", zonedWallTimeToInstant("2026-08-15", "", "UTC"), null);

check("offset at an instant", zoneOffsetMs(Date.UTC(2026, 7, 15, 23, 0), "America/New_York"), -4 * 3600000);
check("offset in winter", zoneOffsetMs(Date.UTC(2026, 0, 16, 0, 0), "America/New_York"), -5 * 3600000);
check("offset of a zone that doesn't exist", zoneOffsetMs(Date.now(), "Nowhere/Nothing"), null);

// A time inside the hour a spring-forward skips never happens on that league's
// clock at all. It still has to resolve to SOMETHING a reader can be shown, so
// it settles on the neighbouring real instant (the same clock reading one hour
// before the jump) rather than throwing or drifting a day.
{
  // 2026-03-08 02:30 doesn't exist in New York — 02:00 EST becomes 03:00 EDT.
  const ts = zonedWallTimeToInstant("2026-03-08", "02:30", "America/New_York");
  check("a skipped hour still resolves to a real instant", typeof ts, "number");
  check("...to the hour beside the jump", ts, Date.UTC(2026, 2, 8, 6, 30));
  check("...on the right day, which is the part that matters",
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", dateStyle: "short" })
      .format(new Date(ts)), "2026-03-08");
}

// ── 4. Opting in is what turns any of this on ─────────────────────────────
const RACE = {
  show_session_times: true, date: "2026-08-15", session_timezone: "America/New_York",
  session_times: { practice: "18:00", qualifying: "18:30", race: "19:00" },
};
check("an opted-in, dated, timed race shows times", hasSessionTimes(RACE), true);
check("the toggle off shows nothing", hasSessionTimes({ ...RACE, show_session_times: false }), false);
check("an undated race shows nothing", hasSessionTimes({ ...RACE, date: "" }), false);
check("no times set shows nothing", hasSessionTimes({ ...RACE, session_times: {} }), false);
check("a race from before this feature shows nothing",
  hasSessionTimes({ date: "2026-08-15", name: "Round 4" }), false);
check("nothing at all", hasSessionTimes(null), false);
check("an opted-out race renders no session rows",
  raceSessionTimes({ ...RACE, show_session_times: false }), []);

// ── 5. Every reader gets the same instant on their own clock ──────────────
// The same race, read from four places. The wall-clock answers differ; the
// instant behind them does not.
{
  const inZone = tz => raceSessionTimes(RACE, { timeZone: tz, locale: "en-US" });

  const ny = inZone("America/New_York");
  check("New York sees the three sessions", ny.map(s => s.key), ["practice", "qualifying", "race"]);
  check("New York sees the times as typed", ny.map(s => s.time), ["6:00 PM", "6:30 PM", "7:00 PM"]);
  check("...on the race's own day", ny.map(s => s.dayOffset), [0, 0, 0]);
  check("...so no day label is shown", ny.map(s => s.dateLabel), ["", "", ""]);
  check("...and they are real conversions", ny.every(s => s.converted), true);

  const la = inZone("America/Los_Angeles");
  check("Los Angeles is three hours earlier", la.map(s => s.time), ["3:00 PM", "3:30 PM", "4:00 PM"]);
  check("...still on the race's own day", la.map(s => s.dayOffset), [0, 0, 0]);

  // The load-bearing one: a US evening race is the next MORNING in Europe. The
  // pill stays in the square for the 15th — the day its league scheduled — and
  // says the 16th beside the time instead.
  const london = inZone("Europe/London");
  check("London sees the next morning", london.map(s => s.time), ["11:00 PM", "11:30 PM", "12:00 AM"]);
  check("...and only the session that crosses midnight is marked", london.map(s => s.dayOffset), [0, 0, 1]);
  check("...with the day it lands on", london[2].dateLabel, "Aug 16");

  const sydney = inZone("Australia/Sydney");
  check("Sydney sees it the following afternoon", sydney.map(s => s.time), ["8:00 AM", "8:30 AM", "9:00 AM"]);
  check("...a whole day later", sydney.map(s => s.dayOffset), [1, 1, 1]);
}

// A reader WEST of a race scheduled early in the morning sees the day before.
{
  const early = { ...RACE, date: "2026-08-15", session_timezone: "Europe/London", session_times: { race: "08:00" } };
  const la = raceSessionTimes(early, { timeZone: "America/Los_Angeles", locale: "en-US" });
  check("a European morning race is midnight in California", la[0].time, "12:00 AM");
  check("...still the race's own day, just", la[0].dayOffset, 0);
  const honolulu = raceSessionTimes(early, { timeZone: "Pacific/Honolulu", locale: "en-US" });
  check("...and the evening BEFORE further west", honolulu[0].time, "9:00 PM");
  check("...genuinely the 14th there", honolulu[0].dayOffset, -1);
  check("...with that day named", honolulu[0].dateLabel, "Aug 14");
}

// Sessions render in running order, whatever order they were stored in, and a
// weekend with no practice simply omits it.
{
  const noPractice = raceSessionTimes(
    { ...RACE, session_times: { race: "19:00", qualifying: "18:30" } },
    { timeZone: "America/New_York", locale: "en-US" });
  check("no practice, no practice row", noPractice.map(s => s.key), ["qualifying", "race"]);
  check("running order, not stored order", noPractice.map(s => s.time), ["6:30 PM", "7:00 PM"]);
}

// A race whose zone never got saved is shown VERBATIM rather than silently
// relabelled as the reader's own time.
{
  const zoneless = raceSessionTimes({ ...RACE, session_timezone: "" }, { timeZone: "Europe/London", locale: "en-US" });
  check("no zone: the times are shown as typed", zoneless.map(s => s.time), ["18:00", "18:30", "19:00"]);
  check("...and not claimed as converted", zoneless.every(s => s.converted), false);
}

// ── 6. A session reads as a line of text ─────────────────────────────────
check("a session line", sessionTimeLine({ label: "Qualifying", time: "6:30 PM", dayOffset: 0, dateLabel: "" }),
  "Qualifying · 6:30 PM");
check("a session that lands on another day says so",
  sessionTimeLine({ label: "Race", time: "12:00 AM", dayOffset: 1, dateLabel: "Aug 16" }),
  "Race · 12:00 AM (Aug 16)");

// ── 7. The admin form round-trips ────────────────────────────────────────
check("a race → the form's three fields", sessionTimesForm(RACE),
  { practice_time: "18:00", qualifying_time: "18:30", race_time: "19:00" });
check("a race with none of them", sessionTimesForm({ id: "r1" }),
  { practice_time: "", qualifying_time: "", race_time: "" });
check("the form → what is saved",
  sessionTimesBody({
    show_session_times: true, session_timezone: "America/New_York",
    practice_time: "18:00", qualifying_time: "18:30", race_time: "19:00",
  }),
  {
    show_session_times: true, session_timezone: "America/New_York",
    session_times: { practice: "18:00", qualifying: "18:30", race: "19:00" },
  });
// Switching the display off keeps what was typed, so turning it back on next
// week doesn't mean entering the weekend's schedule again.
check("the toggle off keeps the times",
  sessionTimesBody({
    show_session_times: false, session_timezone: "America/New_York", race_time: "19:00",
  }),
  {
    show_session_times: false, session_timezone: "America/New_York",
    session_times: { race: "19:00" },
  });
check("an empty form saves an empty schedule",
  sessionTimesBody({}),
  { show_session_times: false, session_timezone: "", session_times: {} });

// ── 8. What is saved is what comes back ──────────────────────────────────
// A full round trip through the pair the admin form uses, ending on the
// calendar — the whole path a time actually travels.
{
  const saved = sessionTimesBody({
    show_session_times: true, session_timezone: "Europe/London",
    qualifying_time: "13:45", race_time: "14:30",
  });
  const race = { ...saved, date: "2026-05-24" };
  check("the saved race shows times", hasSessionTimes(race), true);
  check("the form reads its own save back", sessionTimesForm(race),
    { practice_time: "", qualifying_time: "13:45", race_time: "14:30" });
  const ny = raceSessionTimes(race, { timeZone: "America/New_York", locale: "en-US" });
  check("and New York gets the right clock", ny.map(sessionTimeLine),
    ["Qualifying · 8:45 AM", "Race · 9:30 AM"]);
}

console.log(`all ${n} checks passed — one instant, every reader's own clock, and the event never moves day`);
