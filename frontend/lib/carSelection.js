// Car selection & lock-in — "this game/series/season/class makes its drivers
// pick a car, from this list, before it runs" — and the other things a sign-up
// can be made to carry.
//
// ── THE ONE INHERITANCE RULE ────────────────────────────────────────────────
//
// The settings live on FOUR levels and every one of them resolves the same way:
//
//     game  →  series  →  season  →  class
//
//   THE MOST SPECIFIC LEVEL WITH AN OPINION WINS.
//
// A class overrides its season, a season overrides its series, a series
// overrides its game. That holds for the switches (require a car / a number / a
// manufacturer, and the lock) exactly as it already held for the car list and
// the instructions note: class, else season, else series, else game.
//
// "An opinion" is the important half, because a level that was never configured
// must not silently override the level above it. Each switch is therefore a
// THREE-state setting, not a boolean:
//
//     ""     Inherit — no opinion. Whatever the level above says (the default).
//     "on"   Required here, whatever the level above says.
//     "off"  Not required here, even if the level above requires it.
//
// stored in `<field>_mode` beside the original boolean. The boolean is still
// written (true when the mode is "on") so every older reader keeps working, and
// it's still *read* as an opinion when no mode is stored — a doc written before
// modes existed with `require_car_number: true` means "on", and one with
// `false` means "never configured", which is exactly what it meant then. That's
// what stops this change flipping any league's existing setup: a stored `false`
// has never been an admin saying "off", so it isn't treated as one.
//
// Lists resolve most-specific-first as they always have:
//
//   options  : class, else season, else series, else game — so a league
//              publishes its car list once and a single class overrides it with
//              its own machinery (same rule as carForRace in lib/classFilter.js)
//   note     : the admin's instructions, same order.
//
// Platform identities (Discord, Steam, PSN, Xbox, iRacing) are NOT here and are
// not per-level: they belong to the GAME and apply to every series, season and
// class under it, however many are made. See lib/signupRequest.js.
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

// The manufacturer / model list. A league that runs one make per driver
// (Chevrolet / Ford / Toyota) sets this; leaving it blank falls back to the car
// list, so an admin who thinks of the two as one thing only fills in one field.
export function manufacturerOptionList(doc) {
  const raw = doc?.manufacturer_options;
  const own = Array.isArray(raw) || typeof raw === "string" ? parseCarOptions(raw) : [];
  return own.length ? own : carOptionList(doc);
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

// Most specific first. Everything below walks this order and stops at the first
// level that has something to say.
const LEVELS = ["class", "season", "series", "game"];

// The three-state switches, and the human names of the levels.
export const REQUIREMENT_FIELDS = [
  "require_car_selection",
  "require_car_number",
  "require_car_manufacturer",
  "car_selection_locked",
];

export const LEVEL_LABELS = {
  class: "class",
  season: "season",
  series: "series",
  game: "game",
};

export const INHERIT = "";
export const ON = "on";
export const OFF = "off";

// What ONE level says about one switch: true (on), false (off), or null when it
// has no opinion and the level above answers.
//
// A stored `<field>_mode` is the admin's explicit answer. With no mode stored we
// fall back to the original boolean, where `true` has always meant "required
// here" and `false` has only ever meant "left alone" — so pre-mode documents
// resolve exactly as they did before modes existed.
export function levelOpinion(doc, field) {
  if (!doc) return null;
  const mode = String(doc[`${field}_mode`] ?? "").trim().toLowerCase();
  if (mode === ON) return true;
  if (mode === OFF) return false;
  return doc[field] === true ? true : null;
}

// Does this level say anything at all about any of the switches? Used to show
// an admin whether a level is configured or purely inheriting.
export function definesAnyRequirement(doc) {
  return REQUIREMENT_FIELDS.some(field => levelOpinion(doc, field) !== null);
}

// Resolve one switch down game → series → season → class: the most specific
// level with an opinion wins, and `from` names it so the UI can say who decided.
export function resolveRequirement(docs, field) {
  for (const level of LEVELS) {
    const opinion = levelOpinion(docs[level], field);
    if (opinion !== null) return { on: opinion, from: level };
  }
  return { on: false, from: null };
}

// The car-selection settings in force for a scope. Pass whichever levels apply
// — {game, series, season} for a season-wide answer, plus `cls` for one class's.
export function resolveCarSelection({ game = null, series = null, season = null, cls = null } = {}) {
  const docs = { class: cls, season, series, game };
  const present = LEVELS.filter(level => docs[level]);
  const optionLevel = present.find(level => carOptionList(docs[level]).length) ?? null;
  const noteLevel = present.find(level => String(docs[level].car_selection_note || "").trim()) ?? null;
  const required = resolveRequirement(docs, "require_car_selection");
  const locked = resolveRequirement(docs, "car_selection_locked");
  return {
    required: required.on,
    locked: locked.on,
    options: optionLevel ? carOptionList(docs[optionLevel]) : [],
    options_from: optionLevel,
    note: noteLevel ? String(docs[noteLevel].car_selection_note).trim() : "",
    note_from: noteLevel,
    // Which level decided it, for "Required by the series" text.
    required_from: required.on ? required.from : null,
    locked_from: locked.on ? locked.from : null,
  };
}

// ── What a sign-up must carry ──────────────────────────────────────────────
//
// Three separate things an admin can insist on, each resolved down the same
// game → series → season → class chain as the car lock-in above (most specific
// opinion wins; most specific list wins):
//
//   require_car_selection    — lock in the car you'll race, from `car_options`.
//                              Answered on the season's own screen, and also
//                              asked up front on the sign-up form.
//   require_car_number       — a sign-up must name a car number.
//   require_car_manufacturer — a sign-up must pick a manufacturer / model,
//                              from `manufacturer_options` (or the car list).
//
// They're independent on purpose: a league can demand numbers without caring
// what anyone drives, or run a spec series where the car is fixed but the
// manufacturer isn't.
//
// Not here: the platform identities (Discord/Steam/PSN/Xbox/iRacing). Those are
// the GAME's and are never overridden by anything under it — see
// lib/signupRequest.js.
export function resolveSignupRules({ game = null, series = null, season = null, cls = null } = {}) {
  const docs = { class: cls, season, series, game };
  const present = LEVELS.filter(level => docs[level]);
  const car = resolveCarSelection({ game, series, season, cls });
  const number = resolveRequirement(docs, "require_car_number");
  const manufacturer = resolveRequirement(docs, "require_car_manufacturer");
  const manufacturerLevel = present.find(level => manufacturerOptionList(docs[level]).length) ?? null;
  return {
    // The car lock-in, unchanged — kept whole so callers can pass it straight
    // to the lock-in screen.
    car,
    require_car: car.required,
    car_options: car.options,
    require_number: number.on,
    require_manufacturer: manufacturer.on,
    manufacturer_options: manufacturerLevel ? manufacturerOptionList(docs[manufacturerLevel]) : [],
    note: car.note,
    locked: car.locked,
    // Which level decided each one, so a screen can say "required by the
    // season" rather than leaving an admin to guess where it came from.
    require_car_from: car.required_from,
    require_number_from: number.on ? number.from : null,
    require_manufacturer_from: manufacturer.on ? manufacturer.from : null,
    // Does this scope ask a player for ANYTHING beyond their name at sign-up?
    get asksAnything() {
      return car.required || number.on || manufacturer.on;
    },
  };
}

// Which of a season's requirements a submission hasn't met, as
// [{ field, label }] — the list the form disables its submit button on and the
// API refuses the request with.
export function missingSignupFields(rules, { number = "", car = "", manufacturer = "" } = {}) {
  const missing = [];
  if (rules.require_number && !String(number).trim()) {
    missing.push({ field: "number", label: "a car number" });
  }
  if (rules.require_car && rules.car_options.length && !String(car).trim()) {
    missing.push({ field: "car", label: "a car" });
  }
  if (rules.require_manufacturer && rules.manufacturer_options.length && !String(manufacturer).trim()) {
    missing.push({ field: "manufacturer", label: "a manufacturer / model" });
  }
  return missing;
}

// "This series needs a car number and a manufacturer / model." — one sentence
// for the form and for the API's refusal, worded the same either way.
export function missingSignupMessage(missing = []) {
  if (!missing.length) return "";
  const names = missing.map(m => m.label);
  const list = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `This series needs ${list} before you can sign up.`;
}

// Does this class carry car-selection settings of its OWN, rather than just
// inheriting the season's? That's what makes it a separate lock-in slot below:
// a class with its own machinery asks its drivers for their own pick.
export function classDefinesCarSelection(cls) {
  return levelOpinion(cls, "require_car_selection") !== null
    || levelOpinion(cls, "car_selection_locked") !== null
    || carOptionList(cls).length > 0
    || !!String(cls?.car_selection_note || "").trim();
}

// Does this class ask anything of a sign-up that its season doesn't? Used to
// decide whether picking a class on the form changes what's being asked for.
export function classDefinesSignupRules(cls) {
  return classDefinesCarSelection(cls)
    || levelOpinion(cls, "require_car_number") !== null
    || levelOpinion(cls, "require_car_manufacturer") !== null
    || manufacturerOptionList(cls).length > 0;
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
export function carSelectionSlots({ game = null, series = null, season = null, classes = [] } = {}) {
  const slots = [];
  const seasonWide = resolveCarSelection({ game, series, season });
  if (seasonWide.required) slots.push({ class_id: "", class_name: "", ...seasonWide });
  for (const cls of classes) {
    if (!classDefinesCarSelection(cls)) continue;
    const resolved = resolveCarSelection({ game, series, season, cls });
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
// Each switch is held in the form as its MODE ("" inherit / "on" / "off"), which
// is what the three-way selects in <CarSelectionFields> bind to.
export const BLANK_CAR_SELECTION_FORM = {
  require_car_selection_mode: INHERIT,
  require_car_number_mode: INHERIT,
  require_car_manufacturer_mode: INHERIT,
  car_selection_locked_mode: INHERIT,
  car_options: "",
  manufacturer_options: "",
  car_selection_note: "",
};

// A saved doc → form state. A document written before modes existed shows up as
// "on" where its boolean was true and as "inherit" where it was false, which is
// exactly what those documents have always meant.
export function carSelectionToForm(doc = {}) {
  // The manufacturer box shows only what this level SET, not what it inherits
  // from the car list — otherwise saving would copy the fallback into it and
  // the two could never diverge again.
  const ownManufacturers = Array.isArray(doc.manufacturer_options) || typeof doc.manufacturer_options === "string"
    ? parseCarOptions(doc.manufacturer_options)
    : [];
  const mode = field => {
    const opinion = levelOpinion(doc, field);
    return opinion === null ? INHERIT : (opinion ? ON : OFF);
  };
  return {
    require_car_selection_mode: mode("require_car_selection"),
    require_car_number_mode: mode("require_car_number"),
    require_car_manufacturer_mode: mode("require_car_manufacturer"),
    car_selection_locked_mode: mode("car_selection_locked"),
    car_options: carOptionList(doc).join("\n"),
    manufacturer_options: ownManufacturers.join("\n"),
    car_selection_note: doc.car_selection_note || "",
  };
}

// Form state → the POST/PATCH body. Both halves are written: the mode is the
// answer, and the original boolean is kept in step (true only for "on") so
// anything still reading the raw flag sees the same thing.
export function carSelectionFormToBody(form = {}) {
  const body = {
    car_options: parseCarOptions(form.car_options),
    manufacturer_options: parseCarOptions(form.manufacturer_options),
    car_selection_note: String(form.car_selection_note || "").trim(),
  };
  for (const field of REQUIREMENT_FIELDS) {
    const raw = String(form[`${field}_mode`] ?? "").trim().toLowerCase();
    const mode = raw === ON || raw === OFF ? raw : INHERIT;
    body[`${field}_mode`] = mode;
    body[field] = mode === ON;
  }
  return body;
}
