import { NextResponse } from "next/server";
import { getRequestUser, isGlobalOwner, isVerified } from "@/lib/serverAuth";

// Auth for the backup endpoints.
//
// Two kinds of caller are allowed to take a backup:
//   1. A signed-in Owner, from the Backup & Restore screen.
//   2. The scheduled job, which has no Firebase user to sign in as. It presents
//      the BACKUP_CRON_SECRET as a bearer token (or an X-Backup-Token header)
//      instead — a shared secret held by the CI workflow that runs every
//      Saturday morning.
//
// RESTORE is deliberately Owner-only, never token-authenticated: taking a copy
// of the data is harmless, overwriting the live database with one is not, so
// the destructive half always requires a human account.

export function cronSecret() {
  return (process.env.BACKUP_CRON_SECRET || "").trim();
}

// Constant-time-ish comparison so a wrong token can't be narrowed down by
// timing. Lengths differing is already a mismatch.
function secretsMatch(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isCronRequest(request) {
  const secret = cronSecret();
  if (!secret) return false;                       // no secret configured → no token access
  const header = request.headers.get("authorization") || "";
  const bearer = header.match(/^Bearer (.+)$/)?.[1]?.trim() || "";
  const custom = (request.headers.get("x-backup-token") || "").trim();
  return secretsMatch(bearer, secret) || secretsMatch(custom, secret);
}

// Resolve who is asking. Returns { ok: true, actor, kind } for an allowed
// caller, or { response } holding the error to return.
export async function authorizeBackupRequest(request) {
  if (isCronRequest(request)) {
    return { ok: true, actor: null, kind: "scheduled" };
  }
  const user = await getRequestUser(request);
  if (!user) {
    return { response: NextResponse.json({ error: "Sign in required" }, { status: 401 }) };
  }
  if (!isVerified(user)) {
    return {
      response: NextResponse.json(
        { error: "Verify your email address to continue.", code: "email-unverified" },
        { status: 403 },
      ),
    };
  }
  // The APPLICATION owner, not merely the owner of whichever league the tab
  // happens to be looking at: a backup spans every league, so the owner of a
  // league created this morning must not be able to export — or restore over —
  // everybody else's data. See isGlobalOwner in lib/serverAuth.js.
  if (!(await isGlobalOwner(user))) {
    return {
      response: NextResponse.json(
        { error: "This action is for the application Owner only." },
        { status: 403 },
      ),
    };
  }
  return { ok: true, actor: user, kind: "manual" };
}
