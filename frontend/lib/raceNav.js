import { filterRacesByClass } from "@/lib/classFilter";

// The round either side of `race` in its own calendar, plus where it sits in
// that calendar ("Round 4 of 12"). Exported so the ordering rule has one home:
//
//   • order is the Schedule's — round number ascending, with date then name only
//     breaking a tie between two rounds numbered the same;
//   • a round pinned to ONE class steps through that class's calendar (its own
//     rounds plus the shared ones), since that is the calendar it appears on;
//   • `at` is -1 when the race isn't in the list (a round just deleted, say),
//     which is how the component knows to render nothing.
export function raceNeighbours(races = [], race = {}) {
  const inScope = race.class_id ? filterRacesByClass(races, race.class_id) : races;
  const ordered = [...inScope].sort((a, b) =>
    (Number(a.round_number) || 0) - (Number(b.round_number) || 0)
    || String(a.date ?? "").localeCompare(String(b.date ?? ""))
    || String(a.name ?? "").localeCompare(String(b.name ?? "")));
  const at = ordered.findIndex(r => r.id === race.id);
  return {
    ordered,
    at,
    prev: at > 0 ? ordered[at - 1] : null,
    next: at >= 0 && at < ordered.length - 1 ? ordered[at + 1] : null,
  };
}
