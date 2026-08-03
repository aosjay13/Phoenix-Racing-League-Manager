"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";
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

  function setAlias(i, patch) {
    setAliases(rows => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function addAlias() { setAliases(rows => [...rows, { label: "", value: "", game_id: "", is_display: false }]); }
  function removeAlias(i) { setAliases(rows => rows.filter((_, j) => j !== i)); }

  // Pick which alias is the on-track display name for a given game. Marks row i
  // as the display alias and clears the flag on every other alias mapped to the
  // same game, so each game has exactly one display alias.
  function setDisplayAlias(i) {
    setAliases(rows => {
      const gid = rows[i].game_id;
      return rows.map((r, j) => (r.game_id === gid ? { ...r, is_display: j === i } : r));
    });
  }

  // How many aliases are mapped to each game — used to show the "display" chooser
  // only where there's an actual choice (2+ aliases sharing one game).
  const gameCounts = aliases.reduce((m, a) => {
    if (a.game_id) m[a.game_id] = (m[a.game_id] || 0) + 1;
    return m;
  }, {});

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

        <div className="field" style={{ marginTop: 8 }}>
          <label style={{ display: "block" }}>Aliases / Connected Accounts</label>
          <p style={{ margin: "0 0 8px", fontSize: "0.78rem", color: "var(--ink-2)" }}>
            Platform usernames this driver races under. The Smart Importer matches imported names against
            all of these, so results using any of them map back to this profile. Mapping an alias to a
            <strong> Game</strong> also makes it that game's display name as a fallback — but a name set
            under <strong>Display Names</strong> above always wins. When more than one alias is mapped to
            the same game, use <strong>Display</strong> to pick which one is the fallback.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {aliases.map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  value={a.label}
                  onChange={e => setAlias(i, { label: e.target.value })}
                  placeholder="Platform"
                  style={{ flex: "0 0 30%", minWidth: 90 }}
                />
                <input
                  value={a.value}
                  onChange={e => setAlias(i, { value: e.target.value })}
                  placeholder="Username / ID"
                  style={{ flex: 1, minWidth: 100 }}
                />
                <select
                  value={a.game_id || ""}
                  onChange={e => setAlias(i, { game_id: e.target.value, is_display: false })}
                  title="Game this name is used in"
                  style={{ flex: "0 0 26%", minWidth: 100 }}
                >
                  <option value="">Any game</option>
                  {games.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                {a.game_id && gameCounts[a.game_id] > 1 ? (
                  <label
                    title="Show this name on this game's Standings & Results"
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "0.74rem", color: "var(--ink-2)", cursor: "pointer" }}
                  >
                    <input
                      type="radio"
                      name={`display-${a.game_id}`}
                      checked={!!a.is_display}
                      onChange={() => setDisplayAlias(i)}
                    />
                    Display
                  </label>
                ) : null}
                <button type="button" className="btn btn-ghost" title="Remove field"
                  style={{ marginTop: 0, padding: "4px 10px", color: "var(--ink-2)" }}
                  onClick={() => removeAlias(i)}>✕</button>
              </div>
            ))}
          </div>
          <button type="button" className="btn btn-ghost" style={{ marginTop: 8, padding: "4px 12px" }} onClick={addAlias}>
            ＋ Add platform
          </button>
        </div>

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
