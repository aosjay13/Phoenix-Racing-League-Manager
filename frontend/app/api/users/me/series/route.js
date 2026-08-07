import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, withUser } from "@/lib/serverAuth";
import { normalizeClassIds } from "@/lib/classFilter";
import {
  carSelectionSlots, resolveCarSelection, seasonAcceptsSignups, selectedCarFor, slotsForEntry,
} from "@/lib/carSelection";
import {
  entriesForDriver, leagueSeasonIndex, linkedDriver, newestFirst, pendingClaim,
} from "@/lib/carSelectionServer";

export const dynamic = "force-dynamic";

// Everything the Dashboard's "Series Information" section and the
// /series-info screens need about the SIGNED-IN player, in one call:
//
//   • which driver profile their account is linked to (or that they have none
//     yet, which is the gate on everything else here),
//   • the series/seasons they're on the roster of, with any car they still have
//     to lock in, and
//   • the seasons still open to sign up for.
//
// Completed seasons never appear as sign-ups and are marked closed in the list,
// which is what keeps both actions to seasons that are upcoming or running.
export const GET = withUser(async (request, ctx, user) => {
  const [driver, pending, index] = await Promise.all([
    linkedDriver(user.uid),
    pendingClaim(user.uid),
    leagueSeasonIndex(getRequestLeagueId(request)),
  ]);
  const { seasons, seriesById, gamesById, classesBySeason } = index;
  const seasonsById = Object.fromEntries(seasons.map(s => [s.id, s]));

  // Entries reached through the driver profile OR an older direct account link,
  // so someone linked before driver_id existed still sees their seasons.
  const entries = await entriesForDriver({ driverId: driver?.id, uid: user.uid });
  // Only entries in THIS league's seasons — an account spans leagues, its
  // rosters don't.
  const mine = entries.filter(e => seasonsById[e.season_id]);
  const enteredSeasonIds = new Set(mine.map(e => e.season_id));

  // One row per SEASON, not per entry: a driver can still hold more than one
  // entry in a season (the old add-them-once-per-class workaround), and their
  // car is one answer either way. Their first entry answers for the season —
  // its classes and its picks — and it's the same entry /api/car-selection
  // writes to, so the two never disagree. (The roster's "Combine" button folds
  // such entries into one; see /api/admin/entries/combine.)
  const mySeasonDocs = [...enteredSeasonIds].map(id => seasonsById[id]);
  const my_seasons = newestFirst(mySeasonDocs).map(season => {
    const entry = mine.find(e => e.season_id === season.id);
    const series = seriesById[season.series_id] || null;
    const classes = classesBySeason[season.id] || [];
    const slots = carSelectionSlots({ series, season, classes });
    const classIds = normalizeClassIds(entry.class_ids?.length ? entry.class_ids : (entry.class_id ? [entry.class_id] : []));
    const mySlots = slotsForEntry(slots, classIds);
    const open = seasonAcceptsSignups(season);
    const picks = mySlots.map(slot => ({
      class_id: slot.class_id,
      class_name: slot.class_name,
      car: selectedCarFor(entry, slot.class_id),
      locked: slot.locked,
      options: slot.options,
    }));
    return {
      season_id: season.id,
      season_name: season.name || "Season",
      season_status: season.status || "active",
      open,
      series_id: season.series_id || "",
      series_name: series?.name || "Series",
      game_id: season.game_id || "",
      game_name: gamesById[season.game_id]?.name || "",
      logo_url: season.logo_url || series?.logo_url || "",
      entry_id: entry.id,
      number: entry.number ?? null,
      class_names: classIds.map(id => classes.find(c => c.id === id)?.name).filter(Boolean),
      requires_car: mySlots.length > 0,
      picks,
      // What the Dashboard badge counts: a car this driver can still choose but
      // hasn't. A locked or completed season needs nothing.
      needs_pick: open && picks.some(p => !p.car && !p.locked),
    };
  });

  // Sign-ups: every season in the league still to run that this driver isn't
  // already on. A season whose series or game has been deleted is left out —
  // it's hidden everywhere else too.
  const open_signups = newestFirst(seasons)
    .filter(s => seasonAcceptsSignups(s) && !enteredSeasonIds.has(s.id))
    .filter(s => seriesById[s.series_id] && gamesById[s.game_id])
    .map(season => {
      const series = seriesById[season.series_id];
      const classes = classesBySeason[season.id] || [];
      const resolved = resolveCarSelection({ series, season });
      return {
        season_id: season.id,
        season_name: season.name || "Season",
        series_id: season.series_id,
        series_name: series.name || "Series",
        game_id: season.game_id || "",
        game_name: gamesById[season.game_id]?.name || "",
        logo_url: season.logo_url || series.logo_url || "",
        classes: classes.map(c => ({ id: c.id, name: c.name, car: c.car || "" })),
        requires_car: carSelectionSlots({ series, season, classes }).length > 0,
        car_count: resolved.options.length,
      };
    });

  return NextResponse.json({
    driver: driver ? { id: driver.id, name: driver.name || "Driver" } : null,
    pending_claim: pending ? { id: pending.id, driver_id: pending.driver_id, driver_name: pending.driver_name } : null,
    my_seasons,
    open_signups,
    // What the Dashboard uses to decide whether to render the section at all.
    show: my_seasons.some(s => s.requires_car && s.open) || open_signups.length > 0,
    needs_pick_count: my_seasons.filter(s => s.needs_pick).length,
  });
});

// Register the signed-in player for a season. The entry is created against
// THEIR OWN driver profile — resolved from the account, never taken from the
// request — so nobody can sign anyone else up.
export const POST = withUser(async (request, ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const seasonId = String(body.season_id ?? "").trim();
  if (!seasonId) return NextResponse.json({ error: "Missing season_id" }, { status: 400 });

  const driver = await linkedDriver(user.uid);
  if (!driver) {
    return NextResponse.json(
      { error: "Link a driver profile to your account before signing up.", code: "no-driver" },
      { status: 403 },
    );
  }

  const seasonDoc = await db().collection("seasons").doc(seasonId).get();
  if (!seasonDoc.exists) return NextResponse.json({ error: "Season not found" }, { status: 404 });
  const season = { id: seasonDoc.id, ...seasonDoc.data() };
  if (!seasonAcceptsSignups(season)) {
    return NextResponse.json(
      { error: `${season.name || "That season"} is complete — sign-ups are closed.` },
      { status: 400 },
    );
  }

  // Already on this roster? Say so rather than creating a second entry — a
  // duplicate is exactly what the roster's "Combine" tool exists to undo.
  const roster = await db().collection("entries").where("season_id", "==", seasonId).get();
  const existing = roster.docs.find(d => {
    const e = d.data();
    return e.driver_id === driver.id || (e.user_id && e.user_id === user.uid);
  });
  if (existing) {
    return NextResponse.json({ id: existing.id, ...existing.data(), already_entered: true });
  }

  // Only classes that belong to this season, so a stray id can't attach an
  // entry to another season's class.
  const seasonClasses = await db().collection("classes").where("season_id", "==", seasonId).get();
  const validClassIds = new Set(seasonClasses.docs.map(d => d.id));
  const classIds = normalizeClassIds(body.class_ids).filter(id => validClassIds.has(id));

  // Both free-text fields are capped, the same way the admin entry route caps a
  // car number — a self-service write shouldn't be able to store an essay.
  const number = String(body.number ?? "").trim().slice(0, 3);
  const doc = {
    season_id: seasonId,
    // The name they race under in this series; defaults to their profile name.
    name: String(body.name ?? "").trim().slice(0, 60) || driver.name || "Driver",
    driver_id: driver.id,
    user_id: user.uid,
    team_id: "",
    number,
    class_ids: classIds,
    class_id: classIds[0] || "",
    created_at: new Date().toISOString(),
    created_by: user.uid,
    // Flags an entry the player made themselves rather than one an admin added.
    self_signup: true,
    ...(season.league_id ? { league_id: season.league_id } : (getRequestLeagueId(request) ? { league_id: getRequestLeagueId(request) } : {})),
  };
  const ref = await db().collection("entries").add(doc);
  return NextResponse.json({ id: ref.id, ...doc }, { status: 201 });
});
