import { NextResponse } from "next/server";
import { getRequestLeagueId } from "@/lib/serverAuth";
import { authorizeBackupRequest } from "@/lib/backupAuth";
import { buildBackup, backupFilename, logBackup } from "@/lib/backup";

export const dynamic = "force-dynamic";
// A full export walks every collection; give it room on hosts that allow it.
export const maxDuration = 300;

// GET /api/admin/backup
//
// Streams the entire application back as one JSON document — the manual half of
// the backup story, and the endpoint the weekly scheduled job calls.
//
// Query params:
//   scope=all|league   "all" (default) exports the whole project including
//                      accounts; "league" exports only the active league's
//                      racing data.
//   league_id=…        Which league, when scope=league. Falls back to the
//                      X-League-Id header the client already sends.
//   pretty=1           Indent the JSON (bigger file, readable in an editor).
//
// Owner-only, or the scheduled job presenting BACKUP_CRON_SECRET.
export async function GET(request) {
  const auth = await authorizeBackupRequest(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") === "league" ? "league" : "all";
  const leagueId = searchParams.get("league_id") || getRequestLeagueId(request);

  if (scope === "league" && !leagueId) {
    return NextResponse.json(
      { error: "No league selected — pick a league, or export the entire application instead." },
      { status: 400 },
    );
  }

  let backup;
  try {
    backup = await buildBackup({ scope, leagueId, actor: auth.actor, kind: auth.kind });
  } catch (err) {
    return NextResponse.json({ error: `Backup failed: ${err.message}` }, { status: 500 });
  }

  await logBackup({
    kind: auth.kind,
    scope: backup.scope,
    league_id: backup.league_id,
    counts: backup.counts,
    total: backup.total,
    by: auth.actor?.email || (auth.kind === "scheduled" ? "scheduled job" : null),
  });

  const body = searchParams.get("pretty") ? JSON.stringify(backup, null, 2) : JSON.stringify(backup);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${backupFilename(backup)}"`,
      // A backup is a point-in-time snapshot; nothing should ever serve a
      // cached one.
      "Cache-Control": "no-store",
    },
  });
}
