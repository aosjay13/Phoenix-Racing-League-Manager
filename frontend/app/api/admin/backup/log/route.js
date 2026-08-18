import { NextResponse } from "next/server";
import { withGlobalOwner } from "@/lib/serverAuth";
import { readBackupLog } from "@/lib/backup";

export const dynamic = "force-dynamic";

// GET /api/admin/backup/log — the most recent export runs, manual and
// scheduled, so the Backup & Restore screen can show at a glance when the app
// was last backed up and whether the Saturday job is actually firing.
export const GET = withGlobalOwner(async () => {
  return NextResponse.json(await readBackupLog(20));
});
