// Session start times for the CALENDAR, and nothing else.
//
// A race date stays what it has always been: a bare `YYYY-MM-DD` calendar date
// with no time and no timezone (see lib/raceDate.js — that is the whole reason
// an event lands on the day the admin picked, in every timezone). Nothing here
// changes that. These fields sit ALONGSIDE the date and are read by exactly one
// screen — the Calendar — so a reader can see what time Practice, Qualifying and
// the Race actually start, in their own timezone, without doing the arithmetic.
//
// What an admin stores on a race:
//
//   show_session_times   opt-in. Off (the default, and what every existing race
//                        reads as) means the calendar renders exactly as before.
//   session_timezone     the IANA zone the times below were TYPED IN — the
//                        league's own zone, e.g. "America/New_York". This is the
//                        anchor: a wall-clock time without a zone can't be
//                        converted for anybody.
//   session_times        { practice, qualifying, race } as "HH:MM" wall-clock
//                        strings in that zone. Any of them may be blank — a
//                        league with no practice session just leaves it empty.
//
// The conversion is done at READ time, in the reader's browser, from the
// reader's own zone. Nothing localized is ever stored, so the same race is
// correct for a driver in Perth and one in Phoenix, and stays correct across a
// daylight-saving change because the offset is resolved for that date's instant
// rather than for today's.

export const SESSION_TIME_KEYS = ["practice", "qualifying", "race"];

export const SESSION_TIME_LABELS = {
  practice: "Practice",
  qualifying: "Qualifying",
  race: "Race",
};

// The one-letter tags the calendar pill uses, where "Qualifying · 6:30 PM"
// would never fit. The full label always travels alongside as the tooltip.
export const SESSION_TIME_SHORT = {
  practice: "P",
  qualifying: "Q",
  race: "R",
};

// Whatever a time input / a legacy record gives us → a bare "HH:MM" 24-hour
// wall-clock string, or "" when it isn't a usable time. Accepts the "H:MM" a
// hand-typed value can be, and ignores any seconds an input with a step sends.
export function normalizeClockTime(value) {
  if (value == null) return "";
  const m = String(value).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return "";
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return "";
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

// A race's stored times, cleaned down to the three known sessions and bare
// "HH:MM" values. Anything else in the map is dropped rather than trusted —
// this is what the API stores and what every reader below starts from.
export function cleanSessionTimes(raw) {
  let src = raw;
  if (typeof src === "string") {
    try { src = JSON.parse(src); } catch { src = null; }
  }
  const out = {};
  if (!src || typeof src !== "object") return out;
  for (const key of SESSION_TIME_KEYS) {
    const t = normalizeClockTime(src[key]);
    if (t) out[key] = t;
  }
  return out;
}

// The races collection's normalize hook: whichever half of the pair a caller
// sends, the stored times are the cleaned ones. Returns null when the patch
// doesn't touch them, so an unrelated PATCH is left alone.
export function normalizeRaceSessionTimes(patch) {
  if (!patch || patch.session_times === undefined) return null;
  return { session_times: cleanSessionTimes(patch.session_times) };
}

// ── The admin form's two halves ────────────────────────────────────────────
//
// The edit form keeps one flat field per session (`practice_time`, …) because
// that's what three <input type="time"> elements bind to; the race stores one
// map. These convert between the two, so the mapping lives in one place rather
// than being spelled out in the form.
export function sessionTimesForm(race) {
  const t = cleanSessionTimes(race?.session_times);
  return Object.fromEntries(SESSION_TIME_KEYS.map(k => [`${k}_time`, t[k] || ""]));
}

// The times a save writes. What's typed is stored whether or not the event is
// currently showing them, so an admin can switch the toggle off for a week and
// switch it back on without re-entering the schedule.
export function sessionTimesBody(form) {
  return {
    show_session_times: !!form.show_session_times,
    session_timezone: String(form.session_timezone || "").trim(),
    session_times: cleanSessionTimes(
      Object.fromEntries(SESSION_TIME_KEYS.map(k => [k, form[`${k}_time`]]))
    ),
  };
}

// A timezone's offset from UTC, in milliseconds, AT a given instant — which is
// the only way to ask the question honestly, since a zone's offset changes when
// daylight saving does. Works by formatting the instant in that zone and
// reading the wall-clock fields back. Returns null for a zone the runtime
// doesn't know, so a caller can fall back rather than silently shift a time.
export function zoneOffsetMs(ts, timeZone) {
  if (!timeZone) return null;
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(ts));
  } catch {
    return null;
  }
  const f = {};
  for (const p of parts) f[p.type] = p.value;
  // hourCycle h23 can render midnight as "24" in some runtimes.
  const hour = Number(f.hour) % 24;
  const asUTC = Date.UTC(Number(f.year), Number(f.month) - 1, Number(f.day),
    hour, Number(f.minute), Number(f.second));
  return asUTC - ts;
}

// A wall-clock time in a named zone → the real instant it happens, as epoch ms.
//
// "2026-08-15 19:00 in America/New_York" is a different instant in August than
// in January, so the offset has to be resolved for the instant itself. That's
// circular, so it's done the standard way: guess with the offset at the naive
// UTC reading, then re-resolve with the offset that guess actually lands in —
// which settles any DST boundary the naive guess straddled. Returns null when
// the date, the time or the zone is unusable.
export function zonedWallTimeToInstant(dateIso, clock, timeZone) {
  const dm = String(dateIso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  const time = normalizeClockTime(clock);
  if (!dm || !time) return null;
  const [hh, mm] = time.split(":").map(Number);
  const naive = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), hh, mm);
  const first = zoneOffsetMs(naive, timeZone);
  if (first == null) return null;
  const guess = naive - first;
  const second = zoneOffsetMs(guess, timeZone);
  return second === first ? guess : naive - second;
}

// The calendar date an instant falls on in a given zone, as `YYYY-MM-DD`.
// `timeZone` undefined means the reader's own zone, which is the point.
function dateInZone(ts, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(ts));
  const f = {};
  for (const p of parts) f[p.type] = p.value;
  return `${f.year}-${f.month}-${f.day}`;
}

// Whole days between two `YYYY-MM-DD` dates. Both are read as UTC midnight,
// which is exact for a difference of bare dates.
function dayDiff(fromIso, toIso) {
  const asUTC = iso => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((asUTC(toIso) - asUTC(fromIso)) / 86400000);
}

// Does this race have times to show at all? The opt-in has to be on, the race
// has to have a date to hang them off, and at least one session has to have a
// time set. Anything less and the calendar renders the event exactly as it did
// before this feature existed.
export function hasSessionTimes(race) {
  if (!race?.show_session_times) return false;
  if (!String(race?.date ?? "").match(/^\d{4}-\d{2}-\d{2}/)) return false;
  return Object.keys(cleanSessionTimes(race?.session_times)).length > 0;
}

// One race's sessions, resolved into the READER's timezone, in running order.
//
// Each entry carries:
//   key/label/short  which session it is
//   time             the start, formatted for the reader ("7:00 PM")
//   dayOffset        days between the race's scheduled date and the day this
//                    session falls on for the reader — 0 almost always, +1 for
//                    a US evening race seen from Europe, -1 the other way. The
//                    pill stays in the square for the race's own date (moving it
//                    would put an event on a day its league never scheduled), so
//                    a non-zero offset is SHOWN instead: "R 1:00 AM (Aug 16)".
//   dateLabel        that day, short — only meaningful when dayOffset ≠ 0.
//   converted        false when the race carries no usable zone: the time is
//                    then shown verbatim as typed, never silently re-labelled
//                    as the reader's local time.
//
// `timeZone` / `locale` / `now` are injectable so this is testable off a
// browser; left out, they are the reader's own.
export function raceSessionTimes(race, { timeZone, locale, hour12 } = {}) {
  if (!hasSessionTimes(race)) return [];
  const times = cleanSessionTimes(race.session_times);
  const date = String(race.date).slice(0, 10);
  const zone = String(race.session_timezone || "").trim();

  const fmtTime = ts => new Intl.DateTimeFormat(locale, {
    hour: "numeric", minute: "2-digit", timeZone,
    ...(hour12 === undefined ? {} : { hour12 }),
  }).format(new Date(ts));
  const fmtDate = ts => new Intl.DateTimeFormat(locale, {
    month: "short", day: "numeric", timeZone,
  }).format(new Date(ts));

  const out = [];
  for (const key of SESSION_TIME_KEYS) {
    const clock = times[key];
    if (!clock) continue;
    const ts = zonedWallTimeToInstant(date, clock, zone);
    if (ts == null) {
      // No zone to convert from (or one this runtime doesn't know): show what
      // the admin typed, unconverted and unclaimed.
      out.push({
        key, label: SESSION_TIME_LABELS[key], short: SESSION_TIME_SHORT[key],
        time: clock, dayOffset: 0, dateLabel: "", converted: false,
      });
      continue;
    }
    // The day label is only worth the space when the reader's clock puts the
    // session on a date other than the race's own.
    const dayOffset = dayDiff(date, dateInZone(ts, timeZone));
    out.push({
      key, label: SESSION_TIME_LABELS[key], short: SESSION_TIME_SHORT[key],
      time: fmtTime(ts),
      dayOffset,
      dateLabel: dayOffset === 0 ? "" : fmtDate(ts),
      converted: true,
    });
  }
  return out;
}

// One session as a line of text: "Qualifying · 6:30 PM" — or with the day when
// the reader's clock puts it on a different date: "Race · 1:00 AM (Aug 16)".
export function sessionTimeLine(session) {
  const day = session.dayOffset === 0 ? "" : ` (${session.dateLabel})`;
  return `${session.label} · ${session.time}${day}`;
}

// The reader's timezone as a short name — "EDT", "GMT+10" — for the one-line
// note that tells them whose clock the calendar is quoting. Falls back to the
// zone's own id, then to nothing.
export function localZoneLabel({ timeZone, locale, at = Date.now() } = {}) {
  try {
    const parts = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" })
      .formatToParts(new Date(at));
    const found = parts.find(p => p.type === "timeZoneName")?.value;
    if (found) return found;
  } catch { /* fall through */ }
  try {
    return timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

// The zone the admin's browser is in — the sensible default for "what timezone
// are these times in", since an admin types their league's times in their own.
export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// The zone list the admin picks from. Modern runtimes can enumerate every IANA
// zone; where they can't, a short list of the ones a racing league actually
// runs in stands in. The admin's own zone is always first and always present,
// so the default they'll accept nine times in ten is one click away.
const FALLBACK_ZONES = [
  "Pacific/Auckland", "Australia/Sydney", "Australia/Perth", "Asia/Tokyo",
  "Asia/Singapore", "Asia/Dubai", "Europe/Moscow", "Europe/Berlin", "Europe/Paris",
  "Europe/Madrid", "Europe/London", "Europe/Dublin", "UTC", "America/Sao_Paulo",
  "America/Halifax", "America/New_York", "America/Chicago", "America/Denver",
  "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu",
];

export function timeZoneOptions(own = browserTimeZone()) {
  let all = [];
  try {
    all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  } catch { all = []; }
  const list = all.length ? all : FALLBACK_ZONES;
  const rest = list.filter(z => z !== own).sort((a, b) => a.localeCompare(b));
  return own ? [own, ...rest] : rest;
}
