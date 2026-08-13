"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { findDuplicateCandidates } from "@/lib/driverMerge";
import { driverNames } from "@/lib/driverMatch";

// The Drivers cleanup bench: find the duplicate profiles the league already
// has, and fold them together without losing a single race.
//
// The app asks before creating a driver now (see lib/driverMatch.js), so new
// duplicates are rare. The ones that remain are older — made before that check
// existed, or waved through by an admin who didn't recognise an in-game name —
// and they're the ones that quietly break the standings, because one person's
// season is split across two profiles and neither total is right.
//
// So this screen does the searching. It lists the pairs that look like the
// same human, through every name each of them answers to; one click loads a
// pair into the merge, and the merge always shows what it is about to do
// before it does it.

function nameSummary(driver, games) {
  const names = driverNames(driver, games).slice(1);   // [0] is the profile name itself
  if (!names.length) return "No other names on file";
  return names.map(n => `${n.value} (${n.label})`).join(" · ");
}

// One side of the merge: a searchable picker over the whole driver pool.
function DriverPicker({ id, label, hint, pool, games, value, otherId, onChange }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const options = useMemo(() => {
    const list = pool.filter(d => d.id !== otherId);
    if (!q) return list.slice(0, 60);
    return list
      .filter(d => driverNames(d, games).some(n => n.value.toLowerCase().includes(q)))
      .slice(0, 60);
  }, [pool, otherId, q, games]);
  const chosen = pool.find(d => d.id === value) || null;

  return (
    <div className="field" style={{ margin: 0, minWidth: 240, flex: 1 }}>
      <label htmlFor={id}>{label}</label>
      {pool.length > 10 && (
        <input value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search every name they go by…" style={{ marginBottom: 6 }} />
      )}
      <select id={id} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Choose a driver…</option>
        {options.map(d => (
          <option key={d.id} value={d.id}>{d.name}{d.user_id ? " · linked account" : ""}</option>
        ))}
      </select>
      {chosen
        ? <span style={{ fontSize: "0.76rem", color: "var(--ink-2)" }}>{nameSummary(chosen, games)}</span>
        : <span style={{ fontSize: "0.76rem", color: "var(--ink-2)" }}>{hint}</span>}
    </div>
  );
}

export function DriverMergeTool() {
  const [pool, setPool] = useState(null);
  const [games, setGames] = useState({});
  const [fromId, setFromId] = useState("");     // the duplicate — stops existing
  const [intoId, setIntoId] = useState("");     // the primary — survives
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);

  const load = useCallback(async () => {
    const [drivers, gameList] = await Promise.all([
      api("/api/drivers").catch(() => []),
      api("/api/games").catch(() => []),
    ]);
    setPool(drivers);
    setGames(Object.fromEntries(gameList.map(g => [g.id, g.name])));
  }, []);

  useEffect(() => { load(); }, [load]);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 6000);
  }

  // The pairs worth a look. Pure, and computed from the pool already loaded —
  // no extra request, and it re-runs after a merge so a pair that has just
  // been cleaned up leaves the list.
  //
  // Deliberately in an effect rather than inline: comparing every driver
  // against every other through every name each answers to is real work on a
  // league with hundreds of them, and doing it during render would hold the
  // screen blank while it ran. This way the tool paints immediately and says
  // it's looking.
  const [suggestions, setSuggestions] = useState(null);
  useEffect(() => {
    if (!pool) return;
    setSuggestions(null);
    const timer = setTimeout(() => setSuggestions(findDuplicateCandidates(pool, { games, limit: 40 })), 0);
    return () => clearTimeout(timer);
  }, [pool, games]);
  const shown = showAllSuggestions ? (suggestions || []) : (suggestions || []).slice(0, 6);

  const duplicate = (pool || []).find(d => d.id === fromId) || null;
  const primary = (pool || []).find(d => d.id === intoId) || null;
  const ready = !!fromId && !!intoId && fromId !== intoId;

  // Preview whenever both sides are chosen. The server answers with what the
  // merge WOULD do, from the same code that would do it — so what the admin
  // approves is what runs.
  useEffect(() => {
    if (!ready) { setPreview(null); return; }
    let live = true;
    setPreview(null);
    setError(null);
    setPreviewing(true);
    api("/api/admin/drivers/merge", { method: "POST", body: { from_id: fromId, into_id: intoId, dry_run: true } })
      .then(p => { if (live) setPreview(p); })
      .catch(err => { if (live) setError(err.message); })
      .finally(() => { if (live) setPreviewing(false); });
    return () => { live = false; };
  }, [fromId, intoId, ready]);

  function swap() {
    setFromId(intoId);
    setIntoId(fromId);
  }

  async function merge() {
    if (!ready || !preview) return;
    const moving = preview.entries + preview.trial_entries;
    if (!confirm(
      `Merge “${duplicate?.name}” into “${primary?.name}”?\n\n` +
      `${moving} race/session entr${moving === 1 ? "y" : "ies"} move onto ${primary?.name}, ` +
      `keeping every result attached to them. “${duplicate?.name}” is then removed and kept as a ` +
      `former name, so imports listing it find ${primary?.name} instead.\n\nThis can't be undone from here.`
    )) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api("/api/admin/drivers/merge", {
        method: "POST", body: { from_id: fromId, into_id: intoId },
      });
      const moved = (res.entries_moved || 0) + (res.trial_entries_moved || 0);
      setFromId(""); setIntoId(""); setPreview(null);
      await load();
      showToast("success",
        `Merged into “${primary?.name}” — ${moved} entr${moved === 1 ? "y" : "ies"} moved${
          res.carried?.length ? `, carrying ${res.carried.join(", ")}` : ""}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!pool) return <div className="skeleton" style={{ height: 220 }} />;

  return (
    <>
      <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.9rem", lineHeight: 1.55 }}>
        One human racer, two profiles, is the one mistake this app can&rsquo;t undo cheaply: half their
        season is filed under each, so neither their stats nor the standings are right. Merging puts
        it back. Pick the <strong>duplicate</strong> and the <strong>primary</strong> below — every
        race, result, point and lap moves onto the primary, its own details win wherever the two
        disagree, and the names the duplicate raced under are kept so the next import finds this
        driver instead of re-creating it.
      </p>

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      {suggestions === null && (
        <p style={{ fontSize: "0.85rem", color: "var(--ink-2)" }}>
          Checking {pool.length} driver{pool.length === 1 ? "" : "s"} against each other for duplicates…
        </p>
      )}

      {suggestions?.length === 0 && (
        <p style={{ fontSize: "0.85rem", color: "var(--ink-1)" }}>
          ✓ No obvious duplicates — no two profiles in the pool answer to a similar name. You can
          still merge any pair by hand below.
        </p>
      )}

      {suggestions?.length > 0 && (
        <div className="bonus-panel">
          <div className="bonus-panel-title">
            Possible duplicates — {suggestions.length} pair{suggestions.length === 1 ? "" : "s"} worth a look
          </div>
          <p className="bonus-panel-note" style={{ marginTop: 4 }}>
            Found by checking every driver against every other through <em>every</em> name each one
            answers to — profile names, display names, in-game names, connected accounts and former
            names. Suggestions only: two people with similar names is ordinary, so nothing here
            merges until you say so.
          </p>
          <div className="list-rows" style={{ marginTop: 10 }}>
            {shown.map(pair => (
              <div key={pair.key} className="list-row">
                <div className="list-row-name">
                  <strong>{pair.primary.name} ← {pair.duplicate.name}</strong>
                  <span>
                    {pair.reason}
                    {pair.via ? ` · found through their ${pair.via}` : ""}
                  </span>
                </div>
                <div className="list-row-actions">
                  <span className={`page-badge${pair.confidence === "possible" ? " is-muted" : ""}`}>
                    {pair.confidence === "exact" ? "Same name" : pair.confidence === "strong" ? "Very close" : "Worth checking"}
                  </span>
                  <button type="button" className="btn btn-ghost" style={{ marginTop: 0 }}
                    onClick={() => { setIntoId(pair.primary.id); setFromId(pair.duplicate.id); }}>
                    Review this pair
                  </button>
                </div>
              </div>
            ))}
          </div>
          {suggestions.length > shown.length && (
            <button type="button" className="btn btn-ghost" style={{ marginTop: 10 }}
              onClick={() => setShowAllSuggestions(true)}>
              Show all {suggestions.length}
            </button>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap", marginTop: 16 }}>
        <DriverPicker
          id="merge_from" label="Duplicate (this profile is removed)"
          hint="The spare profile — usually the one with barely any history on it."
          pool={pool} games={games} value={fromId} otherId={intoId} onChange={setFromId} />
        <button type="button" className="btn btn-ghost" style={{ marginTop: 22 }} disabled={!fromId && !intoId}
          title="Swap which profile survives" onClick={swap}>
          ⇄ Swap
        </button>
        <DriverPicker
          id="merge_into" label="Primary (this profile survives)"
          hint="The profile to keep — its name, account and details win."
          pool={pool} games={games} value={intoId} otherId={fromId} onChange={setIntoId} />
      </div>

      {ready && previewing && <div className="skeleton" style={{ height: 90, marginTop: 14 }} />}

      {ready && preview && (
        <div className="bonus-panel">
          <div className="bonus-panel-title">What this merge will do</div>
          <div className="bonus-panel-row">
            <span className="bonus-chip">{preview.entries} roster entr{preview.entries === 1 ? "y" : "ies"} moved</span>
            <span className="bonus-chip">{preview.trial_entries} time-trial row{preview.trial_entries === 1 ? "" : "s"} moved</span>
            <span className="bonus-chip">{preview.merged_names.length} name{preview.merged_names.length === 1 ? "" : "s"} kept</span>
          </div>
          <p className="bonus-panel-note">
            Every result attached to those entries travels with them — races, points, wins, podiums,
            championships and lap records all end up on <strong>{primary?.name}</strong>, and each
            game&rsquo;s Skill Ratings are replayed afterwards so they count the moved races.
          </p>
          {preview.carried?.length > 0 && (
            <p className="bonus-panel-note">
              Carried across from <strong>{duplicate?.name}</strong>: {preview.carried.join(", ")}.
              {" "}Anything <strong>{primary?.name}</strong> already has is left exactly as it is.
            </p>
          )}
          {preview.merged_names.length > 0 && (
            <p className="bonus-panel-note">
              Kept as former names, so an import listing one of them finds this driver rather than
              making the duplicate again: {preview.merged_names.slice(0, 8).join(", ")}
              {preview.merged_names.length > 8 ? `, +${preview.merged_names.length - 8} more` : ""}.
            </p>
          )}
          {preview.entries === 0 && preview.trial_entries === 0 && (
            <p className="bonus-panel-note" style={{ color: "var(--accent-gold)" }}>
              This duplicate has no race history at all — nothing to move. Merging still removes it
              and keeps its name on {primary?.name}.
            </p>
          )}
        </div>
      )}

      {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>⚠ {error}</p>}

      <button className="btn btn-primary" type="button" disabled={!ready || !preview || busy} onClick={merge}>
        {busy ? "Merging…" : ready && primary ? `Merge into “${primary.name}”` : "Merge Drivers"}
      </button>
      {ready && (
        <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} disabled={busy}
          onClick={() => { setFromId(""); setIntoId(""); }}>
          Clear
        </button>
      )}
    </>
  );
}
