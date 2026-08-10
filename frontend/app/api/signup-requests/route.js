import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, getRequestUser, withUser } from "@/lib/serverAuth";
import { normalizeClassIds } from "@/lib/classFilter";
import {
  NUMBER_TAKEN_MESSAGE, matchCarOption, missingSignupFields, missingSignupMessage,
  resolveSignupRules, seasonAcceptsSignups,
} from "@/lib/carSelection";
import { PENDING, numberClaimed, pendingForSeason } from "@/lib/signupQueue";
import { linkedDriver, seasonContext, seasonEntries } from "@/lib/carSelectionServer";
import { missingAliasMessage, missingRequiredAliases } from "@/lib/signupRequest";
import { mergeAliases, normalizeAliases } from "@/lib/aliases";

export const dynamic = "force-dynamic";

// One season's pending sign-ups. Deliberately readable without being an admin,
// but stripped to what the sign-up form needs to show — the name, number and
// car somebody has asked for. No email, no account id: this is the "don't pick
// #24, someone's already waiting on it" list, not the admin queue.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const seasonId = searchParams.get("season_id");
  if (!seasonId) return NextResponse.json({ error: "season_id required" }, { status: 400 });

  const snap = await db().collection("signup_requests")
    .where("season_id", "==", seasonId)
    .where("status", "==", PENDING)
    .get();
  const user = await getRequestUser(request);
  const rows = snap.docs.map(d => {
    const r = d.data();
    return {
      id: d.id,
      name: r.name || r.driver_name || "Driver",
      number: r.number ?? null,
      car: r.car || "",
      manufacturer: r.manufacturer || "",
      class_names: r.class_names || [],
      // Only ever true for the caller's own row, so someone can see their own
      // request in the list without anyone else's account being exposed.
      mine: !!user && r.uid === user.uid,
    };
  });
  return NextResponse.json(rows);
}

// A player submits a sign-up for a season. This NEVER puts them on the roster:
// it files a pending request for an admin to approve or deny (see
// /api/admin/signup-requests/[id]). That holds whether or not the league
// already knows them — an existing driver's request is still a request.
//
// What's required of the submission is whatever the series, season and class
// ask for between them (see resolveSignupRules): a car number, a car, a
// manufacturer, and any alias the game insists on — an iRacing customer ID, so
// the organiser can send a league invite.
export const POST = withUser(async (request, ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const seasonId = String(body.season_id ?? "").trim();
  if (!seasonId) return NextResponse.json({ error: "Missing season_id" }, { status: 400 });

  const context = await seasonContext(seasonId);
  if (!context) return NextResponse.json({ error: "Season not found" }, { status: 404 });
  const { season, series, classes } = context;

  if (!seasonAcceptsSignups(season)) {
    return NextResponse.json(
      { error: `Season over — sign-ups for ${season.name || "that season"} are done.`, code: "season-over" },
      { status: 400 },
    );
  }

  const driver = await linkedDriver(user.uid);

  // A player with no driver profile submits the driver's details with the
  // sign-up; approving the request is what creates the profile. Nothing here
  // creates one.
  const newDriverName = String(body.new_driver?.name ?? "").trim().slice(0, 60);
  const aliases = normalizeAliases(body.aliases ?? body.new_driver?.aliases);
  if (!driver && !newDriverName) {
    return NextResponse.json(
      { error: "Enter the name you race under.", code: "no-driver" },
      { status: 400 },
    );
  }

  // Only classes that belong to this season.
  const validClasses = new Map(classes.map(c => [c.id, c]));
  const classIds = normalizeClassIds(body.class_ids).filter(id => validClasses.has(id));
  // The rules in force for what they picked: a class they're joining can ask
  // for more than the season does.
  const rules = resolveSignupRules({
    series, season,
    cls: classIds.length ? validClasses.get(classIds[0]) : null,
  });

  const number = String(body.number ?? "").trim().slice(0, 3);
  const rawCar = String(body.car ?? "").trim();
  const rawManufacturer = String(body.manufacturer ?? "").trim();

  // Anything picked must be from the admin's own list, matched case-insensitively
  // and stored under the list's spelling.
  let car = "";
  if (rawCar) {
    car = matchCarOption(rules.car_options, rawCar) ?? "";
    if (!car) {
      return NextResponse.json({ error: `“${rawCar}” isn't one of the cars offered for this season.` }, { status: 400 });
    }
  }
  let manufacturer = "";
  if (rawManufacturer) {
    manufacturer = matchCarOption(rules.manufacturer_options, rawManufacturer) ?? "";
    if (!manufacturer) {
      return NextResponse.json({ error: `“${rawManufacturer}” isn't one of the manufacturers offered for this season.` }, { status: 400 });
    }
  }

  const missing = missingSignupFields(rules, { number, car, manufacturer });
  if (missing.length) {
    return NextResponse.json({ error: missingSignupMessage(missing), code: "missing-fields" }, { status: 400 });
  }

  // What this game demands of a sign-up: the Discord name every sign-up needs,
  // plus the platform identities an admin switched on for the game in League
  // Setup (Steam / PSN / Xbox / iRacing). Checked here as well as on the form,
  // because the form is not the security boundary.
  const gameDoc = season.game_id ? await db().collection("games").doc(season.game_id).get() : null;
  const game = gameDoc?.exists ? gameDoc.data() : null;
  const gameName = game?.name || "";
  const missingAliases = missingRequiredAliases(aliases, game);
  if (missingAliases.length) {
    return NextResponse.json({ error: missingAliasMessage(missingAliases), code: "missing-alias" }, { status: 400 });
  }

  // Already racing, or already waiting.
  const [entries, pendingSnap] = await Promise.all([
    seasonEntries(seasonId, classes),
    db().collection("signup_requests")
      .where("season_id", "==", seasonId).where("status", "==", PENDING).get(),
  ]);
  const pending = pendingSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (entries.some(e => (driver && e.driver_id === driver.id) || (e.user_id && e.user_id === user.uid))) {
    return NextResponse.json(
      { error: `You're already on ${season.name || "this season"}'s roster.`, code: "already-entered" },
      { status: 409 },
    );
  }
  if (pendingForSeason(pending, { uid: user.uid, driverId: driver?.id })) {
    return NextResponse.json(
      { error: "You've already got a sign-up waiting for this season. An admin will review it shortly.", code: "already-pending" },
      { status: 409 },
    );
  }

  // A number already on the roster OR already requested by someone else.
  if (number && numberClaimed(entries, pending, number)) {
    return NextResponse.json({ error: NUMBER_TAKEN_MESSAGE, code: "number-taken", number }, { status: 409 });
  }

  const userDoc = await db().collection("users").doc(user.uid).get();
  const u = userDoc.exists ? userDoc.data() : {};
  const leagueId = season.league_id || getRequestLeagueId(request);

  const doc = {
    status: PENDING,
    season_id: season.id,
    season_name: season.name || "Season",
    series_id: season.series_id || "",
    series_name: series?.name || "Series",
    game_id: season.game_id || "",
    game_name: gameName,
    uid: user.uid,
    user_name: u.display_name || user.name || user.email || "Unknown",
    user_email: u.email || user.email || null,
    user_photo: u.photo_url || null,
    // Set for someone the league already knows; null when approving has to
    // create the profile first.
    driver_id: driver?.id ?? null,
    driver_name: driver?.name ?? null,
    new_driver: driver ? null : { name: newDriverName, aliases },
    // What they race under in this series, and what they asked for.
    name: (String(body.name ?? "").trim() || driver?.name || newDriverName).slice(0, 60),
    number,
    car,
    manufacturer,
    class_ids: classIds,
    class_names: classIds.map(id => validClasses.get(id)?.name).filter(Boolean),
    aliases,
    created_at: new Date().toISOString(),
    resolved_at: null,
    resolved_by: null,
    ...(leagueId ? { league_id: leagueId } : {}),
  };
  const ref = await db().collection("signup_requests").add(doc);

  // Sync what they typed straight back onto their global driver profile, so a
  // platform username is asked for ONCE: the next sign-up — for any series, in
  // any game — finds it already saved and fills the field in for them.
  //
  // This happens whether or not the request is ever approved: the answers are
  // about the person, not the roster place, and nothing here touches the
  // roster. A driver with no profile yet carries their answers on the request
  // itself; approving it is what writes them to the profile it creates (see
  // /api/admin/signup-requests/[id]).
  //
  // Merged rather than overwritten — a blank field never erases something the
  // profile already had. Never fail a sign-up over the sync.
  if (driver && aliases.length) {
    try {
      await db().collection("drivers").doc(driver.id)
        .update({ aliases: mergeAliases(driver.aliases, aliases) });
    } catch (err) {
      console.error("Sign-up alias sync failed", err);
    }
  }

  return NextResponse.json({ id: ref.id, ...doc }, { status: 201 });
});
