"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AliasEditor } from "@/components/AliasEditor";
import { api } from "@/lib/api";
import { withDefaults } from "@/lib/aliases";

// Profile ▸ Connected Accounts — the platform usernames a player races under,
// editable by the player themselves.
//
// They were only ever reachable through a series sign-up form before this,
// which meant a driver whose Discord handle changed had no way to correct it
// short of joining another series. They live on the DRIVER PROFILE, not on the
// account (that's what results are matched against, and what a sign-up fills
// in), so this writes through PATCH /api/users/me/driver — the route that
// resolves the profile from the caller's own account, so there's no way to edit
// somebody else's. Aliases are the one field of a driver profile a player may
// write: the name, display names and notes stay admin-only, since those decide
// how the whole league sees them.
//
// It's a card of its own with its own Save, beside the account form rather than
// inside it, because the two write to different records. Saving one never
// silently rewrites the other.
export function ConnectedAccounts() {
  const [driver, setDriver] = useState(undefined);   // undefined = still loading
  const [aliases, setAliases] = useState([]);
  const [games, setGames] = useState([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    let live = true;
    api("/api/users/me/driver")
      .then(res => {
        if (!live) return;
        setDriver(res.driver);
        // Seeded with the standard platform list, so the rows to fill in are
        // named up front rather than hidden behind "＋ Add platform" — the
        // whole point is that a player can see what the league can ask them
        // for. Anything already saved comes back filled in.
        setAliases(withDefaults(res.driver?.aliases));
      })
      .catch(() => { if (live) setDriver(null); });
    api("/api/games").then(g => { if (live) setGames(g); }).catch(() => setGames([]));
    return () => { live = false; };
  }, []);

  function flash(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      // Rows left blank are dropped by the route's normalizeAliases, so
      // clearing a box is how you remove a platform.
      const res = await api("/api/users/me/driver", { method: "PATCH", body: { aliases } });
      setAliases(withDefaults(res.aliases));
      flash("success", "Connected accounts saved.");
    } catch (err) {
      flash("error", err.message);
    } finally {
      setBusy(false);
    }
  }

  if (driver === undefined) return <div className="skeleton" style={{ height: 200, marginTop: 18 }} />;

  return (
    <div className="form-card" style={{ marginTop: 18 }}>
      <h3 style={{ marginTop: 0 }}>Connected Accounts</h3>
      <p style={{ margin: "0 0 4px", fontSize: "0.86rem", lineHeight: 1.55, color: "var(--ink-1)" }}>
        The names you go by on Discord and on each platform. Two things use them: it&rsquo;s how the
        league gets hold of you about races, and it&rsquo;s how results imported under any of your
        names find their way onto your profile.
      </p>

      {/* No profile yet. Not an error — it's where every new player starts, and
          signing up for a series is what fixes it, so say that rather than
          showing a dead form. */}
      {!driver ? (
        <p style={{ margin: "10px 0 0", fontSize: "0.85rem", lineHeight: 1.55, color: "var(--ink-2)" }}>
          You haven&rsquo;t got a driver profile yet, so there&rsquo;s nothing to save these
          against. <Link href="/signups" style={{ color: "var(--accent-cyan)" }}>Sign up for a series</Link>{" "}
          — the form asks for the accounts that series needs, and an admin approving it creates
          your profile with them already filled in. They&rsquo;ll be editable here afterwards.
        </p>
      ) : (
        <form onSubmit={save}>
          <p style={{ margin: "0 0 4px", fontSize: "0.78rem", color: "var(--ink-2)" }}>
            Saved against <strong>{driver.name}</strong>. A series sign-up fills these in for you
            and keeps them current — this is where to correct one that&rsquo;s gone out of date.
            Leave a box empty to remove it.
          </p>
          <AliasEditor aliases={aliases} onChange={setAliases} games={games}
            disabled={busy} showHelp={false} showLabel={false} />
          {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save Connected Accounts"}
          </button>
        </form>
      )}
    </div>
  );
}
