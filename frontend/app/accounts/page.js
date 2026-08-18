"use client";

import { AdminGate } from "@/components/AdminGate";
import { UserAccountsManager } from "@/components/UserAccountsManager";

// Admin ▸ User Accounts — its own screen, and its own sidebar entry.
//
// It used to be a tab on the Drivers page, which put the one screen an admin
// reaches for when somebody can't get in two clicks deep behind a page about
// the public driver directory. Roles, driver links, pending claims and — since
// email delivery turned out to be a thing that can simply stop — marking
// accounts verified all live here. That is a job, not a view, and jobs get their
// own menu entry in this app (see the Driver Roster and Approvals entries for
// the same reasoning).
//
// AdminGate handles signed-out, still-loading and not-staff-in-this-league with
// the app's standard empty states, so this file is only the mounting.
export default function AccountsPage() {
  return (
    <AdminGate>
      <UserAccountsManager />
    </AdminGate>
  );
}
