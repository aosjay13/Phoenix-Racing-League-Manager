// Per-car caps: "Ferrari 296 GT3 | 4" means four drivers may run it, and the
// fifth is refused.
//
// Three things have to hold or the cap is worse than not having one:
//
//   1. every list saved BEFORE caps existed still parses to exactly what it did
//      — a car whose name happens to contain odd characters must not suddenly
//      acquire a limit, and no cap must silently appear or vanish;
//   2. what counts against a cap is the roster PLUS the queue — five people
//      each picking the last seat because none of them is approved yet is the
//      pile-up the cap exists to prevent;
//   3. a driver's own car never counts against them, or the last person to take
//      a seat can't re-save their own choice.
import assert from "node:assert";
import {
  carAvailability, carCapacity, carCounts, carEntryList, carFullMessage, carOptionList,
  carSelectionFormToBody, carSelectionToForm, formatCarEntry, parseCarEntries, parseCarOptions,
  resolveCarSelection, resolveSignupRules,
} from "../carSelection.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };

// ── 1. Every list that already existed parses unchanged ────────────────────
check("a plain list is unchanged",
  parseCarOptions("Ferrari 296 GT3\nPorsche 911 GT3 R"), ["Ferrari 296 GT3", "Porsche 911 GT3 R"]);
check("and gets no caps", parseCarEntries("Ferrari 296 GT3").map(e => e.max), [null]);
check("a comma list still works", parseCarOptions("A, B, C"), ["A", "B", "C"]);
check("duplicates still collapse", parseCarOptions("GT3\ngt3\nGT4"), ["GT3", "GT4"]);
check("blank lines are still dropped", parseCarOptions("A\n\n  \nB"), ["A", "B"]);
// A name containing a comma survives on its own line — the rule that made
// newlines win over commas.
check("a comma inside a name on its own line",
  parseCarOptions("Porsche 911 GT3 R, 992\nFerrari"), ["Porsche 911 GT3 R, 992", "Ferrari"]);

// ── The cap syntax ─────────────────────────────────────────────────────────
check("a cap is read off the end",
  parseCarEntries("Ferrari 296 GT3 | 4"), [{ name: "Ferrari 296 GT3", max: 4 }]);
check("spacing around the pipe doesn't matter",
  parseCarEntries("Ferrari|4")[0], { name: "Ferrari", max: 4 });
check("a mixed list", parseCarEntries("A | 2\nB\nC | 1"),
  [{ name: "A", max: 2 }, { name: "B", max: null }, { name: "C", max: 1 }]);
// Anything that isn't a positive whole number means "no cap" — offering a car
// nobody can choose is the worse failure.
check("zero is not a cap", parseCarEntries("A | 0")[0].max, null);
check("nor is a negative", parseCarEntries("A | -3")[0].max, null);
check("nor a fraction", parseCarEntries("A | 2.5")[0].max, null);
check("nor a word", parseCarEntries("A | lots")[0].max, null);
check("nor an empty one", parseCarEntries("A |")[0].max, null);
// The LAST pipe splits, so a name may contain one.
check("a name containing a pipe keeps it",
  parseCarEntries("A | B | 3")[0], { name: "A | B", max: 3 });
check("the plain-name view drops the caps", parseCarOptions("A | 2\nB"), ["A", "B"]);
check("nothing at all", parseCarEntries(""), []);
check("undefined", parseCarEntries(undefined), []);
// Already-structured rows (a doc written as objects) pass straight through.
check("structured rows are accepted",
  parseCarEntries([{ name: "A", max: 2 }, { name: "B" }]),
  [{ name: "A", max: 2 }, { name: "B", max: null }]);

check("one entry back to text", formatCarEntry({ name: "A", max: 3 }), "A | 3");
check("an uncapped one has no pipe", formatCarEntry({ name: "A", max: null }), "A");
// The round trip is what stops an unrelated edit deleting every cap.
const text = "Ferrari 296 GT3 | 4\nPorsche 911 GT3 R\nBMW M4 GT3 | 2";
check("text survives a round trip",
  parseCarEntries(text).map(formatCarEntry).join("\n"), text);
check("and a League Setup edit that doesn't touch it",
  carSelectionToForm({ car_options: parseCarEntries(text).map(formatCarEntry) }).car_options, text);
check("saving keeps the caps",
  carSelectionFormToBody({ car_options: text }).car_options,
  ["Ferrari 296 GT3 | 4", "Porsche 911 GT3 R", "BMW M4 GT3 | 2"]);

// ── Reading a doc, and resolving down the chain ────────────────────────────
check("a doc's entries", carEntryList({ car_options: "A | 2\nB" }),
  [{ name: "A", max: 2 }, { name: "B", max: null }]);
check("the old manufacturer list still stands in",
  carOptionList({ manufacturer_options: "Ford\nChevy" }), ["Ford", "Chevy"]);
// The caps ride with the list that wins: a season publishing its own list sets
// its own caps rather than inheriting numbers meant for other cars.
const chain = { game: { car_options: "GameCar | 9" }, series: { car_options: "A | 2\nB | 3" } };
check("the most specific list wins, with its caps",
  resolveCarSelection(chain).car_entries, [{ name: "A", max: 2 }, { name: "B", max: 3 }]);
check("and a season's own list replaces both",
  resolveCarSelection({ ...chain, season: { car_options: "S1" } }).car_entries,
  [{ name: "S1", max: null }]);
check("the sign-up rules carry them too",
  resolveSignupRules(chain).car_entries, [{ name: "A", max: 2 }, { name: "B", max: 3 }]);
check("no list anywhere", resolveCarSelection({}).car_entries, []);

// ── 2. The roster AND the queue count ──────────────────────────────────────
const roster = [
  { name: "Ana", selected_car: "Ferrari 296 GT3" },
  { name: "Bo", selected_car: "Ferrari 296 GT3" },
  { name: "Cyd", selected_car: "BMW M4 GT3" },
];
const queue = [{ name: "Dee", car: "Ferrari 296 GT3" }];
check("roster entries count", carCounts(roster)["ferrari 296 gt3"], 2);
check("and so do queued sign-ups", carCounts([...roster, ...queue])["ferrari 296 gt3"], 3);
check("matching ignores case",
  carCounts([{ car: "FERRARI 296 GT3" }])["ferrari 296 gt3"], 1);
// A season whose classes run their own lists puts one car per class on an entry.
check("every car on a multi-class entry counts",
  carCounts([{ selected_cars: { pro: "A", am: "B" } }]), { a: 1, b: 1 });
check("a row with no car counts for nothing", carCounts([{ name: "Nobody" }]), {});
check("nothing at all", carCounts(), {});

const entries = parseCarEntries("Ferrari 296 GT3 | 3\nBMW M4 GT3 | 1\nPorsche 911 GT3 R");
const counts = carCounts([...roster, ...queue]);
check("a car at its cap is full", carCapacity(entries, counts, "Ferrari 296 GT3").full, true);
check("with the numbers to say so",
  [carCapacity(entries, counts, "Ferrari 296 GT3").taken, carCapacity(entries, counts, "Ferrari 296 GT3").max],
  [3, 3]);
check("a car at its cap has no seats left",
  carCapacity(entries, counts, "Ferrari 296 GT3").left, 0);
check("BMW is also full at one", carCapacity(entries, counts, "BMW M4 GT3").full, true);
check("an uncapped car is never full",
  carCapacity(entries, counts, "Porsche 911 GT3 R").full, false);
check("and reports no limit", carCapacity(entries, counts, "Porsche 911 GT3 R").max, null);
check("nor its remaining seats", carCapacity(entries, counts, "Porsche 911 GT3 R").left, null);
// A cap lowered below what's already taken reads as full, not as negative room.
check("an over-filled car has zero left, not negative",
  carCapacity(parseCarEntries("Ferrari 296 GT3 | 1"), counts, "Ferrari 296 GT3").left, 0);

// ── 3. Your own car never counts against you ───────────────────────────────
check("the driver holding the last seat isn't locked out of it",
  carCapacity(entries, counts, "BMW M4 GT3", "BMW M4 GT3").full, false);
check("but somebody else still is",
  carCapacity(entries, counts, "BMW M4 GT3", "Ferrari 296 GT3").full, true);
check("matched case-insensitively",
  carCapacity(entries, counts, "BMW M4 GT3", "bmw m4 gt3").full, false);

// ── The whole list, as the form renders it ─────────────────────────────────
const avail = carAvailability(entries, [...roster, ...queue]);
check("one row per offered car, in the order typed",
  avail.map(a => a.name), ["Ferrari 296 GT3", "BMW M4 GT3", "Porsche 911 GT3 R"]);
check("with the full ones flagged", avail.map(a => a.full), [true, true, false]);
check("nothing offered", carAvailability([], roster), []);
// A car nobody has yet is open with all its seats.
check("an untouched capped car",
  carAvailability(parseCarEntries("New | 2"), []), [{ name: "New", max: 2, taken: 0, left: 2, full: false }]);

ok("the refusal names the car and the numbers",
  carFullMessage(carCapacity(entries, counts, "Ferrari 296 GT3"))
    === "Ferrari 296 GT3 is full — 3 of 3 taken. Please choose another car.");

console.log(`carLimits: ${n} assertions passed`);
