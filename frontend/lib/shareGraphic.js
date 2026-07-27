// Helpers shared by the "Share Graphic" exporters on Standings / Stats / Race
// Results. Keeps the per-page wiring to a couple of lines.

import { formatStat } from "@/lib/standings";

// Logos the user can drop into a graphic's header, drawn from the active League
// and the currently selected Game / Series / Season (each may carry a
// logo_url). Only entries with a real image are offered; the league's own logo
// leads, since that's the one most graphics want.
export function leagueLogos({ league, game, series, season } = {}) {
  return [
    league?.logo_url && { label: `${league.name} (League)`, url: league.logo_url },
    game?.logo_url && { label: `${game.name} (Game)`, url: game.logo_url },
    series?.logo_url && { label: `${series.name} (Series)`, url: series.logo_url },
    season?.logo_url && { label: `${season.name} (Season)`, url: season.logo_url },
  ].filter(Boolean);
}

// Alias-aware primary display name, matching how tables render a driver: on a
// game-specific view the driver's mapped alias wins, otherwise the profile name.
export function driverDisplayName(r) {
  const alias = r.game_alias && r.game_alias !== r.driver_name ? r.game_alias : null;
  return alias || r.driver_name;
}

// Build the { columns, rows } payload the modal wants from a list of row objects
// and a [key, label] column spec. `key === "rank"` renders 1..N and also tags
// the top three so the graphic medals them; a `nameKey` value pulls the
// alias-aware driver/team name; everything else runs through formatStat.
//
// Pass the screen's FULL column list: the exporter's stat picker offers every
// one of them, so an admin can build any graphic they like without the page
// having to guess in advance. `defaultKeys` is the subset ticked when the modal
// opens — a feed-friendly headline set, since all fifteen columns at once makes
// an unreadable image. Omit it and everything starts on.
//
// Each column keeps its source `key`, which is what the picker toggles. A
// column switched off is dropped from the rendered table entirely (header AND
// cells), so the survivors spread across the full width instead of leaving a gap.
export function toGraphicTable(cols, rows, { nameKey, defaultKeys } = {}) {
  const onByDefault = defaultKeys ? new Set(defaultKeys) : null;
  const columns = cols.map(([key, label]) => ({
    key,
    label,
    align: key === "rank" ? "center" : key === nameKey ? "left" : "center",
    // The identity columns are what make a row readable at all, so they're
    // pinned on in the exporter rather than being hideable.
    locked: key === "rank" || key === nameKey,
    on: !onByDefault || onByDefault.has(key) || key === "rank" || key === nameKey,
  }));
  const outRows = rows.map((r, i) => {
    const rank = r.rank ?? i + 1;
    return {
      rank: rank <= 3 ? rank : undefined,
      cells: cols.map(([key]) => {
        if (key === "rank") return rank;
        if (key === nameKey) return key === "driver_name" ? driverDisplayName(r) : r[key];
        const v = r[key];
        return v == null ? "—" : formatStat(key, v);
      }),
    };
  });
  return { columns, rows: outRows };
}
