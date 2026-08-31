"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/Modal";
import { AliasEditor } from "@/components/AliasEditor";
import {
  ACCOUNT_ALIAS_LABELS, DISCORD_ALIAS_LABEL, aliasValue, isGameRacingName,
  normalizeAliases, setAliasValue, syncGameNameAliases,
} from "@/lib/aliases";
import { normalizeGameNames } from "@/lib/driverNames";

// Edit a global driver-pool entry straight from the Drivers directory.
//
// It asks three things, in the order somebody thinks about them:
//
//   WHO      the driver's name, and the name the app shows them under
//            league-wide (the directory, their profile, All Games stats).
//   WHERE    the name they race under in each GAME, one row per game, picked
//            from the league's own games. That row is the single answer to
//            "what are they called in iRacing?" — it used to be askable in two
//            places (a per-game display name AND an alias mapped to that game)
//            which could disagree, and did.
//   HOW      the accounts they can be reached and matched on. Discord has a
//            field of its own because every sign-up in every game asks for it.
//
// Nothing here changes what is stored: the per-game rows are still
// `drivers/<id>.game_names`, the accounts are still `aliases`, and a name a
// driver used to race under is never deleted by an edit (see
// syncGameNameAliases in lib/aliases.js).

// The saved aliases, with a blank row for any standard ACCOUNT platform the
// driver hasn't got one for yet, so the common handles are one click away. The
// per-game racing names are deliberately not seeded here — they belong to the
// per-game section, which builds its own rows from the league's games.
function withAccountDefaults(stored) {
  const rows = normalizeAliases(stored);
  const have = new Set(rows.map(a => a.label.trim().toLowerCase()));
  const missing = ACCOUNT_ALIAS_LABELS
    .filter(label => !have.has(label.toLowerCase()))
    .map(label => ({ label, value: "", game_id: "", is_display: false }));
  return [...rows, ...missing];
}

export function DriverEditModal({ driver, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: driver.name || "",
    notes: driver.notes || "",
    display_name: driver.display_name || "",
    discord: aliasValue(driver.aliases, DISCORD_ALIAS_LABEL),
  });
  const [gameNames, setGameNames] = useState(() => normalizeGameNames(driver.game_names));
  // Every alias this driver has, in full. What the account list SHOWS is a
  // subset (below) — Discord and the per-game racing names are edited in their
  // own fields — but the list itself stays whole, so a save can never lose a
  // row it merely wasn't rendering.
  const [aliases, setAliases] = useState(() => withAccountDefaults(driver.aliases));
  const [games, setGames] = useState([]);
  // Which rows belong to a game can't be answered until the games are in, and
  // answering it wrongly for one render flashes a driver's iRacing name into
  // the account list and out again. So the two game-aware sections wait.
  const [gamesLoaded, setGamesLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api("/api/games")
      .then(list => {
        setGames(list);
        // A racing name stored only as a game-mapped alias — which is how every
        // one of them was stored before this dialog had a per-game section —
        // is surfaced as that game's row, so the editor shows every name it
        // holds instead of hiding one it doesn't recognise.
        setGameNames(rows => {
          const have = new Set(rows.map(r => r.game_id));
          const extra = [];
          for (const g of list) {
            if (have.has(g.id)) continue;
            const hit = normalizeAliases(driver.aliases).find(a => a.value && isGameRacingName(a, g));
            if (hit) extra.push({ game_id: g.id, name: hit.value });
          }
          return extra.length ? [...rows, ...extra] : rows;
        });
      })
      .catch(() => setGames([]))
      .finally(() => setGamesLoaded(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A game's racing name is edited in its own row, so the same value must not
  // also appear as an account row underneath it. Split once, here, rather than
  // filtering at both render and save.
  const isAccountRow = a =>
    a.label.trim().toLowerCase() !== DISCORD_ALIAS_LABEL.toLowerCase()
    && !games.some(g => isGameRacingName(a, g));
  const accountRows = useMemo(() => aliases.filter(isAccountRow), [aliases, games]); // eslint-disable-line react-hooks/exhaustive-deps

  // Edits to the visible account rows, mapped back onto the full list so the
  // hidden ones (Discord, the per-game names) ride through untouched — and in
  // their original positions, since an alias mapped to a game is that game's
  // fallback display name and the order decides which one wins.
  function setAccountRows(update) {
    setAliases(prev => {
      const next = typeof update === "function" ? update(prev.filter(isAccountRow)) : update;
      const out = [];
      let k = 0;
      for (const a of prev) {
        if (!isAccountRow(a)) out.push(a);          // Discord, per-game names: untouched
        else if (k < next.length) out.push(next[k++]); // an edited row, in its old slot
        // a visible row the editor removed simply isn't carried over
      }
      for (; k < next.length; k++) out.push(next[k]); // rows the editor added
      return out;
    });
  }

  function setGameName(i, patch) {
    setGameNames(rows => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function addGameName() { setGameNames(rows => [...rows, { game_id: "", name: "" }]); }
  function removeGameName(i) { setGameNames(rows => rows.filter((_, j) => j !== i)); }

  // One name per game, so a game another row already claims isn't offered twice.
  const takenGameIds = i => new Set(gameNames.filter((_, j) => j !== i).map(r => r.game_id).filter(Boolean));

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Half-filled rows (a game with no name, or a name with no game) are
      // dropped rather than saved as a broken override.
      const cleanGameNames = normalizeGameNames(gameNames);
      // Discord back into the alias list, then every game's racing-name alias
      // brought into step with the rows above, so the two places a game's name
      // can be read from always say the same thing. No alias row is created and
      // none is deleted — one whose game row was removed is emptied, keeping its
      // label and mapping to type back into.
      const cleanAliases = normalizeAliases(
        syncGameNameAliases(setAliasValue(aliases, DISCORD_ALIAS_LABEL, form.discord), cleanGameNames, games));
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

  const hint = { margin: "0 0 8px", fontSize: "0.78rem", color: "var(--ink-2)" };

  return (
    <Modal title="Edit Driver" onClose={busy ? () => {} : onClose}>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label>Driver Name</label>
          <input required autoFocus value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Jane Doe" />
        </div>

        <div className="field">
          <label>Display Name</label>
          <p style={hint}>Shown league-wide: the driver directory, their profile, All Games stats.</p>
          <input
            value={form.display_name}
            onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
            placeholder={`Default: ${driver.account_name || form.name || "driver name"}`}
          />
        </div>

        <div className="field">
          <label>Discord</label>
          <input value={form.discord}
            onChange={e => setForm(f => ({ ...f, discord: e.target.value }))}
            placeholder="Username — how the league reaches this driver" />
        </div>

        {!gamesLoaded ? <div className="skeleton" style={{ height: 96, marginTop: 8 }} /> : <>
        <div className="field" style={{ marginTop: 8 }}>
          <label style={{ display: "block" }}>Name In Each Game</label>
          <p style={hint}>
            Takes over everywhere inside that game — standings, results, stats, records and roster.
            Pick the game; the name goes with it.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {gameNames.map((g, i) => {
              const taken = takenGameIds(i);
              return (
                <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <select
                    value={g.game_id}
                    onChange={e => setGameName(i, { game_id: e.target.value })}
                    style={{ flex: "0 0 38%", minWidth: 130 }}
                  >
                    <option value="">Select a game…</option>
                    {games.filter(gm => gm.id === g.game_id || !taken.has(gm.id))
                      .map(gm => <option key={gm.id} value={gm.id}>{gm.name}</option>)}
                  </select>
                  <input
                    value={g.name}
                    onChange={e => setGameName(i, { name: e.target.value })}
                    placeholder="Name they race under there"
                    style={{ flex: 1, minWidth: 110 }}
                  />
                  <button type="button" className="btn btn-ghost" title="Remove this game name"
                    style={{ marginTop: 0, padding: "4px 10px", color: "var(--ink-2)" }}
                    onClick={() => removeGameName(i)}>✕</button>
                </div>
              );
            })}
          </div>
          <button type="button" className="btn btn-ghost" style={{ marginTop: 8, padding: "4px 12px" }} onClick={addGameName}>
            ＋ Add game
          </button>
        </div>

        {/* Shared with the player's own sign-up and profile pages, so a driver
            is described the same way whoever fills it in — see AliasEditor. */}
        <AliasEditor aliases={accountRows} onChange={setAccountRows} games={games} />
        </>}

        <div className="field" style={{ marginTop: 8 }}>
          <label>Notes</label>
          <input value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
        </div>

        {driver.linked && (
          <p style={{ margin: "10px 0 0", fontSize: "0.8rem", color: "var(--ink-2)" }}>
            Linked to a player account — with no display name above, that account&rsquo;s name is used.
          </p>
        )}
        {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save Changes"}</button>
        <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={onClose} disabled={busy}>Cancel</button>
      </form>
    </Modal>
  );
}
