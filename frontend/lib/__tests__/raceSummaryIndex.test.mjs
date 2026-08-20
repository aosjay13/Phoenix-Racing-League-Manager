// summarizeRace takes either every result to consider or an index of them
// grouped by race (indexResultsByRace). The whole point of the index is that it
// is a pure speed-up — the schedule feed used to rescan the league's entire
// results list once per race, and once again per class of every race, which is
// races x results and got worse every season on its own.
//
// A speed-up that changes an answer is a bug, not a speed-up. So the invariant
// this file exists to hold is exactly one thing:
//
//   summarizeRace(race, results, …) === summarizeRace(race, index, …)
//
// for every race, in every scoping the callers actually use — unscoped, scoped
// to a class, and scoped to a class the race doesn't run.
import assert from "node:assert";
import { indexResultsByRace, summarizeRace } from "../raceSummaryServer.js";

let n = 0;
const check = (label, got, want) => {
  n++;
  assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// Two classes sharing a weekend, which is the case that reads differently
// depending on which results the summary can see.
const entries = {
  pro1: { id: "pro1", name: "Ana", driver_id: "d1", class_ids: ["pro"] },
  pro2: { id: "pro2", name: "Bo", driver_id: "d2", class_ids: ["pro"] },
  am1: { id: "am1", name: "Cy", driver_id: "d3", class_ids: ["am"] },
  am2: { id: "am2", name: "Di", driver_id: "d4", class_ids: ["am"] },
};

const races = [
  { id: "r1", sessions: ["Qualifying", "Race"], total_laps: 30 },
  { id: "r2", sessions: ["Qualifying", "Heat 1", "Feature"], heat_format: true, feature_name: "Feature", total_laps: 25 },
  { id: "r3", sessions: ["Qualifying", "Race"], total_laps: 40 },   // no results at all
];

const res = (raceId, entryId, session, pos, extra = {}) => ({
  race_id: raceId, entry_id: entryId, session, finish_pos: pos,
  session_type: session === "Qualifying" ? "qualifying" : "race",
  laps: session === "Qualifying" ? 3 : 30,
  ...extra,
});

// Deliberately interleaved across races, so an index that quietly reordered
// within a race would show up below rather than pass by luck.
const results = [
  res("r1", "pro1", "Qualifying", 1), res("r2", "am1", "Qualifying", 1),
  res("r1", "am1", "Qualifying", 2), res("r1", "pro2", "Qualifying", 3),
  res("r2", "pro1", "Qualifying", 2), res("r1", "am2", "Qualifying", 4),
  res("r1", "am1", "Race", 1), res("r1", "pro1", "Race", 2),
  res("r2", "pro1", "Heat 1", 1), res("r1", "pro2", "Race", 3),
  res("r2", "am1", "Feature", 1), res("r1", "am2", "Race", 4, { provisional: true }),
  res("r2", "pro1", "Feature", 2), res("r2", "am2", "Feature", 3),
];

const index = indexResultsByRace(results);

// ── 1. The index is a regrouping and nothing else ─────────────────────────
check("every result is in the index exactly once",
  [...index.values()].reduce((sum, list) => sum + list.length, 0), results.length);
check("each race's results keep the order they arrived in",
  index.get("r1"), results.filter(r => r.race_id === "r1"));
check("a race with no results is simply absent", index.has("r3"), false);

// ── 2. The invariant: both forms summarize identically ────────────────────
for (const race of races) {
  for (const [label, classSel] of [["unscoped", ""], ["pro", "pro"], ["am", "am"], ["a class nobody runs", "gt3"]]) {
    check(`${race.id} scoped to ${label} summarizes the same either way`,
      summarizeRace(race, index, entries, "Car", classSel),
      summarizeRace(race, results, entries, "Car", classSel));
  }
}

// A race the index has never heard of must summarize as empty rather than
// throw — r3 ran no sessions, and the schedule still has a row for it.
check("an unraced round reads as having no results",
  summarizeRace(races[2], index, entries, null, "").has_results, false);

// ── 3. And the answers are actually right, not just consistent ────────────
// Guards against both forms being broken in the same way.
const r1 = summarizeRace(races[0], index, entries, null, "");
check("r1 pole is outright P1 in Qualifying", r1.pole.name, "Ana");
check("r1 winner is P1 of the deciding session", r1.winner.name, "Cy");
check("a provisional entry is not part of the field", r1.num_drivers, 3);

// A class-scoped summary narrows the FIELD but still reads OUTRIGHT finishing
// positions, so a class that didn't take the outright win or pole shows none.
// That is how it behaved before the index existed, and pinning it here is the
// point: the index must preserve the odd answers as faithfully as the obvious
// ones, or it isn't a pure speed-up.
const r1pro = summarizeRace(races[0], index, entries, null, "pro");
check("inside Pro, the field is Pro's field", r1pro.num_drivers, 2);
check("Pro took the outright pole, so Pro has one", r1pro.pole.name, "Ana");
check("Pro did not win outright, so Pro shows no winner", r1pro.winner, null);

const r1am = summarizeRace(races[0], index, entries, null, "am");
check("Am won outright, so Am has a winner", r1am.winner.name, "Cy");
check("Am did not take the outright pole, so Am shows none", r1am.pole, null);
check("a provisional Am entry still doesn't count in the field", r1am.num_drivers, 1);

const r2 = summarizeRace(races[1], index, entries, null, "");
check("a heat weekend is decided by its Feature", r2.winner.name, "Cy");

console.log(`all ${n} checks passed — the results index is a speed-up and changes no answer`);
