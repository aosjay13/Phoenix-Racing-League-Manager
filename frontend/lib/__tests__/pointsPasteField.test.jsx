// The points box that takes a spreadsheet paste, rendered.
//
// The parser is covered next door (pointsPaste.test.mjs). What this pins is the
// wiring around it, which is where a points editor could quietly lose the
// feature: that BOTH scales in BOTH editors are the pasteable box rather than a
// plain textarea, that the box still behaves as the textarea it replaced, and
// that the season form and the per-session one are the same box — so a paste
// works identically wherever a scale is edited.
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { PointsScaleField } from "@/components/PointsScaleField";
import { PointsFields } from "@/components/PointsFields";

let n = 0;
const ok = (label, cond) => { n++; assert.ok(cond, label); };
const check = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}`); };

// react-dom/server resolves every import the way the browser does and throws on
// a missing one, so rendering is also the check that these modules line up.
const render = el => renderToStaticMarkup(el);

// ── The box itself ────────────────────────────────────────────────────────

const field = render(
  <PointsScaleField id="race" label="Race Points — comma-separated, 1st place first"
    what="Race Points" value="350, 320, 300" onChange={() => {}} />);

ok("the scale is in the box", field.includes("350, 320, 300"));
ok("its label is the one it was given", field.includes("Race Points — comma-separated, 1st place first"));
ok("the label points at the box", field.includes('for="race"') && field.includes('id="race"'));
ok("the way in is visible rather than a secret about pasting",
  field.includes("Paste from a spreadsheet"));

// A disabled scale is one the caller says can't be edited — offering to fill it
// would be offering to do the thing it just refused.
const off = render(
  <PointsScaleField id="race" label="Race Points" value="" onChange={() => {}} disabled />);
ok("a disabled box offers no paste button", !off.includes("Paste from a spreadsheet"));
ok("…and is disabled", off.includes("disabled"));

// Whatever the caller hung under the old textarea still hangs under this one —
// the blank-scale warning, the note about what a pole is worth.
const withChild = render(
  <PointsScaleField id="q" label="Qualifying Points" value="" onChange={() => {}}>
    <span>Pole is position 1 of this list</span>
  </PointsScaleField>);
ok("the caller's own note is still rendered under the box",
  withChild.includes("Pole is position 1 of this list"));

// ── Both scales, in the season/class form ─────────────────────────────────

const blank = { race_points: "", qual_points: "", bonuses: {} };
const seasonForm = render(<PointsFields value={blank} onPatch={() => {}} templates={[]} />);

check("the season form offers a paste for each of its two scales",
  seasonForm.split("Paste from a spreadsheet").length - 1, 2);
ok("…and still carries its template loader", seasonForm.includes("Load Template"));
ok("…and its qualifying loader", seasonForm.includes("Load Qualifying Points Template"));
ok("…and the blank-scale warning when there are no points",
  render(<PointsFields value={blank} onPatch={() => {}} templates={[]} noPoints />)
    .includes("Blank scores 0 for every finishing position"));

// Two of these on one screen (a season's and a class's) must not hand two
// labels the same field to point at.
const twice = render(
  <div>
    <PointsFields value={blank} onPatch={() => {}} templates={[]} />
    <PointsFields value={blank} onPatch={() => {}} templates={[]} />
  </div>);
const ids = [...twice.matchAll(/id="([^"]*race-points)"/g)].map(m => m[1]);
check("two forms on one screen give their scales ids of their own", new Set(ids).size, ids.length);
ok("…and there are two of them to be distinct", ids.length === 2);

console.log(`pointsPasteField: ${n} checks passed — every points scale is a box you can paste a spreadsheet into`);
