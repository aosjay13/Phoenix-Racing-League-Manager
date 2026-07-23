import { NextResponse } from "next/server";
import { adminAuth, db } from "@/lib/firebase";
import { normalizeRole, isStaffRole } from "@/lib/roles";

export async function getRequestUser(request) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return null;
  try {
    const decoded = await adminAuth().verifyIdToken(match[1]);
    return decoded;
  } catch {
    return null;
  }
}

export function envAdminEmails() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

// Owners granted via the ADMIN_EMAILS env var are permanent — their role can't
// be revoked or lowered from the dashboard, so the UI flags them as locked.
// These accounts always resolve to the top "owner" role.
export function isEnvAdmin(email) {
  return !!email && envAdminEmails().includes(String(email).toLowerCase());
}

// The effective staff role for a request user: env-var admins are always
// "owner"; otherwise the role stored on their user doc (defaulting to "player").
export async function getUserRole(user) {
  if (!user) return null;
  if (isEnvAdmin(user.email)) return "owner";
  const doc = await db().collection("users").doc(user.uid).get();
  return doc.exists ? normalizeRole(doc.data().role || "player") : "player";
}

// "Has league-admin access" — true for any of the four staff roles (owner,
// admin, moderator, statistician). This is what gates the AdminGate / withAdmin
// league routes, all of which share the same baseline powers.
export async function isAdmin(user) {
  if (!user) return false;
  return isStaffRole(await getUserRole(user));
}

// An account may use the app only once its email is verified. Permanent env-var
// admins are exempt so the league owner can never lock themselves out (e.g. if
// verification email delivery ever breaks).
export function isVerified(user) {
  return !!user && (user.email_verified === true || isEnvAdmin(user.email));
}

export function unauthorized() {
  return NextResponse.json({ error: "Sign in required" }, { status: 401 });
}

export function forbidden() {
  return NextResponse.json({ error: "Admin access required" }, { status: 403 });
}

export function unverified() {
  return NextResponse.json(
    { error: "Verify your email address to continue.", code: "email-unverified" },
    { status: 403 },
  );
}

// Wraps a handler that requires an authenticated admin.
export function withAdmin(handler) {
  return async (request, ctx) => {
    const user = await getRequestUser(request);
    if (!user) return unauthorized();
    if (!isVerified(user)) return unverified();
    if (!(await isAdmin(user))) return forbidden();
    return handler(request, ctx, user);
  };
}

// Wraps a handler that requires any authenticated (and email-verified) user.
export function withUser(handler) {
  return async (request, ctx) => {
    const user = await getRequestUser(request);
    if (!user) return unauthorized();
    if (!isVerified(user)) return unverified();
    return handler(request, ctx, user);
  };
}
