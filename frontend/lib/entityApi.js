import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin, getRequestLeagueId, scopeByLeague } from "@/lib/serverAuth";
import { toDateOnly } from "@/lib/raceDate";
import { normalizeClassIds } from "@/lib/classFilter";

// A roster entry's classes are stored twice on purpose: `class_ids` is the real
// list (a driver can race several classes in one season) and `class_id` mirrors
// the first of them, so every reader written before multi-class — and every
// result stamped from an entry — still resolves. Whichever half a caller sends,
// this derives the other so the two can never drift apart.
function normalizeEntryClasses(patch) {
  if (patch.class_ids !== undefined) {
    const ids = normalizeClassIds(patch.class_ids);
    return { class_ids: ids, class_id: ids[0] || "" };
  }
  if (patch.class_id !== undefined) {
    const id = String(patch.class_id ?? "").trim();
    return { class_id: id, class_ids: id ? [id] : [] };
  }
  return null;
}

// Coerce/validate one field value against its spec. Returns { value } or
// { error }. `number: true` parses to a Number; `maxLen` marks a string field
// (e.g. a car number) that must be kept as text — trimmed and length-capped so
// leading-zero values like "01"/"001"/"000" are stored verbatim, never parsed
// to an integer that would drop the zeros. `dateOnly: true` strips any time
// component so a schedule date is stored as a bare YYYY-MM-DD calendar date
// (see lib/raceDate.js — a date with a time in it is what makes a race display
// a day early in western timezones). `bool: true` stores a real boolean, so an
// explicit `false` is preserved rather than read back as "unset".
export function coerceField(opts, raw) {
  if (opts.dateOnly) return { value: toDateOnly(raw) };
  if (opts.bool) return { value: !!raw };
  if (opts.maxLen != null) {
    const value = String(raw ?? "").trim();
    if (value.length > opts.maxLen) return { error: `must be at most ${opts.maxLen} characters` };
    return { value };
  }
  return { value: opts.number ? Number(raw) : raw };
}

// Shared CRUD factory for the hierarchy collections (games, series, seasons,
// teams, entries, races). Reads are public; writes require an admin.
export function makeCollectionRoutes({ collection, parentField, fields, sortField = "created_at", normalize = null }) {
  async function GET(request) {
    const { searchParams } = new URL(request.url);
    let query = db().collection(collection);
    if (parentField) {
      const parent = searchParams.get(parentField);
      if (!parent) {
        return NextResponse.json({ error: `${parentField} required` }, { status: 400 });
      }
      query = query.where(parentField, "==", parent);
    }
    // Scope every hierarchy/pool collection to the active league (equality-only
    // filters need no composite index; sorting is done in-memory below).
    query = scopeByLeague(query, getRequestLeagueId(request));
    const snap = await query.get();
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    docs.sort((a, b) => {
      const av = a[sortField], bv = b[sortField];
      if (typeof av === "number" && typeof bv === "number") return av - bv;
      return String(av ?? "").localeCompare(String(bv ?? ""));
    });
    return NextResponse.json(docs);
  }

  const POST = withAdmin(async (request, ctx, user) => {
    const body = await request.json();
    const doc = { created_at: new Date().toISOString(), created_by: user.uid };
    // Stamp the active league so new rows are partitioned like migrated ones.
    // Absent header (pre-migration) leaves it unset; a later migration run
    // backfills it.
    const leagueId = getRequestLeagueId(request);
    if (leagueId) doc.league_id = leagueId;
    if (parentField) {
      if (!body[parentField]) {
        return NextResponse.json({ error: `${parentField} required` }, { status: 400 });
      }
      doc[parentField] = body[parentField];
    }
    for (const [name, opts] of Object.entries(fields)) {
      const value = body[name];
      if (opts.required && (value === undefined || value === null || value === "")) {
        return NextResponse.json({ error: `${name} required` }, { status: 400 });
      }
      if (value !== undefined) {
        const coerced = coerceField(opts, value);
        if (coerced.error) return NextResponse.json({ error: `${name} ${coerced.error}` }, { status: 400 });
        doc[name] = coerced.value;
      } else if (opts.default !== undefined) doc[name] = opts.default;
    }
    // Derived fields the spec keeps in sync (e.g. an entry's class_id/class_ids).
    if (normalize) Object.assign(doc, normalize(doc) || {});
    const ref = await db().collection(collection).add(doc);
    return NextResponse.json({ id: ref.id, ...doc }, { status: 201 });
  });

  return { GET, POST };
}

export function makeDocRoutes({ collection, fields, normalize = null }) {
  const PATCH = withAdmin(async (request, { params }) => {
    const body = await request.json();
    const updates = {};
    for (const [name, opts] of Object.entries(fields)) {
      if (body[name] !== undefined) {
        const coerced = coerceField(opts, body[name]);
        if (coerced.error) return NextResponse.json({ error: `${name} ${coerced.error}` }, { status: 400 });
        updates[name] = coerced.value;
      }
    }
    if (normalize) Object.assign(updates, normalize(updates) || {});
    if (!Object.keys(updates).length) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }
    const ref = db().collection(collection).doc(params.id);
    const doc = await ref.get();
    if (!doc.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await ref.update(updates);
    return NextResponse.json({ id: params.id, ...doc.data(), ...updates });
  });

  const DELETE = withAdmin(async (request, { params }) => {
    await db().collection(collection).doc(params.id).delete();
    return NextResponse.json({ ok: true });
  });

  return { PATCH, DELETE };
}

// Field specs shared between the list POST and doc PATCH routes.
export const SPECS = {
  games:   { collection: "games", parentField: null, sortField: "name",
             fields: { name: { required: true }, logo_url: {}, description: {} } },
  // `isBangerRacing` flags the series as Demo Derby / Banger Racing. It turns on
  // the mode-specific stats (Takedowns, Survival Bonus, Most Lethal Bonus — see
  // lib/bangerRacing.js): the results grids of its events grow inputs for them,
  // the points structures grow a bonus value for each, and Standings/Stats show
  // their totals — but ONLY while the viewer is scoped to this series. Off (the
  // default) the series behaves exactly as every series did before.
  // `race_points` / `qual_points` / `bonus_points` are the series' points
  // structure — the DEFAULT every season in it scores on, in the same shape a
  // season, a class and a points template use:
  //
  //     series (default) → season → class → the session's template
  //
  // Each level overrides only what it sets, so a league configures its points
  // once here and adjusts a season or a class where they genuinely differ.
  // Leaving them unset (the default) changes nothing: the season stays the top
  // of the chain, exactly as before series points existed.
  // `isBracketRacing` flags the series as Bracket Style Racing (drag racing and
  // other elimination-tournament formats — see lib/bracketRacing.js). It adds
  // no stats and no bonuses: it changes only how a results grid is SHAPED, so
  // the drivers knocked out in the same round share one finishing position
  // (two 3rd places for the semi-final losers, four 4ths for the quarters).
  // Those finishes are ordinary racing finishes and cascade into Wins, Top 5s,
  // Average Finish and the Overall/Game views exactly like any other result.
  // `require_car_selection` / `car_options` / `car_selection_note` /
  // `car_selection_locked` are the car lock-in settings, carried identically by
  // a series, a season and a class (see lib/carSelection.js). On, every driver
  // on the roster is asked to lock in the car they'll race from `car_options`,
  // from the Series Information section of their Dashboard; the pick is stored
  // on their roster entry. A series' settings cover every season and class in
  // it, and the most specific car list wins — the same inheritance the points
  // structure and the season's car use.
  series:  { collection: "series", parentField: "game_id", sortField: "name",
             fields: { name: { required: true }, logo_url: {}, description: {},
                       race_points: {}, qual_points: {}, bonus_points: {},
                       isBangerRacing: { bool: true, default: false },
                       isBracketRacing: { bool: true, default: false },
                       require_car_selection: { bool: true, default: false },
                       car_options: {}, car_selection_note: {},
                       car_selection_locked: { bool: true, default: false } } },
  seasons: { collection: "seasons", parentField: "series_id", sortField: "created_at",
             // `car` is the free-text car/model this season races (e.g. "NASCAR
             // Next Gen", "GT3"). It's the season-wide default; a race can
             // override it with its own `car` (see SPECS.races).
             // `combined_championship` decides whether a multi-class season also
             // tracks ONE overall championship across the whole field, on top of
             // each class's own championship. On (the default) the "All Classes"
             // view is the official combined table; off, the season is class
             // championships only and that combined view is labelled unofficial.
             // Ignored when the season has no classes.
             //
             // `per_class_schedules` opens up the schedule to classes: off (the
             // default) every class shares ONE season schedule, exactly as before
             // classes existed. On, a race can be pinned to a single class via
             // races.class_id, so each class can run its own calendar — races left
             // unpinned stay shared by every class, which is what makes a mixed
             // schedule (a shared opener, then class-specific rounds) possible.
             //
             // `per_class_results` is the other half of that: it splits the
             // SESSIONS of a shared event by class, so classes racing the same
             // round each get their own Qualifying and Race — their own pole,
             // P1 and field — instead of one combined grid. It's only the
             // default for new events; each event carries its own
             // `per_class_results` (see SPECS.races) and can differ.
             //
             // `isBangerRacing` runs THIS season as Demo Derby / Banger Racing
             // even when the series around it is ordinary racing — a one-off
             // derby year. It adds to the series flag rather than overriding it
             // (see lib/bangerRacing.js), and a single class can carry it too.
             //
             // `banger_mode` is the season's own answer to "is this a derby
             // season?": "" follows its classes (the default), "on" is the whole
             // season, "off" keeps it a racing season even when one of its
             // classes IS a derby — that class stays a derby on its own. See
             // BANGER_MODES in lib/bangerRacing.js.
             //
             // `status` is "active" (the default) or "completed". A completed
             // season is history: players can neither sign themselves up for it
             // nor change a locked-in car, which is what keeps the Dashboard's
             // Series Information section to upcoming and running seasons.
             //
             // `require_car_selection` & friends are this season's car lock-in
             // settings — see SPECS.series above and lib/carSelection.js.
             fields: { name: { required: true }, game_id: {}, logo_url: {}, status: { default: "active" },
                       isBangerRacing: { bool: true, default: false }, banger_mode: {},
                       drop_weeks: { number: true, default: 0 }, points_scale: {}, car: {},
                       race_points: {}, qual_points: {}, bonus_points: {},
                       combined_championship: { bool: true, default: true },
                       per_class_schedules: { bool: true, default: false },
                       per_class_results: { bool: true, default: false },
                       require_car_selection: { bool: true, default: false },
                       car_options: {}, car_selection_note: {},
                       car_selection_locked: { bool: true, default: false } } },
  // Classes divide a season's field into separately-scored groups ("Pro" /
  // "Amateur", "GT3" / "LMP2"). A class belongs to exactly one season; a roster
  // entry points at one with `class_id`, and each saved result carries the class
  // the driver ran in (see /api/results). `sort_order` fixes the display order of
  // the class dropdown (lowest first), so "Pro" can sit above "Amateur"
  // regardless of which was created first.
  // `car` is the free-text car/model this class races ("GT3", "LMP2", "Late
  // Model"). It sits between the season's car and a race's own override — see
  // carForRace in lib/classFilter.js — so a season whose classes run different
  // machinery shows the right car per class without setting it on every event.
  //
  // `race_points` / `qual_points` / `bonus_points` are the class's OWN points
  // structure, in the same shape a season and a points template use — so a
  // class sits between the two as an override layer: season default → class
  // structure → session template. Every field is optional and only overrides
  // what it sets, and all three left unset (the default) means the class scores
  // on the season's points exactly as it always did. See classScoresOwnPoints /
  // configForClass in lib/standings.js.
  //
  // `isBangerRacing` makes THIS class a Demo Derby / Banger Racing class, which
  // is how a season runs a Banger class alongside ordinary racing ones: only
  // this class's results capture takedowns/survival/most-lethal, and only its
  // standings show them. A flagged series or season already covers every class
  // under it — see lib/bangerRacing.js.
  //
  // `isBracketRacing` makes THIS class a Bracket Style Racing class — a drag
  // racing class running its elimination ladder alongside the season's ordinary
  // racing classes. Only its results grid takes the bracket layout (and the
  // tied finishing positions that come with it); a flagged series already
  // covers every class under it. See lib/bracketRacing.js.
  //
  // `require_car_selection` & friends are this class's car lock-in settings —
  // see SPECS.series and lib/carSelection.js. A class that sets a list of its
  // own asks ITS drivers for their own pick, so a GT3 class and an LMP2 class
  // in one season each lock in from their own machinery; a class that sets
  // nothing simply inherits the season's question.
  classes: { collection: "classes", parentField: "season_id", sortField: "sort_order",
             fields: { name: { required: true }, color: {}, description: {}, car: {},
                       isBangerRacing: { bool: true, default: false },
                       isBracketRacing: { bool: true, default: false },
                       race_points: {}, qual_points: {}, bonus_points: {},
                       require_car_selection: { bool: true, default: false },
                       car_options: {}, car_selection_note: {},
                       car_selection_locked: { bool: true, default: false },
                       sort_order: { number: true, default: 0 } } },
  teams:   { collection: "teams", parentField: "season_id", sortField: "name",
             fields: { name: { required: true }, logo_url: {}, color: {} } },
  // Global driver pool — identities that exist independently of any season,
  // so an admin can create a driver first and pull them into a series/season
  // (or a race's results) later. See frontend/app/roster/page.js.
  // `skillRatings` is a MAP of game_id -> Elo-style Skill Rating: SR is gated
  // per game (skill in GT7 doesn't carry to iRacing), so each game a driver
  // races in gets its own rating, seeded at the baseline (1500) and maintained
  // by the stats engine after each main race — see lib/skillRating.js and
  // lib/skillRatingServer.js. The legacy single `skillRating` number is kept for
  // backward-compat reads but is no longer written. `aliases` is an ordered list
  // of { label, value } connected-account identities (Discord/PSN/Xbox/… — see
  // lib/aliases.js) the importer also matches imported names against.
  // `display_name` overrides the name shown everywhere that isn't tied to one
  // game, and `game_names` ([{ game_id, name }]) sets the name shown on each
  // game's own pages — see lib/driverNames.js.
  drivers: { collection: "drivers", parentField: null, sortField: "name",
             fields: { name: { required: true }, user_id: {}, notes: {},
                       display_name: {}, game_names: {},
                       skillRating: { number: true }, skillRatings: {}, aliases: {},
                       // Names this driver was previously known as — appended when
                       // another driver is merged into them (see /api/admin/drivers/merge).
                       merged_names: {} } },
  // `number` is the car number — stored as a STRING (max 3 chars) so racing
  // numbers with leading zeros ("01", "001", "0", "00", "000") survive intact
  // instead of being parsed to an integer that drops the zeros.
  // `class_ids` are the season classes this driver races in (see SPECS.classes)
  // — a driver can run several, so they appear in each of those class
  // championships from one roster entry instead of needing a duplicate entry
  // per class. Empty means unclassified, which still counts toward the season's
  // overall championship but toward no class championship. `class_id` mirrors
  // the first of them (the primary class) for everything written before
  // multi-class; `normalize` keeps the two in step whichever one is sent.
  // `selected_car` is the car this driver locked in for the season, and
  // `selected_cars` ({ class_id: car }) their pick in each class that runs its
  // own car list — `selected_car` mirrors the most recent of them the same way
  // `class_id` mirrors `class_ids[0]`, so a single-field reader always
  // resolves. Players write these themselves through /api/car-selection (which
  // checks they own the driver profile); they're editable here so an admin can
  // correct one. See lib/carSelection.js.
  entries: { collection: "entries", parentField: "season_id", sortField: "name",
             normalize: normalizeEntryClasses,
             fields: { name: { required: true }, number: { maxLen: 3 }, team_id: {}, user_id: {},
                       driver_id: {}, class_id: {}, class_ids: {},
                       selected_car: {}, selected_cars: {}, selected_car_at: {},
                       points_adjustment: { number: true }, adjustment_note: {} } },
  pointsTemplates: { collection: "points_templates", parentField: null, sortField: "name",
             fields: { name: { required: true }, race_points: {}, qual_points: {}, bonus_points: {} } },
  // Global venue pool — tracks exist independently of any season and are pulled
  // into a race event by reference (races.track_id). `length` and `track_type`
  // are free text ("2.5 mi", "Oval"/"Road Course"/"Dirt Oval"/…) so the stats
  // engine never has to parse them; the pickers offer the canonical list in
  // lib/trackTypes.js. See frontend/app/tracks/page.js and
  // frontend/lib/trackStatsServer.js.
  tracks:  { collection: "tracks", parentField: null, sortField: "name",
             fields: { name: { required: true }, location: {}, length: {}, track_type: {},
                       logo_url: {}, notes: {} } },
  races:   { collection: "races", parentField: "season_id", sortField: "round_number",
             // `track_id` references a global tracks doc; `track` still stores the
             // resolved track NAME (kept in sync from the dropdown) so every place
             // that renders a race's venue as text keeps working, and legacy
             // free-text races with no track_id still display.
             // `car` overrides the season's default car for this one event
             // (blank = inherit the season's car).
             // `date` is a bare YYYY-MM-DD calendar date with NO time component
             // — the day the admin picked, stored and rendered verbatim in every
             // timezone (see lib/raceDate.js).
             // `class_id` pins the event to ONE class of its season, so that class
             // can run its own calendar; blank (the default, and the only value
             // used while the season's per_class_schedules toggle is off) means the
             // event is shared by every class. See raceInClass in lib/classServer.
             // `per_class_results` splits this event's sessions by class: each
             // class enters its own Qualifying and Race, with its own pole, P1
             // and field, rather than sharing one combined grid. Absent (the
             // default) inherits the season's setting — see racePerClassResults
             // in lib/classFilter.js — so an admin can flip the whole season at
             // once and still override a single event.
             fields: { name: { required: true }, track: {}, track_id: {}, track_logo_url: {}, date: { dateOnly: true },
                       class_id: {}, per_class_results: { bool: true },
                       round_number: { number: true, required: true }, sessions: {},
                       // How this event's distance is measured: `length_type` is
                       // "laps" (the default, and what every pre-toggle race reads
                       // as), "time" or "rounds". A lap race carries `total_laps`;
                       // a timed race carries `race_minutes` and runs to the clock;
                       // a rounds race carries `total_rounds`. See lib/raceLength.js.
                       length_type: {}, total_laps: { number: true }, race_minutes: { number: true },
                       total_rounds: { number: true }, car: {},
                       // Bracket Style Racing: how big the elimination ladder
                       // this event ran was — 4, 8, 16 or 32 drivers. It's what
                       // the results grid builds its finishing positions from
                       // (an 8 gives 1, 2, 3, 3, 4, 4, 4, 4), so it's per RACE
                       // rather than per season: a league can run an 8-car
                       // bracket one week and a 16 the next. Unset on every
                       // ordinary race, where the grid runs 1..N as always.
                       // See lib/bracketRacing.js.
                       bracket_size: { number: true },
                       // Heat-racing weekend structure: when heat_format is on, `heats` and
                       // `consolations` are ordered lists of session names (each addable/removable
                       // from the event screen) feeding into one Feature session. `session_points`
                       // maps a session name -> points_templates id, so every session (including
                       // Qualifying and standard `sessions`) can carry its own points system.
                       // `session_points_by_class` is the same map one level deeper —
                       // class scope -> { session name -> points_templates id } — for an
                       // event whose classes run their own sessions, so Pro's Race and
                       // Amateur's Race at the same event can score differently. A class
                       // with no entry for a session falls back to `session_points`, then
                       // to the class's own structure, then to the season's.
                       // `session_stats` / `session_points_enabled` map a session name -> boolean,
                       // letting an admin exclude a session from official stats and/or championship
                       // points (see resolveSessionFlags in lib/standings.js for the defaults).
                       heat_format: {}, heats: {}, consolations: {}, feature_name: { default: "A-Main Feature" },
                       session_points: {}, session_points_by_class: {}, session_stats: {}, session_points_enabled: {},
                       // `strength_of_field` records the average Skill Rating of the field that
                       // started this event's main race (Race, or the Feature for heat weekends).
                       // Written by the stats engine on save; null when SR wasn't exchanged.
                       strength_of_field: { number: true } } },
};
