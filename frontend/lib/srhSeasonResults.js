// A whole season of SimRacerHub results → what this app writes for it.
//
// The single-race importer (lib/srhImport.js + the Smart Import dialog) turns
// ONE SimRacerHub race page into tables a statistician reviews and saves, one
// session at a time. That is the right shape for a night that has just been
// run. It is the wrong shape for a season that has already been run: twelve
// rounds of qualifying, heats, a consolation and a feature is sixty passes
// through the same dialog, and the fifty-ninth gets the same care as the first
// only in theory.
//
// So this module answers the two questions a bulk import has to answer for
// itself, the two the review grid otherwise answers by hand:
//
//   planSessions(race, segments)  — which of THIS event's sessions does each
//                                   SimRacerHub session belong in, and which
//                                   sessions does the event not have yet?
//   sessionRows(table, entries…)  — which roster place is each driver, and what
//                                   does their row become?
//
// Both are pure. Neither reads or writes anything: the route feeds them a
// parsed page and a roster, and gets back a plan it can show an admin before a
// single document is written. That is what makes a season import reviewable —
// the preview an admin approves is this plan, and the import is the same plan
// run again against the same pages.
//
// The rules it encodes are the ones the review grid applies by eye:
//   • Practice is skipped. Nothing in this app stores a practice session.
//   • Qualifying goes in the Qualifying grid, and its lap time is a qual time.
//   • Heats, consolations and the feature go in the session of that kind at the
//     same position on the card: SimRacerHub's second heat is this event's
//     second heat, whatever either calls it.
//   • A driver SimRacerHub paid without racing is a Provisional Entry here,
//     carrying the flat points it paid them and no finishing position.
//   • What a driver SCORED can be taken from SimRacerHub outright, which is
//     the only way a league already scored there gets a table here that agrees
//     with it row for row. Its scale, its bonuses, its penalties and its stage
//     points are one figure per driver that no structure here can reproduce, so
//     re-deriving one guarantees the two tables disagree. See `takeSrhPoints`
//     in sessionRows, and `manual_points` in pointsFor.
//
//     Turned off, the older rule applies instead: this season's own structure
//     pays for every position and only the part it cannot work out for itself
//     — a penalty, a bonus of SimRacerHub's own — rides across in the Adj
//     column. Either way it is one figure per row, never two: a row carrying
//     SimRacerHub's total must not also carry its penalty in Adj, or the
//     penalty lands twice.

import { mapHeaders, buildRows } from "@/lib/resultsImport";
import { srhPageUrl } from "@/lib/srhImport";
import { applyAutoFlags } from "@/lib/autoFlags";

// What the results screen calls a session of each kind when the event doesn't
// name one itself — the same defaults RaceEditScreen opens its tabs on, so an
// imported event and a hand-built one grow the same sessions.
export const DEFAULT_STD_SESSION = "Race";
export const DEFAULT_FEATURE_NAME = "A-Main Feature";

// SimRacerHub shouts, and a league's own capitalisation is worth keeping, but a
// session name is compared to the event's existing ones to decide whether it is
// new — so the comparison ignores case and spacing.
const norm = s => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

// A name for a session this event doesn't have yet: SimRacerHub's own, tidied,
// and suffixed only if the event already has something by that name.
function freshName(want, taken) {
  const base = String(want ?? "").trim() || "Session";
  if (!taken.some(t => norm(t) === norm(base))) return base;
  for (let n = 2; n < 40; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.some(t => norm(t) === norm(candidate))) return candidate;
  }
  return `${base} ${Date.now()}`;
}

// ── 1. SimRacerHub's sessions → this event's ──────────────────────────────

// Plan where each session of one SimRacerHub race page lands on one event here.
//
// Returns:
//   sessions   — in running order: { key, srh_name, session, session_type,
//                new, driver_count }. `session` is the name this app will store
//                the rows under, `new` says the event is growing that session.
//   race_update— the fields to PATCH onto the race so those sessions exist, or
//                null when the event already has every one of them.
//   skipped    — { srh_name, reason } for each session that lands nowhere.
//
// The event is only switched into heat format when SimRacerHub actually ran
// heats or a consolation. A league that simply calls its one race "FEATURE"
// keeps a plain event with a plain Race session — turning that into a heat
// weekend would put a tab in front of every session on the event for a
// structure it never ran.
export function planSessions(race = {}, segments = []) {
  const declaredStd = Array.isArray(race.sessions) && race.sessions.length
    ? [...race.sessions] : [DEFAULT_STD_SESSION];
  const declaredHeats = Array.isArray(race.heats) ? [...race.heats] : [];
  const declaredCons = Array.isArray(race.consolations) ? [...race.consolations] : [];
  const featureName = race.feature_name || DEFAULT_FEATURE_NAME;

  const usable = (segments || []).filter(s => s && s.type !== "practice");
  const quals = usable.filter(s => s.type === "qualifying");
  const heats = usable.filter(s => s.type === "heat");
  const cons = usable.filter(s => s.type === "consolation");
  const feats = usable.filter(s => s.type === "feature");
  const plain = usable.filter(s => s.type === "race");

  // Heats or a consolation on the page mean this was a heat night, whatever the
  // event is currently set to — and an event already in heat format stays one,
  // because its sessions ARE its heats, its consolations and its feature. A
  // feature dropped into its standard Race session would be stored somewhere
  // the results screen has no tab for.
  const srhRanHeats = heats.length > 0 || cons.length > 0;
  const heatNight = srhRanHeats || !!race.heat_format;

  const sessions = [];
  const skipped = [];
  const nextHeats = [...declaredHeats];
  const nextCons = [...declaredCons];
  const nextStd = [...declaredStd];

  // Qualifying. One grid, so a page with two qualifying sessions on it imports
  // the first and says so rather than overwriting one with the other.
  quals.forEach((seg, i) => {
    if (i > 0) {
      skipped.push({ srh_name: seg.name, reason: "this event has one Qualifying grid, and an earlier session already filled it" });
      return;
    }
    sessions.push({ key: seg.key, srh_name: seg.name, session: "Qualifying", session_type: "qualifying", new: false, driver_count: seg.driver_count });
  });

  // A list of sessions of one kind, matched position for position against what
  // the event already declares. SimRacerHub's second heat is this event's
  // second heat; a third heat it doesn't have yet is added under SimRacerHub's
  // own name for it.
  const takeInOrder = (segs, declared, type) => {
    segs.forEach((seg, i) => {
      if (i < declared.length) {
        sessions.push({ key: seg.key, srh_name: seg.name, session: declared[i], session_type: type, new: false, driver_count: seg.driver_count });
        return;
      }
      const name = freshName(seg.name, declared);
      declared.push(name);
      sessions.push({ key: seg.key, srh_name: seg.name, session: name, session_type: type, new: true, driver_count: seg.driver_count });
    });
  };

  if (heatNight) {
    takeInOrder(heats, nextHeats, "heat");
    takeInOrder(cons, nextCons, "consolation");
    // The feature is the event's single A-Main. On a heat night with no session
    // SimRacerHub named as one, the plain race on the card is it.
    const featureSegs = feats.length ? feats : plain.slice(0, 1);
    featureSegs.forEach((seg, i) => {
      if (i > 0) {
        skipped.push({ srh_name: seg.name, reason: "this event has one Feature, and an earlier session already filled it" });
        return;
      }
      sessions.push({ key: seg.key, srh_name: seg.name, session: featureName, session_type: "feature", new: false, driver_count: seg.driver_count });
    });
    for (const seg of (feats.length ? plain : plain.slice(1))) {
      skipped.push({ srh_name: seg.name, reason: "a heat night's sessions are its heats, its consolations and its feature — this is none of them" });
    }
  } else {
    // No heats and no consolation: every race on the page is one of the event's
    // standard sessions, in the order it ran — read off the page rather than
    // rebuilt from the two buckets, so two races on one card stay in the order
    // they were run. A lone "FEATURE" is this event's Race.
    takeInOrder(usable.filter(s => s.type === "race" || s.type === "feature"), nextStd, "race");
  }

  // Only what actually changed, so an event that already has its sessions is
  // not written to at all.
  const race_update = {};
  if (srhRanHeats && !race.heat_format) race_update.heat_format = true;
  if (nextHeats.length !== declaredHeats.length) race_update.heats = nextHeats;
  if (nextCons.length !== declaredCons.length) race_update.consolations = nextCons;
  if (nextStd.length !== declaredStd.length) race_update.sessions = nextStd;
  // A heat night on an event that never named its feature gets the default one
  // written down, so the name the results are stored under is the name the
  // editor's Feature tab shows.
  if (heatNight && !race.feature_name) race_update.feature_name = featureName;

  return {
    sessions,
    skipped,
    race_update: Object.keys(race_update).length ? race_update : null,
    heat_night: heatNight,
  };
}

// ── 2. One session's table → the rows to write ────────────────────────────

// Turn one SimRacerHub session table into the rows the results writer stores.
//
// `table` is what srhSegmentTable() hands back — headers, rows, the per-row
// provisional flags and SimRacerHub's itemised points. `entries` is the season
// roster, matched against exactly as the review grid matches it (every name a
// driver answers to: their profile name, their name in this game, and each
// connected account).
//
// Returns { rows, matched, unmatched, provisional, warnings }. `unmatched` is
// the names no roster place could be found for: they are NOT written, and the
// preview lists them so they can be added to the roster and the import re-run.
export function sessionRows(table, entries = [], { sessionType = "race", takeSrhPoints = false } = {}) {
  const parsed = { headers: table?.headers || [], rows: table?.rows || [], delimiter: "srh" };
  const mapping = mapHeaders(parsed.headers, parsed.rows);
  const built = buildRows(parsed, mapping, entries, { sessionType });
  const provisionalFlags = table?.provisional || [];
  const points = table?.points || [];

  // A qualifying sheet has no Provisional Entries section — there is nothing to
  // be provisionally classified in.
  const allowProv = sessionType !== "qualifying";

  const unmatched = [];
  const warnings = [];
  const seen = new Map();
  const placed = [];
  const prov = [];

  built.rows.forEach((row, idx) => {
    const entryId = row.match?.entry_id || null;
    if (!entryId) {
      if (row.rawName) unmatched.push(row.rawName);
      return;
    }
    // The same roster place on two rows of one session. The better finishing
    // position is the one kept — a silently dropped win is the one mistake a
    // bulk import must not make quietly — and the other is called out.
    const already = seen.get(entryId);
    if (already) {
      warnings.push(`${row.rawName || "A driver"} appears twice; the row finishing ${already} was kept.`);
      return;
    }
    seen.set(entryId, row.values.finish_pos);

    const isProv = allowProv && !!provisionalFlags[idx];
    if (isProv) {
      // A driver paid without racing has no finishing position to be scored
      // off, so what SimRacerHub paid them IS their points here.
      prov.push({ entry_id: entryId, manual_points: Number(points[idx]?.total ?? row.values.points ?? 0) || 0 });
      return;
    }

    // What SimRacerHub paid this driver, taken as the row's points outright.
    // The total already contains its penalties and its own bonuses, so nothing
    // goes to Adj as well — that is the double-count this pairing exists to
    // avoid.
    const paid = points[idx]?.total ?? row.values.points;
    const override = takeSrhPoints && paid != null ? Number(paid) : null;

    placed.push({
      entry_id: entryId,
      ...(override != null ? { manual_points: override } : {}),
      finish_pos: row.values.finish_pos,
      start_pos: row.values.start_pos,
      laps: row.values.laps,
      laps_led: row.values.laps_led,
      incidents: row.values.incidents,
      interval: row.values.interval,
      race_time: row.values.race_time,
      qual_time: row.values.qual_time,
      fastest_lap_time: row.values.fastest_lap_time,
      status: row.values.status,
      fastest_lap: !!row.values.fastest_lap,
      // What this app cannot work out for itself — SimRacerHub's penalties and
      // its own bonuses — on top of the points this season's structure pays for
      // the finishing position. Never the finishing points themselves.
      //
      // Zero when the row already carries SimRacerHub's total, which includes
      // them: carrying both would pay every penalty twice.
      points_adjustment: override != null ? 0 : (points[idx]?.carried ?? 0),
    });
  });

  placed.sort((a, b) => (Number(a.finish_pos) || 0) - (Number(b.finish_pos) || 0));

  // Hard Charger and Most Laps Led are derived from the numbers, exactly as the
  // grid derives them while an admin types — so a session imported in bulk
  // carries the same bonus flags as the same session typed in by hand. Fastest
  // Lap comes from the source itself and is left alone.
  const flagged = applyAutoFlags(
    placed.map((r, i) => ({ ...r, slot_id: i })),
    { fastest_lap: true, most_lethal: true },
  ).map(({ slot_id, ...r }) => r);

  // Provisionals are parked behind the field so they can never collide with a
  // real finishing position, which is what the results grid does with them too.
  const maxPos = flagged.reduce((m, r) => Math.max(m, Number(r.finish_pos) || 0), 0);
  const provRows = prov.map((p, i) => ({
    entry_id: p.entry_id,
    finish_pos: maxPos + i + 1,
    provisional: true,
    manual_points: p.manual_points,
    laps: 0, laps_led: 0, incidents: 0, status: "finished",
  }));

  return {
    rows: [...flagged, ...provRows],
    matched: flagged.length + provRows.length,
    provisional: provRows.length,
    unmatched,
    warnings,
  };
}

// ── 3. One race's whole page → its plan ───────────────────────────────────

// Every session except qualifying is a race of some kind — a heat, a
// consolation, the feature or the event's own Race.
const isRaceSession = s => s.session_type !== "qualifying";

// Everything the importer will do to one event, ready to be shown before it is
// done. `doc` is parseSrhPage()'s output with each segment's table attached as
// `table` (see the route). Sessions with nothing to write — every driver in
// them unmatched — are still reported, because "nobody in this heat is on your
// roster" is the single most useful thing a preview can say.
export function planRace(race, doc, entries = [], { takeSrhPoints = false } = {}) {
  const plan = planSessions(race, doc?.segments || []);
  const byKey = new Map((doc?.segments || []).map(s => [s.key, s]));

  const unmatched = new Set();
  const sessions = plan.sessions.map(s => {
    const segment = byKey.get(s.key);
    const built = sessionRows(segment?.table, entries, { sessionType: s.session_type, takeSrhPoints });
    for (const name of built.unmatched) unmatched.add(name);
    return {
      ...s,
      rows: built.rows,
      matched: built.matched,
      provisional: built.provisional,
      unmatched: built.unmatched,
      warnings: built.warnings,
      // The session's own caution / lead-change figures. Only the session that
      // decides the event — its feature, or its race — carries them onto the
      // event itself: a heat's cautions are not the night's.
      stats: segment?.stats || null,
    };
  });

  // Which session's figures become the event's race statistics. The feature on
  // a heat night, otherwise the last standard race of the day — the same
  // session every public screen treats as the event's main race.
  const mainIdx = (() => {
    const feature = sessions.findIndex(s => s.session_type === "feature");
    if (feature >= 0) return feature;
    for (let i = sessions.length - 1; i >= 0; i--) if (isRaceSession(sessions[i])) return i;
    return -1;
  })();
  const stats = mainIdx >= 0 ? sessions[mainIdx].stats : null;

  return {
    sessions,
    skipped: plan.skipped,
    race_update: plan.race_update,
    heat_night: plan.heat_night,
    unmatched: [...unmatched],
    // The event's own figures (cautions, caution laps, lead changes), from the
    // session that decides the night. Null when SimRacerHub printed none.
    stats,
    stats_session: mainIdx >= 0 ? sessions[mainIdx].session : "",
    rows_total: sessions.reduce((n, s) => n + s.rows.length, 0),
  };
}


// ── 4. A season's schedule → a link per round ─────────────────────────────

// Pair this season's rounds with the rounds on a SimRacerHub schedule, so the
// dialog can fill in every round's results link from one season link instead of
// an admin opening twelve pages and copying twelve URLs.
//
// Round numbers first, because that is what both sides call a round and it
// survives a season whose rounds were created out of order. When neither side's
// numbering lines up — a league that renumbered here, or a SimRacerHub schedule
// that leaves its playoff rounds unnumbered — the two lists are paired down the
// page instead, which is date order on both. Nothing is guessed at beyond that:
// a round with no partner is simply left empty for the admin to paste into.
//
// `races` are this app's, in the order they are shown; `rows` are what
// /api/import-srh-season's preview returned. Returns { [race_id]: url }.
export function matchScheduleToRaces(races = [], rows = []) {
  const withId = rows.filter(r => r && r.schedule_id);
  const url = row => srhPageUrl("schedule_id", row.schedule_id);

  const byRound = new Map();
  for (const row of withId) {
    const n = Number(row.round_number);
    if (Number.isInteger(n) && n >= 1 && !byRound.has(n)) byRound.set(n, row);
  }

  const out = {};
  let hits = 0;
  for (const race of races) {
    const row = byRound.get(Number(race.round_number));
    if (!row) continue;
    out[race.id] = url(row);
    hits += 1;
  }
  // A round number matched for at least half the calendar means the numbering
  // agrees and the gaps are genuinely missing rounds. Below that the two are
  // numbered differently, and pairing them down the page is the better guess.
  if (hits * 2 >= Math.min(races.length, withId.length) && hits > 0) return out;

  const paired = {};
  for (let i = 0; i < races.length && i < withId.length; i++) paired[races[i].id] = url(withId[i]);
  return paired;
}

// ── 5. The names the roster doesn't have ──────────────────────────────────

// Every driver on the season's pages that no roster place could be found for,
// gathered across the rounds they appeared on.
//
// The importer leaves those rows out rather than guessing at them, which is
// right — but "3 drivers not on the roster" on each of eleven rounds is the
// same handful of people said eleven times, and an admin fixing it needs the
// people, not the repetitions. So this folds the per-round lists into one list
// of names, each carrying the rounds it was seen on.
//
// Ordered by how much is riding on each: the driver missing from nine rounds
// is nine rounds of results going nowhere, and is what to resolve first.
// Compared case-insensitively, because SimRacerHub is not consistent about it,
// and the first spelling seen is the one shown.
//
// `rounds` are { race_id, label } as the dialog knows them, so a name can be
// traced back to the rounds it will fix.
export function unmatchedRoster(reports = []) {
  const byKey = new Map();
  for (const report of reports) {
    if (!report) continue;
    for (const raw of report.unmatched || []) {
      const name = String(raw ?? "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!byKey.has(key)) byKey.set(key, { name, rounds: [] });
      const seen = byKey.get(key);
      if (!seen.rounds.some(r => r.race_id === report.race_id)) {
        seen.rounds.push({ race_id: report.race_id, label: report.label || "" });
      }
    }
  }
  return [...byKey.values()].sort(
    (a, b) => b.rounds.length - a.rounds.length || a.name.localeCompare(b.name),
  );
}

// Which missing driver to put in front of the admin next.
//
// The importer's roster panel WORKS its list rather than displaying it: one
// name is active, answering it opens the next. This is the "next" — the first
// unanswered name BELOW the one just dealt with, wrapping back to the top so a
// list worked out of order still finishes, and never the name just answered
// (whose answer hasn't reached this function's `answered` set yet, because it
// was set in the same tick).
//
// `keys` are the names in the order they are shown, `answered` the ones already
// resolved or left off. "" when there is nothing left, which is what ends the
// run.
export function nextUnanswered(keys = [], fromKey = "", answered = []) {
  const done = answered instanceof Set ? answered : new Set(answered);
  const from = keys.indexOf(fromKey);
  // From the one after it, round to the one before it.
  const order = from < 0 ? [...keys] : [...keys.slice(from + 1), ...keys.slice(0, from + 1)];
  return order.find(k => k !== fromKey && !done.has(k)) || "";
}
