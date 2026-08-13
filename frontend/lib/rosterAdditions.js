// "Who joined a roster while I wasn't looking?"
//
// Approving a sign-up is the one admin action whose RESULT lands somewhere else
// entirely: a driver appears on one season's roster, on a screen the admin may
// not be scoped to, in a series they may not have open. The approval itself
// happens in a queue that then empties, so there was nothing left to say it had
// happened — the admin had to remember which season the person had asked for
// and go and look. This module is what turns that into a notification.
//
// Everything here is pure, so the badge on the sidebar, the panel on the Driver
// Roster screen and the tests all read one set of rules.

import { isNumberChange } from "@/lib/signupQueue";

// One approved sign-up, flattened into what an admin needs to read: who, onto
// what, with which number and car. The request doc carries all of it already —
// it's stamped with the season's names at submission time, so this stays right
// even if a series is renamed afterwards.
export function additionRow(req) {
  return {
    id: req.id,
    driver_id: req.driver_id || "",
    name: req.name || req.driver_name || "Driver",
    number: String(req.number ?? "").trim(),
    car: req.car || "",
    class_names: req.class_names || [],
    season_id: req.season_id || "",
    season_name: req.season_name || "Season",
    series_id: req.series_id || "",
    series_name: req.series_name || "Series",
    game_id: req.game_id || "",
    game_name: req.game_name || "",
    resolved_at: req.resolved_at || "",
    // When this row last mattered: approved rows are ordered by when they were
    // approved, waiting ones by when they were sent. One field, so grouping and
    // ordering work the same for both strips.
    at: req.resolved_at || req.created_at || "",
    // Someone the league had never seen before — worth flagging, because
    // approving them created a driver profile as well as a roster place.
    is_new_driver: !!req.new_driver,
  };
}

// The approvals an admin hasn't seen yet: approved SIGN-UPS resolved after the
// moment they last opened the screen.
//
// Number changes are deliberately excluded. Approving one moves a number on a
// roster entry that already existed — nobody joined anything, and the roster's
// membership is what this notification is about. They're still in the queue and
// still reviewed there; they just aren't "someone was added".
export function newAdditions(rows = [], seenIso = "") {
  const seen = String(seenIso || "");
  return rows
    .filter(r => !isNumberChange(r))
    .filter(r => String(r.resolved_at || "") > seen)
    .map(additionRow)
    .sort((a, b) => String(b.resolved_at).localeCompare(String(a.resolved_at)));
}

// Those additions gathered by the roster they landed on, because that's the
// unit an admin acts on: one trip to a season's roster settles every driver who
// joined it, so the panel offers one button per season rather than one per
// person. Seasons are ordered by their most recent addition.
export function groupBySeason(additions = []) {
  const bySeason = new Map();
  for (const a of additions) {
    const key = a.season_id || `${a.series_name}·${a.season_name}`;
    if (!bySeason.has(key)) {
      bySeason.set(key, {
        season_id: a.season_id,
        season_name: a.season_name,
        series_id: a.series_id,
        series_name: a.series_name,
        game_id: a.game_id,
        game_name: a.game_name,
        latest: a.at,
        drivers: [],
      });
    }
    const group = bySeason.get(key);
    group.drivers.push(a);
    if (String(a.at) > String(group.latest)) group.latest = a.at;
  }
  return [...bySeason.values()]
    .sort((a, b) => String(b.latest).localeCompare(String(a.latest)));
}

// "3 drivers added to 2 rosters" — the sidebar badge's tooltip, and the panel's
// own heading. Says both numbers because they answer different questions: how
// much has changed, and how many places have to be looked at.
export function additionsTitle(additions = []) {
  const drivers = additions.length;
  if (!drivers) return "No new drivers on your rosters";
  const seasons = groupBySeason(additions).length;
  return `${drivers} driver${drivers === 1 ? "" : "s"} added to `
    + `${seasons} roster${seasons === 1 ? "" : "s"}`;
}

// One driver's line in the panel: "#42 · Ferrari 296 GT3 · Pro", with only the
// parts that season actually uses. A series that runs no numbers and no car
// list would otherwise get a row of separators around nothing.
export function additionDetail(addition) {
  return [
    addition.number ? `#${addition.number}` : "",
    addition.car,
    (addition.class_names || []).join(" · "),
    addition.is_new_driver ? "new to the league" : "",
  ].filter(Boolean).join(" · ");
}

// Sign-ups still WAITING, in seasons other than the one on screen.
//
// The queue panel on the Driver Roster is scoped to the season being edited,
// which is right for working through it — but it means an admin sitting on
// Season 3 is told nothing at all about the two people waiting for Season 4.
// The sign-up simply doesn't appear until they happen to steer the dropdowns
// at the right season, which is the same "where did it go?" problem the
// additions panel solves at the other end of the process.
//
// Same shape as the additions groups, so the two strips render from one
// component's worth of markup and one set of rules.
export function pendingElsewhere(rows = [], currentSeasonId = "") {
  const current = String(currentSeasonId || "");
  const others = rows
    .filter(r => !isNumberChange(r))
    .filter(r => String(r.season_id || "") !== current)
    .map(additionRow);
  // Oldest first within each season: whoever has waited longest leads, which is
  // the order the queue itself works in.
  return groupBySeason(others).map(g => ({
    ...g,
    drivers: [...g.drivers].sort((a, b) => String(a.at).localeCompare(String(b.at))),
  }));
}

// "3 waiting in 2 other seasons" — the strip's heading.
export function pendingElsewhereTitle(groups = []) {
  const people = groups.reduce((n, g) => n + g.drivers.length, 0);
  if (!people) return "";
  return `${people} sign-up${people === 1 ? "" : "s"} waiting in `
    + `${groups.length} other season${groups.length === 1 ? "" : "s"}`;
}
