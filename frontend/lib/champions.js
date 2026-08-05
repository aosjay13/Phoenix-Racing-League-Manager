// Who won a championship, and how many that's worth.
//
// One definition, used by the driver profile, the stats tables and team pages,
// so a title means the same thing everywhere it's counted.
//
// The rules:
//
//   • A season only crowns anyone once it's marked **completed**.
//   • A season with no classes crowns its points leader — the behaviour that
//     existed before classes did.
//   • A season WITH classes crowns each class's own points leader. A class
//     championship is a championship: it counts +1 for that driver at every
//     scope, including the league-wide "All Games" view where no class is
//     selected. This is the part that used to be lost — only the outright
//     leader was credited, so a GT3 champion who ran mid-pack on combined
//     points finished their season with nothing.
//   • The OVERALL (combined) title is awarded on top only when the season's
//     `combined_championship` toggle is on. Switched off, the combined table is
//     explicitly unofficial, so no overall champion is awarded, displayed or
//     counted — the class winners are the only champions that season.
//   • Every crown counts. A season running three classes with the overall
//     championship switched on crowns FOUR champions — one per class, plus the
//     outright one — and all four are tracked. When the same driver takes both
//     their class and the overall that's two titles to their name, because two
//     championships were won; collapsing them to one used to make the overall
//     title vanish from the records in exactly the case where it's most often
//     won, since the outright leader is usually a class winner too.

import { calculateStandings } from "@/lib/standings";
import { classIdSet, filterEntriesByClass, filterResultsByClass } from "@/lib/classFilter";

// Every crown handed out in one season, as
// [{ entry_id, kind: "overall" | "class", class_id, class_name }].
// `results` must already be decorated (bonuses + session flags), exactly as
// calculateStandings expects. `classes` is the season's class list — empty for
// a single-class season.
export function seasonChampions(season, results, entries, config, templatesById = {}, classes = []) {
  if (!season || season.status !== "completed" || !results.length) return [];

  const crowns = [];
  const entriesById = Object.fromEntries(entries.map(e => [e.id, e]));

  // Each class crowns its own champion, scored within the class — its own
  // points, its own drop weeks, its own leader.
  for (const c of classes) {
    const classResults = filterResultsByClass(results, c.id, entriesById);
    if (!classResults.length) continue;
    const top = calculateStandings(classResults, filterEntriesByClass(entries, c.id), [], config, templatesById, classes).rows[0];
    if (top) crowns.push({ entry_id: top.entry_id, kind: "class", class_id: c.id, class_name: c.name ?? null });
  }

  // The overall title. A season without classes has only this one; a season
  // with classes awards it only when the combined championship is enabled.
  if (!classes.length || season.combined_championship !== false) {
    const top = calculateStandings(results, entries, [], config, templatesById, classes).rows[0];
    if (top) crowns.push({ entry_id: top.entry_id, kind: "overall", class_id: null, class_name: null });
  }

  return crowns;
}

// Group a season's crowns by who won them:
// entry_id -> { titles, overall, class_names[] }. `titles` is how many crowns
// that competitor took, so a driver who wins their class AND the overall in the
// same season scores two — two championships were decided, and both belong on
// their record.
//
// Entries are per season, so keying on entry_id is keying on driver-season.
export function titlesByEntry(crowns) {
  const byEntry = new Map();
  for (const c of crowns) {
    const rec = byEntry.get(c.entry_id) ?? { titles: 0, overall: false, class_names: [] };
    rec.titles += 1;
    if (c.kind === "overall") rec.overall = true;
    else if (c.class_name) rec.class_names.push(c.class_name);
    byEntry.set(c.entry_id, rec);
  }
  return byEntry;
}

// The crowns that count for the scope being viewed. Inside one class, only that
// class's title is relevant — a GT3 view shouldn't credit the driver who led
// the combined table. With no class selected every crown counts, which is what
// carries class championships up into the global tally.
//
// The selection may be one class id or, above season level, every id that class
// resolves to across the seasons in scope (see classIdSet).
export function crownsInScope(crowns, selection = "") {
  const set = classIdSet(selection);
  if (!set) return crowns;
  return crowns.filter(c => set.has(c.class_id));
}

// "Overall + GT3" / "GT3" / "Overall" — a short, readable description of what
// somebody won in a season, for profiles and tooltips.
export function describeCrowns(rec) {
  if (!rec) return "";
  return [...(rec.overall ? ["Overall"] : []), ...rec.class_names].join(" + ");
}
