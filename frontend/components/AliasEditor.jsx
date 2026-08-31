"use client";

import { aliasPlatformOptions } from "@/lib/aliases";

// The "Connected Accounts" editor — the platform usernames one racer goes by.
// Shared by the admin's Driver Edit dialog, the player's own profile and the
// series sign-up form, so a driver describes themselves the same way whoever is
// filling it in. The rules live in lib/aliases.js.
//
// A row used to be three controls: a free-typed platform, a username, and a
// dropdown pointing the row at a game. Nothing tied the first to the third, so
// "iRacing Name" could sit there mapped to BeamNG, and there was a second place
// (Display Names) where the same driver's name in the same game could be set to
// something else entirely.
//
// So the platform is a CHOICE now, and the choice carries its game with it: pick
// "iRacing Name" and the row is iRacing's, because that is what the option
// means. One control instead of two, and no way to make the two disagree.
//
// `required` / `suggested` are label lists a particular context insists on or
// asks for — an iRacing sign-up needs the driver's customer ID before the league
// can invite them (see lib/signupRequest.js). A required row is marked, can't be
// removed, and is flagged while it's still blank.
export function AliasEditor({
  aliases, onChange, games = [], disabled = false,
  required = [], suggested = [], showHelp = true, showLabel = true,
}) {
  const requiredLabels = new Set(required.map(r => String(r.label ?? r).toLowerCase()));
  const suggestedLabels = new Set(suggested.map(s => String(s).toLowerCase()));
  // Every platform on offer, including any already saved that the standard list
  // doesn't cover — a menu that quietly dropped a stored pairing would unmap the
  // row the moment anybody touched it.
  const options = aliasPlatformOptions(games, aliases);

  const set = (i, patch) => onChange(rows => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => onChange(rows => [...rows, { label: "", value: "", game_id: "", is_display: false }]);
  const remove = i => onChange(rows => rows.filter((_, j) => j !== i));

  // Picking a platform sets the label and the game together. When the platform
  // IS a game's racing name, the row also becomes that game's display alias —
  // the fallback its tables use when no per-game display name is set — and any
  // other row for that game gives the flag up, so each game has exactly one.
  function choosePlatform(i, value) {
    const opt = options.find(o => o.value === value);
    if (!opt) return;
    const racingName = !!opt.game_id && opt.label.toLowerCase().endsWith(" name");
    onChange(rows => rows.map((r, j) => {
      if (j === i) return { ...r, label: opt.label, game_id: opt.game_id, is_display: racingName || r.is_display };
      if (racingName && r.game_id === opt.game_id) return { ...r, is_display: false };
      return r;
    }));
  }

  const groups = [...new Set(options.map(o => o.group))];

  return (
    <div className="field" style={{ marginTop: 8 }}>
      {showLabel && <label style={{ display: "block" }}>Connected Accounts</label>}
      {showHelp && (
        <p style={{ margin: "0 0 8px", fontSize: "0.78rem", color: "var(--ink-2)" }}>
          Usernames this driver goes by. Results importing under any of them map back to this profile.
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {aliases.map((a, i) => {
          const key = String(a.label ?? "").toLowerCase();
          const isRequired = requiredLabels.has(key);
          const isSuggested = suggestedLabels.has(key);
          const blank = !String(a.value ?? "").trim();
          const current = `${a.label ?? ""}|${a.game_id ?? ""}`;
          return (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={current} disabled={disabled || isRequired}
                onChange={e => choosePlatform(i, e.target.value)}
                title="Which platform this username is for"
                style={{ flex: "0 0 38%", minWidth: 130 }}
              >
                {!a.label && <option value="|">Select a platform…</option>}
                {groups.map(group => (
                  <optgroup key={group} label={group}>
                    {options.filter(o => o.group === group)
                      .map(o => <option key={o.value} value={o.value}>{o.text || o.label}</option>)}
                  </optgroup>
                ))}
              </select>
              <input
                value={a.value} disabled={disabled}
                onChange={e => set(i, { value: e.target.value })}
                className={isRequired && blank ? "is-invalid" : undefined}
                aria-invalid={(isRequired && blank) || undefined}
                placeholder={isRequired ? "Required" : isSuggested ? "Recommended" : "Username / ID"}
                style={{ flex: 1, minWidth: 110 }}
              />
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
        ＋ Add account
      </button>
    </div>
  );
}
