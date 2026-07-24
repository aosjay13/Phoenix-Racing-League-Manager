// Helpers shared by the "Share Graphic" exporters on Standings / Stats / Race
// Results. Keeps the per-page wiring to a couple of lines.

import { formatStat } from "@/lib/standings";

// Logos the user can drop into a graphic's header, drawn from the currently
// selected Game / Series / Season (each may carry a logo_url). Only entries
// with a real image are offered.
export function leagueLogos({ game, series, season } = {}) {
  return [
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
// the top three so the graphic medals them; a `nameKeys` value pulls the
// alias-aware driver/team name; everything else runs through formatStat.
export function toGraphicTable(cols, rows, { nameKey } = {}) {
  const columns = cols.map(([key, label]) => ({
    label,
    align: key === "rank" ? "center" : key === nameKey ? "left" : "center",
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
