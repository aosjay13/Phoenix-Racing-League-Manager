"use client";

import { AdminGate } from "@/components/AdminGate";
import { RosterManager } from "@/components/RosterManager";

// ── Driver Roster ──────────────────────────────────────────────────────────
//
// Who is on which season's roster, and everything an admin does to it: add and
// edit drivers, hand out car numbers, run the driver pool and the teams,
// approve the players waiting to get in, and see who has joined since they last
// looked.
//
// It was a tab on the Drivers page ("Roster & Teams"), reached by knowing it
// was there. It's a sidebar menu of its own now, under Admin, for the same
// reason Sign-ups is one for players: it's a job rather than a view, and a job
// needs somewhere it can carry a badge and be reached from every page. Drivers
// keeps what it was actually about — the public directory, and the accounts
// behind the profiles.
//
// AdminGate handles signed-out, still-loading and not-staff with the app's
// usual wording, so there's nothing for this page to add.
export default function DriverRosterPage() {
  return (
    <AdminGate>
      <RosterManager />
    </AdminGate>
  );
}
