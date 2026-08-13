import { NextResponse } from "next/server";
import { getRequestLeagueId } from "@/lib/serverAuth";
import { duplicateCheck, duplicateMessage, serializeMatches } from "@/lib/driverMatchServer";
import { makeCollectionRoutes, SPECS } from "@/lib/entityApi";

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
    error: duplicateMessage(report, name),
    code: "possible-duplicate",
    duplicate_status: report.status,
    matches: serializeMatches(report.matches),
  }, { status: 409 });
}

const routes = makeCollectionRoutes({ ...SPECS.drivers, guard: refuseDuplicate });
export const GET = routes.GET;
export const POST = routes.POST;
