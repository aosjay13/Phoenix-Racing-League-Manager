"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useLeague } from "@/components/LeagueProvider";
import { ImageUpload } from "@/components/ImageUpload";
import { api } from "@/lib/api";

// League Settings + Create League. Lives at the top of League Setup (/admin).
// Renaming/creating/migrating are Owner-only both here (UI gating) and on the
// server (withOwner) — Admins/Moderators/Statisticians see the active league
// read-only. Before the containment migration has run there are no leagues, so
// the Owner is shown a one-click "Initialize" that creates the default league
// and stamps league_id onto all existing data.
export function LeagueSettings() {
  const { role } = useAuth();
  const isOwner = role === "owner";
  const league = useLeague();
  const { leagues, leagueId, league: active, switchLeague, reloadLeagues } = league || {};

  const [name, setName] = useState("");
  const [logo, setLogo] = useState("");
  const [newName, setNewName] = useState("");
  const [newLogo, setNewLogo] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    setName(active?.name || "");
    setLogo(active?.logo_url || "");
  }, [active?.id, active?.name, active?.logo_url]);

  function flash(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }

  async function saveSettings(e) {
    e.preventDefault();
    if (!leagueId) return;
    setBusy(true);
    try {
      await api(`/api/leagues/${leagueId}`, { method: "PATCH", body: { name: name.trim(), logo_url: logo || null } });
      await reloadLeagues?.();
      flash("success", "League settings saved.");
    } catch (err) { flash("error", err.message); }
    finally { setBusy(false); }
  }

  async function createLeague(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const created = await api("/api/leagues", { method: "POST", body: { name: newName.trim(), logo_url: newLogo || null } });
      setNewName(""); setNewLogo("");
      await reloadLeagues?.();
      switchLeague?.(created.id);      // jump into the fresh, empty environment
      flash("success", `Created “${created.name}”. You're now in its empty environment.`);
    } catch (err) { flash("error", err.message); }
    finally { setBusy(false); }
  }

  async function runMigration() {
    setBusy(true);
    try {
      const res = await api("/api/admin/leagues/migrate", { method: "POST" });
      await reloadLeagues?.();
      if (res.league?.id) switchLeague?.(res.league.id);
      // The account half of the migration is the part somebody will want
      // confirmed out loud: it is what keeps every existing admin an admin now
      // that roles are held per league.
      const members = res.members ?? 0;
      flash("success", `Data contained into “${res.league?.name}”. Stamped ${res.total} record${res.total === 1 ? "" : "s"}`
        + (members ? `, and carried ${members} account${members === 1 ? "'s role" : "s' roles"} over to it.` : "."));
    } catch (err) { flash("error", err.message); }
    finally { setBusy(false); }
  }

  const hasLeagues = !!(leagues && leagues.length);

  return (
    <div style={{ marginBottom: 8 }}>
      <h3 className="setup-section-title">
        League
        <span className="setup-section-hint">The top of the hierarchy — each league is its own isolated environment</span>
      </h3>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      {/* Pre-migration: no leagues yet. Owner runs the one-time containment. */}
      {!hasLeagues && (
        <div className="form-card" style={{ maxWidth: "100%" }}>
          <h3 style={{ marginTop: 0 }}>Set up multi-league</h3>
          <p style={{ color: "var(--ink-1)", fontSize: "0.9rem" }}>
            Your existing games, seasons, drivers, races and stats aren&apos;t assigned to a league yet.
            Initializing creates your first league (<strong>Prodigy Racing Association</strong>) and safely
            files every existing record under it — nothing is deleted or changed, only tagged. You can rename
            the league afterward.
          </p>
          <p style={{ color: "var(--ink-1)", fontSize: "0.9rem" }}>
            It also carries every existing account&apos;s <strong>role</strong> over to that league. Roles are
            held per league now, so this is what keeps your current Owners, Admins, Moderators and
            Statisticians exactly as they are — nobody is demoted, and nobody has to be re-added. A league
            you create later starts with no staff but you.
          </p>
          {isOwner ? (
            <button className="btn btn-primary" disabled={busy} onClick={runMigration}>
              {busy ? "Working…" : "Initialize & contain existing data"}
            </button>
          ) : (
            <p style={{ color: "var(--ink-2)", fontSize: "0.85rem" }}>Only the league Owner can run this.</p>
          )}
        </div>
      )}

      {hasLeagues && (
        <div className="two-col" style={{ marginTop: 14 }}>
          {/* Active league settings */}
          <div className="form-card" style={{ maxWidth: "100%" }}>
            <h3 style={{ marginTop: 0 }}>League Settings</h3>
            <p style={{ color: "var(--ink-2)", fontSize: "0.82rem", marginTop: -4 }}>
              Editing <strong>{active?.name || "the active league"}</strong>. Switch leagues from the
              dropdown in the top bar.
            </p>
            {isOwner ? (
              <form onSubmit={saveSettings}>
                <div className="field"><label>League Name</label>
                  <input required value={name} onChange={e => setName(e.target.value)} placeholder="Prodigy Racing Association" />
                </div>
                <ImageUpload label="League Logo" kind="league-logo" value={logo} onUploaded={setLogo} />
                <button className="btn btn-primary" type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save League Settings"}
                </button>
              </form>
            ) : (
              <div className="field"><label>League Name</label>
                <input value={active?.name || ""} disabled readOnly /></div>
            )}
          </div>

          {/* Create a new league (Owner-only) */}
          {isOwner && (
            <div className="form-card" style={{ maxWidth: "100%" }}>
              <h3 style={{ marginTop: 0 }}>Create League</h3>
              <p style={{ color: "var(--ink-2)", fontSize: "0.82rem", marginTop: -4 }}>
                Spins up a fresh, empty environment — no games, seasons, or drivers — that you&apos;ll be
                switched into as its Owner. Nobody else carries over: this league&apos;s Admins and
                Moderators have no standing in the new one until you give them a role there. Only Owners
                can create leagues.
              </p>
              <form onSubmit={createLeague}>
                <div className="field"><label>New League Name</label>
                  <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Apex Touring Car Club" />
                </div>
                <ImageUpload label="League Logo" kind="league-logo" value={newLogo} onUploaded={setNewLogo} />
                <button className="btn btn-primary" type="submit" disabled={busy || !newName.trim()}>
                  {busy ? "Creating…" : "Create League"}
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
