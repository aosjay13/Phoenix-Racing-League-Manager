// Car selection & lock-in — "this series/season/class makes its drivers pick a
// car, from this list, before it runs".
//
// The settings live on THREE levels (series, season, class) and resolve exactly
// the way every other inherited setting in the app does:
//
//   required : ON anywhere at or above the level being asked about. A series
//              that requires a selection covers every season and class in it;
//              a season covers its classes; a class can require one on its own
//              while the rest of the season doesn't (see isBangerRacing for the
//              same additive shape).
//   options  : the MOST SPECIFIC list wins — class, else season, else series —
//              so a league publishes its car list once on the series and a
//              single class overrides it with its own machinery (same rule as
//              carForRace in lib/classFilter.js).
//   note     : the admin's instructions, resolved most-specific-first like the
//              options.
//   locked   : locked anywhere at or above → locked. Freezing the series
//              freezes every season and class under it, and a locked selection
//              can no longer be changed by the player.
//
// Deliberately dependency-free so the API routes and the client screens apply
// one set of rules.

// ── Storing a pick ─────────────────────────────────────────────────────────
//
// A driver's choice lives on their season ROSTER ENTRY, which is the only doc
// that already means "this driver, in this season":
//
//   entries.selected_car   the season-wide pick, and a mirror of the most
//                          recent pick whatever slot it came from — so every
//                          reader written against a single field (the roster,
//                          a results grid) resolves without knowing about
//                          classes, exactly like class_id mirrors class_ids[0].
//   entries.selected_cars  { [class_id]: car } for the classes that run their
//                          own car list.
//   entries.selected_car_at ISO timestamp of the last lock-in.

// The pick that answers for one slot. `classId` is "" for the season-wide slot.
export function selectedCarFor(entry, classId = "") {
  const key = String(classId || "");
  if (key) {
    const map = entry?.selected_cars;
    return map && typeof map === "object" ? String(map[key] || "") : "";
  }
  return String(entry?.selected_car || "");
}

// The patch that records one pick. A class pick also refreshes `selected_car`
// so the single-field readers keep resolving; passing an empty car clears the
// slot rather than storing a blank as a choice.
export function carSelectionPatch(entry, classId, car, now = new Date()) {
  const key = String(classId || "");
  const value = String(car || "").trim();
  if (!key) return { selected_car: value, selected_car_at: value ? now.toISOString() : null };
  const map = { ...(entry?.selected_cars && typeof entry.selected_cars === "object" ? entry.selected_cars : {}) };
  if (value) map[key] = value;
  else delete map[key];
  return {
    selected_cars: map,
    // Mirror the pick (or, when clearing, whatever pick is left) onto the flat
    // field so it never points at a car the driver no longer holds.
    selected_car: value || Object.values(map).find(Boolean) || "",
    selected_car_at: value ? now.toISOString() : null,
  };
}

// ── The admin's car list ───────────────────────────────────────────────────

// Free text → a clean list of car names. Newlines are the separator; commas are
// only treated as one when the text has no newlines at all, so a proper
// one-per-line list can hold names that contain a comma ("Porsche 911 GT3 R, 992")
// while a quickly-typed "A, B, C" still works.
export function parseCarOptions(text) {
  if (Array.isArray(text)) return dedupe(text.map(s => String(s ?? "").trim()));
  const raw = String(text ?? "");
  const parts = /[\r\n]/.test(raw) ? raw.split(/[\r\n]+/) : raw.split(",");
  return dedupe(parts.map(s => s.trim()));
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const name of list) {
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

// A saved doc's car list, whichever shape it was written in.
export function carOptionList(doc) {
  const raw = doc?.car_options;
  if (Array.isArray(raw) || typeof raw === "string") return parseCarOptions(raw);
  return [];
}

// Is `car` one of the offered cars? Compared case-insensitively so a pick made
// before the admin re-cased the list still matches, and answers the canonical
// spelling from the list rather than what the caller sent.
export function matchCarOption(options = [], car) {
  const wanted = String(car ?? "").trim().toLowerCase();
  if (!wanted) return null;
  return options.find(o => o.trim().toLowerCase() === wanted) ?? null;
}

// ── Resolution ─────────────────────────────────────────────────────────────

const LEVELS = ["class", "season", "series"];

// The car-selection settings in force for a scope. Pass whichever levels apply
// — {series, season} for a season-wide answer, {series, season, cls} for one
// class's.
export function resolveCarSelection({ series = null, season = null, cls = null } = {}) {
  const docs = { class: cls, season, series };
  const present = LEVELS.filter(level => docs[level]);
  const optionLevel = present.find(level => carOptionList(docs[level]).length) ?? null;
  const noteLevel = present.find(level => String(docs[level].car_selection_note || "").trim()) ?? null;
  return {
    required: present.some(level => !!docs[level].require_car_selection),
    locked: present.some(level => !!docs[level].car_selection_locked),
    options: optionLevel ? carOptionList(docs[optionLevel]) : [],
    options_from: optionLevel,
    note: noteLevel ? String(docs[noteLevel].car_selection_note).trim() : "",
    note_from: noteLevel,
    // Which level turned the requirement on, for "Required by the series" text.
    required_from: present.find(level => !!docs[level].require_car_selection) ?? null,
  };
}

// Does this class carry car-selection settings of its OWN, rather than just
// inheriting the season's? That's what makes it a separate lock-in slot below:
// a class with its own machinery asks its drivers for their own pick.
export function classDefinesCarSelection(cls) {
  return !!cls?.require_car_selection
    || !!cls?.car_selection_locked
    || carOptionList(cls).length > 0
    || !!String(cls?.car_selection_note || "").trim();
}

// ── Slots ──────────────────────────────────────────────────────────────────
//
// A "slot" is one question put to a driver: pick a car for this season, or pick
// a car for this class of it. A season offers:
//
//   • one season-wide slot (class_id "") when the season/series requires a
//     selection, and
//   • one slot per class that defines car settings of its own and resolves to
//     "required".
//
// A driver answers the slots of the classes they race, and the season-wide one
// only when no class of theirs has its own — see slotsForEntry. That's what
// stops a driver being asked twice for the same car.
export function carSelectionSlots({ series = null, season = null, classes = [] } = {}) {
  const slots = [];
  const seasonWide = resolveCarSelection({ series, season });
  if (seasonWide.required) slots.push({ class_id: "", class_name: "", ...seasonWide });
  for (const cls of classes) {
    if (!classDefinesCarSelection(cls)) continue;
    const resolved = resolveCarSelection({ series, season, cls });
    if (!resolved.required) continue;
    slots.push({ class_id: cls.id, class_name: cls.name || "Class", ...resolved });
  }
  return slots;
}

// The slots one driver actually answers, given the classes they race.
export function slotsForEntry(slots = [], classIds = []) {
  const own = slots.filter(s => s.class_id && classIds.includes(s.class_id));
  if (own.length) return own;
  const wide = slots.find(s => !s.class_id);
  return wide ? [wide] : [];
}

// Find one slot by its class key ("" = season-wide).
export function findSlot(slots = [], classId = "") {
  const key = String(classId || "");
  return slots.find(s => String(s.class_id || "") === key) ?? null;
}

// ── Season status ──────────────────────────────────────────────────────────
//
// Sign-ups and lock-ins are for seasons that are still to come or under way.
// A season an admin has marked completed is history: its roster and its cars
// are read-only from here on.
export function seasonIsCompleted(season) {
  return String(season?.status || "active").toLowerCase() === "completed";
}
export function seasonAcceptsSignups(season) {
  return !!season && !seasonIsCompleted(season);
}

// ── Car numbers ────────────────────────────────────────────────────────────
//
// A car number is stored as a STRING (max 3 chars) so racing numbers with
// leading zeros survive — "01", "007" and "1" are three different numbers, and
// a league that runs both a 1 and an 01 is exactly why (see SPECS.entries).
// Everything below therefore compares the trimmed text, never a parsed integer.

export function normalizeCarNumber(value) {
  return String(value ?? "").trim();
}

// Is this number already on the roster? `taken` is a list of numbers (or of
// rows carrying one). A blank number is never "taken" — running without one is
// always allowed.
export function carNumberTaken(taken = [], value) {
  const wanted = normalizeCarNumber(value);
  if (!wanted) return false;
  return taken.some(t => normalizeCarNumber(typeof t === "object" ? t?.number : t) === wanted);
}

// What a driver is told when they pick a number someone else already has.
// Defined once so the instant check in the sign-up form and the server's own
// rejection say exactly the same thing.
export const NUMBER_TAKEN_MESSAGE =
  "That number is already taken, please choose another number. " +
  "You may look at the series roster to see what numbers are already taken.";

// Order car numbers the way a grid does: by value, so 2 comes before 10 rather
// than after it as a plain string sort would have it. A tie in value ("01" and
// "1") falls back to the text, anything non-numeric sorts after the numbers,
// and a driver with no number at all goes last.
export function compareCarNumbers(a, b) {
  const na = normalizeCarNumber(a);
  const nb = normalizeCarNumber(b);
  if (!na || !nb) return (!na ? 1 : 0) - (!nb ? 1 : 0);
  const va = Number(na);
  const vb = Number(nb);
  const aNumeric = na !== "" && Number.isFinite(va);
  const bNumeric = nb !== "" && Number.isFinite(vb);
  if (aNumeric && bNumeric) return (va - vb) || na.localeCompare(nb);
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
  return na.localeCompare(nb);
}

// A roster in car-number order — what a driver reads to find a free number, and
// how a non-admin roster is listed. Ties (and the unnumbered tail) fall back to
// the driver's name so the order is stable rather than arbitrary.
export function sortRosterByNumber(rows = []) {
  return [...rows].sort((a, b) =>
    compareCarNumbers(a?.number, b?.number) ||
    String(a?.name ?? "").localeCompare(String(b?.name ?? "")));
}

// ── Scope ──────────────────────────────────────────────────────────────────
//
// Does one of a player's series rows belong to the Game ▸ Series selection at
// the top of the page? The Dashboard's Series Information section is about the
// series being viewed, not every series the player has ever raced, so it
// narrows to the deepest concrete selection — the same chain the Dashboard's
// own metrics follow. An "All …" choice at a level ("") widens to it.
export function rowInScope(row, { gameId = "", seriesId = "" } = {}) {
  if (seriesId) return row?.series_id === seriesId;
  if (gameId) return row?.game_id === gameId;
  return true;
}

// ── The admin form ─────────────────────────────────────────────────────────
//
// Shared by the Series, Seasons and Classes panels of League Setup through
// <CarSelectionFields>, so all three offer exactly the same settings.
export const BLANK_CAR_SELECTION_FORM = {
  require_car_selection: false,
  car_options: "",
  car_selection_note: "",
  car_selection_locked: false,
};

export function carSelectionToForm(doc = {}) {
  return {
    require_car_selection: !!doc.require_car_selection,
    car_options: carOptionList(doc).join("\n"),
    car_selection_note: doc.car_selection_note || "",
    car_selection_locked: !!doc.car_selection_locked,
  };
}

export function carSelectionFormToBody(form = {}) {
  return {
    require_car_selection: !!form.require_car_selection,
    car_options: parseCarOptions(form.car_options),
    car_selection_note: String(form.car_selection_note || "").trim(),
    car_selection_locked: !!form.car_selection_locked,
  };
}
