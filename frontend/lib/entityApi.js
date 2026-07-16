import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { withAdmin } from "@/lib/serverAuth";

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
      if (value !== undefined) doc[name] = opts.number ? Number(value) : value;
      else if (opts.default !== undefined) doc[name] = opts.default;
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
      if (body[name] !== undefined) updates[name] = opts.number ? Number(body[name]) : body[name];
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
             fields: { name: { required: true }, game_id: {}, logo_url: {}, status: { default: "active" },
                       drop_weeks: { number: true, default: 0 }, points_scale: {},
                       race_points: {}, qual_points: {}, bonus_points: {} } },
  teams:   { collection: "teams", parentField: "season_id", sortField: "name",
             fields: { name: { required: true }, logo_url: {}, color: {} } },
  // Global driver pool — identities that exist independently of any season,
  // so an admin can create a driver first and pull them into a series/season
  // (or a race's results) later. See frontend/app/roster/page.js.
  drivers: { collection: "drivers", parentField: null, sortField: "name",
             fields: { name: { required: true }, user_id: {}, notes: {} } },
  entries: { collection: "entries", parentField: "season_id", sortField: "name",
             fields: { name: { required: true }, number: { number: true }, team_id: {}, user_id: {},
                       driver_id: {}, points_adjustment: { number: true }, adjustment_note: {} } },
  pointsTemplates: { collection: "points_templates", parentField: null, sortField: "name",
             fields: { name: { required: true }, race_points: {}, qual_points: {}, bonus_points: {} } },
  races:   { collection: "races", parentField: "season_id", sortField: "round_number",
             fields: { name: { required: true }, track: {}, track_logo_url: {}, date: {},
                       round_number: { number: true, required: true }, sessions: {},
                       // Heat-racing weekend structure: when heat_format is on, `heats` and
                       // `consolations` are ordered lists of session names (each addable/removable
                       // from the event screen) feeding into one Feature session. `session_points`
                       // maps a session name -> points_templates id, so every session (including
                       // Qualifying and standard `sessions`) can carry its own points system.
                       heat_format: {}, heats: {}, consolations: {}, feature_name: { default: "A-Main Feature" },
                       session_points: {} } },
};
