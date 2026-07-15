import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// TEMPORARY diagnostic — reports env/config health without leaking secret
// values. Remove after deployment is confirmed working.
// Access-gated so the diagnostic is not readable by the public.
const DEBUG_TOKEN = "prlm-diag-7f3a91c2";

export async function GET(request) {
  const token = new URL(request.url).searchParams.get("token");
  if (token !== DEBUG_TOKEN) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const pk = process.env.FIREBASE_PRIVATE_KEY || "";
  const report = {
    build_marker: "debug-v1",
    env_present: {
      FIREBASE_PROJECT_ID: !!process.env.FIREBASE_PROJECT_ID,
      FIREBASE_CLIENT_EMAIL: !!process.env.FIREBASE_CLIENT_EMAIL,
      FIREBASE_PRIVATE_KEY: !!process.env.FIREBASE_PRIVATE_KEY,
      FIREBASE_STORAGE_BUCKET: !!process.env.FIREBASE_STORAGE_BUCKET,
      ADMIN_EMAILS: !!process.env.ADMIN_EMAILS,
      NEXT_PUBLIC_FIREBASE_API_KEY: !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    },
    project_id_value: process.env.FIREBASE_PROJECT_ID || null,
    private_key: {
      length: pk.length,
      starts_with_quote: pk.startsWith('"') || pk.startsWith("'"),
      has_begin: pk.includes("BEGIN PRIVATE KEY"),
      has_end: pk.includes("END PRIVATE KEY"),
      has_literal_backslash_n: pk.includes("\\n"),
      has_real_newline: pk.includes("\n"),
    },
    firebase_init: "not attempted",
    firestore_read: "not attempted",
    error: null,
  };

  try {
    const { db } = await import("@/lib/firebase");
    report.firebase_init = "ok";
    const snap = await db().collection("games").limit(1).get();
    report.firestore_read = `ok (${snap.size} docs)`;
  } catch (err) {
    report.error = String(err?.message || err).split("\n").slice(0, 4).join(" | ");
  }

  return NextResponse.json(report);
}
