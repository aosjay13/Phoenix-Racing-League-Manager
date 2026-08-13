"use client";

// The "Aliases / Connected Accounts" editor — the platform usernames one racer
// goes by across games. Shared by the admin's Driver Edit dialog and the
// player's own series sign-up dialog, so a driver describes themselves the same
// way whoever is filling it in. The rules live in lib/aliases.js.
//
// `required` / `suggested` are label lists a particular context insists on or
// asks for — an iRacing sign-up needs the driver's customer ID before the
// league can invite them (see lib/signupRequest.js). A required row is marked,
// can't be removed, and is flagged while it's still blank.
export function AliasEditor({
  aliases, onChange, games = [], disabled = false,
  required = [], suggested = [], showHelp = true, showLabel = true,
}) {
  const requiredLabels = new Set(required.map(r => String(r.label ?? r).toLowerCase()));
  const suggestedLabels = new Set(suggested.map(s => String(s).toLowerCase()));

  const set = (i, patch) => onChange(rows => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => onChange(rows => [...rows, { label: "", value: "", game_id: "", is_display: false }]);
  const remove = i => onChange(rows => rows.filter((_, j) => j !== i));

  // Pick which alias is the on-track display name for a given game. Marks row i
  // as the display alias and clears the flag on every other alias mapped to the
  // same game, so each game has exactly one display alias.
  function setDisplayAlias(i) {
    onChange(rows => {
      const gid = rows[i].game_id;
      return rows.map((r, j) => (r.game_id === gid ? { ...r, is_display: j === i } : r));
    });
  }

  // How many aliases are mapped to each game — used to show the "display"
  // chooser only where there's an actual choice (2+ aliases sharing one game).
  const gameCounts = aliases.reduce((m, a) => {
    if (a.game_id) m[a.game_id] = (m[a.game_id] || 0) + 1;
    return m;
  }, {});

  return (
    <div className="field" style={{ marginTop: 8 }}>
      {/* Off where the caller already titles the section — a card headed
          "Connected Accounts" doesn't want the same words again under it. */}
      {showLabel && <label style={{ display: "block" }}>Aliases / Connected Accounts</label>}
      {showHelp && (
        <p style={{ margin: "0 0 8px", fontSize: "0.78rem", color: "var(--ink-2)" }}>
          Platform usernames this driver races under. The Smart Importer matches imported names against
          all of these, so results using any of them map back to this profile. Mapping an alias to a
          <strong> Game</strong> also makes it that game&rsquo;s display name as a fallback — but a name set
          under <strong>Display Names</strong> always wins. When more than one alias is mapped to
          the same game, use <strong>Display</strong> to pick which one is the fallback.
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {aliases.map((a, i) => {
          const key = String(a.label ?? "").toLowerCase();
          const isRequired = requiredLabels.has(key);
          const isSuggested = suggestedLabels.has(key);
          const blank = !String(a.value ?? "").trim();
          return (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <input
                value={a.label} disabled={disabled || isRequired}
                onChange={e => set(i, { label: e.target.value })}
                placeholder="Platform"
                style={{ flex: "0 0 30%", minWidth: 90 }}
              />
              <input
                value={a.value} disabled={disabled}
                onChange={e => set(i, { value: e.target.value })}
                className={isRequired && blank ? "is-invalid" : undefined}
                aria-invalid={(isRequired && blank) || undefined}
                placeholder={isRequired ? "Required" : isSuggested ? "Recommended" : "Username / ID"}
                style={{ flex: 1, minWidth: 100 }}
              />
              <select
                value={a.game_id || ""} disabled={disabled}
                onChange={e => set(i, { game_id: e.target.value, is_display: false })}
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
                  <input type="radio" name={`display-${a.game_id}`} disabled={disabled}
                    checked={!!a.is_display} onChange={() => setDisplayAlias(i)} />
                  Display
                </label>
              ) : null}
              {isRequired ? (
                <span className="alias-required" title="This series can't take your sign-up without it">required</span>
              ) : (
                <button type="button" className="btn btn-ghost" title="Remove field" disabled={disabled}
                  style={{ marginTop: 0, padding: "4px 10px", color: "var(--ink-2)" }}
                  onClick={() => remove(i)}>✕</button>
              )}
            </div>
          );
        })}
      </div>
      <button type="button" className="btn btn-ghost" disabled={disabled}
        style={{ marginTop: 8, padding: "4px 12px" }} onClick={add}>
        ＋ Add platform
      </button>
    </div>
  );
}
