// The race dates every season is ordered by — read once, attached to the season
// docs the API hands out. See lib/seasonOrder.js for the ordering itself.
//
// The dates aren't stored on the season: a season's span is simply the earliest
// and latest date on its schedule, and deriving it here means adding, moving or
// deleting a race reorders the menus by itself, with nothing to keep in sync.

import { db } from "@/lib/firebase";
import { toDateOnly } from "@/lib/raceDate";
import { sortSeasons } from "@/lib/seasonOrder";

// Firestore caps an `in` filter at 30 values, so the per-season read is chunked
// — but past a few chunks one whole-collection read and an in-memory group is
// the cheaper shape (the same trade the league-wide stats routes make).
const IN_CHUNK = 30;
const CHUNK_LIMIT = 3;

// season id -> { first_race_date, last_race_date }, for the seasons asked about.
// Seasons with no dated races are absent from the result.
export async function fetchSeasonRaceDates(seasonIds = []) {
  const ids = [...new Set(seasonIds.filter(Boolean))];
  if (!ids.length) return {};

  let docs;
  if (ids.length > IN_CHUNK * CHUNK_LIMIT) {
    docs = (await db().collection("races").get()).docs;
  } else {
    const chunks = [];
    for (let i = 0; i < ids.length; i += IN_CHUNK) chunks.push(ids.slice(i, i + IN_CHUNK));
    const snaps = await Promise.all(
      chunks.map(chunk => db().collection("races").where("season_id", "in", chunk).get()),
    );
    docs = snaps.flatMap(snap => snap.docs);
  }

  const wanted = new Set(ids);
  const out = {};
  for (const doc of docs) {
    const race = doc.data();
    if (!wanted.has(race.season_id)) continue;
    // Bare `YYYY-MM-DD` calendar dates compare correctly as strings — see
    // lib/raceDate.js for why they're never turned into Date objects here.
    const date = toDateOnly(race.date);
    if (!date) continue;
    const span = out[race.season_id];
    if (!span) { out[race.season_id] = { first_race_date: date, last_race_date: date }; continue; }
    if (date < span.first_race_date) span.first_race_date = date;
    if (date > span.last_race_date) span.last_race_date = date;
  }
  return out;
}

// Stamp each season with the span of its schedule. Seasons with no dated races
// carry empty strings, so every row has the fields whether or not it raced yet.
export function attachRaceDates(seasons = [], datesById = {}) {
  return seasons.map(s => ({
    first_race_date: "",
    last_race_date: "",
    ...s,
    ...(datesById[s.id] || {}),
  }));
}

// Seasons decorated with their race dates AND put in display order — newest
// first, or whatever order an admin arranged by hand. This is what every season
// list the app renders goes through.
export async function orderSeasons(seasons = []) {
  if (!seasons.length) return [];
  const dates = await fetchSeasonRaceDates(seasons.map(s => s.id));
  return sortSeasons(attachRaceDates(seasons, dates));
}
