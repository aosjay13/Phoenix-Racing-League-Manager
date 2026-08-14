import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, getRequestUser, withUser } from "@/lib/serverAuth";
import { normalizeClassIds } from "@/lib/classFilter";
import {
  NUMBER_TAKEN_MESSAGE, carCapacity, carCounts, carFullMessage, matchCarOption, missingSignupFields,
  missingSignupMessage, resolveSignupRules, seasonAcceptsSignups,
} from "@/lib/carSelection";
import {
  NUMBER_CHANGE_KIND, PENDING, SIGNUP_KIND, isOwnNumber, numberClaimed,
  numberRequestFor, pendingForSeason, requestKind,
} from "@/lib/signupQueue";
import {
  linkedDriver, openRequestsForSeason, seasonContext, seasonEntries,
} from "@/lib/carSelectionServer";
import {
  missingAliasMessage, missingRequiredAliases, userAccountUpdatesFromSignup,
} from "@/lib/signupRequest";
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

  const open = await openRequestsForSeason(seasonId);
  const user = await getRequestUser(request);
  const rows = open.map(r => {
    return {
      id: r.id,
      kind: r.kind || SIGNUP_KIND,
      entry_id: r.entry_id ?? null,
      name: r.name || r.driver_name || "Driver",
      number: r.number ?? null,
      car: r.car || "",
      class_names: r.class_names || [],
      // Only ever true for the caller's own row, so someone can see their own
      // request in the list without anyone else's account being exposed.
      mine: !!user && r.uid === user.uid,
    };
  });
  return NextResponse.json(rows);
}

// "Please change my car number to #12", from a driver already on the roster.
//
// Files a pending row and edits NOTHING — the number only moves when an admin
// approves it (see /api/admin/signup-requests/[id]), because a car number is
// unique in a season and handing them out is the league's call. The number is
// checked against the roster AND the queue here so an obviously-taken one is
// refused up front rather than sitting in the queue to be denied later; it's
// checked again at approval, since the queue is exactly where stale data comes
// from.
async function numberChangeRequest({ request, user, driver, season, series, game, body }) {
  if (!driver) {
    return NextResponse.json(
      { error: "Link your driver profile before asking for a number change.", code: "no-driver" },
      { status: 403 },
    );
  }

  const [entries, pending] = await Promise.all([
    seasonEntries(season.id, []),
    openRequestsForSeason(season.id),
  ]);

  // Their own roster entry — resolved from THEIR driver profile and account, so
  // a request can't name somebody else's row.
  const entry = entries.find(e => e.driver_id === driver.id || (e.user_id && e.user_id === user.uid));
  if (!entry) {
    return NextResponse.json(
      { error: `You're not on ${season.name || "this season"}'s roster, so there's no number to change.`, code: "not-entered" },
      { status: 409 },
    );
  }

  const number = String(body.number ?? "").trim().slice(0, 3);
  if (!number) {
    return NextResponse.json({ error: "Enter the car number you'd like.", code: "no-number" }, { status: 400 });
  }
  if (isOwnNumber(entry.number, number)) {
    return NextResponse.json(
      { error: `You already run #${number}.`, code: "same-number" },
      { status: 400 },
    );
  }
  if (numberRequestFor(pending, { uid: user.uid, driverId: driver.id, entryId: entry.id })) {
    return NextResponse.json(
      { error: "You've already got a number change waiting for this season. An admin will review it shortly.", code: "already-pending" },
      { status: 409 },
    );
  }
  // Taken by anyone else on the roster, or already asked for by anyone in the
  // queue. Their OWN entry is excluded — it's the row being changed.
  const others = entries.filter(e => e.id !== entry.id);
  if (numberClaimed(others, pending, number)) {
    return NextResponse.json({ error: NUMBER_TAKEN_MESSAGE, code: "number-taken", number }, { status: 409 });
  }

  const userDoc = await db().collection("users").doc(user.uid).get();
  const u = userDoc.exists ? userDoc.data() : {};
  const leagueId = season.league_id || getRequestLeagueId(request);

  const doc = {
    kind: NUMBER_CHANGE_KIND,
    status: PENDING,
    season_id: season.id,
    season_name: season.name || "Season",
    series_id: season.series_id || "",
    series_name: series?.name || "Series",
    game_id: season.game_id || "",
    game_name: game?.name || "",
    uid: user.uid,
    user_name: u.display_name || user.name || user.email || "Unknown",
    user_email: u.email || user.email || null,
    user_photo: u.photo_url || null,
    driver_id: driver.id,
    driver_name: driver.name ?? null,
    // The row that will be edited, and what it runs today — so the admin sees
    // the change rather than just the destination, and so approving can tell
    // whether the entry moved on while the request waited.
    entry_id: entry.id,
    current_number: String(entry.number ?? "").trim(),
    name: entry.name || driver.name || "Driver",
    number,
    reason: String(body.reason ?? "").trim().slice(0, 300),
    class_ids: entry.class_ids || [],
    class_names: [],
    created_at: new Date().toISOString(),
    resolved_at: null,
    resolved_by: null,
    ...(leagueId ? { league_id: leagueId } : {}),
  };
  const ref = await db().collection("signup_requests").add(doc);
  return NextResponse.json({ id: ref.id, ...doc }, { status: 201 });
}

// A player submits a sign-up for a season. This NEVER puts them on the roster:
// it files a pending request for an admin to approve or deny (see
// /api/admin/signup-requests/[id]). That holds whether or not the league
// already knows them — an existing driver's request is still a request.
//
// What's required of the submission is whatever the series, season and class
// ask for between them (see resolveSignupRules): a car number, a car from the
// season's one car list, and any alias the game insists on — an iRacing
// customer ID, so the organiser can send a league invite.
export const POST = withUser(async (request, ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const seasonId = String(body.season_id ?? "").trim();
  if (!seasonId) return NextResponse.json({ error: "Missing season_id" }, { status: 400 });

  const context = await seasonContext(seasonId);
  if (!context) return NextResponse.json({ error: "Season not found" }, { status: 404 });
  const { season, series, game, classes } = context;

  if (!seasonAcceptsSignups(season)) {
    return NextResponse.json(
      { error: `Season over — sign-ups for ${season.name || "that season"} are done.`, code: "season-over" },
      { status: 400 },
    );
  }

  const driver = await linkedDriver(user.uid);

  // A driver already ON the roster asking to change their car number. It goes
  // through the same queue as a sign-up for the same reason a sign-up does: a
  // car number is the league's to hand out, and two drivers can't share one.
  // Nothing is changed here — approving it is what edits the roster entry.
  if (requestKind(body) === NUMBER_CHANGE_KIND) {
    return numberChangeRequest({ request, user, driver, season, series, game, body });
  }

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
    game, series, season,
    cls: classIds.length ? validClasses.get(classIds[0]) : null,
  });

  const number = String(body.number ?? "").trim().slice(0, 3);
  const rawCar = String(body.car ?? "").trim();

  // Anything picked must be from the admin's own list, matched case-insensitively
  // and stored under the list's spelling.
  let car = "";
  if (rawCar) {
    car = matchCarOption(rules.car_options, rawCar) ?? "";
    if (!car) {
      return NextResponse.json({ error: `“${rawCar}” isn't one of the cars offered for this season.` }, { status: 400 });
    }
  }

  const missing = missingSignupFields(rules, { number, car });
  if (missing.length) {
    return NextResponse.json({ error: missingSignupMessage(missing), code: "missing-fields" }, { status: 400 });
  }

  // What this game demands of a sign-up: the Discord name every sign-up needs,
  // plus the platform identities an admin switched on for the game in League
  // Setup (Steam / PSN / Xbox / iRacing). Checked here as well as on the form,
  // because the form is not the security boundary. `game` comes from
  // seasonContext, which resolves it through the series for a season written
  // before it stamped its own game_id.
  const gameName = game?.name || "";
  const missingAliases = missingRequiredAliases(aliases, game);
  if (missingAliases.length) {
    return NextResponse.json({ error: missingAliasMessage(missingAliases), code: "missing-alias" }, { status: 400 });
  }

  // Already racing, or already waiting.
  const [entries, pending] = await Promise.all([
    seasonEntries(seasonId, classes),
    openRequestsForSeason(seasonId),
  ]);

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

  // A car whose cap filled up — possibly while this form sat open. Checked
  // here as well as on the form, because the form is not the boundary, and
  // against the roster AND the queue for the same reason the number is: two
  // people can be holding the last seat at the same moment and only one of
  // them can have it.
  if (car) {
    const cap = carCapacity(rules.car_entries, carCounts([...entries, ...pending]), car);
    if (cap.full) {
      return NextResponse.json(
        { error: carFullMessage(cap), code: "car-full", car: cap.name }, { status: 409 });
    }
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
    class_ids: classIds,
    class_names: classIds.map(id => validClasses.get(id)?.name).filter(Boolean),
    // Was this tier placement-gated when they pressed the button? Stamped so
    // the record says what the player was TOLD — the form warned them they'd
    // be racing for a place rather than taking one, and an admin reading the
    // row months later can see that. The queue's badge resolves the gate live
    // on top of this, since an admin may have switched it on (or off) while
    // the request waited; see /api/admin/signup-requests.
    placements_required: rules.require_placements,
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

  // And onto their own ACCOUNT, for the two fields it owns that a sign-up
  // answers: the display name and the car number. Only ever fills in what the
  // account hasn't got — a name or number the player set on their Profile is
  // never overwritten (see userAccountUpdatesFromSignup). This runs for a
  // brand-new player too, who has an account from the moment they signed in
  // even though their driver profile is still waiting on an admin, so their
  // Profile stops saying "jane.doe" the moment they tell us their racing name.
  //
  // Never fail a sign-up over it: the request is filed either way.
  const accountUpdates = userAccountUpdatesFromSignup({
    profile: { ...u, email: u.email || user.email },
    name: doc.name,
    number,
  });
  if (Object.keys(accountUpdates).length) {
    try {
      await db().collection("users").doc(user.uid).set(accountUpdates, { merge: true });
    } catch (err) {
      console.error("Sign-up account sync failed", err);
    }
  }

  return NextResponse.json({ id: ref.id, ...doc, account_updates: accountUpdates }, { status: 201 });
});
