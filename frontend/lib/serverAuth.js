import { NextResponse } from "next/server";
import { adminAuth, db } from "@/lib/firebase";

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

function envAdminEmails() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function isAdmin(user) {
  if (!user) return false;
  if (user.email && envAdminEmails().includes(user.email.toLowerCase())) return true;
  const doc = await db().collection("users").doc(user.uid).get();
  return doc.exists && doc.data().role === "admin";
}

export function unauthorized() {
  return NextResponse.json({ error: "Sign in required" }, { status: 401 });
}

export function forbidden() {
  return NextResponse.json({ error: "Admin access required" }, { status: 403 });
}

// Wraps a handler that requires an authenticated admin.
export function withAdmin(handler) {
  return async (request, ctx) => {
    const user = await getRequestUser(request);
    if (!user) return unauthorized();
    if (!(await isAdmin(user))) return forbidden();
    return handler(request, ctx, user);
  };
}

// Wraps a handler that requires any authenticated user.
export function withUser(handler) {
  return async (request, ctx) => {
    const user = await getRequestUser(request);
    if (!user) return unauthorized();
    return handler(request, ctx, user);
  };
}
