// Shared, dependency-free role model for the RBAC hierarchy. Imported by both
// server auth (lib/serverAuth) and client UI (AuthProvider, the User Accounts
// dashboard) so the two never drift apart.
//
// The staff hierarchy, highest authority first:
//   owner (4) > admin (3) > moderator (2) > statistician (1)
// plus the non-staff baseline:
//   player (0)
//
// All four staff roles share the same baseline league powers — they bypass the
// AdminGate and may add/edit/delete league data (races, seasons, series, games,
// drivers, teams, tracks, results). The levels only govern USER MANAGEMENT:
// who may edit whose account and which roles they may hand out.

export const ROLE_LEVEL = {
  player: 0,
  statistician: 1,
  moderator: 2,
  admin: 3,
  owner: 4,
};

// Ordered low → high; handy for building dropdowns.
export const ROLES = ["player", "statistician", "moderator", "admin", "owner"];

export const ROLE_LABELS = {
  player: "Player",
  statistician: "Statistician",
  moderator: "Moderator",
  admin: "Admin",
  owner: "Owner",
};

// Anyone at or above Statistician is "staff" and clears the league AdminGate.
export const STAFF_MIN_LEVEL = ROLE_LEVEL.statistician;

export function roleLevel(role) {
  return ROLE_LEVEL[role] ?? 0;
}

// Coerce any stored/incoming value to a known role; unknown → "player".
export function normalizeRole(role) {
  return ROLES.includes(role) ? role : "player";
}

export function isStaffRole(role) {
  return roleLevel(role) >= STAFF_MIN_LEVEL;
}

// Can an actor manage (edit role / delete) a target account? An actor may only
// touch accounts at or below their own level, and must themselves be staff.
// e.g. a Moderator can't edit an Admin or Owner; a Statistician can't edit a
// Moderator, Admin, or Owner.
export function canManage(actorRole, targetRole) {
  const a = roleLevel(actorRole);
  return a >= STAFF_MIN_LEVEL && a >= roleLevel(targetRole);
}

// Roles an actor is allowed to assign — never above their own level, so a
// Moderator can't mint an Admin/Owner and nobody can promote past themselves.
export function assignableRoles(actorRole) {
  const a = roleLevel(actorRole);
  return ROLES.filter(r => roleLevel(r) <= a);
}
