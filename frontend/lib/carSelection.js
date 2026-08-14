// Car selection & lock-in — "this game/series/season/class makes its drivers
// pick a car, from this list, before it runs" — and the other things a sign-up
// can be made to carry, including whether it has to go through PLACEMENTS
// first (see "Placements required" below).
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
// overrides its game. That holds for the switches (require a car / a number,
// and the lock) exactly as it already held for the car list and the
// instructions note: class, else season, else series, else game.
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
  return parseCarEntries(text).map(e => e.name);
}

// The same list, keeping each car's OPTIONAL cap: how many drivers in a season
// may run it before it's closed off.
//
// The cap is written after the name behind a pipe — "Ferrari 296 GT3 | 4" — for
// two reasons. A pipe appears in no car name anyone has ever typed, unlike the
// "x4" an admin would reach for first (a real car could be "Cup Car x4"), and
// it keeps the list a single text field, so a cap inherits down the
// game → series → season → class chain exactly as the list itself does, with no
// second field to resolve and no migration for the lists already saved. A line
// with no pipe means no cap, which is what every existing list is.
//
// Anything after the pipe that isn't a positive whole number is ignored rather
// than rejected: "| 0" and "| lots" both mean "no cap" rather than "nobody may
// pick this", because silently offering a car nobody can choose is the worse
// failure.
export function parseCarEntries(text) {
  const list = Array.isArray(text)
    ? text.map(s => (s && typeof s === "object" ? s : String(s ?? "")))
    : (() => {
      const raw = String(text ?? "");
      return /[\r\n]/.test(raw) ? raw.split(/[\r\n]+/) : raw.split(",");
    })();

  const seen = new Set();
  const out = [];
  for (const item of list) {
    // Already-structured rows (a doc written as objects) pass straight through.
    const raw = item && typeof item === "object"
      ? { name: String(item.name ?? "").trim(), max: item.max }
      : splitCarLine(String(item ?? ""));
    if (!raw.name) continue;
    const key = raw.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const max = Number(raw.max);
    out.push({ name: raw.name, max: Number.isInteger(max) && max > 0 ? max : null });
  }
  return out;
}

function splitCarLine(line) {
  const at = line.lastIndexOf("|");
  if (at === -1) return { name: line.trim(), max: null };
  return { name: line.slice(0, at).trim(), max: line.slice(at + 1).trim() };
}

// "Ferrari 296 GT3 | 4" — one entry back to the text an admin edits, so the
// League Setup field can round-trip what it parsed.
export function formatCarEntry(entry) {
  return entry?.max ? `${entry.name} | ${entry.max}` : String(entry?.name ?? "");
}

// A saved doc's car list WITH each car's cap, whichever shape it was written in.
// Mirrors carOptionList below, which stays the plain-names view every existing
// caller reads.
export function carEntryList(doc) {
  const raw = doc?.car_options;
  const own = Array.isArray(raw) || typeof raw === "string" ? parseCarEntries(raw) : [];
  if (own.length) return own;
  const legacy = doc?.manufacturer_options;
  return Array.isArray(legacy) || typeof legacy === "string" ? parseCarEntries(legacy) : [];
}

// A saved doc's car list, whichever shape it was written in.
//
// `manufacturer_options` is the old second list. There used to be TWO questions
// here — "pick your car" and "pick your manufacturer / model" — asked side by
// side on the same sign-up form, which is one question too many for what is in
// practice the same choice. There is now one list and one question, so a league
// that had only ever filled in the manufacturer box keeps its options: the old
// field is read as the car list when no car list of its own was set.
export function carOptionList(doc) {
  const raw = doc?.car_options;
  const own = Array.isArray(raw) || typeof raw === "string" ? parseCarOptions(raw) : [];
  if (own.length) return own;
  const legacy = doc?.manufacturer_options;
  return Array.isArray(legacy) || typeof legacy === "string" ? parseCarOptions(legacy) : [];
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
  "car_selection_locked",
  "require_placements",
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
  // The caps ride with the list they were typed on: whichever level's list
  // wins, its caps win with it. A season that publishes its own list therefore
  // sets its own caps too, rather than inheriting numbers meant for a different
  // set of cars.
  const entries = optionLevel ? carEntryList(docs[optionLevel]) : [];
  const noteLevel = present.find(level => String(docs[level].car_selection_note || "").trim()) ?? null;
  const required = resolveRequirement(docs, "require_car_selection");
  const locked = resolveRequirement(docs, "car_selection_locked");
  return {
    required: required.on,
    locked: locked.on,
    options: entries.map(e => e.name),
    options_from: optionLevel,
    // Every offered car, with its cap (null = unlimited). Kept as a list rather
    // than a map so the order the admin typed survives.
    car_entries: entries,
    note: noteLevel ? String(docs[noteLevel].car_selection_note).trim() : "",
    note_from: noteLevel,
    // Which level decided it, for "Required by the series" text.
    required_from: required.on ? required.from : null,
    locked_from: locked.on ? locked.from : null,
  };
}

// ── What a sign-up must carry ──────────────────────────────────────────────
//
// THREE separate things an admin can insist on, each resolved down the same
// game → series → season → class chain as the car lock-in above (most specific
// opinion wins; most specific list wins):
//
//   require_car_selection    — lock in the car you'll race, from `car_options`.
//                              Answered on the season's own screen, and also
//                              asked up front on the sign-up form.
//   require_car_number       — a sign-up must name a car number.
//   require_placements       — nobody joins this tier straight off the
//                              Dashboard: a sign-up here is a request to be
//                              PLACED, and an admin runs them through a Time
//                              Trial & placement session before their roster
//                              spot is final. See "Placements required" below.
//
// There is ONE car question, not two. A "manufacturer / model" requirement used
// to sit beside the car one with its own list, and the two read as the same
// prompt asked twice on the same form — a league running Chevrolet / Ford /
// Toyota simply types those into the car list. See carOptionList for how a
// league that filled in the old box keeps its options.
//
// The two that remain are independent on purpose: a league can demand numbers
// without caring what anyone drives, or publish a car list without demanding a
// number.
//
// Not here: the platform identities (Discord/Steam/PSN/Xbox/iRacing). Those are
// the GAME's and are never overridden by anything under it — see
// lib/signupRequest.js.
export function resolveSignupRules({ game = null, series = null, season = null, cls = null } = {}) {
  const docs = { class: cls, season, series, game };
  const car = resolveCarSelection({ game, series, season, cls });
  const number = resolveRequirement(docs, "require_car_number");
  const placements = resolveRequirement(docs, "require_placements");
  return {
    // The car lock-in, unchanged — kept whole so callers can pass it straight
    // to the lock-in screen.
    car,
    require_car: car.required,
    car_options: car.options,
    car_entries: car.car_entries,
    require_number: number.on,
    // The placements gate. Not a FIELD on the form — it changes what submitting
    // the form MEANS, so the form says so and renames its button, and the admin
    // queue flags the row. See PLACEMENTS_* below.
    require_placements: placements.on,
    note: car.note,
    locked: car.locked,
    // Which level decided each one, so a screen can say "required by the
    // season" rather than leaving an admin to guess where it came from.
    require_car_from: car.required_from,
    require_number_from: number.on ? number.from : null,
    require_placements_from: placements.on ? placements.from : null,
    // Does this scope ask a player for ANYTHING beyond their name at sign-up?
    // Placements are deliberately not counted: they add no question to the
    // form, they change what answering it leads to.
    get asksAnything() {
      return car.required || number.on;
    },
  };
}

// Which of a season's requirements a submission hasn't met, as
// [{ field, label }] — the list the form disables its submit button on and the
// API refuses the request with.
export function missingSignupFields(rules, { number = "", car = "" } = {}) {
  const missing = [];
  if (rules.require_number && !String(number).trim()) {
    missing.push({ field: "number", label: "a car number" });
  }
  if (rules.require_car && rules.car_options.length && !String(car).trim()) {
    missing.push({ field: "car", label: "a car" });
  }
  return missing;
}

// "This series needs a car number and a car." — one sentence
// for the form and for the API's refusal, worded the same either way.
export function missingSignupMessage(missing = []) {
  if (!missing.length) return "";
  const names = missing.map(m => m.label);
  const list = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `This series needs ${list} before you can sign up.`;
}

// ── Placements required ────────────────────────────────────────────────────
//
// A league that sorts its field by pace — a Gold Series, a Pro class — needs
// one thing to be true: nobody walks into the fast tier off the Dashboard.
// Ticking "Placements Required" on a series, season or class is what makes
// that true, and it changes THREE things and nothing else:
//
//   1. the sign-up form warns, up front, that this series is placement-gated;
//   2. its button stops saying "Submit Sign Up" and says what pressing it
//      actually does — register for placements;
//   3. the row it files is flagged in the admin queue as AWAITING PLACEMENT,
//      so whoever approves it knows to run the driver through the Time Trials
//      hub before finalising their spot.
//
// What it deliberately does NOT do is block anything. The sign-up still files
// exactly the same pending row, the admin can still approve it with one press,
// and nothing about a series that doesn't require placements changes. The gate
// is a piece of INFORMATION carried from the admin who set it, through the
// player who reads it, to the admin who resolves it — which is the only shape
// that can't strand a driver whose league runs placements informally.
//
// The wording lives here, once, so the form a player reads and the badge an
// admin reads can never describe the same flag differently.

export const PLACEMENTS_REQUIRED_TITLE = "Placements Required";

export const PLACEMENTS_REQUIRED_MESSAGE =
  "You must qualify via a placement session to race in this series. "
  + "Submitting this form registers your intent to qualify — it doesn't put you on the grid. "
  + "A league admin will run you through a Time Trial and place you in the right class "
  + "before your roster spot is final.";

// What the submit button says where the gate is on. A button that still said
// "Submit Sign Up" would be promising a roster place this form can't give.
export const PLACEMENTS_SUBMIT_LABEL = "Register for Placements";

// The flag on the admin's queue row, and what it's there to remind them of.
export const AWAITING_PLACEMENT_BADGE = "Awaiting Placement";
export const AWAITING_PLACEMENT_HINT =
  "This series requires placements — route this driver through a Time Trial "
  + "session before finalising their class and roster spot.";

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
    || levelOpinion(cls, "require_placements") !== null;
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
  car_selection_locked_mode: INHERIT,
  require_placements_mode: INHERIT,
  car_options: "",
  car_selection_note: "",
};

// A saved doc → form state. A document written before modes existed shows up as
// "on" where its boolean was true and as "inherit" where it was false, which is
// exactly what those documents have always meant.
export function carSelectionToForm(doc = {}) {
  const mode = field => {
    const opinion = levelOpinion(doc, field);
    return opinion === null ? INHERIT : (opinion ? ON : OFF);
  };
  return {
    require_car_selection_mode: mode("require_car_selection"),
    require_car_number_mode: mode("require_car_number"),
    car_selection_locked_mode: mode("car_selection_locked"),
    require_placements_mode: mode("require_placements"),
    // carOptionList falls back to the retired manufacturer list, so the one box
    // opens showing whichever of the two an admin had filled in — and saving
    // writes it back as the car list, which is where it belongs now.
    // Each car with its cap, one per line — the shape the admin types and the
    // shape it's stored as, so a limit survives an edit that doesn't touch it.
    // Round-tripping through the names alone silently deleted every cap the
    // moment anything else on the level was saved.
    car_options: carEntryList(doc).map(formatCarEntry).join("\n"),
    car_selection_note: doc.car_selection_note || "",
  };
}

// Form state → the POST/PATCH body. Both halves are written: the mode is the
// answer, and the original boolean is kept in step (true only for "on") so
// anything still reading the raw flag sees the same thing.
export function carSelectionFormToBody(form = {}) {
  const body = {
    // Stored WITH the caps, as "Ferrari 296 GT3 | 4" lines.
    car_options: parseCarEntries(form.car_options).map(formatCarEntry),
    // The retired second list is emptied as the level is saved. The form loaded
    // it into `car_options` when that was the only list this level had (see
    // carSelectionToForm), so this moves the options rather than dropping them —
    // and leaves nothing behind for the fallback in carOptionList to prefer.
    manufacturer_options: [],
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

// ── Car capacity ───────────────────────────────────────────────────────────
//
// An admin can cap how many drivers may run each car ("Ferrari 296 GT3 | 4").
// Once a car is full it's closed: greyed out on the sign-up form, refused by
// the API, and not offered on the lock-in screen.
//
// What counts against a cap is everyone who HAS that car in the season plus
// everyone who has ASKED for it and is still waiting — a queue of five people
// all picking the last Ferrari, each told it was free because nobody had been
// approved yet, is exactly the pile-up the cap exists to prevent. It's the same
// rule car numbers already use (see numberClaimed in lib/signupQueue.js).
//
// Matching is case-insensitive, like matchCarOption, so a pick made before the
// admin re-cased the list still counts against the right cap.

// How many drivers hold each car. Rows are anything with a `car` (a sign-up
// request) or `selected_car`/`selected_cars` (a roster entry).
export function carCounts(rows = []) {
  const counts = {};
  for (const row of rows) {
    for (const car of carsHeldBy(row)) {
      const key = car.trim().toLowerCase();
      if (key) counts[key] = (counts[key] || 0) + 1;
    }
  }
  return counts;
}

// Every car one row holds. A roster entry can carry one per class in a season
// whose classes run their own lists, so all of them count.
function carsHeldBy(row) {
  if (!row || typeof row !== "object") return [];
  const out = [];
  if (row.car) out.push(String(row.car));
  if (row.selected_car) out.push(String(row.selected_car));
  const per = row.selected_cars;
  if (per && typeof per === "object") {
    for (const v of Object.values(per)) if (v) out.push(String(v));
  }
  return out;
}

// One car's cap and how much of it is used.
//
// `mine` is the car this driver already holds in the season, and it never
// counts against them: someone re-opening the lock-in screen on the last
// Ferrari must not be told their own car is full and be unable to save.
export function carCapacity(entries = [], counts = {}, car, mine = "") {
  const name = String(car ?? "").trim();
  const entry = entries.find(e => e.name.trim().toLowerCase() === name.toLowerCase());
  const taken = counts[name.toLowerCase()] || 0;
  const isMine = !!name && name.toLowerCase() === String(mine ?? "").trim().toLowerCase();
  const max = entry?.max ?? null;
  return {
    name: entry?.name ?? name,
    max,
    taken,
    // Free seats left, floored at zero so an over-filled car (the cap was
    // lowered after the fact) reads as full rather than as negative space.
    left: max == null ? null : Math.max(0, max - taken),
    full: max != null && taken >= max && !isMine,
  };
}

// The whole list, ready to render: name, cap, how many have it, whether it's
// closed. One call, so the form's radios and the API's refusal can't disagree.
export function carAvailability(entries = [], rows = [], mine = "") {
  const counts = carCounts(rows);
  return entries.map(e => carCapacity(entries, counts, e.name, mine));
}

// "Ferrari 296 GT3 is full — 4 of 4 taken. Please choose another car."
// Worded once, for the form's disabled label and the API's rejection alike.
export function carFullMessage(capacity) {
  return `${capacity.name} is full — ${capacity.taken} of ${capacity.max} taken.`
    + " Please choose another car.";
}
