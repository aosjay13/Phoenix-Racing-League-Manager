import { NextResponse } from "next/server";
import { getRequestLeagueId, getRequestUser, isAdmin } from "@/lib/serverAuth";
import { duplicateCheck, duplicateMessage, loadGameNames, serializeMatches } from "@/lib/driverMatchServer";
import { makeCollectionRoutes, SPECS } from "@/lib/entityApi";
import { db } from "@/lib/firebase";
import { iracingGameIds, publicDriverDoc } from "@/lib/iracingPrivacy";

// The global driver pool. Reads are the plain generated list route; creating
// one goes past a duplicate check first.
//
// This is the LAST line of defence against the same human ending up in the app
// twice. The screens ask the same question before they get here (see
// lib/driverPool.js and components/DuplicateDriverPrompt.jsx), so an admin
// normally answers it in a dialog that offers the existing driver — but a path
// that forgets to ask, or a script posting straight at the API, must not be
// able to create a silent duplicate either. Hence the check lives here as well.
//
// It REFUSES rather than resolves, and it never decides for the caller: a 409
// carries the drivers the new one looked like and why each one came up, and
// `confirm_duplicate: true` on a repeat POST creates the driver anyway. Two
// people with similar names is an ordinary thing in a league, so the answer to
// "are these the same person?" always belongs to the admin.
async function refuseDuplicate(body, request) {
  if (body?.confirm_duplicate) return null;
  const name = String(body?.name ?? "").trim();
  const user_id = String(body?.user_id ?? "").trim();
  // No name at all isn't a duplicate, it's an invalid create — let the field
  // check answer that, so the caller gets "name required" rather than a
  // confusing verdict about somebody else.
  if (!name) return null;

  const report = await duplicateCheck({ name, user_id, leagueId: getRequestLeagueId(request) });
  if (!report) return null;

  return NextResponse.json({
    // Admin-only route (POST goes through withAdmin), so the refusal names the
    // drivers it found as they are stored — resolving identity is the job it
    // exists for. The player-facing sign-up and claim routes redact instead.
    error: duplicateMessage(report, name, { privileged: true }),
    code: "possible-duplicate",
    duplicate_status: report.status,
    matches: serializeMatches(report.matches, { privileged: true }),
  }, { status: 409 });
}

const routes = makeCollectionRoutes({ ...SPECS.drivers, guard: refuseDuplicate });
export const POST = routes.POST;

// The pool as a reader may see it.
//
// This list is public — the Drivers directory is the one page every visitor
// lands on — and a driver document carries every name the league holds for that
// person, the real name iRacing forces them to race under included. Staff need
// all of it: resolving who somebody is, merging a duplicate and editing a
// profile are their jobs, and none of them can be done through a redacted name.
// Nobody else does, so nobody else is sent it.
//
// A projection on the way out, and nothing more: the stored documents are
// untouched, and the driver a redacted row describes is the same driver, with
// the same id, the same links and the same stats behind them (see
// publicDriverDoc in lib/iracingPrivacy.js).
export async function GET(request) {
  const response = await routes.GET(request);
  const user = await getRequestUser(request);
  const leagueId = getRequestLeagueId(request);
  if (user && await isAdmin(user, leagueId)) return response;

  const drivers = await response.json();
  if (!Array.isArray(drivers)) return NextResponse.json(drivers, { status: response.status });

  const iracingIds = iracingGameIds(await loadGameNames(leagueId));
  const accountNames = await accountNamesFor(drivers);
  return NextResponse.json(
    drivers.map(d => publicDriverDoc(d, { iracingIds, accountName: d.user_id ? accountNames[d.user_id] : null })),
    { status: response.status },
  );
}

// The one field of a linked account that name resolution needs. Read here so a
// redacted row falls back to the same name the directory would have shown.
async function accountNamesFor(drivers) {
  const uids = [...new Set(drivers.map(d => d.user_id).filter(Boolean))];
  if (!uids.length) return {};
  const docs = await Promise.all(uids.map(uid => db().collection("users").doc(uid).get()));
  const out = {};
  for (const u of docs) if (u.exists) out[u.id] = String(u.data().display_name ?? "").trim();
  return out;
}
