import { NextResponse } from "next/server";
import { getRequestLeagueId, withUser } from "@/lib/serverAuth";
import { normalizeClassIds } from "@/lib/classFilter";
import {
  carSelectionSlots, normalizeCarNumber, resolveCarSelection, resolveSignupRules,
  seasonAcceptsSignups, seasonIsCompleted, selectedCarFor, slotsForEntry,
} from "@/lib/carSelection";
import {
  entriesForDriver, leagueSeasonIndex, linkedDriver, newestFirst, pendingClaim,
  pendingForSeasons, rostersForSeasons,
} from "@/lib/carSelectionServer";
import { pendingForSeason } from "@/lib/signupQueue";

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
  //
  // FINISHED SEASONS ARE LEFT OUT ENTIRELY. Series Information is about what a
  // player still has to do; a season an admin marked complete has nothing left
  // to answer, and a league's back catalogue piling up here buried the one
  // season that actually wanted something. A series whose seasons are all
  // complete therefore disappears from the flow on its own — there's no
  // separate "series is over" flag to set. It's filtered HERE rather than on
  // each screen so there is one place it's true and no screen can reinstate it;
  // the season's own page (/series-info/[id], fed by /api/car-selection) still
  // opens from a direct link and still says "Season over", so nothing is lost.
  const mySeasonDocs = [...enteredSeasonIds]
    .map(id => seasonsById[id])
    .filter(seasonAcceptsSignups);
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
      // Through the series when the season itself carries no game_id — some
      // early seasons were written before it was stamped, and the Dashboard
      // scopes on this.
      game_id: season.game_id || series?.game_id || "",
      game_name: gamesById[season.game_id || series?.game_id]?.name || "",
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

  // A season is listable only while both the series it's in and the game that
  // series belongs to still exist — a season orphaned by a deleted game is
  // hidden everywhere else too. The game is resolved through the series when the
  // season predates its own game_id stamp.
  const gameOf = season => season.game_id || seriesById[season.series_id]?.game_id;
  const listable = season => !!seriesById[season.series_id] && !!gamesById[gameOf(season)];

  // Sign-ups: every season in the league still to run that this driver isn't
  // already on.
  const openSeasons = newestFirst(seasons)
    .filter(s => seasonAcceptsSignups(s) && !enteredSeasonIds.has(s.id))
    .filter(listable);

  // Each of those seasons' rosters, so the sign-up form can show which car
  // numbers are already taken and reject a clash the moment it's typed rather
  // than on submit. One query per season being offered — a league only has a
  // handful running at once, and it saves a round trip per card.
  const [rosters, pendings] = await Promise.all([
    rostersForSeasons(openSeasons.map(s => s.id)),
    pendingForSeasons(openSeasons.map(s => s.id)),
  ]);

  const open_signups = openSeasons
    .map(season => {
      const series = seriesById[season.series_id];
      const classes = classesBySeason[season.id] || [];
      const resolved = resolveCarSelection({ series, season });
      const roster = rosters[season.id] || [];
      const pending = pendings[season.id] || [];
      const classNameById = Object.fromEntries(classes.map(c => [c.id, c.name]));
      // What this season asks of a sign-up — a number, a car, a manufacturer —
      // resolved down the series → season chain. A class that asks for more is
      // resolved on the form once one is picked.
      const rules = resolveSignupRules({ series, season });
      return {
        season_id: season.id,
        season_name: season.name || "Season",
        series_id: season.series_id,
        series_name: series.name || "Series",
        game_id: season.game_id || series.game_id || "",
        game_name: gamesById[season.game_id || series.game_id]?.name || "",
        logo_url: season.logo_url || series.logo_url || "",
        classes: classes.map(c => ({ id: c.id, name: c.name, car: c.car || "" })),
        requires_car: carSelectionSlots({ series, season, classes }).length > 0,
        car_count: resolved.options.length,
        // Everything the sign-up form renders itself from.
        rules: {
          require_car: rules.require_car,
          require_number: rules.require_number,
          require_manufacturer: rules.require_manufacturer,
          car_options: rules.car_options,
          manufacturer_options: rules.manufacturer_options,
          note: rules.note,
        },
        // Per class, so picking one on the form can tighten what's asked for.
        class_rules: Object.fromEntries(classes.map(c => {
          const r = resolveSignupRules({ series, season, cls: c });
          return [c.id, {
            require_car: r.require_car, require_number: r.require_number,
            require_manufacturer: r.require_manufacturer,
            car_options: r.car_options, manufacturer_options: r.manufacturer_options,
            note: r.note,
          }];
        })),
        pending: pending.map(p => ({
          name: p.name, number: p.number, car: p.car,
          manufacturer: p.manufacturer, class_names: p.class_names,
        })),
        // This account's own sign-up already waiting on an admin, if any.
        my_pending: pendingForSeason(pending, { uid: user.uid, driverId: driver?.id })
          ? true : false,
        // The season's public roster, in car-number order — the "which numbers
        // are gone?" list a driver reads before picking one, and the source of
        // the instant clash check on the number field.
        roster: roster.map(r => ({
          number: r.number,
          name: r.name,
          class_names: r.class_ids.map(id => classNameById[id]).filter(Boolean),
        })),
        taken_numbers: roster
          .map(r => normalizeCarNumber(r.number))
          .filter(Boolean),
      };
    });

  // Seasons left OUT of the sign-up list purely because they're finished. The
  // screens count them so "nothing open" can say WHY — a league whose seasons
  // are all complete reads as "sign-ups are done", not as an empty page.
  const closed_signups = seasons.filter(s =>
    seasonIsCompleted(s) && !enteredSeasonIds.has(s.id) && listable(s)).length;

  return NextResponse.json({
    // `aliases` seeds the sign-up dialog's Aliases / Connected Accounts editor
    // from what this driver already has, so they confirm rather than retype.
    driver: driver
      ? { id: driver.id, name: driver.name || "Driver", aliases: driver.aliases || [] }
      : null,
    pending_claim: pending ? { id: pending.id, driver_id: pending.driver_id, driver_name: pending.driver_name } : null,
    my_seasons,
    open_signups,
    closed_signups,
    // No league-wide "should the Dashboard show this?" flag on purpose: the
    // Dashboard's section is scoped to the selected Game/Series and counts only
    // running seasons, so any total computed here would be answering a
    // different question than the one being asked. Each row carries `open`,
    // `requires_car`, `needs_pick`, `series_id` and `game_id`; the caller
    // decides from those.
  });
});

// There is deliberately no POST here any more. A player joining a season goes
// through POST /api/signup-requests, which only ever files a PENDING row for an
// admin to approve — see lib/signupQueue.js. This route used to create the
// roster entry directly; leaving it in place would have been a way onto the
// official roster with nobody reviewing it, which is the one thing the approval
// queue exists to prevent.
