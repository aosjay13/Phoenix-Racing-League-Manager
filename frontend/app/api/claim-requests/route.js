import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { docInLeague, withUser } from "@/lib/serverAuth";
import { linkedDriver, pendingClaim } from "@/lib/carSelectionServer";
import {
  CLAIM_KIND, NEW_DRIVER_KIND, cleanSignupDriverInfo, missingAliasMessage,
  missingRequiredAliases,
} from "@/lib/signupRequest";
import { seasonAcceptsSignups } from "@/lib/carSelection";
import { matchedName, matchReason } from "@/lib/driverMatch";
import { duplicateCheck } from "@/lib/driverMatchServer";
import { withStatsRefresh } from "@/lib/statsCache";

export const dynamic = "force-dynamic";

// A signed-in user asks admins to give them a driver profile. NOTHING is
// created here in either case — the request lands in `claim_requests` with
// status "pending", and only an admin approval (see /api/admin/claim-requests)
// writes anything. Adding a driver to the league is never automated.
//
// Two kinds:
//
//   { driver_id }                     → "that existing driver is me". Approval
//                                       writes drivers.user_id.
//   { kind: "new_driver", driver_name,
//     aliases, signup? }              → "please add me as a new driver".
//                                       Approval creates the driver profile
//                                       and, when a `signup` came with it, the
//                                       season roster entry too.
//
// The `signup` half is what makes the series sign-up dialog work for someone
// the league has never seen: they fill in one form, and the season they wanted
// to join rides along with the request rather than being lost while they wait.
const handlePOST = withUser(async (request, ctx, user, leagueId) => {
  const body = await request.json().catch(() => ({}));
  const kind = body.kind === NEW_DRIVER_KIND ? NEW_DRIVER_KIND : CLAIM_KIND;

  // One driver profile per account PER LEAGUE, and at most one open request per
  // league — checked for both kinds, so a user can't queue a claim and a
  // new-driver request at once. Both are scoped: racing as somebody in League A
  // is no reason to be refused a profile in League B, and neither is waiting on
  // League A's admin.
  const owned = await linkedDriver(user.uid, leagueId);
  if (owned) {
    return NextResponse.json(
      { error: "You already have a driver profile linked to your account in this league. Unclaim it before requesting another." },
      { status: 400 },
    );
  }
  if (await pendingClaim(user.uid, leagueId)) {
    return NextResponse.json(
      { error: "You already have a pending request in this league. You can only ask for one driver profile at a time." },
      { status: 409 },
    );
  }

  const userDoc = await db().collection("users").doc(user.uid).get();
  const u = userDoc.exists ? userDoc.data() : {};
  const base = {
    kind,
    uid: user.uid,
    user_name: u.display_name || user.name || user.email || "Unknown",
    user_email: u.email || user.email || null,
    user_photo: u.photo_url || null,
    status: "pending",
    created_at: new Date().toISOString(),
    resolved_at: null,
    resolved_by: null,
    ...(leagueId ? { league_id: leagueId } : {}),
  };

  if (kind === CLAIM_KIND) {
    const driverId = body.driver_id;
    if (!driverId) return NextResponse.json({ error: "Missing driver_id" }, { status: 400 });

    const driverDoc = await db().collection("drivers").doc(driverId).get();
    if (!driverDoc.exists) return NextResponse.json({ error: "Driver profile not found" }, { status: 404 });
    const driver = driverDoc.data();
    // Claiming is addressed by driver id, so it has to say which league that id
    // is allowed to be in — otherwise a player could claim another league's
    // driver, and with it that league's whole race history.
    if (!docInLeague(driver, leagueId)) {
      return NextResponse.json({ error: "Driver profile not found" }, { status: 404 });
    }
    if (driver.user_id) {
      return NextResponse.json({ error: "This profile is already claimed by another account." }, { status: 400 });
    }

    const doc = { ...base, driver_id: driverId, driver_name: driver.name || "Driver" };
    const ref = await db().collection("claim_requests").add(doc);
    return NextResponse.json({ id: ref.id, ...doc });
  }

  // ── New driver ───────────────────────────────────────────────────────────
  const info = cleanSignupDriverInfo({
    name: body.driver_name,
    aliases: body.aliases,
    number: body.signup?.number,
    class_ids: body.signup?.class_ids,
  });
  if (!info.name) {
    return NextResponse.json({ error: "Enter the name you race under." }, { status: 400 });
  }

  // A name the league already knows is almost always the same person, and a
  // duplicate would split their history in two — point them at claiming that
  // profile instead. "Already knows" means any name that driver answers to, not
  // just the one on their profile: somebody whose GT7 sign-up gives their PSN
  // username is the driver that username is already on file for.
  //
  // Only a name they demonstrably go by counts here. A merely SIMILAR name is
  // offered to an admin as a prompt (see POST /api/drivers), but this is a
  // player filling in a form about themselves, and refusing them because their
  // name resembles somebody else's would leave them with no way through.
  const report = await duplicateCheck({ name: info.name, leagueId });
  if (report && report.status !== "possible") {
    const clash = report.matches[0];
    return NextResponse.json({
      // Named the way a stranger may hear it. The clash can be through an
      // iRacing real name — the app matches on those, or one person becomes two
      // profiles — but the refusal is read by whoever typed the form, so it
      // quotes the safe name and says nothing about which field matched (see
      // matchedName / matchReason in lib/driverMatch.js).
      error: `There's already a driver called “${matchedName(clash)}”${clash.via?.source === "name" && !clash.via?.iracing ? "" : ` (${matchReason(clash)})`}. If that's you, ask to claim that profile instead so your race history comes with it.`,
      code: "driver-exists",
      driver_id: clash.driver_id,
    }, { status: 409 });
  }

  // The season they want to join, resolved here so the request carries readable
  // names for the admin reviewing it — and so an already-closed season is
  // refused now rather than at approval time.
  let signup = null;
  if (body.signup?.season_id) {
    const seasonDoc = await db().collection("seasons").doc(String(body.signup.season_id)).get();
    if (!seasonDoc.exists) return NextResponse.json({ error: "Season not found" }, { status: 404 });
    const season = { id: seasonDoc.id, ...seasonDoc.data() };
    // A season in another league is not one this request may join.
    if (!docInLeague(season, leagueId)) {
      return NextResponse.json({ error: "Season not found" }, { status: 404 });
    }
    if (!seasonAcceptsSignups(season)) {
      return NextResponse.json(
        { error: `Season over — sign-ups for ${season.name || "that season"} are done.`, code: "season-over" },
        { status: 400 },
      );
    }
    const [seriesDoc, gameDoc] = await Promise.all([
      season.series_id ? db().collection("series").doc(season.series_id).get() : null,
      season.game_id ? db().collection("games").doc(season.game_id).get() : null,
    ]);
    const game = gameDoc?.exists ? gameDoc.data() : null;
    const gameName = game?.name || "";

    // Whatever this game insists on — the Discord name every sign-up carries,
    // plus the platform identities configured on the game (Steam / PSN / Xbox /
    // iRacing) — has to be in the request before it's filed. Same rules as a
    // sign-up from a player the league already knows; see lib/signupRequest.js.
    const missing = missingRequiredAliases(info.aliases, game);
    if (missing.length) {
      return NextResponse.json(
        { error: missingAliasMessage(missing), code: "missing-alias" },
        { status: 400 },
      );
    }

    signup = {
      season_id: season.id,
      season_name: season.name || "Season",
      series_id: season.series_id || "",
      series_name: seriesDoc?.exists ? (seriesDoc.data().name || "Series") : "",
      game_id: season.game_id || "",
      game_name: gameName,
      class_ids: info.class_ids,
      number: info.number,
      name: info.name,
    };
  }

  const doc = {
    ...base,
    driver_id: null,
    driver_name: info.name,
    aliases: info.aliases,
    signup,
  };
  const ref = await db().collection("claim_requests").add(doc);
  return NextResponse.json({ id: ref.id, ...doc });
});

// The caller's own claim requests — lets the driver profile page reflect a
// "request pending" state so a user doesn't spam duplicate requests.
export const GET = withUser(async (request, ctx, user, leagueId) => {
  const snap = await db().collection("claim_requests").where("uid", "==", user.uid).get();
  const rows = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(r => docInLeague(r, leagueId));
  rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return NextResponse.json(rows);
});

// A successful write here changes something the cached league reads are built
// from, so the cache is dropped in the same request — see lib/statsCache.js.
export const POST = withStatsRefresh(handlePOST);
