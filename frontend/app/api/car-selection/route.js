import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestUser, withUser } from "@/lib/serverAuth";
import { fetchDriverNames } from "@/lib/driverNamesServer";
import {
  carCapacity, carCounts, carFullMessage, carSelectionPatch, findSlot, matchCarOption,
  resolveSignupRules, seasonAcceptsSignups, selectedCarFor, slotsForEntry, sortRosterByNumber,
} from "@/lib/carSelection";
import {
  linkedDriver, openRequestsForSeason, pendingForSeasons, seasonContext, seasonEntries,
} from "@/lib/carSelectionServer";
import { gameRequirementFlags } from "@/lib/signupRequest";
import { isAwaitingPlacement, numberRequestFor } from "@/lib/signupQueue";
import { withStatsRefresh } from "@/lib/statsCache";

export const dynamic = "force-dynamic";

// One season's car lock-in: what the admin is asking for, and what everyone on
// the roster has picked so far.
//
// The roster half is deliberately public — seeing which cars the rest of the
// field has taken is the point of the screen, and it's the same roster
// /api/roster already serves. Only the "which of these is mine" flag needs a
// signed-in caller, and it's resolved from that caller's own driver profile.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const seasonId = searchParams.get("season_id");
  if (!seasonId) return NextResponse.json({ error: "season_id required" }, { status: 400 });

  const context = await seasonContext(seasonId);
  if (!context) return NextResponse.json({ error: "Season not found" }, { status: 404 });
  const { season, series, game, classes, slots } = context;

  const [entries, user, pendings] = await Promise.all([
    seasonEntries(seasonId, classes),
    getRequestUser(request),
    pendingForSeasons([seasonId]),
  ]);
  const pending = pendings[seasonId] || [];
  // Scoped to the league THIS SEASON belongs to, not to whatever league the
  // caller's tab is on: the driver answering for a season is that league's
  // driver profile, and a direct link to a season in another league must still
  // resolve the right one.
  const driver = user ? await linkedDriver(user.uid, season.league_id || "") : null;
  const gameId = season.game_id || series?.game_id || null;
  // The game's NAME, not just its id — the sign-up dialog decides what extra
  // information to insist on from it (an iRacing season needs the driver's
  // customer ID before the league can invite them). See lib/signupRequest.js.
  const names = await fetchDriverNames(entries.map(e => e.driver_id), gameId);
  const gameName = game?.name || "";

  const classNameById = Object.fromEntries(classes.map(c => [c.id, c.name]));
  const rows = entries.map(entry => {
    const mySlots = slotsForEntry(slots, entry.class_ids);
    // A car chosen at SIGN-UP is on the entry whether or not the season also
    // runs a lock-in slot — an admin can publish a car list without making the
    // pick a standing question. Read it directly when there's no slot to hang
    // it on, so what somebody picked is never invisible on the screen that
    // exists to show who's driving what.
    const signupCar = mySlots.length ? "" : selectedCarFor(entry);
    return {
      entry_id: entry.id,
      driver_id: entry.driver_id ?? null,
      // What this entry has asked to change its number TO, if anything — shown
      // beside their current number so nobody picks a number already spoken for.
      wants_number: pending.find(p => p.entry_id === entry.id)?.number ?? null,
      // The name this driver races under in this game, falling back to the
      // entry's own alias — the same rule the roster and results grids use.
      name: (entry.driver_id ? names[entry.driver_id]?.display : null) || entry.name || "Driver",
      number: entry.number ?? null,
      class_ids: entry.class_ids,
      class_names: entry.class_ids.map(id => classNameById[id]).filter(Boolean),
      // One reading per slot this driver answers, so the grid can show a column
      // per class when the classes run their own car lists.
      cars: mySlots.length
        ? mySlots.map(slot => ({
          class_id: slot.class_id,
          class_name: slot.class_name,
          car: selectedCarFor(entry, slot.class_id),
        }))
        : signupCar ? [{ class_id: "", class_name: "", car: signupCar }] : [],
      mine: !!driver && entry.driver_id === driver.id,
    };
  });
  // Car-number order, not alphabetical: this roster is read to find out who has
  // which number, and a numbered grid is how a racing roster is always listed.
  // Drivers with no number yet fall to the end.
  const sortedRows = sortRosterByNumber(rows);

  const myEntry = driver ? entries.find(e => e.driver_id === driver.id) ?? null : null;

  return NextResponse.json({
    season: {
      id: season.id, name: season.name || "Season", status: season.status || "active",
      logo_url: season.logo_url || "", car: season.car || "",
    },
    series: series ? { id: series.id, name: series.name || "Series", logo_url: series.logo_url || "" } : null,
    game_id: gameId,
    game_name: gameName,
    // The platform identities this game insists on (Steam / PSN / Xbox /
    // iRacing) — the sign-up dialog renders an input for each. Discord is
    // required everywhere and carries no flag. See lib/signupRequest.js.
    game_requirements: gameRequirementFlags(game),
    open: seasonAcceptsSignups(season),
    // What a sign-up for this season has to carry, so the sign-up dialog on
    // this screen renders itself exactly as the Dashboard's does.
    rules: (() => {
      const r = resolveSignupRules({ game, series, season });
      return {
        require_car: r.require_car, require_number: r.require_number,
        require_placements: r.require_placements,
        car_options: r.car_options, car_entries: r.car_entries, note: r.note,
      };
    })(),
    class_rules: Object.fromEntries(classes.map(c => {
      const r = resolveSignupRules({ game, series, season, cls: c });
      return [c.id, {
        require_car: r.require_car, require_number: r.require_number,
        require_placements: r.require_placements,
        car_options: r.car_options, car_entries: r.car_entries, note: r.note,
      }];
    })),
    // Sign-ups waiting on an admin — shown beside the roster so a number
    // somebody has already asked for isn't offered as free.
    pending: pending.map(p => ({
      kind: p.kind, entry_id: p.entry_id,
      status: p.status,
      name: p.name, number: p.number, car: p.car,
      class_names: p.class_names,
    })),
    // In flight for this caller — waiting on a decision, or already approved
    // into a placement session. Either way there is no "Sign up" button to
    // offer them.
    my_pending: !!(driver && pending.some(p => p.driver_id === driver.id))
      || !!(user && pending.some(p => p.uid === user.uid)),
    // …and which of the two, so the screen doesn't tell somebody who has been
    // approved that their sign-up is still with the admins.
    my_awaiting_placement: pending.some(p =>
      isAwaitingPlacement(p)
      && ((driver && p.driver_id === driver.id) || (user && p.uid === user.uid))),
    classes: classes.map(c => ({ id: c.id, name: c.name, car: c.car || "" })),
    slots,
    roster: sortedRows,
    // The caller's own standing on this screen, so the client needn't re-derive
    // it: are they linked, are they on the roster, which slots are theirs.
    me: user
      ? {
        driver_id: driver?.id ?? null,
        driver_name: driver?.name ?? null,
        // Seeds the sign-up dialog's alias editor from what they already have.
        aliases: driver?.aliases ?? [],
        entry_id: myEntry?.id ?? null,
        // The number they run today, and the change they've already asked for
        // (if any) — what the "Request a different number" card renders itself
        // from. See lib/signupQueue.js.
        number: myEntry?.number ?? "",
        number_request: (() => {
          const r = numberRequestFor(pending, {
            uid: user.uid, driverId: driver?.id, entryId: myEntry?.id,
          });
          return r ? { id: r.id, number: r.number ?? "", reason: r.reason || "" } : null;
        })(),
        class_ids: myEntry?.class_ids ?? [],
        // The car on their entry, whatever put it there — the lock-in screen,
        // or the sign-up they were approved from. Read by the screen to show
        // their pick back to them even where no slot asks them for one.
        selected_car: myEntry ? selectedCarFor(myEntry) : "",
        slots: myEntry ? slotsForEntry(slots, myEntry.class_ids) : [],
        picks: myEntry
          ? slotsForEntry(slots, myEntry.class_ids).map(slot => ({
            class_id: slot.class_id,
            class_name: slot.class_name,
            car: selectedCarFor(myEntry, slot.class_id),
          }))
          : [],
      }
      : null,
  });
}

// Lock in (or change, or clear) the signed-in player's car for one season —
// season-wide, or for one class of it.
//
// Security: the entry written is the one belonging to the driver profile linked
// to the CALLER'S account. The request names a season and a class, never a
// driver or an entry, so there's nothing here to point at somebody else's row.
const handlePOST = withUser(async (request, ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const seasonId = String(body.season_id ?? "").trim();
  const classId = String(body.class_id ?? "").trim();
  const wantedCar = String(body.car ?? "").trim();
  if (!seasonId) return NextResponse.json({ error: "Missing season_id" }, { status: 400 });

  const context = await seasonContext(seasonId);
  if (!context) return NextResponse.json({ error: "Season not found" }, { status: 404 });
  const { season, classes, slots } = context;

  // Resolved AFTER the season, because which driver profile answers depends on
  // which league the season is in — this account may hold a different one in
  // each league it races in.
  const driver = await linkedDriver(user.uid, season.league_id || "");
  if (!driver) {
    return NextResponse.json(
      { error: "Link a driver profile to your account before locking in a car.", code: "no-driver" },
      { status: 403 },
    );
  }

  // Marked complete by an admin: the season is closed to players, cars
  // included. Enforced here and not only in the UI, so a tab left open before
  // the season closed can't still write a change.
  if (!seasonAcceptsSignups(season)) {
    return NextResponse.json(
      { error: `Season over — ${season.name || "that season"}'s cars are final and can no longer be changed.`, code: "season-over" },
      { status: 400 },
    );
  }

  const entries = await seasonEntries(seasonId, classes);
  const entry = entries.find(e => e.driver_id === driver.id)
    ?? entries.find(e => e.user_id === user.uid)
    ?? null;
  if (!entry) {
    return NextResponse.json(
      { error: `You're not on ${season.name || "this season"}'s roster yet — sign up first.`, code: "not-entered" },
      { status: 403 },
    );
  }

  // The slot must be one this driver is actually asked to answer: a class they
  // race (or the season-wide question when no class of theirs runs its own).
  const allowed = slotsForEntry(slots, entry.class_ids);
  const slot = findSlot(allowed, classId);
  if (!slot) {
    return NextResponse.json(
      { error: "No car selection is being asked of you here." },
      { status: 400 },
    );
  }
  if (slot.locked) {
    return NextResponse.json(
      { error: "Car selections have been locked by an admin — ask them to reopen it." },
      { status: 403 },
    );
  }

  // Blank clears the pick; anything else must be one of the offered cars, matched
  // case-insensitively and stored under the list's own spelling.
  let car = "";
  if (wantedCar) {
    car = matchCarOption(slot.options, wantedCar) ?? "";
    if (!car) {
      return NextResponse.json(
        { error: `“${wantedCar}” isn't one of the cars offered for this season.` },
        { status: 400 },
      );
    }

    // The admin can cap how many drivers run each car, and a driver arriving at
    // the lock-in screen must not be able to take a seat that has gone since
    // the page loaded. Their OWN current car never counts against them — the
    // last Ferrari being full must not stop the person holding it from saving.
    // Everyone waiting on approval counts, same as on the sign-up form.
    const open = await openRequestsForSeason(seasonId);
    const cap = carCapacity(
      slot.car_entries || [],
      carCounts([...entries, ...open]),
      car,
      selectedCarFor(entry, slot.class_id),
    );
    if (cap.full) {
      return NextResponse.json(
        { error: carFullMessage(cap), code: "car-full", car: cap.name }, { status: 409 });
    }
  }

  const patch = carSelectionPatch(entry, slot.class_id, car);
  await db().collection("entries").doc(entry.id).update(patch);
  return NextResponse.json({
    ok: true,
    entry_id: entry.id,
    class_id: slot.class_id,
    car,
    ...patch,
  });
});

// A successful write here changes something the cached league reads are built
// from, so the cache is dropped in the same request — see lib/statsCache.js.
export const POST = withStatsRefresh(handlePOST);
