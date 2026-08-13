// Pure planning logic for the bulk roster import (POST /api/roster/import).
// Kept out of the route so the deduplication rules — the part that decides who
// gets created and who is skipped — are testable on their own.
//
// There are TWO questions to answer for every driver being pulled into a new
// season's roster, and only the first one used to be asked:
//
//   1. are they already on THIS roster?      → skip them
//   2. who are they in the app at all?       → link them to that driver
//
// Question 2 is the one that made duplicates. A source entry that carried a
// `driver_id` brought it along, but one that didn't — a legacy entry, or one
// typed in under the name a different game uses — arrived as a nameless
// stranger, and the roster grew a second copy of somebody it already had. So
// every candidate is now resolved against the global driver pool through the
// shared matcher (lib/driverMatch.js), which knows every name a driver answers
// to: profile name, display name, per-game names, connected-account usernames
// and any name a merge folded into them.
//
// What comes back is a PLAN, not a write: one row per candidate saying what
// would happen and why, so the import dialog can show it and an admin can
// settle the doubtful ones before anything is created.

import { duplicateReport } from "@/lib/driverMatch";

// Every identity key an entry could be recognised by, matching how the rest of
// the app unifies drivers: global driver_id first, then linked account, then
// lowercased name. A driver counts as "already on the roster" if ANY of their
// keys is already claimed, so someone on the target roster under a series alias
// still blocks a duplicate arriving under their pool name.
export function identityKeys(entry) {
  const keys = [];
  if (entry.driver_id) keys.push(`d:${entry.driver_id}`);
  if (entry.user_id) keys.push(`u:${entry.user_id}`);
  const name = String(entry.name || "").trim().toLowerCase();
  if (name) keys.push(`n:${name}`);
  return keys;
}

// What a planned row says about one candidate:
//
//   on_roster  already racing this season — nothing to do
//   unusable   no name and no identity; there'd be nothing to show on a roster
//   linked     resolved to a driver the app already has (their own driver_id,
//              or a name they demonstrably answer to) — import under them
//   check      resembles one or more existing drivers without matching any of
//              them outright. The one case a human has to settle, and the one
//              that silently created duplicates before
//   new        nobody in the league is close — a new driver profile is created
export const ROW_STATUS = ["on_roster", "unusable", "linked", "check", "new"];

// Decide what a run would do. `existing` is the target season's current roster,
// `candidates` the source entries, `pool` the league's global drivers. The
// FIRST candidate seen for a driver is the one kept, so callers pass them
// newest-season-first to carry over the name and number that driver most
// recently raced under.
//
// Team and class are deliberately NOT carried — both are per-season records
// whose ids mean nothing in the new season.
export function planRosterImport(existing, candidates, pool = [], { games = {} } = {}) {
  const taken = new Set();
  for (const e of existing) for (const k of identityKeys(e)) taken.add(k);
  // Drivers this run has already spoken for, so two source entries that resolve
  // to one person (their entry in each of two past seasons) can't both come
  // through as separate roster places.
  const claimed = new Set();
  for (const e of existing) if (e.driver_id) claimed.add(e.driver_id);

  const rows = [];
  for (const c of candidates) {
    const base = {
      key: c.id ?? `${c.season_id ?? ""}:${c.name ?? ""}`,
      name: c.name ?? "",
      number: c.number != null && c.number !== "" ? String(c.number) : "",
      user_id: c.user_id || "",
      source_season_id: c.season_id ?? null,
    };
    const keys = identityKeys(c);
    // An entry with no name and no identity can't be matched or displayed.
    if (!keys.length) { rows.push({ ...base, status: "unusable", driver_id: null, matches: [] }); continue; }
    if (keys.some(k => taken.has(k))) { rows.push({ ...base, status: "on_roster", driver_id: c.driver_id || null, matches: [] }); continue; }
    for (const k of keys) taken.add(k);

    // Who is this, in the app? An entry that already carries a driver_id has
    // answered that itself.
    const report = c.driver_id
      ? { status: "linked", driver_id: c.driver_id, matches: [], match: null }
      : duplicateReport(pool, { name: base.name, user_id: base.user_id }, { games });

    if (report.status === "linked" && report.driver_id) {
      if (claimed.has(report.driver_id)) {
        rows.push({ ...base, status: "on_roster", driver_id: report.driver_id, matches: [] });
        continue;
      }
      claimed.add(report.driver_id);
      rows.push({ ...base, status: "linked", driver_id: report.driver_id, matches: report.matches, match: report.match ?? null });
      continue;
    }
    if (report.status === "none") {
      rows.push({ ...base, status: "new", driver_id: null, matches: [] });
      continue;
    }
    rows.push({ ...base, status: "check", driver_id: null, matches: report.matches });
  }

  return { rows, summary: summarize(rows) };
}

export function summarize(rows = []) {
  const count = status => rows.filter(r => r.status === status).length;
  return {
    total: rows.length,
    linked: count("linked"),
    check: count("check"),
    new: count("new"),
    on_roster: count("on_roster"),
    unusable: count("unusable"),
  };
}

// Turn the plan plus the admin's answers into what to write.
//
// `decisions` maps a row key to { action, driver_id }:
//   link + driver_id  → import them under that existing driver
//   create            → make a new driver profile for them
//   skip              → leave them off this roster entirely
//
// A row nobody answered for falls back to what the plan said: `linked` rows
// import under the driver they resolved to, `new` rows create one, and a
// `check` row — the doubtful case — creates one too, because that is what the
// importer did before any of this existed and an unanswered question must not
// silently merge two people into one. The dialog doesn't let a `check` row go
// unanswered; this is only what happens if something else calls the route.
//
// Returns { create, skipped, needsDriver }, where `create` holds the per-entry
// payload fields that carry over and `needsDriver` lists the rows whose driver
// profile has to be made before the entries are written.
export function applyRosterPlan(rows = [], decisions = {}) {
  const create = [];
  const needsDriver = [];
  let skipped = 0;

  for (const row of rows) {
    if (row.status === "on_roster" || row.status === "unusable") { skipped += 1; continue; }
    const choice = decisions[row.key] || {};
    const action = choice.action || (row.status === "linked" ? "link" : "create");
    if (action === "skip") { skipped += 1; continue; }

    const driverId = action === "link" ? (choice.driver_id || row.driver_id || null) : null;
    if (action === "link" && !driverId) { skipped += 1; continue; }

    const entry = {
      name: row.name,
      ...(row.number ? { number: row.number } : {}),
      ...(driverId ? { driver_id: driverId } : {}),
      ...(row.user_id ? { user_id: row.user_id } : {}),
      team_id: "",
      class_id: "",
      imported_from_season_id: row.source_season_id ?? null,
    };
    if (!driverId) needsDriver.push({ key: row.key, name: row.name, user_id: row.user_id || "", at: create.length });
    create.push(entry);
  }

  return { create, skipped, needsDriver };
}
