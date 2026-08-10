"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { AliasEditor } from "@/components/AliasEditor";
import { withDefaults, normalizeAliases } from "@/lib/aliases";
import { normalizeGameNames } from "@/lib/driverNames";

// Edit a global driver-pool entry straight from the Drivers directory. Editable
// here: name, notes, Display Names, and the driver's Aliases / Connected
// Accounts — the platform usernames (Discord, PSN, Xbox, Steam, iRacing, …) that
// let the Smart Importer map an imported name to this one Driver Profile no
// matter which game it came from.
//
// Display Names are what a driver is SHOWN as, and they're set per context: one
// overall name for the directory, their profile and all-games stats/records, and
// one name per game for everything scoped to that game (its standings, results,
// stats, records, skill ratings and roster). So Ryan Maynard can appear as
// "Ryanbirdman" throughout BeamNG while staying "Ryan Maynard" everywhere else.
export function DriverEditModal({ driver, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: driver.name || "",
    notes: driver.notes || "",
    display_name: driver.display_name || "",
  });
  // Per-game display names: [{ game_id, name }], one row per game the admin
  // wants a distinct name in.
  const [gameNames, setGameNames] = useState(() => normalizeGameNames(driver.game_names));
  // Seed the alias rows with the standard platforms (pre-filled from any saved
  // values), followed by whatever custom platforms were already stored.
  const [aliases, setAliases] = useState(() => withDefaults(driver.aliases));
  const [games, setGames] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Games power the per-alias "Game" dropdown: mapping an alias to a game lets
  // that game's Standings/Results show the driver's on-track name.
  useEffect(() => {
    api("/api/games").then(setGames).catch(() => setGames([]));
  }, []);

  function setGameName(i, patch) {
    setGameNames(rows => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function addGameName() { setGameNames(rows => [...rows, { game_id: "", name: "" }]); }
  function removeGameName(i) { setGameNames(rows => rows.filter((_, j) => j !== i)); }

  // Games already claimed by another row can't be picked twice — one display
  // name per game.
  const takenGameIds = i => new Set(gameNames.filter((_, j) => j !== i).map(r => r.game_id).filter(Boolean));

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Persist only labelled aliases; blank-value rows are kept (a labelled but
      // empty platform is fine) but rows with no label are dropped.
      const cleanAliases = normalizeAliases(aliases);
      // Half-filled rows (a game with no name, or a name with no game) are
      // dropped rather than saved as a broken override.
      const cleanGameNames = normalizeGameNames(gameNames);
      const body = {
        name: form.name.trim(),
        notes: form.notes,
        display_name: form.display_name.trim(),
        game_names: cleanGameNames,
        aliases: cleanAliases,
      };
      const updated = await api(`/api/drivers/${driver.id}`, { method: "PATCH", body });
      onSaved({
        ...driver,
        name: updated.name ?? body.name,
        display_name: body.display_name,
        game_names: cleanGameNames,
        notes: body.notes,
        aliases: cleanAliases,
      });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Edit Driver" onClose={busy ? () => {} : onClose}>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label>Driver Name</label>
          <input required autoFocus value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Jane Doe" />
        </div>
        <div className="field">
          <label>Notes</label>
          <input value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
        </div>

        <div className="field" style={{ marginTop: 8 }}>
          <label style={{ display: "block" }}>Display Names</label>
          <p style={{ margin: "0 0 8px", fontSize: "0.78rem", color: "var(--ink-2)" }}>
            What this driver is <strong>shown</strong> as. The overall name covers the driver directory,
            their profile, and All Games stats &amp; records. A per-game name takes over everywhere inside
            that game — its standings, results, stats, records, skill ratings and roster.
          </p>
          <input
            value={form.display_name}
            onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
            placeholder={`Overall display name (default: ${driver.account_name || form.name || "driver name"})`}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
            {gameNames.map((g, i) => {
              const taken = takenGameIds(i);
              return (
                <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <select
                    value={g.game_id}
                    onChange={e => setGameName(i, { game_id: e.target.value })}
                    style={{ flex: "0 0 36%", minWidth: 120 }}
                  >
                    <option value="">Select a game…</option>
                    {games.filter(gm => gm.id === g.game_id || !taken.has(gm.id))
                      .map(gm => <option key={gm.id} value={gm.id}>{gm.name}</option>)}
                  </select>
                  <input
                    value={g.name}
                    onChange={e => setGameName(i, { name: e.target.value })}
                    placeholder="Name shown in this game"
                    style={{ flex: 1, minWidth: 120 }}
                  />
                  <button type="button" className="btn btn-ghost" title="Remove this game name"
                    style={{ marginTop: 0, padding: "4px 10px", color: "var(--ink-2)" }}
                    onClick={() => removeGameName(i)}>✕</button>
                </div>
              );
            })}
          </div>
          <button type="button" className="btn btn-ghost" style={{ marginTop: 8, padding: "4px 12px" }} onClick={addGameName}>
            ＋ Add game name
          </button>
        </div>

        {/* Shared with the player's own series sign-up dialog, so a driver is
            described the same way whoever fills it in — see AliasEditor. */}
        <AliasEditor aliases={aliases} onChange={setAliases} games={games} />

        {driver.linked && (
          <p style={{ margin: "10px 0 0", fontSize: "0.8rem", color: "var(--ink-2)" }}>
            This driver is linked to a player account, so without an overall display name above they’re
            shown under the account’s display name.
          </p>
        )}
        {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save Changes"}</button>
        <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={onClose} disabled={busy}>Cancel</button>
      </form>
    </Modal>
  );
}
