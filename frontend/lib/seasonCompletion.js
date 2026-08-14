// Telling the drivers of a season that it's over.
//
// An admin pressing "Mark Completed" was, until now, silent to everybody it
// affected. Worse than silent: the Dashboard's Series Information section drops
// a finished season the moment it's marked — correctly, there's nothing left to
// answer for it — so the row that said which series, season and class a player
// was in simply stopped being there. The one visible consequence of the
// decision was a card disappearing, which reads far more like the app losing an
// entry than like a season finishing.
//
// So the row turns into a message instead. Everything here is pure — the
// Firestore reads live in lib/seasonCompletionServer.js — so what decides WHO
// gets told, and what their card says, is testable without a database.

import { seasonIsCompleted } from "@/lib/carSelection";
import { classNamesFor, entryClassIds } from "@/lib/classFilter";

// Did THIS save finish the season?
//
// The announcement hangs off the TRANSITION, never off the stored status, and
// that's the whole of what stops the board filling with duplicates: "Mark
// Completed" is a toggle an admin can press twice by accident, and every other
// edit to a finished season (a rename, a points tweak, a logo) is a PATCH that
// leaves `status` exactly where it was. Only active → completed announces.
// Un-completing a season says nothing at all — the card already sent stays as
// the record of what was decided at the time.
export function seasonJustCompleted(before, after) {
  return !seasonIsCompleted(before) && seasonIsCompleted(after);
}

// Who to tell, one card each.
//
// Keyed by ACCOUNT, not by roster entry, for two reasons. A driver can still
// hold more than one entry in a season (the old add-them-once-per-class
// workaround, which the roster's "Combine" button folds up), and two cards for
// one season would read as a bug. And an entry with no account behind it — a
// hand-typed roster row for somebody with no login — has nobody to tell, so it
// drops out rather than posting into the void.
//
// `entries` are roster rows with their account already resolved onto `user_id`
// (through the driver profile where the entry only names one — see
// lib/seasonCompletionServer.js). `classes` are the season's, in display order,
// so a driver in two of them reads them the same way round as everywhere else.
//
// The classes are gathered as IDS and only turned into names at the end, once,
// through the season's own order. Merging the NAMES entry by entry would have
// ordered them by whichever roster row Firestore happened to return first —
// which is not an order at all, and read as "Amateur & Pro" for a driver whose
// season lists Pro above Amateur everywhere else in the app.
export function completionRecipients(entries = [], classes = []) {
  const byUid = new Map();
  for (const entry of entries) {
    const uid = String(entry?.user_id ?? "").trim();
    if (!uid) continue;
    const ids = entryClassIds(entry);
    const already = byUid.get(uid);
    if (already) {
      already.class_ids = [...new Set([...already.class_ids, ...ids])];
      already.driver_name ||= String(entry?.name ?? "").trim();
      already.number ||= String(entry?.number ?? "").trim();
      continue;
    }
    byUid.set(uid, {
      uid,
      class_ids: ids,
      driver_name: String(entry?.name ?? "").trim(),
      number: String(entry?.number ?? "").trim(),
    });
  }
  return [...byUid.values()].map(({ class_ids, ...rest }) => ({
    ...rest,
    class_names: classNamesFor({ class_ids }, classes),
  }));
}

// The context one recipient's card is built from — the names AS THEY WERE when
// the season ended, so a series renamed next year doesn't rewrite what somebody
// was told. The card names the whole path (game › series › season › class),
// because "your season is over" is no use to a player racing in three of them.
export function completionContext({ season, series, game, recipient }) {
  return {
    season_id: String(season?.id ?? ""),
    season_name: String(season?.name ?? "").trim() || "Season",
    series_id: String(season?.series_id ?? ""),
    series_name: String(series?.name ?? "").trim() || "Series",
    game_id: String(season?.game_id || series?.game_id || ""),
    game_name: String(game?.name ?? "").trim(),
    class_names: recipient?.class_names ?? [],
    driver_name: recipient?.driver_name || "",
    number: recipient?.number || "",
  };
}
