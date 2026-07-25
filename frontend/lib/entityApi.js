import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin, getRequestLeagueId, scopeByLeague } from "@/lib/serverAuth";
import { toDateOnly } from "@/lib/raceDate";

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
export function makeCollectionRoutes({ collection, parentField, fields, sortField = "created_at" }) {
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
    const ref = await db().collection(collection).add(doc);
    return NextResponse.json({ id: ref.id, ...doc }, { status: 201 });
  });

  return { GET, POST };
}

export function makeDocRoutes({ collection, fields }) {
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
  series:  { collection: "series", parentField: "game_id", sortField: "name",
             fields: { name: { required: true }, logo_url: {}, description: {} } },
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
             fields: { name: { required: true }, game_id: {}, logo_url: {}, status: { default: "active" },
                       drop_weeks: { number: true, default: 0 }, points_scale: {}, car: {},
                       race_points: {}, qual_points: {}, bonus_points: {},
                       combined_championship: { bool: true, default: true },
                       per_class_schedules: { bool: true, default: false } } },
  // Classes divide a season's field into separately-scored groups ("Pro" /
  // "Amateur", "GT3" / "LMP2"). A class belongs to exactly one season; a roster
  // entry points at one with `class_id`, and each saved result carries the class
  // the driver ran in (see /api/results). `sort_order` fixes the display order of
  // the class dropdown (lowest first), so "Pro" can sit above "Amateur"
  // regardless of which was created first.
  classes: { collection: "classes", parentField: "season_id", sortField: "sort_order",
             fields: { name: { required: true }, color: {}, description: {},
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
  drivers: { collection: "drivers", parentField: null, sortField: "name",
             fields: { name: { required: true }, user_id: {}, notes: {},
                       skillRating: { number: true }, skillRatings: {}, aliases: {},
                       // Names this driver was previously known as — appended when
                       // another driver is merged into them (see /api/admin/drivers/merge).
                       merged_names: {} } },
  // `number` is the car number — stored as a STRING (max 3 chars) so racing
  // numbers with leading zeros ("01", "001", "0", "00", "000") survive intact
  // instead of being parsed to an integer that drops the zeros.
  // `class_id` is the season class this driver races in (see SPECS.classes);
  // blank/absent means unclassified, which still counts toward the season's
  // overall championship but toward no class championship.
  entries: { collection: "entries", parentField: "season_id", sortField: "name",
             fields: { name: { required: true }, number: { maxLen: 3 }, team_id: {}, user_id: {},
                       driver_id: {}, class_id: {}, points_adjustment: { number: true }, adjustment_note: {} } },
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
             fields: { name: { required: true }, track: {}, track_id: {}, track_logo_url: {}, date: { dateOnly: true },
                       class_id: {},
                       round_number: { number: true, required: true }, sessions: {},
                       total_laps: { number: true }, car: {},
                       // Heat-racing weekend structure: when heat_format is on, `heats` and
                       // `consolations` are ordered lists of session names (each addable/removable
                       // from the event screen) feeding into one Feature session. `session_points`
                       // maps a session name -> points_templates id, so every session (including
                       // Qualifying and standard `sessions`) can carry its own points system.
                       // `session_stats` / `session_points_enabled` map a session name -> boolean,
                       // letting an admin exclude a session from official stats and/or championship
                       // points (see resolveSessionFlags in lib/standings.js for the defaults).
                       heat_format: {}, heats: {}, consolations: {}, feature_name: { default: "A-Main Feature" },
                       session_points: {}, session_stats: {}, session_points_enabled: {},
                       // `strength_of_field` records the average Skill Rating of the field that
                       // started this event's main race (Race, or the Feature for heat weekends).
                       // Written by the stats engine on save; null when SR wasn't exchanged.
                       strength_of_field: { number: true } } },
};
