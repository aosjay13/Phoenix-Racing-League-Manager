import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";

export const dynamic = "force-dynamic";

// Public player directory (no emails exposed).
export async function GET() {
  const snap = await db().collection("users").get();
  const users = snap.docs.map(d => {
    const { email, role, ...pub } = d.data();
    return { uid: d.id, ...pub };
  });
  users.sort((a, b) => String(a.display_name).localeCompare(String(b.display_name)));
  return NextResponse.json(users);
}
