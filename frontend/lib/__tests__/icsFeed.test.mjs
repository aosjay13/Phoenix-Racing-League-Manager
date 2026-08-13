// The subscribable calendar feed. What has to hold:
//
//   1. a published session time exports as the REAL INSTANT it starts, so
//      every subscriber's calendar app renders it in their own zone — the same
//      guarantee lib/raceTimes.js makes on screen, now on the wire;
//   2. a race without published times exports as an ALL-DAY entry on the day
//      the admin picked, never a timed one in the server's timezone;
//   3. UIDs are stable, because that is the whole difference between a
//      subscription that updates in place and one that duplicates every round
//      on every refresh;
//   4. the file is well-formed iCalendar — escaped text, folded lines, CRLF.
import assert from "node:assert";
import {
  buildIcsCalendar, escapeIcsText, eventSummary, foldIcsLine, icsDate,
  icsNextDate, icsUtcStamp, raceEvents, sessionMinutes,
} from "../icsFeed.js";

let n = 0;
const check = (label, got, want) => {
  n++;
  assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const ok = (label, cond) => check(label, !!cond, true);

const DTSTAMP = "20260812T120000Z";
const opts = { dtstamp: DTSTAMP, baseUrl: "https://league.example" };
// One property's value out of a VEVENT's lines.
const prop = (lines, key) => {
  const hit = lines.find(l => l.startsWith(`${key}:`) || l.startsWith(`${key};`));
  return hit == null ? null : hit.slice(hit.indexOf(":") + 1);
};

const TIMED = {
  id: "r1", name: "Round 4", track: "Watkins Glen", date: "2026-08-15",
  series_name: "GT Cup", season_name: "2026 Season", game_name: "iRacing",
  show_session_times: true, session_timezone: "America/New_York",
  session_times: { practice: "18:00", qualifying: "18:30", race: "19:00" },
};
const PLAIN = { id: "r2", name: "Round 5", track: "Road Atlanta", date: "2026-09-06", series_name: "GT Cup" };

// ── 1. Text that would otherwise break the format ─────────────────────────
check("a comma is escaped", escapeIcsText("Road Atlanta, GA"), "Road Atlanta\\, GA");
check("a semicolon is escaped", escapeIcsText("Practice; then quali"), "Practice\\; then quali");
check("a backslash is escaped first", escapeIcsText("back\\slash"), "back\\\\slash");
check("a newline travels as \\n", escapeIcsText("one\ntwo"), "one\\ntwo");
check("a CRLF travels as one \\n", escapeIcsText("one\r\ntwo"), "one\\ntwo");
check("nothing in, nothing out", escapeIcsText(null), "");

// ── 2. Long lines fold, and never mid-character ──────────────────────────
{
  const short = "SUMMARY:Round 4";
  check("a short line is left alone", foldIcsLine(short), short);

  const long = `SUMMARY:${"a".repeat(200)}`;
  const folded = foldIcsLine(long);
  const parts = folded.split("\r\n");
  ok("a long line is folded", parts.length > 1);
  check("the first segment is 75 octets", Buffer.byteLength(parts[0], "utf8"), 75);
  ok("continuations start with a single space", parts.slice(1).every(p => p.startsWith(" ")));
  ok("no continuation exceeds the limit",
    parts.slice(1).every(p => Buffer.byteLength(p, "utf8") <= 75));
  check("unfolding restores the original", parts.map((p, i) => (i ? p.slice(1) : p)).join(""), long);

  // The limit is on BYTES, so a line of multi-byte characters must not be cut
  // through the middle of one — an emoji would arrive as two broken halves.
  const emoji = `SUMMARY:${"🏁".repeat(40)}`;
  const foldedEmoji = foldIcsLine(emoji);
  ok("a multi-byte line folds without corruption", !foldedEmoji.includes("�"));
  check("unfolding restores it exactly",
    foldedEmoji.split("\r\n").map((p, i) => (i ? p.slice(1) : p)).join(""), emoji);
}

// ── 3. Dates and instants in iCalendar form ──────────────────────────────
check("a calendar date", icsDate("2026-08-15"), "20260815");
check("a timestamp is read as its calendar date", icsDate("2026-08-15T18:00:00Z"), "20260815");
check("nothing in, nothing out", icsDate(""), "");
check("an all-day end is the NEXT day (DTEND is exclusive)", icsNextDate("2026-08-15"), "20260816");
check("...across a month boundary", icsNextDate("2026-08-31"), "20260901");
check("...across a year boundary", icsNextDate("2026-12-31"), "20270101");
check("...across a leap day", icsNextDate("2028-02-28"), "20280229");
check("a UTC instant", icsUtcStamp(Date.UTC(2026, 7, 15, 23, 0)), "20260815T230000Z");

// ── 4. A race with published times: one entry per session ────────────────
{
  const lines = raceEvents(TIMED, opts);
  const events = lines.join("\r\n").split("BEGIN:VEVENT").slice(1);
  check("three sessions, three entries", events.length, 3);

  const starts = lines.filter(l => l.startsWith("DTSTART"));
  // 18:00 / 18:30 / 19:00 New York on 15 August 2026 is EDT (UTC-4).
  check("each session is exported as its real UTC instant", starts, [
    "DTSTART:20260815T220000Z",
    "DTSTART:20260815T223000Z",
    "DTSTART:20260815T230000Z",
  ]);
  ok("nothing is exported as a floating local time", starts.every(l => l.endsWith("Z")));

  const uids = lines.filter(l => l.startsWith("UID:"));
  check("one stable UID per session", uids, [
    "UID:practice-r1@phoenix-racing-league-manager",
    "UID:qualifying-r1@phoenix-racing-league-manager",
    "UID:race-r1@phoenix-racing-league-manager",
  ]);
  check("the same race exports the same UIDs every time",
    raceEvents(TIMED, { ...opts, dtstamp: "20270101T000000Z" }).filter(l => l.startsWith("UID:")), uids);

  const summaries = lines.filter(l => l.startsWith("SUMMARY:"));
  check("each entry names its session", summaries, [
    "SUMMARY:GT Cup · Watkins Glen — Practice",
    "SUMMARY:GT Cup · Watkins Glen — Qualifying",
    "SUMMARY:GT Cup · Watkins Glen — Race",
  ]);
  ok("the track is the location", lines.includes("LOCATION:Watkins Glen"));
  ok("each entry links back to the race page",
    lines.filter(l => l === "URL:https://league.example/races/r1").length === 3);
  ok("every entry carries the feed's timestamp", lines.filter(l => l === `DTSTAMP:${DTSTAMP}`).length === 3);
}

// Sessions block out a sensible slot rather than a zero-length sliver, and a
// race run to the clock uses the length it actually runs.
check("practice defaults to half an hour", sessionMinutes("practice", TIMED), 30);
check("a lap race defaults to an hour", sessionMinutes("race", TIMED), 60);
check("a timed race uses its own clock", sessionMinutes("race", { ...TIMED, race_minutes: 90 }), 90);
{
  const lines = raceEvents({ ...TIMED, race_minutes: 90 }, opts);
  const ends = lines.filter(l => l.startsWith("DTEND"));
  check("the race entry ends when the race does", ends[2], "DTEND:20260816T003000Z");
  check("practice ends half an hour in", ends[0], "DTEND:20260815T223000Z");
}

// A weekend with no practice exports two entries, not three with a blank.
{
  const lines = raceEvents({ ...TIMED, session_times: { qualifying: "18:30", race: "19:00" } }, opts);
  check("only the sessions that exist", lines.filter(l => l.startsWith("UID:")), [
    "UID:qualifying-r1@phoenix-racing-league-manager",
    "UID:race-r1@phoenix-racing-league-manager",
  ]);
}

// ── 5. A race without published times: one all-day entry ─────────────────
{
  const lines = raceEvents(PLAIN, opts);
  check("one entry", lines.filter(l => l === "BEGIN:VEVENT").length, 1);
  ok("it is an all-day entry on the date the admin picked",
    lines.includes("DTSTART;VALUE=DATE:20260906"));
  ok("...ending the next day, since DTEND is exclusive",
    lines.includes("DTEND;VALUE=DATE:20260907"));
  ok("no timed start sneaks in", !lines.some(l => /^DTSTART:/.test(l)));
  check("its UID is stable too", prop(lines, "UID"), "race-r2@phoenix-racing-league-manager");
  check("the summary reads series · track", prop(lines, "SUMMARY"), "GT Cup · Road Atlanta");
}

// The toggle is what decides it: times stored but not published stay off the
// wire, exactly as they stay off the calendar page.
{
  const unpublished = { ...TIMED, show_session_times: false };
  const lines = raceEvents(unpublished, opts);
  ok("times that aren't published export as an all-day entry",
    lines.includes("DTSTART;VALUE=DATE:20260815"));
  check("...as a single entry", lines.filter(l => l === "BEGIN:VEVENT").length, 1);
}

// A race whose zone was never saved has no instant anybody could publish — it
// falls back to the all-day entry rather than exporting a time that might be
// hours out, or vanishing from the feed altogether.
{
  const zoneless = { ...TIMED, session_timezone: "" };
  const lines = raceEvents(zoneless, opts);
  check("it still appears", lines.filter(l => l === "BEGIN:VEVENT").length, 1);
  ok("as an all-day entry", lines.includes("DTSTART;VALUE=DATE:20260815"));
}

// An undated race has no day to sit on, so it exports nothing at all. (It's
// still visible on the Calendar page under "Date to be announced".)
check("an undated race exports nothing", raceEvents({ ...PLAIN, date: "" }, opts), []);
check("...and a null date", raceEvents({ ...PLAIN, date: null }, opts), []);

// ── 6. The summary line stays recognisable ───────────────────────────────
check("series · track", eventSummary(PLAIN), "GT Cup · Road Atlanta");
check("with a session", eventSummary(PLAIN, "Qualifying"), "GT Cup · Road Atlanta — Qualifying");
check("no series: just the track", eventSummary({ track: "Monza" }), "Monza");
check("no track: the event's own name", eventSummary({ name: "Round 7" }), "Round 7");
check("something is always shown", eventSummary({}), "Race");

// ── 7. The whole file ────────────────────────────────────────────────────
{
  const ics = buildIcsCalendar([TIMED, PLAIN], {
    name: "Phoenix Racing — GT Cup", description: "Every race.",
    baseUrl: "https://league.example", now: Date.UTC(2026, 7, 12, 12, 0),
  });
  ok("it opens as a calendar", ics.startsWith("BEGIN:VCALENDAR\r\n"));
  ok("it closes as one", ics.endsWith("END:VCALENDAR\r\n"));
  ok("every line ends CRLF", !/(?<!\r)\n/.test(ics));
  ok("it declares the version", ics.includes("\r\nVERSION:2.0\r\n"));
  ok("it names itself for the subscriber's sidebar",
    ics.includes("X-WR-CALNAME:Phoenix Racing — GT Cup"));
  ok("it asks clients to re-poll", ics.includes("REFRESH-INTERVAL;VALUE=DURATION:PT1H"));
  ok("...including the ones that only read the X- spelling", ics.includes("X-PUBLISHED-TTL:PT1H"));
  check("four entries: three sessions plus one all-day race",
    ics.split("BEGIN:VEVENT").length - 1, 4);
  check("every entry is closed", ics.split("END:VEVENT").length - 1, 4);
  check("the feed's own timestamp is the one asked for",
    ics.split("\r\n").filter(l => l.startsWith("DTSTAMP:")).length, 4);
  ok("the timestamp is the given instant", ics.includes("DTSTAMP:20260812T120000Z"));

  // Every UID in the file is distinct — a duplicate would make two rounds
  // collapse into one entry in the subscriber's calendar.
  const uids = ics.split("\r\n").filter(l => l.startsWith("UID:"));
  check("no UID is repeated", new Set(uids).size, uids.length);
}

// An empty league is still a valid calendar, not a broken file.
{
  const ics = buildIcsCalendar([], { name: "Empty" });
  ok("still a calendar", ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"));
  check("with no entries", ics.split("BEGIN:VEVENT").length - 1, 0);
}

console.log(`all ${n} checks passed — subscribe once, and every session lands at the right instant`);
