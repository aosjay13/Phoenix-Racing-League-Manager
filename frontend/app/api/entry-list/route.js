import { NextResponse } from "next/server";
import { getUserRole, withUser } from "@/lib/serverAuth";
import { isStaffRole } from "@/lib/roles";
import { fetchDriverNames } from "@/lib/driverNamesServer";
import { loadTeamIndex } from "@/lib/teamsServer";
import { seasonAcceptsSignups, sortRosterByNumber } from "@/lib/carSelection";
import {
  leagueSeasonIndex, linkedDriver, newestFirst, pendingForSeasons, rostersForSeasons,
  seasonContext, seasonEntries,
} from "@/lib/carSelectionServer";
import {
  ENTRY_LIST_CLOSED_MESSAGE, canViewEntryList, entryCars, entryStanding, pendingEntries,
} from "@/lib/entryList";
import { isNumberChange } from "@/lib/signupQueue";

export const dynamic = "force-dynamic";

// A season's entry list — see lib/entryList.js for who may read it and why.
//
//   GET /api/entry-list?season_id=…   one season's list: every driver on the
//                                     roster in car-number order, with their
//                                     class, team and car, plus the sign-ups
//                                     still waiting to get in.
//   GET /api/entry-list               staff only: every ACTIVE season in the
//                                     league with its head count, for the
//                                     "pick a series" list on Series Sign-Ups
//                                     and Driver Roster.
//
// A player never needs the second form. Their own seasons are already in
// /api/users/me/series, which the Dashboard reads for the rows it shows; the
// list itself is only fetched when one is opened.
export const GET = withUser(async (request, ctx, user, leagueId) => {
  const seasonId = new URL(request.url).searchParams.get("season_id");
  return seasonId
    ? seasonList(seasonId, user, leagueId)
    : activeSeasons(user, leagueId);
});

async function seasonList(seasonId, user, requestLeagueId) {
  const context = await seasonContext(seasonId);
  if (!context) return NextResponse.json({ error: "Season not found" }, { status: 404 });
  const { season, series, game, classes } = context;
  // Answered in the league THIS SEASON belongs to, the way /api/car-selection
  // does: a direct link to a season in another league must resolve the driver
  // profile and the staff role that league knows this account by.
  const leagueId = season.league_id || requestLeagueId || "";

  const [entries, pendings, role, driver] = await Promise.all([
    seasonEntries(seasonId, classes),
    pendingForSeasons([seasonId]),
    getUserRole(user, leagueId),
    linkedDriver(user.uid, leagueId),
  ]);
  const pending = pendings[seasonId] || [];
  const staff = isStaffRole(role);
  const standing = entryStanding({ entries, pending, uid: user.uid, driverId: driver?.id || "" });
  if (!canViewEntryList({ staff, standing })) {
    return NextResponse.json({ error: ENTRY_LIST_CLOSED_MESSAGE, code: "not-joined" }, { status: 403 });
  }

  const gameId = season.game_id || series?.game_id || null;
  // The name each driver races under in this game (falling back to the entry's
  // own alias), and the team they drive for this season — the same two
  // answers the roster and the standings give, so the lists never disagree.
  const [names, teamIndex] = await Promise.all([
    fetchDriverNames(entries.map(e => e.driver_id), gameId),
    loadTeamIndex({ leagueId }),
  ]);
  const classNameById = Object.fromEntries(classes.map(c => [c.id, c.name]));

  const rows = sortRosterByNumber(entries.map(entry => {
    const team = teamIndex.teamForEntry(entry, seasonId);
    return {
      entry_id: entry.id,
      driver_id: entry.driver_id ?? null,
      number: entry.number ?? null,
      name: (entry.driver_id ? names[entry.driver_id]?.display : null) || entry.name || "Driver",
      class_names: entry.class_ids.map(id => classNameById[id]).filter(Boolean),
      team: team ? { id: team.id, name: team.name || "Team", logo_url: team.logo_url || "", color: team.color || "" } : null,
      cars: entryCars(entry),
      // A number change waiting on an admin, shown beside the number it would
      // replace so nobody reads the list as final while it's being moved.
      wants_number: pending.find(p => isNumberChange(p) && p.entry_id === entry.id)?.number ?? null,
      mine: (!!driver && entry.driver_id === driver.id) || entry.user_id === user.uid,
    };
  }));

  return NextResponse.json({
    season: { id: season.id, name: season.name || "Season", status: season.status || "active", logo_url: season.logo_url || "" },
    series: series ? { id: series.id, name: series.name || "Series", logo_url: series.logo_url || "" } : null,
    game_name: game?.name || "",
    open: seasonAcceptsSignups(season),
    classes: classes.map(c => ({ id: c.id, name: c.name })),
    viewer: { staff, standing },
    entries: rows,
    pending: pendingEntries(pending, { uid: user.uid, driverId: driver?.id || "" }),
  });
}

// Every season in the league still to run, newest first, with how many are on
// it and how many are waiting to get in. Staff only — it spans seasons nobody
// asking has necessarily joined.
async function activeSeasons(user, leagueId) {
  if (!isStaffRole(await getUserRole(user, leagueId))) {
    return NextResponse.json({ error: "Admin access required for this league" }, { status: 403 });
  }
  const { seasons, seriesById, gamesById } = await leagueSeasonIndex(leagueId);
  // The same "is this season listable?" rule the Sign-ups screen applies: a
  // season orphaned by a deleted series or game is hidden everywhere else, so
  // it's hidden here too.
  const gameOf = s => s.game_id || seriesById[s.series_id]?.game_id;
  const active = newestFirst(seasons)
    .filter(seasonAcceptsSignups)
    .filter(s => !!seriesById[s.series_id] && !!gamesById[gameOf(s)]);
  const ids = active.map(s => s.id);
  const [rosters, pendings] = await Promise.all([rostersForSeasons(ids), pendingForSeasons(ids)]);

  return NextResponse.json({
    seasons: active.map(s => {
      const series = seriesById[s.series_id];
      const waiting = (pendings[s.id] || []).filter(p => !isNumberChange(p));
      return {
        season_id: s.id,
        season_name: s.name || "Season",
        series_id: s.series_id,
        series_name: series.name || "Series",
        game_id: gameOf(s) || "",
        game_name: gamesById[gameOf(s)]?.name || "",
        logo_url: s.logo_url || series.logo_url || "",
        entry_count: (rosters[s.id] || []).length,
        pending_count: waiting.length,
      };
    }),
  });
}
