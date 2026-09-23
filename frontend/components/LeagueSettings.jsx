"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useLeague } from "@/components/LeagueProvider";
import { ImageUpload } from "@/components/ImageUpload";
import { api } from "@/lib/api";
import {
  canEditDiscordUrl, discordLabel, discordUrlProblem, normalizeDiscordUrl,
} from "@/lib/discordInvite";

// League Settings + Create League. Lives at the top of League Setup (/admin).
// Renaming and migrating are Owner-only both here (UI gating) and on the
// server (withOwner) — Admins/Moderators/Statisticians see the active league
// read-only. Before the containment migration has run there are no leagues, so
// the Owner is shown a one-click "Initialize" that creates the default league
// and stamps league_id onto all existing data.
//
// Creating a league is free for the APPLICATION Owner only, so the form lives
// here for them. The Owner of any other league pays like everybody else, from
// the Start a League page (/leagues/new), and is pointed there instead. The
// server decides either way; see POST /api/leagues and lib/billing.js.
export function LeagueSettings() {
  const { role, isGlobalOwner } = useAuth();
  const isOwner = role === "owner";
  // The Discord invite is the one setting here an Admin may change without
  // being the Owner — it expires and gets regenerated, and the banner calling it
  // mandatory shouldn't be able to go stale waiting on one person. See
  // lib/discordInvite.js.
  const canSetDiscord = canEditDiscordUrl(role);
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

            {/* Outside the form above, not nested in it: the two have different
                floors (Owner vs Admin) and so need their own save buttons, and
                a form inside a form is invalid markup anyway. */}
            <DiscordInviteField league={active} canEdit={canSetDiscord}
              onSaved={reloadLeagues} onResult={flash} />
          </div>

          {/* Create a new league: free for the application Owner. */}
          {isGlobalOwner && (
            <div className="form-card" style={{ maxWidth: "100%" }}>
              <h3 style={{ marginTop: 0 }}>Create League</h3>
              <p style={{ color: "var(--ink-2)", fontSize: "0.82rem", marginTop: -4 }}>
                Spins up a fresh, empty environment — no games, seasons, or drivers — that you&apos;ll be
                switched into as its Owner. Nobody else carries over: this league&apos;s Admins and
                Moderators have no standing in the new one until you give them a role there. Free for
                you as the application Owner; anyone else pays to start a league from
                the <Link href="/leagues/new">Start a League</Link> page.
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

          {/* The Owner of some other league starts another the same way anyone does. */}
          {isOwner && !isGlobalOwner && (
            <div className="form-card" style={{ maxWidth: "100%" }}>
              <h3 style={{ marginTop: 0 }}>Start Another League</h3>
              <p style={{ color: "var(--ink-2)", fontSize: "0.82rem", marginTop: -4 }}>
                Each league is its own separate environment with its own staff. Starting another one
                is a one-time payment.
              </p>
              <Link href="/leagues/new" className="btn btn-primary">Start a League</Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── One league's Discord invite ────────────────────────────────────────────
//
// The link behind "Discord is mandatory to race in this league" on the Sign-ups
// screen, and behind the Join the Discord button on a player's message board.
// It used to be a constant in the code, which meant every league on the
// installation invited its players into the first league's server. It is a
// per-league setting now, and this is where it is set.
//
// Admin and up, rather than Owner like the name and logo above it: an invite
// expires and gets regenerated, so the person who can fix a dead link should be
// anybody who runs the league. Everyone else sees the current link, read-only —
// worth showing rather than hiding, because "which Discord does this league
// point at?" is a fair question for a Moderator to be able to answer.
//
// Clearing the box is a real answer, not a no-op: it stores "no Discord", and
// the callout and the button then disappear rather than pointing somewhere
// wrong. The one thing it must not do is silently fall back to another league's
// server — see lib/discordInvite.js.
function DiscordInviteField({ league, canEdit, onSaved, onResult }) {
  const saved = league?.discord_url || "";
  const [value, setValue] = useState(saved);
  const [busy, setBusy] = useState(false);

  // Re-seed when the active league changes, or after a save lands.
  useEffect(() => { setValue(saved); }, [league?.id, saved]);

  const problem = discordUrlProblem(value);
  // A save is only worth offering when it would actually change something.
  const dirty = normalizeDiscordUrl(value) !== normalizeDiscordUrl(saved)
    || (!value.trim() && !!saved);

  async function save(e) {
    e.preventDefault();
    if (!league?.id || problem) return;
    setBusy(true);
    try {
      await api(`/api/leagues/${league.id}`, {
        method: "PATCH",
        body: { discord_url: value.trim() },
      });
      await onSaved?.();
      onResult?.("success", value.trim()
        ? `Discord invite saved for ${league.name || "this league"}.`
        : `Discord invite cleared — ${league.name || "this league"} no longer shows a Discord link.`);
    } catch (err) {
      onResult?.("error", err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) {
    return (
      <div className="field" style={{ marginTop: 18 }}>
        <label>Discord Invite</label>
        {saved ? (
          <a href={saved} target="_blank" rel="noopener noreferrer"
            style={{ color: "var(--accent-cyan)", fontWeight: 600, fontSize: "0.9rem" }}>
            {discordLabel(saved)} ↗
          </a>
        ) : (
          <p style={{ margin: 0, color: "var(--ink-2)", fontSize: "0.85rem" }}>
            No Discord set for this league.
          </p>
        )}
        <p style={{ margin: "4px 0 0", color: "var(--ink-2)", fontSize: "0.8rem" }}>
          An Admin or the Owner of this league can change this.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={save} style={{ marginTop: 18, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
      <div className="field" style={{ marginTop: 0 }}>
        <label htmlFor="league-discord">Discord Invite</label>
        <input
          id="league-discord"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="https://discord.gg/your-invite"
          aria-invalid={problem ? "true" : undefined}
        />
        <p style={{ margin: "2px 0 0", color: problem ? "var(--accent-red)" : "var(--ink-2)", fontSize: "0.8rem" }}>
          {problem || (
            <>
              This league&rsquo;s own Discord. It&rsquo;s the link behind &ldquo;Discord is mandatory
              to race in this league&rdquo; on Sign-ups and the Join the Discord button on a
              player&rsquo;s messages. Leave it empty and neither appears —
              better than sending your players to another league&rsquo;s server.
            </>
          )}
        </p>
      </div>
      <button className="btn btn-primary" type="submit" disabled={busy || !!problem || !dirty}>
        {busy ? "Saving…" : "Save Discord Invite"}
      </button>
    </form>
  );
}
