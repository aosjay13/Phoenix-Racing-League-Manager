// Pure planning logic for the bulk roster import (POST /api/roster/import).
// Kept out of the route so the deduplication rules — the part that decides who
// gets created and who is skipped — are testable on their own.

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

// Decide what a run would create. `existing` is the target season's current
// roster; `candidates` are the source entries. The FIRST candidate seen for a
// driver is the one kept, so callers pass them newest-season-first to carry over
// the name and number that driver most recently raced under.
//
// Returns { create, skipped }: `create` holds the per-entry payload fields that
// carry over (name, number, identity), leaving the caller to stamp season_id,
// league_id and audit fields. Team and class are deliberately NOT carried — both
// are per-season records whose ids mean nothing in the new season.
export function planRosterImport(existing, candidates) {
  const taken = new Set();
  for (const e of existing) for (const k of identityKeys(e)) taken.add(k);

  const create = [];
  let skipped = 0;

  for (const c of candidates) {
    const keys = identityKeys(c);
    // An entry with no name and no identity can't be matched or displayed.
    if (!keys.length) { skipped += 1; continue; }
    if (keys.some(k => taken.has(k))) { skipped += 1; continue; }
    // Claim every key up front so two source entries for the same person (one
    // per past season) can't both come through in the same run.
    for (const k of keys) taken.add(k);
    create.push({
      name: c.name,
      ...(c.number != null && c.number !== "" ? { number: String(c.number) } : {}),
      ...(c.driver_id ? { driver_id: c.driver_id } : {}),
      ...(c.user_id ? { user_id: c.user_id } : {}),
      team_id: "",
      class_id: "",
      imported_from_season_id: c.season_id ?? null,
    });
  }

  return { create, skipped };
}
