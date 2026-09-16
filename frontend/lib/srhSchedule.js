// A SimRacerHub season schedule page → a whole season of this app's races.
//
// Building next season used to mean typing the same twelve rounds in twice:
// once into SimRacerHub, where an iRacing league's scoring lives, and again
// here, round by round, with the tracks, the dates and the distances. This turns
// the second half into one URL.
//
// It does three things:
//   parseSrhSeasonRef(input)  — a pasted URL or season id → the page to fetch
//   parseSrhSchedule(html)    — that page → the season, its series, its rounds
//   srhSchedulePlan(parsed)   — those rounds → the season and race bodies this
//                               app writes, plus what the review table shows
//
// The hard part is that SimRacerHub lets every league choose its own columns
// AND its own date format, so no two schedule pages have the same shape:
//
//   Race | Race Date | Pts Count | Car | Event / Track | Race Length | Pole | …
//   Race | Race Date | Pract Time | Race Time | Car | Num Drivers | Event / …
//
// So nothing here counts columns. The header row is read first and every cell
// is found by what its column is CALLED, the same way the results importer maps
// a pasted table (see headerToField in lib/resultsImport.js). A column this
// module doesn't know is ignored rather than guessed at.
//
// Dates are the other trap. A league writes them as "Sep 10, 2024", as
// "Sunday June 21, 2026", or as "17/08/2026" — and that last one is 17 August
// in a British league and nothing at all in an American one. SimRacerHub uses
// ONE format per league, so the whole table is read together and the ambiguity
// resolved once, from evidence, rather than a row at a time from a guess. See
// resolveDates.
//
// Everything here is pure and dependency-free, so it is unit-tested with bare
// `node` like the rest of lib/, and it never throws: an unreadable page comes
// back as null and a row it can't make sense of becomes a warning.

import { asUrl, isSrhHost, SRH_SCORING } from "@/lib/srhImport";

// ── 1. What to fetch ──────────────────────────────────────────────────────

export const SRH_SCHEDULE_PAGE = `${SRH_SCORING}/season_schedule.php`;

export const srhSchedulePageUrl = id => `${SRH_SCHEDULE_PAGE}?season_id=${encodeURIComponent(id)}`;

// A pasted SimRacerHub link — or a bare season id — → the schedule page to
// fetch. Any SimRacerHub URL carrying a `season_id` will do (its schedule, its
// standings, its latest results), because that id is the whole address: an
// admin shouldn't have to find the schedule tab before copying.
//
// As with the results importer, the host allowlist is the point of this
// function as much as the parsing is — it is the only thing that decides where
// the server will make a request to.
export function parseSrhSeasonRef(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return { ok: false, error: "Paste a SimRacerHub season URL or season id." };

  if (/^\d+$/.test(raw)) return { ok: true, season_id: raw, url: srhSchedulePageUrl(raw) };

  const fragment = raw.match(/^\??\s*season_id\s*=\s*(\d+)$/i);
  if (fragment) return { ok: true, season_id: fragment[1], url: srhSchedulePageUrl(fragment[1]) };

  const url = asUrl(raw);
  if (!url) return { ok: false, error: "That doesn't look like a SimRacerHub season URL or season id." };
  if (!isSrhHost(url.hostname)) {
    return { ok: false, error: `Only simracerhub.com links can be imported — that one points at ${url.hostname.toLowerCase()}.` };
  }

  const id = (url.searchParams.get("season_id") || "").trim();
  if (/^\d+$/.test(id)) return { ok: true, season_id: id, url: srhSchedulePageUrl(id) };

  // A series or league link names no one season, and picking one for the admin
  // would be picking the wrong one.
  const other = ["series_id", "league_id"].find(p => (url.searchParams.get(p) || "").trim());
  return {
    ok: false,
    error: other
      ? "That link is for a whole series, not one season — open the season on SimRacerHub and copy the URL from there."
      : "That SimRacerHub link carries no season id — open the season's schedule on SimRacerHub and copy the URL from there.",
  };
}

// ── 2. Reading the page ───────────────────────────────────────────────────

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " ",
  ndash: "–", mdash: "—", deg: "°",
};

const decode = s => String(s ?? "")
  .replace(/&(amp|lt|gt|quot|apos|#39|nbsp|ndash|mdash|deg);/g, (_, e) => ENTITIES[e])
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/\s+/g, " ")
  .trim();

// Markup → the text a reader sees. <br> and </div> become spaces so two stacked
// divs don't run their words together.
const textOf = html => decode(String(html ?? "")
  .replace(/<br\s*\/?>/gi, " ")
  .replace(/<\/(div|p|td|th|li)>/gi, " ")
  .replace(/<[^>]*>/g, ""));

// The schedule columns this module understands, by what SimRacerHub calls them.
// Everything else on the row — Pole, Winner, Num Drivers, Weather, Can Drop,
// Distance or Time — describes a race that has already been run, and a schedule
// import has no use for it.
const COLUMNS = [
  ["round", ["race", "rnd", "round", "#"]],
  ["date", ["racedate", "date"]],
  ["points_count", ["ptscount", "pointscount", "points", "pts"]],
  ["car", ["car", "cars"]],
  ["event", ["eventtrack", "event", "track", "trackevent"]],
  ["length", ["racelength", "length", "laps"]],
  ["practice_time", ["practtime", "practicetime", "practice"]],
  ["qualifying_time", ["qualtime", "qualifyingtime", "qualifying"]],
  ["race_time", ["racetime", "starttime", "greenflag"]],
];

const norm = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// The field a header cell names, or null.
export function scheduleHeaderField(header) {
  const n = norm(header);
  if (!n) return null;
  for (const [field, names] of COLUMNS) if (names.includes(n)) return field;
  return null;
}

// headers[] → { field: columnIndex }. First column to claim a field keeps it, so
// a later ambiguous header can't steal one.
export function mapScheduleHeaders(headers) {
  const mapping = {};
  (headers || []).forEach((h, i) => {
    const field = scheduleHeaderField(h);
    if (field && !(field in mapping)) mapping[field] = i;
  });
  return mapping;
}

// ── The season this page belongs to ───────────────────────────────────────

// SimRacerHub heads the page with three dropdowns — league, series, season —
// each a button carrying the name and a menu whose links say which level it is.
// The links are what identifies them, since the names themselves could be
// anything and the order has changed before.
const NAME_BY_LINK = [
  ["league", /league_series\.php\?league_id=/],
  ["series", /series_seasons\.php\?series_id=/],
  ["season", /season_schedule\.php\?season_id=/],
];

export function parseSrhSeasonNames(html) {
  const out = { league: "", series: "", season: "" };
  const blocks = String(html || "").match(/<div class='dropdown lss-dropdown[\s\S]*?<\/div>/g)
    || String(html || "").split("lss-dropdown").slice(1);
  for (const block of blocks) {
    const name = textOf((block.match(/<button[^>]*>([\s\S]*?)<\/button>/) || [])[1]);
    if (!name) continue;
    for (const [level, re] of NAME_BY_LINK) {
      if (!out[level] && re.test(block)) out[level] = name;
    }
  }
  return out;
}

// ── Dates ─────────────────────────────────────────────────────────────────

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];

const monthIndex = word => {
  const w = norm(word).slice(0, 3);
  const i = MONTHS.indexOf(w);
  return i < 0 ? null : i + 1;
};

const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const valid = (y, m, d) =>
  Number.isInteger(y) && y >= 1990 && y <= 2100
  && Number.isInteger(m) && m >= 1 && m <= 12
  && Number.isInteger(d) && d >= 1 && d <= 31;

// One date cell → what can be read from it WITHOUT deciding day/month order:
//   { iso }                        — unambiguous (a month name, or ISO)
//   { ambiguous: { a, b, year } }  — two numbers and a year, order unresolved
//   null                           — nothing date-shaped in it
export function readScheduleDate(text) {
  const raw = decode(text)
    // A weekday tells us nothing the numbers don't, and it gets in the way.
    .replace(/^(sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat)[a-z]*\.?,?\s*/i, "")
    .trim();
  if (!raw) return null;

  // ISO, which every league's format can be told apart from.
  const isoMatch = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (isoMatch) {
    const [y, m, d] = isoMatch.slice(1).map(Number);
    return valid(y, m, d) ? { iso: iso(y, m, d) } : null;
  }

  // A month NAME settles it however the rest is arranged: "Sep 10, 2024",
  // "10 September 2024", "Feb 4 2026".
  const named = raw.match(/^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i);
  if (named) {
    const m = monthIndex(named[1]);
    if (m) return valid(Number(named[3]), m, Number(named[2])) ? { iso: iso(Number(named[3]), m, Number(named[2])) } : null;
  }
  const namedLast = raw.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4})$/i);
  if (namedLast) {
    const m = monthIndex(namedLast[2]);
    if (m) return valid(Number(namedLast[3]), m, Number(namedLast[1])) ? { iso: iso(Number(namedLast[3]), m, Number(namedLast[1])) } : null;
  }

  // All numbers: "17/08/2026" or "08/17/2026", and only the table as a whole
  // can say which.
  const numeric = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    let year = Number(numeric[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    if (a >= 1 && b >= 1 && Number.isInteger(year)) return { ambiguous: { a, b, year } };
  }
  return null;
}

// Every date on the page, resolved together.
//
// SimRacerHub renders a whole schedule in its league's one date format, so
// "day/month or month/day?" is asked once for the table rather than once per
// row. Three things answer it, in order of how much they prove:
//
//   1. a first number above 12 can only be a day, and a second one can only be
//      a month — one such row settles the entire page;
//   2. failing that, a schedule runs FORWARDS, so the reading whose dates climb
//      is the right one;
//   3. and if both readings climb (a monthly series on the 8th of each month,
//      say) neither is provable. Month-first is used, since it is
//      SimRacerHub's own default format, and the ambiguity is reported so the
//      review table can say so instead of quietly picking.
export function resolveDates(reads) {
  const list = reads || [];
  const ambiguous = list.filter(r => r?.ambiguous).map(r => r.ambiguous);
  if (!ambiguous.length) return { order: "unambiguous", dates: list.map(r => r?.iso ?? null), ambiguous: false };

  const dayFirst = ambiguous.some(({ a }) => a > 12);
  const monthFirst = ambiguous.some(({ b }) => b > 12);

  let order = null;
  if (dayFirst && !monthFirst) order = "dmy";
  else if (monthFirst && !dayFirst) order = "mdy";

  const build = (mode, { a, b, year }) => {
    const [m, d] = mode === "dmy" ? [b, a] : [a, b];
    return valid(year, m, d) ? iso(year, m, d) : null;
  };
  // How much of a reading runs forwards. Scored rather than demanded, because a
  // schedule is not always perfectly ordered — a rescheduled round can sit out
  // of sequence — and the reading with fewer steps backwards is still the right
  // one. A reading that can't produce a real date for every row scores nothing.
  const forwardness = mode => {
    const seq = ambiguous.map(x => build(mode, x));
    if (seq.some(v => v == null)) return -1;
    return seq.reduce((n, v, i) => n + (i === 0 || v >= seq[i - 1] ? 1 : 0), 0);
  };

  let unresolved = false;
  if (!order) {
    const mdy = forwardness("mdy");
    const dmy = forwardness("dmy");
    if (mdy > dmy) order = "mdy";
    else if (dmy > mdy) order = "dmy";
    else { order = "mdy"; unresolved = true; }
  }

  return {
    order,
    // True when the reading could not be proved, so a caller can say so.
    ambiguous: unresolved,
    dates: list.map(r => (r?.iso ? r.iso : r?.ambiguous ? build(order, r.ambiguous) : null)),
  };
}

// ── Race length ───────────────────────────────────────────────────────────

// "58 Laps", "0h 22m", "1h 25m", "45 mins" → how this app stores a distance
// (see lib/raceLength.js). Null when the column said nothing, or said something
// that isn't a distance at all — several leagues use it for a track type.
export function readRaceLength(text) {
  const raw = decode(text);
  if (!raw) return null;

  const laps = raw.match(/^(\d+)\s*laps?$/i);
  if (laps) return { length_type: "laps", total_laps: Number(laps[1]) };

  const hm = raw.match(/^(\d+)\s*h(?:ours?|rs?)?\s*(\d+)?\s*m/i);
  if (hm) {
    const minutes = Number(hm[1]) * 60 + Number(hm[2] || 0);
    return minutes > 0 ? { length_type: "time", race_minutes: minutes } : null;
  }

  const mins = raw.match(/^(\d+)\s*m(?:in(?:ute)?s?)?$/i);
  if (mins) return Number(mins[1]) > 0 ? { length_type: "time", race_minutes: Number(mins[1]) } : null;

  return null;
}

// ── Session start times ───────────────────────────────────────────────────

// The zones SimRacerHub prints times in, as the IANA ids this app stores (see
// lib/raceTimes.js — a wall-clock time is worthless without one). Deliberately
// a short list of the abbreviations leagues actually use: an unknown zone means
// the times are left out rather than shifted into the wrong one.
const ZONES = {
  est: "America/New_York", edt: "America/New_York", et: "America/New_York",
  cst: "America/Chicago", cdt: "America/Chicago", ct: "America/Chicago",
  mst: "America/Denver", mdt: "America/Denver", mt: "America/Denver",
  pst: "America/Los_Angeles", pdt: "America/Los_Angeles", pt: "America/Los_Angeles",
  akst: "America/Anchorage", akdt: "America/Anchorage",
  hst: "Pacific/Honolulu",
  ast: "America/Halifax", adt: "America/Halifax",
  utc: "UTC", gmt: "UTC", z: "UTC",
  bst: "Europe/London", wet: "Europe/London", west: "Europe/London",
  cet: "Europe/Paris", cest: "Europe/Paris",
  eet: "Europe/Helsinki", eest: "Europe/Helsinki",
  aest: "Australia/Sydney", aedt: "Australia/Sydney",
  acst: "Australia/Adelaide", acdt: "Australia/Adelaide",
  awst: "Australia/Perth",
  nzst: "Pacific/Auckland", nzdt: "Pacific/Auckland",
};

// "8:30 pm EDT" → { time: "20:30", zone: "America/New_York" }. Null when
// there's no time in the cell, and `zone` is "" when it named one this module
// doesn't know — the caller then keeps the clock and drops the zone, which is
// what stops a time being shown in the wrong one.
export function readSessionTime(text) {
  const raw = decode(text);
  const m = raw.match(/(\d{1,2}):(\d{2})\s*(am|pm)?\s*([a-z]{1,4})?/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const ampm = (m[3] || "").toLowerCase();
  if (hour > 23 || minute > 59) return null;
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  return {
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    zone: ZONES[norm(m[4])] || "",
  };
}

// ── The Event / Track cell ────────────────────────────────────────────────

// SimRacerHub stacks up to two things in this one cell: the league's own name
// for the event, in bold, and the track, as a link to its config page. Either
// can be missing, and an off week is written in place of both.
//
//   <div class='mb-1'><b>Stages 30/60/130</b></div>
//   <div><a href='config_stats.php?config_id=157'>Daytona International Speedway Oval</a></div>
//
// The track comes off the config link rather than the cell's text, which is
// what keeps the event name out of the venue — a track called "Stages 30/60/130
// Daytona International Speedway Oval" would be a new venue every week.
export function readEventCell(html) {
  const raw = String(html ?? "");
  const text = textOf(raw);
  if (/off\s*week/i.test(text)) return { off_week: true, event: "", track: "", config_id: null };

  const link = raw.match(/<a[^>]*href='[^']*config_stats\.php\?config_id=(\d+)'[^>]*>([\s\S]*?)<\/a>/i);
  const track = link ? textOf(link[2]) : "";
  const bold = raw.match(/<b>([\s\S]*?)<\/b>/i);
  let event = bold ? textOf(bold[1]) : "";
  // No bold and no track link: whatever the cell says is the event's name.
  if (!event && !track) event = text;
  return { off_week: false, event, track, config_id: link ? link[1] : null };
}

// ── The Car cell ──────────────────────────────────────────────────────────

// A car cell carries an image per car — `images/car_186.png` — and, on the
// leagues that switch the name on, the name as text beside it. Both are read:
// the names when they are there, the ids either way so a caller that wants a
// name SimRacerHub didn't print can look it up.
export function readCarCell(html) {
  const raw = String(html ?? "");
  const ids = [...raw.matchAll(/car_(\d+)\.(?:png|jpe?g|webp|gif)/gi)].map(m => m[1]);
  const names = textOf(raw).split(/\s{2,}|,/).map(s => s.trim()).filter(Boolean);
  return { ids: [...new Set(ids)], names };
}

// ── 3. The page → its rounds ──────────────────────────────────────────────

// Parse a SimRacerHub season schedule page. Returns null when the text isn't
// one at all (an error page, a login wall, some other page of the site), so the
// caller can say so rather than import an empty season.
export function parseSrhSchedule(html) {
  const text = String(html || "");
  if (!text) return null;

  const table = text.match(/<table[^>]*id='sched_table'[\s\S]*?<\/table>/i)
    || text.match(/<table[\s\S]*?<\/table>/i);
  if (!table) return null;

  const headerRow = table[0].match(/<tr[^>]*jsTableHdr[^>]*>([\s\S]*?)<\/tr>/i)
    || table[0].match(/<tr[^>]*>([\s\S]*?)<\/tr>/i);
  const headers = headerRow
    ? [...headerRow[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map(m => textOf(m[1]))
    : [];
  const mapping = mapScheduleHeaders(headers);
  // Without a date or an Event/Track column there is no schedule here — a page
  // with some other table on it must not read as an empty season.
  if (mapping.date == null && mapping.event == null) return null;

  const rows = [...table[0].matchAll(/<tr[^>]*id='sch_(\d+)'[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => ({
    schedule_id: m[1],
    cells: [...m[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => c[1]),
  }));
  if (!rows.length) return null;

  const cell = (row, field) => (mapping[field] != null ? row.cells[mapping[field]] : undefined);

  // Read every row's date first, then resolve the whole page's format at once.
  const dateReads = rows.map(row => readScheduleDate(textOf(cell(row, "date"))));
  const resolved = resolveDates(dateReads);

  const names = parseSrhSeasonNames(text);
  const warnings = [];

  const parsed = rows.map((row, i) => {
    const event = readEventCell(cell(row, "event") ?? "");
    const car = readCarCell(cell(row, "car") ?? "");
    const roundText = textOf(cell(row, "round"));
    const ptsText = textOf(cell(row, "points_count"));
    return {
      schedule_id: row.schedule_id,
      // An off week holds a place on SimRacerHub's calendar and is not a race.
      off_week: event.off_week,
      round: /^\d+$/.test(roundText) ? Number(roundText) : null,
      date: resolved.dates[i] || "",
      date_text: textOf(cell(row, "date")),
      event: event.event,
      track: event.track,
      config_id: event.config_id,
      car_ids: car.ids,
      car_names: car.names,
      length: readRaceLength(textOf(cell(row, "length"))),
      length_text: textOf(cell(row, "length")),
      // "Yes" / "No". Absent means the column wasn't shown, which is not the
      // same as a No — see srhSchedulePlan.
      points_count: ptsText ? !/^no$/i.test(ptsText) : null,
      times: {
        practice: readSessionTime(textOf(cell(row, "practice_time"))),
        qualifying: readSessionTime(textOf(cell(row, "qualifying_time"))),
        race: readSessionTime(textOf(cell(row, "race_time"))),
      },
    };
  });

  const races = parsed.filter(r => !r.off_week);
  const undated = races.filter(r => !r.date).length;
  if (resolved.ambiguous) {
    warnings.push("This league writes its dates as numbers (17/08/2026), and the schedule doesn't say which number is the month. They have been read as month/day — check them before creating.");
  }
  if (undated) warnings.push(`${undated} round${undated === 1 ? "" : "s"} had no date SimRacerHub could be read from — set ${undated === 1 ? "it" : "them"} after importing.`);

  return {
    names,
    headers,
    mapping,
    date_order: resolved.order,
    dates_ambiguous: resolved.ambiguous,
    rounds: parsed,
    off_weeks: parsed.length - races.length,
    warnings,
  };
}

// ── 3b. SimRacerHub's own track directory ─────────────────────────────────

// Every venue SimRacerHub knows, off its Tracks page — the base names a
// schedule's layouts are built from, each with iRacing's own logo for it.
//
// A schedule names the LAYOUT raced ("Lime Rock Park Grand Prix"), which is one
// string with no seam in it. This list is the seam: the longest base name that
// starts the string is the venue, and the rest is the layout (see
// splitTrackName in lib/trackMatch.js). Across the eight leagues this was built
// against, all 82 distinct layout names resolved to one of these 154 venues.
//
// The logo is worth the request on its own. It is iRacing's, hosted by iRacing,
// so a venue this app creates from an import arrives looking like the venue
// rather than like a blank row — the one piece of "what is this place"
// SimRacerHub can actually supply, since it publishes no length or surface.
//
// One row per venue: { name, logo_url }. The page carries a map link and the
// venue's own website too, and neither is kept: this app stores a track's
// location as the words a person reads on its card ("Concord, NC"), and a pair
// of coordinates in that field is worse than the blank an admin fills in.
export function parseSrhTrackDirectory(html) {
  const text = String(html || "");
  const rows = [...text.matchAll(/<tr class='jsTableRow'[^>]*>([\s\S]*?)<\/tr>/gi)];
  const out = [];
  for (const [, body] of rows) {
    const cells = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => c[1]);
    if (!cells.length) continue;
    const name = textOf(cells[0]);
    if (!name) continue;
    // The light-theme logo; SimRacerHub prints a dark one beside it, and either
    // reads the same on this app's own cards. The logo cell is located by what
    // is IN it rather than by its position, because a row that has lost a cell
    // would otherwise hand a venue the map pin as its logo.
    const logoCell = cells.find(c => /track-logo-light/i.test(c)) || cells.find(c => /images-static\.iracing\.com/i.test(c)) || "";
    const logo = logoCell.match(/<img[^>]*class='track-logo-light'[^>]*>/i) || logoCell.match(/<img[^>]*>/i);
    const logoUrl = logo ? (logo[0].match(/src='([^']+)'/) || [])[1] || "" : "";
    out.push({ name, logo_url: /^https?:\/\//i.test(logoUrl) ? logoUrl : "" });
  }
  return out;
}

// A schedule's layout names → what the directory knows about each, keyed by the
// name exactly as the schedule wrote it. Anything the directory has never heard
// of simply gets nothing, which is a venue created with only a name.
export function srhTrackInfo(names, directory = []) {
  const bases = directory.map(t => t.name).filter(Boolean);
  const byName = new Map(directory.map(t => [normalizeKey(t.name), t]));
  const info = {};
  for (const name of names || []) {
    const raw = String(name ?? "").trim();
    if (!raw || info[raw]) continue;
    const base = longestBase(raw, bases);
    const detail = base ? byName.get(normalizeKey(base)) : null;
    info[raw] = { base: base || "", logo_url: detail?.logo_url || "" };
  }
  return info;
}

const normalizeKey = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// The longest venue name that starts this layout name, so "Indianapolis Motor
// Speedway Road Course" resolves to the Motor Speedway and not to a shorter
// venue that merely shares its first word.
function longestBase(name, bases) {
  const key = normalizeKey(name);
  let best = "";
  for (const base of bases) {
    const b = normalizeKey(base);
    if (!b) continue;
    if (key !== b && !key.startsWith(`${b} `)) continue;
    if (b.length > normalizeKey(best).length) best = base;
  }
  return best;
}

// ── 4. The rounds → what this app writes ──────────────────────────────────

const blank = v => !String(v ?? "").trim();

// The round number to give each race.
//
// A league's own numbering is kept whenever it can be: it is what their drivers
// call the rounds. It can't always be. SimRacerHub numbers the rounds that
// score and leaves a playoff or a championship round unnumbered, and it lists
// the page by DATE, so a league whose numbering doesn't follow its calendar
// comes out of order. Either would put two races on one round number here, or
// order the season wrongly — this app orders a schedule by that number.
//
// So the numbering is taken as given only when every race has one and they
// climb; otherwise the races are numbered 1..N down the page, which is date
// order. The names are untouched either way, so "FFRL PLAYOFFS 1st ROUND" is
// still called that.
export function numberRounds(rounds) {
  const list = rounds || [];
  const given = list.map(r => r?.round ?? null);
  const usable = given.length > 0
    && given.every(n => Number.isInteger(n) && n >= 1)
    && given.every((n, i) => i === 0 || n > given[i - 1]);
  return {
    numbers: usable ? given : list.map((_, i) => i + 1),
    renumbered: !usable,
  };
}

// The name to give a round here.
//
// A league's own event name wins when it has one, because that is what they
// call the race. Two of them don't count: a name that is just the round number
// (SimRacerHub leagues use the field that way) and a blank one, which leave the
// track's name to do the job — and on a schedule with neither, the round number
// is all there is.
export function roundName(round, index) {
  const event = String(round?.event ?? "").trim();
  if (event && !/^\d+$/.test(event)) return event;
  const track = String(round?.track ?? "").trim();
  if (track) return track;
  const n = round?.round ?? index + 1;
  return `Race ${n}`;
}

// The season and its races, ready to write, plus everything the review table
// needs to show what is about to happen.
//
// `carNames` maps a SimRacerHub car id to its name, for the leagues that don't
// print the name in the cell — the route looks those up. Left out, the cars are
// simply not set, which is what an admin would then type on the season.
export function srhSchedulePlan(parsed, { carNames = {}, seasonName = "" } = {}) {
  const rounds = (parsed?.rounds || []).filter(r => !r.off_week);

  const nameFor = round => {
    if (round.car_names.length) return round.car_names.join(", ");
    const named = round.car_ids.map(id => carNames[id]).filter(Boolean);
    return named.join(", ");
  };

  const { numbers, renumbered } = numberRounds(rounds);

  const races = rounds.map((round, i) => {
    const car = nameFor(round);
    const number = numbers[i];
    const race = {
      name: roundName(round, i),
      round_number: number,
      date: round.date || "",
      track: round.track || "",
      car,
      ...(round.length || {}),
      // Sessions: one Race, which is what a SimRacerHub schedule describes. A
      // league running heats sets that up per event afterwards.
      sessions: ["Race"],
      // "Pts Count: No" on SimRacerHub is a round that runs for nothing, which
      // is this app's championship-points switch for the session (see
      // resolveSessionFlags in lib/standings.js). Only ever written as a NO:
      // the column being absent, or saying Yes, is what every race already
      // does by default.
      ...(round.points_count === false ? { session_points_enabled: { Race: false } } : {}),
      ...sessionTimesFor(round),
    };
    return { race, round, warnings: roundWarnings(round, race) };
  });

  const cars = [...new Set(races.map(r => r.race.car).filter(Boolean))];
  // Every round on the same car is the SEASON's car, not twelve copies of the
  // same override — which is how this app is meant to be set up, and what makes
  // the per-race field mean "this one is different".
  const seasonCar = cars.length === 1 ? cars[0] : "";
  if (seasonCar) for (const r of races) r.race.car = "";

  const tracks = [...new Set(races.map(r => r.race.track).filter(Boolean))];

  return {
    season: {
      name: String(seasonName || parsed?.names?.season || "").trim(),
      car: seasonCar,
    },
    // What SimRacerHub called the levels above this season, for the review
    // table to show — an admin pasting the wrong link should see it at once.
    source: {
      league: parsed?.names?.league || "",
      series: parsed?.names?.series || "",
      season: parsed?.names?.season || "",
    },
    races: races.map(r => r.race),
    rows: races.map(({ race, round, warnings }) => ({
      round_number: race.round_number,
      name: race.name,
      // SimRacerHub's own id for this round, which is what its results page is
      // addressed by. Carried so the season RESULTS importer can offer to fill
      // in every round's link from the schedule, instead of an admin opening
      // twelve pages and copying twelve URLs. See srhPageUrl in lib/srhImport.
      schedule_id: round.schedule_id,
      date: race.date,
      date_text: round.date_text,
      track: race.track,
      length: race.length_type === "time" ? `${race.race_minutes} min` : race.total_laps ? `${race.total_laps} laps` : "",
      length_text: round.length_text,
      car: round.car_names.length ? round.car_names.join(", ") : (round.car_ids.map(id => carNames[id]).filter(Boolean).join(", ")),
      points_count: round.points_count,
      warnings,
    })),
    tracks,
    cars,
    off_weeks: parsed?.off_weeks || 0,
    renumbered,
    warnings: [
      ...(parsed?.warnings || []),
      ...(renumbered && races.length
        ? [`SimRacerHub's own round numbers skip or repeat here (it leaves playoff rounds unnumbered), so these have been numbered 1–${races.length} in date order. The names are unchanged.`]
        : []),
    ],
  };
}

// The session times for a round, in the shape a race doc stores them — but only
// when there is a real clock time AND a zone it was typed in. A time with no
// zone can't be converted for anybody (see lib/raceTimes.js), so it is dropped
// rather than shown in whoever's zone happens to read it.
function sessionTimesFor(round) {
  const times = {};
  let zone = "";
  for (const key of ["practice", "qualifying", "race"]) {
    const t = round.times?.[key];
    if (!t?.time) continue;
    if (t.zone && !zone) zone = t.zone;
    times[key] = t.time;
  }
  if (!zone || !Object.keys(times).length) return {};
  return { show_session_times: true, session_timezone: zone, session_times: times };
}

// What is missing from a round, in the words an admin can act on.
function roundWarnings(round, race) {
  const out = [];
  if (!race.date) out.push(round.date_text ? `Date "${round.date_text}" couldn't be read` : "No date");
  if (blank(race.track)) out.push("No track");
  if (!round.length && round.length_text) out.push(`Length "${round.length_text}" isn't a distance`);
  else if (!round.length) out.push("No race length");
  return out;
}
