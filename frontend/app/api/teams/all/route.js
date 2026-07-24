import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { getRequestLeagueId, scopeByLeague } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

// Directory of every team across every season. Teams are per-season docs keyed
// by name (no global id), so collapse them by lowercased name — the same
// identity model the Teams stats tab and /teams/[name] profile use. Each row
// carries the newest logo/color seen and how many seasons the name has raced.
// `ids` lists every backing team doc for the name so the directory can edit
// (rename/re-logo across all seasons) or delete the whole team at once —
// including "phantom" teams that have no drivers/results but still have a doc.
export async function GET(request) {
  const snap = await scopeByLeague(db().collection("teams"), getRequestLeagueId(request)).get();

  const byName = {};
  for (const doc of snap.docs) {
    const t = doc.data();
    const name = String(t.name || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const row = byName[key] || (byName[key] = { name, seasons: 0, logo_url: null, color: null, ids: [] });
    row.seasons += 1;
    row.ids.push(doc.id);
    if (t.logo_url) row.logo_url = t.logo_url;
    if (t.color) row.color = t.color;
  }

  const teams = Object.values(byName).sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json(teams);
}
