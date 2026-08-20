import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, scopeByLeague, withAdmin } from "@/lib/serverAuth";
import { TEAM_SEASONS_COLLECTION, teamNameKey } from "@/lib/teams";
import { withStatsRefresh } from "@/lib/statsCache";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Teams → global pool migration.
//
// Teams used to be per-SEASON documents: one `teams` doc per season, with the
// same team appearing as three separate docs across three seasons and its
// cross-season identity inferred from the name. This turns each of those name
// groups into ONE persistent team plus a `team_seasons` lineup per season it
// raced in — the shape the whole app now reads (see lib/teams.js).
//
// It is IDEMPOTENT and LOSSLESS:
//   • the oldest doc of each name survives as the persistent team, keeping its
//     id — so anything already pointing at it keeps resolving;
//   • every roster entry that pointed at a duplicate is re-pointed at the
//     survivor BEFORE the duplicate is deleted, so no driver loses their team;
//   • race results reference entries, never teams, so no result is touched;
//   • re-running finds the work already done and reports zeros.
//
// Nothing depends on it having been run: an un-migrated league still resolves
// its teams by name (that's the legacy path in lib/teams.js). It's the tidy-up
// that turns "teams that look persistent" into "teams that are".
// ─────────────────────────────────────────────────────────────────────────────
const handlePOST = withAdmin(async (request, ctx, user) => {
  const leagueId = getRequestLeagueId(request);
  const [teamsSnap, mappingsSnap, entriesSnap] = await Promise.all([
    scopeByLeague(db().collection("teams"), leagueId).get(),
    scopeByLeague(db().collection(TEAM_SEASONS_COLLECTION), leagueId).get(),
    scopeByLeague(db().collection("entries"), leagueId).get(),
  ]);

  const teams = teamsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const entries = entriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const existingMappings = new Set(
    mappingsSnap.docs.map(d => `${d.data().team_id}::${d.data().season_id}`),
  );

  // One group per team name; a doc with no name at all is left alone rather
  // than folded into a nameless bucket.
  const groups = new Map();
  for (const team of teams) {
    const key = teamNameKey(team.name);
    if (!key) continue;
    const group = groups.get(key) || [];
    group.push(team);
    groups.set(key, group);
  }

  const now = new Date().toISOString();
  let teamsKept = 0, teamsRemoved = 0, mappingsCreated = 0, entriesRepointed = 0, madeGlobal = 0;

  for (const group of groups.values()) {
    // The survivor: a doc that is already global, else the oldest.
    group.sort((a, b) =>
      (!!a.season_id - !!b.season_id) ||
      String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) ||
      String(a.id).localeCompare(String(b.id)));
    const canonical = group[0];
    teamsKept++;

    // Every season this name raced in, from the per-season docs themselves.
    const seasonIds = [...new Set(group.map(t => t.season_id).filter(Boolean))];
    const groupIds = new Set(group.map(t => t.id));

    for (const seasonId of seasonIds) {
      if (existingMappings.has(`${canonical.id}::${seasonId}`)) continue;
      // Who actually drove for the team that season: the roster entries that
      // pointed at any of the name's docs. Entries with no global driver id
      // (written before the driver pool existed) keep their team through the
      // re-pointed `entries.team_id` below, so nobody is dropped.
      const driverIds = [...new Set(entries
        .filter(e => e.season_id === seasonId && groupIds.has(e.team_id) && e.driver_id)
        .map(e => e.driver_id))];
      const doc = {
        team_id: canonical.id,
        season_id: seasonId,
        driver_ids: driverIds,
        created_at: now,
        created_by: user.uid,
        migrated: true,
      };
      const league = canonical.league_id || leagueId;
      if (league) doc.league_id = league;
      await db().collection(TEAM_SEASONS_COLLECTION).add(doc);
      existingMappings.add(`${canonical.id}::${seasonId}`);
      mappingsCreated++;
    }

    // Re-point every entry that referenced a duplicate at the survivor, then
    // drop the duplicates. Order matters: an entry must never be left pointing
    // at a deleted doc.
    const duplicates = group.slice(1);
    if (duplicates.length) {
      const dupIds = new Set(duplicates.map(t => t.id));
      const pending = entries.filter(e => dupIds.has(e.team_id));
      for (let i = 0; i < pending.length; i += 400) {
        const batch = db().batch();
        for (const entry of pending.slice(i, i + 400)) {
          batch.update(db().collection("entries").doc(entry.id), { team_id: canonical.id });
          entry.team_id = canonical.id;
        }
        await batch.commit();
        entriesRepointed += pending.slice(i, i + 400).length;
      }
      for (let i = 0; i < duplicates.length; i += 400) {
        const batch = db().batch();
        for (const dup of duplicates.slice(i, i + 400)) batch.delete(db().collection("teams").doc(dup.id));
        await batch.commit();
      }
      teamsRemoved += duplicates.length;
    }

    // The survivor becomes a global team: its season now lives in the lineup
    // doc, so the field that tied it to one season is dropped.
    if (canonical.season_id) {
      await db().collection("teams").doc(canonical.id).update({ season_id: FieldValue.delete() });
      madeGlobal++;
    }
  }

  return NextResponse.json({
    ok: true,
    teams_kept: teamsKept,
    teams_removed: teamsRemoved,
    made_global: madeGlobal,
    mappings_created: mappingsCreated,
    entries_repointed: entriesRepointed,
  });
});

// A successful write here changes something the cached league reads are built
// from, so the cache is dropped in the same request — see lib/statsCache.js.
export const POST = withStatsRefresh(handlePOST);
