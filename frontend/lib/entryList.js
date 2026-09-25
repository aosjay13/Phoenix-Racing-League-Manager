// A season's ENTRY LIST: everybody signed up for it, in car-number order, with
// the class, team and car each of them runs — the sheet a league posts before
// a season starts so the field knows who it's racing.
//
// Two audiences, and one rule about who they are:
//
//   • Drivers who have JOINED the series. On the roster, or with a sign-up in
//     flight (waiting on an admin, or approved into a placement session). The
//     list is theirs to read from the Dashboard the moment they sign up, and
//     it stays out of sight for everybody else — a player who hasn't joined has
//     the Sign-ups screen instead, which is where joining happens.
//   • League staff, who see every active season's list from Series Sign-Ups
//     and from Driver Roster.
//
// The rule is decided here, purely, and enforced by /api/entry-list — the
// screens only ever decide where the button goes, never whether the list may
// be read.
//
// Everything below is pure: no Firestore, no React.

import { normalizeCarNumber, sortRosterByNumber } from "@/lib/carSelection";
import { isAwaitingPlacement, isNumberChange } from "@/lib/signupQueue";

// Said to a signed-in player who opens the list of a series they aren't in.
// Worded as the way in, not as a refusal: the fix is to sign up.
export const ENTRY_LIST_CLOSED_MESSAGE =
  "The entry list is only open to drivers in this series. Sign up for it to see who else is racing.";

// Where the signed-in caller stands in one season:
//
//   "entered"    on the roster
//   "pending"    signed up, waiting on an admin
//   "placement"  signed up and approved into a placement session — seated on
//                no roster yet, but very much in the series
//   null         none of the above
//
// Matched on the driver profile OR the account, like everything else that asks
// "is this me?" — an entry written before driver_id existed carries only the
// account link. A pending NUMBER CHANGE is somebody already racing asking to
// move number, not a sign-up, so it never counts on its own.
export function entryStanding({ entries = [], pending = [], uid = "", driverId = "" } = {}) {
  const isMe = row => (!!driverId && row?.driver_id === driverId) || (!!uid && (row?.user_id === uid || row?.uid === uid));
  if (entries.some(isMe)) return "entered";
  const mine = pending.find(p => !isNumberChange(p) && isMe(p));
  if (!mine) return null;
  return isAwaitingPlacement(mine) ? "placement" : "pending";
}

// May this caller read the list? Staff always; a player only once they've
// joined the series (see entryStanding above).
export function canViewEntryList({ staff = false, standing = null } = {}) {
  return !!staff || !!standing;
}

// The seasons whose entry list a player can open from their Dashboard, read off
// the /api/users/me/series payload the app already holds (see
// components/MySignupsProvider.jsx), so showing the rows costs no extra
// request — only opening one does.
//
// The seasons they're racing come first, then the ones they've signed up for
// and are still waiting on. Finished seasons never appear: the payload drops
// them, and a closed season's field is on Standings.
export function joinedSeasons(data) {
  const racing = (data?.my_seasons || [])
    .filter(s => s.open !== false)
    .map(s => ({
      season_id: s.season_id,
      season_name: s.season_name,
      series_name: s.series_name,
      game_name: s.game_name || "",
      logo_url: s.logo_url || "",
      standing: "entered",
      number: s.number ?? null,
      class_names: s.class_names || [],
    }));
  const waiting = (data?.open_signups || [])
    .filter(s => s.my_pending)
    .map(s => ({
      season_id: s.season_id,
      season_name: s.season_name,
      series_name: s.series_name,
      game_name: s.game_name || "",
      logo_url: s.logo_url || "",
      standing: s.my_awaiting_placement ? "placement" : "pending",
      number: null,
      class_names: [],
      entry_count: (s.roster || []).length,
    }));
  return [...racing, ...waiting];
}

// What a Dashboard row says about the player's own place in the list.
export function standingLabel(row) {
  if (row?.standing === "entered") {
    const num = normalizeCarNumber(row.number);
    return ["You're on the list", num ? `#${num}` : "", ...(row.class_names || [])]
      .filter(Boolean).join(" · ");
  }
  if (row?.standing === "placement") return "Registered for placements — not on the roster yet";
  if (row?.standing === "pending") return "Your sign-up is waiting on an admin";
  return "";
}

// Every car one roster entry runs, de-duplicated and in a stable order. A
// season whose classes run their own car lists stores one pick per class
// (`selected_cars`), mirrored onto `selected_car`; both are read so a pick is
// never invisible, and the mirror doesn't list the same car twice.
export function entryCars(entry = {}) {
  const out = [];
  const seen = new Set();
  const add = car => {
    const name = String(car ?? "").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };
  const per = entry?.selected_cars;
  if (per && typeof per === "object") Object.values(per).forEach(add);
  add(entry?.selected_car);
  return out;
}

// The sign-ups still in flight, as entry-list rows. Number changes are left
// out — that's a driver already on the list asking to move, and listing them
// again would show one person twice.
export function pendingEntries(pending = [], { uid = "", driverId = "" } = {}) {
  return sortRosterByNumber(pending
    .filter(p => !isNumberChange(p))
    .map(p => ({
      id: p.id,
      number: p.number ?? null,
      name: p.name || "Driver",
      class_names: p.class_names || [],
      car: p.car || "",
      awaiting_placement: isAwaitingPlacement(p),
      mine: (!!uid && p.uid === uid) || (!!driverId && p.driver_id === driverId),
    })));
}

// "18 entries · 3 waiting on approval" — the line under the list's title.
export function entryListSummary({ entries = [], pending = [] } = {}) {
  const parts = [`${entries.length} ${entries.length === 1 ? "entry" : "entries"}`];
  const waiting = pending.filter(p => !p.awaiting_placement).length;
  const placement = pending.length - waiting;
  if (waiting) parts.push(`${waiting} waiting on approval`);
  if (placement) parts.push(`${placement} awaiting placement`);
  return parts.join(" · ");
}

// How many confirmed entries race in each class, in the season's class order,
// so a multi-class field can be read at a glance ("Pro · 10", "Am · 8"). A
// driver in two classes counts in both — they are on both grids. Classes
// nobody has entered yet still show, as 0, so an empty class isn't mistaken
// for one that doesn't exist.
export function classTally(entries = [], classes = []) {
  if (!classes.length) return [];
  const counts = new Map(classes.map(c => [c.name, 0]));
  let unclassified = 0;
  for (const e of entries) {
    const names = e.class_names || [];
    if (!names.length) unclassified++;
    for (const n of names) counts.set(n, (counts.get(n) || 0) + 1);
  }
  const out = [...counts].map(([name, count]) => ({ name, count }));
  if (unclassified) out.push({ name: "No class", count: unclassified });
  return out;
}

// The list as plain text, one driver a line, for an admin to paste into
// Discord or a forum post:
//
//   Formula Phoenix · Season 4 — Entry List
//   #2  Driver A · Pro · Team X · Porsche 911 GT3 R
//   #10 Driver B · Am
//
// Waiting sign-ups are listed under their own heading rather than mixed in, so
// the pasted list never promises a seat an admin hasn't given.
export function entryListText({ title = "", entries = [], pending = [] } = {}) {
  const numbers = [...entries, ...pending].map(r => normalizeCarNumber(r.number));
  const width = Math.max(0, ...numbers.map(n => (n ? n.length + 1 : 0)));
  const line = row => {
    const num = normalizeCarNumber(row.number);
    const tag = (num ? `#${num}` : "").padEnd(width, " ");
    const bits = [
      row.name || "Driver",
      (row.class_names || []).join(" / "),
      row.team?.name || "",
      ...(row.cars || (row.car ? [row.car] : [])),
    ].filter(Boolean);
    return `${tag ? `${tag} ` : ""}${bits.join(" · ")}`.trimEnd();
  };
  const out = [];
  if (title) out.push(`${title} — Entry List`);
  out.push(...sortRosterByNumber(entries).map(line));
  if (!entries.length) out.push("No entries yet.");
  if (pending.length) {
    out.push("", "Signed up, not on the roster yet:");
    out.push(...sortRosterByNumber(pending).map(line));
  }
  return out.join("\n");
}
