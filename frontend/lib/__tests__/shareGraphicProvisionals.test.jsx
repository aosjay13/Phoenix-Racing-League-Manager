// Provisional entries on an exported race graphic.
//
// A provisional entry is a driver awarded a flat, admin-entered points value
// without having raced. The whole rule is the separation: those points are real
// and belong on a graphic anyone posts, but the row they sit on is NOT a
// finishing position. Dropped into the results table it would number a driver
// who never took the green flag among the finishers and read as a
// back-of-field result — so the exporter draws them in their own captioned
// block at the BOTTOM of the card, below the finishing order and above the
// watermark, exactly as the results page lists them below its table.
//
// The card is checked by rendering it; the results screen's wiring is checked
// at source level, the way raceStats.test.jsx checks that screen's stat strip —
// the page itself needs a live bundle and a router to drive.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { GraphicCard } from "@/components/ShareGraphicModal";

let n = 0;
const ok = (label, cond) => { n++; assert.ok(cond, label); };
const eq = (label, got, want) => { n++; assert.deepStrictEqual(got, want, `${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };

const theme = {
  pageBg: "#0b0b12", cardBg: "#14141f", ink: "#eeeef5", muted: "#bfbfd4",
  faint: "#9a9ab4", border: "rgba(255,255,255,0.09)", headBg: "rgba(0,180,216,0.12)",
  headInk: "#7fe3ff", stripe: "rgba(255,255,255,0.025)", accent: "#00b4d8",
};

const columns = [
  { key: "pos", label: "Pos", align: "center" },
  { key: "driver", label: "Driver", align: "left" },
  { key: "points", label: "Pts" },
];
const rows = [
  { rank: 1, cells: [1, "Ana Vasquez", 45] },
  { rank: 2, cells: [2, "Bo Chen", 40] },
  { cells: [3, "Cam Ellis", 38] },
];
const provisionals = {
  title: "Provisional Entries",
  note: "points only · did not race · not counted in stats",
  columns: [
    { key: "driver", label: "Driver", align: "left" },
    { key: "points", label: "Pts", align: "center" },
  ],
  rows: [{ cells: ["Eli Watts", 30] }, { cells: ["Fay Oduya", 28] }],
};

const card = (props = {}) => renderToStaticMarkup(
  <GraphicCard theme={theme} title="Round 4 — Race 1" subtitle="Bristol · Season 5"
    columns={columns} rows={rows} totalRows={rows.length} shownCount={rows.length} {...props} />
);
const text = html => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

// ── 1. The block is drawn, and drawn at the bottom ────────────────────────

const withProv = card({ sections: [provisionals] });
const at = s => withProv.indexOf(s);

ok("the block is titled, so nobody has to guess what these rows are",
  text(withProv).includes("Provisional Entries"));
ok("its caption says why they aren't in the order",
  /points only . did not race . not counted in stats/.test(text(withProv)));
ok("every provisional driver is on the graphic", at("Eli Watts") > -1 && at("Fay Oduya") > -1);
ok("…with the points they scored", at("30") > -1 && at("28") > -1);

// Bottom means bottom: after the finishing order, before the watermark.
ok("the block comes after the results table closes", at("Provisional Entries") > at("</table>"));
ok("the finishers are still above it", at("Cam Ellis") < at("Provisional Entries"));
ok("the watermark still anchors the bottom edge",
  at("Phoenix Racing League Manager") > at("Provisional Entries"));

// And it is a section, not extra table rows: nothing provisional may appear
// inside the finishing order itself.
const order = withProv.slice(0, at("Provisional Entries"));
ok("no provisional driver appears in the results table", !order.includes("Eli Watts") && !order.includes("Fay Oduya"));
eq("the finishing order is untouched by the block",
  text(order).includes("Ana Vasquez") && text(order).includes("Bo Chen"), true);

// Unranked by nature — a provisional entry has no finishing position, so the
// block never medals a row the way the results table tints its top three.
const block = withProv.slice(at("Provisional Entries"));
ok("the results table still medals its podium", /#f4a228/.test(order));
ok("the provisionals block medals nobody", !/#f4a228|#c4cbd6|#cd8a54/.test(block));

// ── 2. A race with no provisional entries carries no heading ──────────────

const plain = card();
ok("a card given no sections has no stray heading", !text(plain).includes("Provisional Entries"));
ok("…and still draws its results", text(plain).includes("Ana Vasquez"));
ok("an empty section is skipped entirely",
  !text(card({ sections: [{ ...provisionals, rows: [] }] })).includes("Provisional Entries"));

// ── 3. A session that was ONLY provisional entries ────────────────────────
//
// Nothing was raced, so there is no finishing order to print — but the points
// still happened, and the card is the block alone rather than bare headers over
// an empty table.

const onlyProv = card({ rows: [], totalRows: 0, shownCount: 0, sections: [provisionals] });
ok("the block still draws", text(onlyProv).includes("Provisional Entries"));
ok("its entries still draw", text(onlyProv).includes("Eli Watts"));
ok("no empty results table is printed", !text(onlyProv).includes("POS") && !text(onlyProv).includes("Pos"));
ok("and the footer doesn't claim '0 shown'", !text(onlyProv).includes("0 shown"));

// ── 4. Where the section comes from ───────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const read = f => readFileSync(join(here, "../..", f), "utf8");
// Strip comments before searching source, so the prose explaining a rule can
// never be what satisfies the check for it.
const strip = src => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map(l => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");

const viewer = strip(read("app/races/[id]/RaceResultsScreen.jsx"));
ok("the results screen splits provisionals off the finishers",
  /const provisionals = activeResults\.filter\(r => r\.provisional\)/.test(viewer));
ok("the graphic's section is built from that list",
  /const shareSections = [\s\S]*?provisionals\.map\(/.test(viewer));
ok("…and titled Provisional Entries", /title: "Provisional Entries"/.test(viewer));
ok("…and handed to the exporter", /sections=\{shareSections\}/.test(viewer));
ok("the table itself is still only the finishers (or the qualifying sheet)",
  /const shareSource = sharingQual \? qualRows : finishers/.test(viewer));
ok("qualifying, which has no provisional entries, gets no section",
  /const shareSections = \(!sharingQual && provisionals\.length\)/.test(viewer));
ok("a session that is only provisional entries can still be exported",
  /shareRows\.length > 0 \|\| shareSections\.length > 0/.test(viewer));

const modal = strip(read("components/ShareGraphicModal.jsx"));
ok("the exporter takes a sections prop", /meta = \[\], sections = \[\],/.test(modal));
ok("each section is offered as a tick-box", /toggleSection\(sec\.title\)/.test(modal));
ok("…starting on, so a race that has them exports them by default",
  /const shownSections = offeredSections\.filter\(s => !hiddenSections\.has\(s\.title\)\)/.test(modal));
ok("only the ticked ones reach the card", /sections=\{shownSections\}/.test(modal));

console.log(`shareGraphicProvisionals: ${n} assertions passed`);
