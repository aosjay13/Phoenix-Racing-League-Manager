import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestUser, withUser } from "@/lib/serverAuth";
import { fetchDriverNames } from "@/lib/driverNamesServer";
import {
  carSelectionPatch, findSlot, matchCarOption, seasonAcceptsSignups, selectedCarFor, slotsForEntry,
} from "@/lib/carSelection";
import { linkedDriver, seasonContext, seasonEntries } from "@/lib/carSelectionServer";

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
  const { season, series, classes, slots } = context;

  const [entries, user] = await Promise.all([
    seasonEntries(seasonId, classes),
    getRequestUser(request),
  ]);
  const driver = user ? await linkedDriver(user.uid) : null;
  const gameId = season.game_id || null;
  const names = await fetchDriverNames(entries.map(e => e.driver_id), gameId);

  const classNameById = Object.fromEntries(classes.map(c => [c.id, c.name]));
  const rows = entries.map(entry => {
    const mySlots = slotsForEntry(slots, entry.class_ids);
    return {
      entry_id: entry.id,
      driver_id: entry.driver_id ?? null,
      // The name this driver races under in this game, falling back to the
      // entry's own alias — the same rule the roster and results grids use.
      name: (entry.driver_id ? names[entry.driver_id]?.display : null) || entry.name || "Driver",
      number: entry.number ?? null,
      class_ids: entry.class_ids,
      class_names: entry.class_ids.map(id => classNameById[id]).filter(Boolean),
      // One reading per slot this driver answers, so the grid can show a column
      // per class when the classes run their own car lists.
      cars: mySlots.map(slot => ({
        class_id: slot.class_id,
        class_name: slot.class_name,
        car: selectedCarFor(entry, slot.class_id),
      })),
      mine: !!driver && entry.driver_id === driver.id,
    };
  });
  rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const myEntry = driver ? entries.find(e => e.driver_id === driver.id) ?? null : null;

  return NextResponse.json({
    season: {
      id: season.id, name: season.name || "Season", status: season.status || "active",
      logo_url: season.logo_url || "", car: season.car || "",
    },
    series: series ? { id: series.id, name: series.name || "Series", logo_url: series.logo_url || "" } : null,
    game_id: gameId,
    open: seasonAcceptsSignups(season),
    classes: classes.map(c => ({ id: c.id, name: c.name, car: c.car || "" })),
    slots,
    roster: rows,
    // The caller's own standing on this screen, so the client needn't re-derive
    // it: are they linked, are they on the roster, which slots are theirs.
    me: user
      ? {
        driver_id: driver?.id ?? null,
        driver_name: driver?.name ?? null,
        entry_id: myEntry?.id ?? null,
        class_ids: myEntry?.class_ids ?? [],
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
export const POST = withUser(async (request, ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const seasonId = String(body.season_id ?? "").trim();
  const classId = String(body.class_id ?? "").trim();
  const wantedCar = String(body.car ?? "").trim();
  if (!seasonId) return NextResponse.json({ error: "Missing season_id" }, { status: 400 });

  const driver = await linkedDriver(user.uid);
  if (!driver) {
    return NextResponse.json(
      { error: "Link a driver profile to your account before locking in a car.", code: "no-driver" },
      { status: 403 },
    );
  }

  const context = await seasonContext(seasonId);
  if (!context) return NextResponse.json({ error: "Season not found" }, { status: 404 });
  const { season, classes, slots } = context;

  if (!seasonAcceptsSignups(season)) {
    return NextResponse.json(
      { error: `${season.name || "That season"} is complete — its cars can no longer be changed.` },
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
