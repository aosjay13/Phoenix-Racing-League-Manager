// One roster entry per driver, per season.
//
// A driver holding two entries in one season splits their results between them:
// the standings used to list them twice with half a season each, the stats pages
// folded them back into one and disagreed, and the results grid offered the same
// name twice. lib/standings.js now scores such a roster as one row per driver,
// and this is the rule that stops it being written in the first place — the one
// POST /api/entries applies to every caller, screens and scripts alike.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findRosterEntry, reusePatch, sameRosterDriver } from "../rosterEntry.js";

let n = 0;
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, label); };
const ok = (label, cond) => { n++; assert.ok(cond, label); };

// ── 1. Who counts as the same driver ──────────────────────────────────────
ok("the same driver profile is the same driver",
  sameRosterDriver({ driver_id: "d1", name: "Ryan" }, { driver_id: "d1", name: "Ryanbirdman" }));
ok("two profiles are two drivers, however alike the names",
  !sameRosterDriver({ driver_id: "d1", name: "Ana" }, { driver_id: "d2", name: "Ana" }));
ok("a linked account answers it when neither side has a profile",
  sameRosterDriver({ user_id: "u1", name: "Ana" }, { user_id: "u1", name: "Ana B" }));
ok("different accounts are different drivers",
  !sameRosterDriver({ user_id: "u1", name: "Ana" }, { user_id: "u2", name: "Ana" }));
// The legacy case: an entry written before the driver pool existed carries a
// name and nothing else, and the name is what the roster and the standings
// already unify it by.
ok("a nameless-identity entry still matches on its name",
  sameRosterDriver({ name: "DuckLovers" }, { driver_id: "d1", name: "ducklovers" }));
ok("blank names never match", !sameRosterDriver({ name: "  " }, { name: "" }));

// ── 2. Finding the entry a driver already holds ───────────────────────────
const roster = [
  { id: "e1", name: "DuckLovers", driver_id: "d-duck", class_ids: ["pro"] },
  { id: "e2", name: "Hweaton", driver_id: "d-hw" },
];
check("an existing entry is found by profile",
  findRosterEntry(roster, { name: "DuckLovers", driver_id: "d-duck", season_id: "s1" })?.id, "e1");
check("somebody new isn't", findRosterEntry(roster, { name: "JCOM", driver_id: "d-jcom" }), null);

// ── 3. What reusing it changes ────────────────────────────────────────────
// The class whose grid the driver was being added to is folded in, so the add
// still does what it was for: they show up in that class.
check("the class being added to is folded into the entry they have",
  reusePatch(roster[0], { driver_id: "d-duck", class_ids: ["am"] }),
  { class_ids: ["pro", "am"], class_id: "pro" });
check("a class they already race changes nothing",
  reusePatch(roster[0], { driver_id: "d-duck", class_ids: ["pro"] }), {});
check("a car number fills a blank one",
  reusePatch(roster[1], { driver_id: "d-hw", number: "7" }), { number: "7" });
// Never an edit nobody asked for: a create that turns out to be a duplicate
// must not quietly renumber, rename or re-team the entry that already exists.
check("a number they already have is left alone",
  reusePatch({ ...roster[1], number: "3" }, { driver_id: "d-hw", number: "7" }), {});
check("nothing else on the entry is touched",
  reusePatch({ ...roster[0], team_id: "t1", name: "DuckLovers" },
    { driver_id: "d-duck", name: "Duck", team_id: "t2", points_adjustment: -50 }), {});

// ── 4. The route applies it ───────────────────────────────────────────────
// Source-level, because the handler needs Firestore to run: what matters is
// that the rule is wired into the create at all, and that reusing answers with
// the existing entry instead of writing a second one.
const here = dirname(fileURLToPath(import.meta.url));
const route = readFileSync(join(here, "../../app/api/entries/route.js"), "utf8");
ok("POST /api/entries goes through the roster rule", /guard:\s*reuseExistingEntry/.test(route));
ok("…and answers with the entry that already exists", /findRosterEntry\(/.test(route) && /reused:\s*true/.test(route));
ok("…without creating a second one", !/collection\("entries"\)\.add\(/.test(route));

console.log(`all ${n} checks passed — a driver gets one roster entry per season`);
