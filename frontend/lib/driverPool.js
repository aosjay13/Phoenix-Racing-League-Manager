import { api } from "@/lib/api";
import { duplicateReport, duplicateSummary, findDriverMatches, matchReason } from "@/lib/driverMatch";

// Resolving a season entry to the global driver identity (drivers/{id}) behind
// it, and creating one only when there genuinely isn't one.
//
// Every entry should carry a `driver_id` — that's the real identity, since the
// same person runs a different display name per series, per game and per
// platform. Which of those names an admin happens to type must not decide
// whether they get a second profile, so resolution goes through the shared
// matcher (lib/driverMatch.js), which knows every name a driver answers to:
// their profile name, display name, per-game names, connected-account
// usernames and any name a merge folded into them.
//
// The order is: an explicit id, then the account (one account, one profile),
// then any name they demonstrably go by. A merely SIMILAR name is never
// resolved silently and never created silently — it raises DuplicateDriverError
// so the screen can ask, which is the whole point: a duplicate that appears
// without a word is the thing this is here to stop.

// Raised instead of quietly creating a second profile. Carries the verdict, so
// the caller can offer the drivers it found (see DuplicateDriverPrompt).
export class DuplicateDriverError extends Error {
  constructor(report, name = "") {
    super(duplicateSummary(report, name));
    this.name = "DuplicateDriverError";
    this.report = report;
    this.matches = report?.matches ?? [];
    this.driverName = name;
  }
}

export function isDuplicateDriverError(err) {
  // The server refuses the same thing at POST /api/drivers, so a 409 from there
  // is the same answer arriving the long way round — see app/api/drivers.
  return err instanceof DuplicateDriverError || err?.data?.code === "possible-duplicate";
}

// The verdict behind either form of that refusal, in one shape. A screen that
// catches one shouldn't have to care whether the question was answered here or
// by the API — the API's answer is the authority anyway, since it read the pool
// as it stands rather than the copy this page loaded.
export function duplicateReportFromError(err) {
  if (err?.report) return err.report;
  const matches = err?.data?.matches ?? [];
  return { status: err?.data?.duplicate_status ?? "possible", driver_id: null, matches, match: matches[0] ?? null };
}

// The global pool, as the matcher wants it. Every caller here takes an optional
// pool so a screen that already has one (the roster, the race-entry
// autocomplete) doesn't re-fetch it mid-interaction.
export async function loadDriverPool() {
  return api("/api/drivers");
}

// Who does this look like? A thin wrapper so screens don't each import the
// matcher and pick their own thresholds.
export function driverMatchesFor(pool, { name, user_id, exclude_id }, games = {}) {
  return findDriverMatches(pool, { name, user_id, exclude_id }, { games });
}

export { duplicateReport, duplicateSummary, matchReason };

// Resolve — never create. Returns the verdict, so a caller can decide what to
// do about a "possible" before anything is written.
export async function resolveDriverIdentity({ driverId, name, user_id, exclude_id, pool = null, games = {} }) {
  if (driverId) return { status: "linked", driver_id: driverId, matches: [], match: null };
  const list = pool || (await loadDriverPool());
  return duplicateReport(list, { name, user_id, exclude_id }, { games });
}

// Resolve, and create when there's genuinely nobody there.
//
//   • an explicit `driverId` wins outright
//   • one driver who demonstrably answers to this name (or owns this account)
//     is that driver — reused, not duplicated
//   • anything else — several candidates, or a near miss — throws
//     DuplicateDriverError unless the caller passes `confirmDuplicate`, which
//     is the screen saying "the admin has seen the candidates and wants a new
//     driver anyway"
export async function ensureDriverId({ driverId, name, user_id, pool = null, games = {}, confirmDuplicate = false }) {
  if (driverId) return driverId;
  const report = await resolveDriverIdentity({ name, user_id, pool, games });
  if (report.status === "linked") return report.driver_id;
  if (report.status !== "none" && !confirmDuplicate) throw new DuplicateDriverError(report, name);
  // `confirmDuplicate` is passed STRAIGHT THROUGH, and that matters more than it
  // looks. This used to hard-code `true`, which meant every screen in the app
  // told the API "the question has been answered" — including the case where
  // the only thing that had answered it was this page's own copy of the pool.
  // A copy loaded ten minutes ago cannot know about the driver another admin
  // added since, so the one check that CAN see them never ran, and two admins
  // adding the same person at the same time each got their own profile.
  //
  // Left false, POST /api/drivers re-asks against the pool as it stands and
  // answers 409; every caller that passes false already catches that (see
  // isDuplicateDriverError) and shows the same prompt it would have shown
  // locally. Callers resolving somebody who demonstrably already exists — a
  // merge, a link, a team line-up — still pass true and are unaffected.
  return (await createDriverProfile({ name, user_id, confirmDuplicate })).id;
}

// Create a pool driver outright, returning the new document.
//
// `confirmDuplicate` says the question has already been asked and answered —
// either there was nobody to ask about, or the admin looked at the candidates
// and said "new driver anyway". Left false, the API asks it again against the
// pool as it stands right now, which catches the case a screen can't: a driver
// added by somebody else since this page loaded its copy of the pool.
export async function createDriverProfile({ name, user_id = "", confirmDuplicate = false }) {
  return api("/api/drivers", {
    method: "POST",
    body: { name, user_id: user_id || "", ...(confirmDuplicate ? { confirm_duplicate: true } : {}) },
  });
}
