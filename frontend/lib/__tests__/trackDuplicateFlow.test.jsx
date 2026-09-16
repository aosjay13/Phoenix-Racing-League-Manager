// Guard: the duplicate eliminator must MOUNT, and the review it puts in front
// of an admin has to say enough to be answered.
//
// The matching rules themselves are unit-tested in trackMerge.test.mjs. What
// that cannot catch is the screen built on top of them — a component with a
// missing binding dies on mount behind the error boundary, and this one is
// reached from both Track menus.
//
// The second half asserts on the WORDS, because the words are the feature. A
// review panel that lists three names and a Merge button is one an admin
// presses without reading, and the merge it performs cannot be undone by
// pressing anything. So a row has to carry how many races are riding on it, why
// it came up, and — when the scan is not sure — what specifically disagrees.

import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { GroupPanel, TrackDuplicateScanner } from "@/components/TrackDuplicateScanner";
import { findDuplicateTrackGroups } from "@/lib/trackMerge";

let n = 0;
const ok = (label, cond) => { n++; assert.ok(cond, label); };

function render(label, element) {
  n += 1;
  try {
    return renderToStaticMarkup(element);
  } catch (err) {
    assert.fail(`${label} failed to mount: ${err.message}`);
  }
}

render("TrackDuplicateScanner", <TrackDuplicateScanner onClose={() => {}} onMerged={() => {}} />);

// One circuit entered three times, which is the ordinary case.
const [clean] = findDuplicateTrackGroups([
  { id: "d1", name: "Daytona" },
  { id: "d2", name: "Daytona International Speedway", location: "Daytona Beach, FL", track_type: "Superspeedway" },
  { id: "d3", name: "DAYTONA INTL SPEEDWAY" },
], { raceCounts: { d1: 2, d2: 9, d3: 1 } });

const cleanEdit = {
  survivorId: clean.survivor_id,
  checked: clean.tracks.filter(t => t.suggested && t.id !== clean.survivor_id).map(t => t.id),
  name: clean.suggested_name,
};
const cleanHtml = render("GroupPanel (clean)", (
  <GroupPanel group={clean} open edit={cleanEdit} onToggle={() => {}} onEdit={() => {}}
    preview={{ races_moved: 3, races_renamed: 9, tracks_merged: 2, filled: [] }}
    previewing={false} busy={false} done={null} error={null}
    onMerge={() => {}} onSkip={() => {}} />
));

ok("every copy is listed", ["Daytona", "DAYTONA INTL SPEEDWAY"].every(name => cleanHtml.includes(name)));
ok("the survivor is named as the one being kept", cleanHtml.includes("Keeping this one"));
ok("the race count rides on each row", cleanHtml.includes("9 races") && cleanHtml.includes("2 races"));
ok("the merge says what it will be called", cleanHtml.includes("Merge 2 into"));
ok("the preview says what actually moves", cleanHtml.includes("3 races moved"));
ok("leaving it alone is always offered", cleanHtml.includes("Leave these alone"));
ok("and it promises nothing is lost", cleanHtml.includes("Nothing is deleted from the record books"));

// The dangerous case: one venue's oval and its road course. Both are found,
// both are shown, and the one that would skew the stats is NOT ticked.
const [layouts] = findDuplicateTrackGroups([
  { id: "o", name: "Daytona International Speedway", track_type: "Superspeedway" },
  { id: "r", name: "Daytona International Speedway Road Course", track_type: "Road Course" },
], { raceCounts: { o: 9, r: 1 } });

const layoutHtml = render("GroupPanel (needs a look)", (
  <GroupPanel group={layouts} open
    edit={{ survivorId: layouts.survivor_id, checked: [], name: layouts.suggested_name }}
    onToggle={() => {}} onEdit={() => {}} preview={null} previewing={false}
    busy={false} done={null} error={null} onMerge={() => {}} onSkip={() => {}} />
));

ok("the road course is shown", layoutHtml.includes("Road Course"));
ok("the panel says it needs a look", layoutHtml.includes("Needs a look"));
ok("and names what disagrees", layoutHtml.includes("Superspeedway") && layoutHtml.includes("check this is really the same track"));
ok("with nothing ticked, there is nothing to merge", layoutHtml.includes("Tick the duplicates to merge"));

// A finished group reports what it did, in races rather than rows — that is the
// number an admin cares about afterwards.
const doneHtml = render("GroupPanel (done)", (
  <GroupPanel group={clean} open edit={cleanEdit} onToggle={() => {}} onEdit={() => {}}
    preview={null} previewing={false} busy={false} error={null}
    done={{ track: { id: "d2", name: "Daytona International Speedway" }, tracks_merged: 2, races_moved: 3, races_renamed: 9 }}
    onMerge={() => {}} onSkip={() => {}} />
));
ok("the result names the surviving venue", doneHtml.includes("Daytona International Speedway"));
ok("and counts the races that moved", doneHtml.includes("3 races moved across"));

console.log(`trackDuplicateFlow: ${n} checks passed`);
