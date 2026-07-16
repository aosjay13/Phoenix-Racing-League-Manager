import { api } from "@/lib/api";

// Resolves the global driver identity (drivers/{id}) for a season entry,
// creating one if necessary. Every entry should carry a `driver_id` — that's
// the real identity, since the same person can run a different display
// name (alias) per series/game. Prefers an explicit id, then a linked
// account match (unambiguous), then a case-insensitive name match, and only
// creates a new global driver record as a last resort — so adding someone
// to a series roster always mirrors them into the global pool, without
// spawning duplicate pool entries for people already there under an
// identical name.
export async function ensureDriverId({ driverId, name, user_id }) {
  if (driverId) return driverId;
  const pool = await api("/api/drivers");
  if (user_id) {
    const byUser = pool.find(d => d.user_id === user_id);
    if (byUser) return byUser.id;
  }
  const trimmed = (name || "").trim().toLowerCase();
  const byName = trimmed ? pool.find(d => d.name.trim().toLowerCase() === trimmed) : null;
  if (byName) return byName.id;
  const created = await api("/api/drivers", { method: "POST", body: { name, user_id: user_id || "" } });
  return created.id;
}
