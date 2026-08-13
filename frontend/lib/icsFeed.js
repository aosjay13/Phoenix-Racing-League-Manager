// The league's racing as an iCalendar (RFC 5545) feed — the thing a driver
// subscribes to once, in Google Calendar / Apple Calendar / Outlook, and never
// thinks about again. It syncs itself: add a round, change a time, and it
// appears in everybody's calendar on the next refresh.
//
// This is the export side of the same data the Calendar page draws, and it
// follows the same rules:
//
//   • an event with session times published (Race Info → "Show session times
//     on the Calendar") exports ONE TIMED ENTRY PER SESSION — Practice,
//     Qualifying, Race — each at the real instant it starts;
//   • an event without them exports as an ALL-DAY entry on its date, which is
//     exactly what a bare `YYYY-MM-DD` race date means (see lib/raceDate.js);
//   • an event with no date at all exports nothing — there is no day to put it
//     on. It's still on the Calendar page under "Date to be announced".
//
// Timed entries are written as UTC instants (`...Z`). That is deliberate: the
// instant is computed once here, from the race's own zone and its own date, and
// every calendar client then renders it in ITS OWN user's timezone. No VTIMEZONE
// block to get wrong, no daylight-saving rule to keep in step with the world's
// tzdata, and a race entered as "19:00 New York" shows up at 19:00 for the
// league and at midnight for a subscriber in London — automatically, forever.

import { toDateOnly } from "@/lib/raceDate";
import {
  SESSION_TIME_KEYS, SESSION_TIME_LABELS, cleanSessionTimes, hasSessionTimes,
  zonedWallTimeToInstant,
} from "@/lib/raceTimes";

// How long a session blocks out in somebody's calendar. Nothing records when a
// session ENDS — a league enters start times — so these are honest defaults
// rather than guesses dressed up as data: enough to reserve the slot and to
// stop a calendar drawing a zero-length sliver. A race run to the clock knows
// its own length and uses it.
export const DEFAULT_SESSION_MINUTES = { practice: 30, qualifying: 30, race: 60 };

// The end of a timed session, in minutes after its start.
export function sessionMinutes(key, race) {
  if (key === "race" && Number(race?.race_minutes) > 0) return Number(race.race_minutes);
  return DEFAULT_SESSION_MINUTES[key] ?? 60;
}

// ── RFC 5545 plumbing ─────────────────────────────────────────────────────

// Text inside a property value: backslash, semicolon and comma are structural
// in iCalendar, and a newline has to travel as the two characters \n. A track
// called "Road Atlanta, GA" would otherwise split into two property values.
export function escapeIcsText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Content lines are limited to 75 OCTETS, continued by CRLF + one space. The
// limit is on bytes, not characters, so folding counts UTF-8 length and never
// splits a multi-byte character down the middle — an emoji in a race name would
// otherwise arrive as two broken halves.
export function foldIcsLine(line) {
  const bytes = Buffer.from(String(line), "utf8");
  if (bytes.length <= 75) return String(line);
  const out = [];
  let start = 0;
  let limit = 75; // the first line takes 75; continuations lose one to the space
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Back off to a character boundary: a UTF-8 continuation byte is 10xxxxxx.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74;
  }
  return out.join("\r\n ");
}

// `YYYY-MM-DD` → the DATE value form, `20260815`.
export function icsDate(value) {
  const iso = toDateOnly(value);
  return iso ? iso.replace(/-/g, "") : "";
}

// An instant → the UTC DATE-TIME form, `20260815T230000Z`.
export function icsUtcStamp(ms) {
  const d = new Date(ms);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

// The day after a `YYYY-MM-DD`, in DATE form. An all-day VEVENT's DTEND is
// EXCLUSIVE, so a one-day event ends on the following morning; without this a
// race shows as a zero-length all-day entry (or, in some clients, two days).
export function icsNextDate(value) {
  const iso = toDateOnly(value);
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return icsDate(new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10));
}

// ── What one race says ────────────────────────────────────────────────────

// The line a calendar shows in its grid. The series and the track are what make
// an entry recognisable at a glance among a subscriber's own appointments, and
// a session's name is appended when the event exports session by session.
export function eventSummary(race, sessionLabel = "") {
  const scope = String(race?.series_name ?? "").trim();
  const where = String(race?.track ?? "").trim() || String(race?.name ?? "").trim() || "Race";
  const head = scope ? `${scope} · ${where}` : where;
  return sessionLabel ? `${head} — ${sessionLabel}` : head;
}

// Everything that didn't fit on the summary line, as the entry's notes: which
// round of which season, the class it's for, the car, and the rest of the
// weekend's running order so a subscriber can see the other sessions from
// inside any one of them.
//
// A description is ONE fixed string sent to every subscriber, so it can't be
// localized the way the entry's own start time is. The running order therefore
// quotes the LEAGUE's clock and names the zone it's on — while each session's
// entry still lands on the subscriber's calendar at the correct instant for
// them. Both facts are true, and saying which is which is what stops the notes
// contradicting the times.
export function eventDescription(race, { url = "" } = {}) {
  const lines = [];
  const name = String(race?.name ?? "").trim();
  if (name) lines.push(name);
  const scope = [race?.series_name, race?.season_name, race?.game_name]
    .map(v => String(v ?? "").trim()).filter(Boolean).join(" · ");
  if (scope) lines.push(scope);
  if (race?.class_name) lines.push(`Class: ${race.class_name}`);
  if (race?.car) lines.push(`Car: ${race.car}`);

  const times = hasSessionTimes(race) ? cleanSessionTimes(race.session_times) : {};
  const zone = String(race?.session_timezone || "").trim();
  const running = SESSION_TIME_KEYS.filter(k => times[k]);
  if (running.length) {
    lines.push("");
    lines.push(zone ? `Running order (${zone}):` : "Running order:");
    for (const key of running) lines.push(`  ${SESSION_TIME_LABELS[key]} — ${times[key]}`);
    lines.push("");
    lines.push("Each session is a separate entry, at the right time for wherever you are.");
  }
  if (url) { lines.push(""); lines.push(url); }
  return lines.join("\n");
}

// One VEVENT. `props` is an ordered list of [name, value] pairs already in
// iCalendar form — the caller decides whether this is an all-day or a timed
// entry, since that's the one real difference between the two shapes.
function vevent(props) {
  return ["BEGIN:VEVENT", ...props.map(([k, v]) => foldIcsLine(`${k}:${v}`)), "END:VEVENT"];
}

// A race → the calendar entries it produces. A stable UID per entry is what
// makes this a SUBSCRIPTION rather than a re-import: a client that already has
// `<race id>-race` updates it in place when the time changes, instead of
// leaving the old one behind next to the new.
export function raceEvents(race, { dtstamp, baseUrl = "" } = {}) {
  const date = toDateOnly(race?.date);
  if (!date) return [];               // no day to put it on — see the header
  const uidBase = `${race.id}@phoenix-racing-league-manager`;
  const url = baseUrl ? `${baseUrl.replace(/\/$/, "")}/races/${race.id}` : "";
  const location = String(race?.track ?? "").trim();

  const common = [
    ["DTSTAMP", dtstamp],
    ...(location ? [["LOCATION", escapeIcsText(location)]] : []),
    ...(url ? [["URL", url]] : []),
    ["STATUS", "CONFIRMED"],
    ["TRANSP", "TRANSPARENT"],
  ];

  const description = escapeIcsText(eventDescription(race, { url }));

  // Times published → one entry per session, each at the real instant it
  // starts. The instant is computed straight from the stored wall-clock time
  // and the race's own zone, so what goes on the wire never depends on the
  // timezone the SERVER happens to be running in.
  if (hasSessionTimes(race)) {
    const times = cleanSessionTimes(race.session_times);
    const timed = SESSION_TIME_KEYS.filter(k => times[k]).flatMap(key => {
      // A race whose zone was never saved (or names a zone this runtime doesn't
      // know) has no instant to publish. Rather than exporting a time that
      // might be hours out, those fall through to the all-day entry below —
      // which is still true, and is what the event's date alone says.
      const startMs = zonedWallTimeToInstant(date, times[key], race.session_timezone);
      if (startMs == null) return [];
      const endMs = startMs + sessionMinutes(key, race) * 60000;
      return vevent([
        ["UID", `${key}-${uidBase}`],
        ["DTSTART", icsUtcStamp(startMs)],
        ["DTEND", icsUtcStamp(endMs)],
        ["SUMMARY", escapeIcsText(eventSummary(race, SESSION_TIME_LABELS[key]))],
        ["DESCRIPTION", description],
        ...common,
      ]);
    });
    if (timed.length) return timed;
  }

  // No published times (or none that could be resolved) → the all-day entry a
  // bare calendar date describes.
  return vevent([
    ["UID", `race-${uidBase}`],
    ["DTSTART;VALUE=DATE", icsDate(date)],
    ["DTEND;VALUE=DATE", icsNextDate(date)],
    ["SUMMARY", escapeIcsText(eventSummary(race))],
    ["DESCRIPTION", description],
    ...common,
  ]);
}

// ── The whole feed ────────────────────────────────────────────────────────

// Every calendar client is told to re-poll hourly. Both spellings are here on
// purpose: REFRESH-INTERVAL is the standard one (RFC 7986), X-PUBLISHED-TTL is
// what Outlook and several others actually read.
const REFRESH = "PT1H";

export function buildIcsCalendar(races = [], { name, description = "", baseUrl = "", now = Date.now() } = {}) {
  const dtstamp = icsUtcStamp(now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Phoenix Racing League Manager//Race Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    foldIcsLine(`X-WR-CALNAME:${escapeIcsText(name || "Racing Calendar")}`),
    ...(description ? [foldIcsLine(`X-WR-CALDESC:${escapeIcsText(description)}`)] : []),
    `REFRESH-INTERVAL;VALUE=DURATION:${REFRESH}`,
    `X-PUBLISHED-TTL:${REFRESH}`,
    ...races.flatMap(r => raceEvents(r, { dtstamp, baseUrl })),
    "END:VCALENDAR",
  ];
  // CRLF throughout, and a trailing one — some clients reject a file whose last
  // line isn't terminated.
  return lines.join("\r\n") + "\r\n";
}
