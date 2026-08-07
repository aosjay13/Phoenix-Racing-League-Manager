"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

// The pre-requisite for everything on the Series Information screens: a player
// account has to be attached to a driver profile from the global roster before
// they can sign up for a series or lock in a car, because the car is stored on
// that driver's roster entry.
//
// Two ways through, in the order a new player should try them:
//
//   1. Claim an existing profile — you're already in the league's driver list
//      because your results have been entered. This goes to an admin for
//      approval (/api/claim-requests): it hands over somebody's race history.
//   2. Add yourself as a new driver — you're genuinely new. This links straight
//      away (/api/users/me/driver), so nobody is stuck waiting to sign up. If
//      the league did already have you under another name, an admin folds the
//      two together with Drivers ▸ Merge and every result comes across.
//
// `onLinked` fires once the account is linked (or a claim has been filed), so
// the caller can reload.
export function DriverLinkGate({ onLinked, pendingClaim = null }) {
  const [pool, setPool] = useState(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [newName, setNewName] = useState("");
  const [mode, setMode] = useState("claim");   // claim | create

  useEffect(() => {
    api("/api/drivers")
      .then(list => setPool(list.filter(d => !d.user_id).sort((a, b) => String(a.name).localeCompare(String(b.name)))))
      .catch(() => setPool([]));
  }, []);

  if (pendingClaim) {
    return (
      <div className="form-card">
        <h3 style={{ marginTop: 0 }}>Waiting on an admin</h3>
        <p style={{ color: "var(--ink-1)", fontSize: "0.9rem", margin: 0 }}>
          You&rsquo;ve asked to claim <strong>{pendingClaim.driver_name}</strong>. As soon as an admin
          approves it, your series and car selections show up here.
        </p>
      </div>
    );
  }

  const matches = (pool ?? []).filter(d =>
    !query.trim() || String(d.name).toLowerCase().includes(query.trim().toLowerCase()));

  async function claim(driver) {
    setBusy(true); setError(null);
    try {
      await api("/api/claim-requests", { method: "POST", body: { driver_id: driver.id } });
      setNotice(`Claim request sent for ${driver.name}. An admin will review it.`);
      onLinked?.();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function createDriver(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true); setError(null);
    try {
      await api("/api/users/me/driver", { method: "POST", body: { name: newName.trim() } });
      setNotice(`You're now racing as ${newName.trim()}.`);
      onLinked?.();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="form-card">
      <h3 style={{ marginTop: 0 }}>First, link your driver profile</h3>
      <p style={{ color: "var(--ink-1)", fontSize: "0.9rem", marginTop: 0 }}>
        Series sign-ups and car choices are recorded against a <strong>driver</strong>, not an
        account — so your account needs to point at one before you can do either. If you&rsquo;ve
        raced in this league before you&rsquo;re already in the list below: claim yourself. If
        you&rsquo;re new, add yourself as a driver.
      </p>

      <div className="tab-row" style={{ marginTop: 0, marginBottom: 14 }}>
        <button type="button" className={`tab${mode === "claim" ? " active" : ""}`} onClick={() => setMode("claim")}>
          I&rsquo;m already on the roster
        </button>
        <button type="button" className={`tab${mode === "create" ? " active" : ""}`} onClick={() => setMode("create")}>
          I&rsquo;m new — add me
        </button>
      </div>

      {notice && <div className="toast toast-success">{notice}</div>}
      {error && <div className="toast toast-error">{error}</div>}

      {mode === "claim" ? (
        <>
          <div className="field">
            <label>Find your name</label>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Start typing…" />
            <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
              Only unclaimed profiles are listed. Claiming one goes to an admin for approval, since it
              hands over that driver&rsquo;s whole race history.
            </span>
          </div>
          {pool === null ? (
            <div className="skeleton" style={{ height: 120 }} />
          ) : matches.length === 0 ? (
            <p style={{ fontSize: "0.85rem", color: "var(--ink-2)" }}>
              No unclaimed driver matches that. If you&rsquo;re not in the list, switch to{" "}
              <strong>I&rsquo;m new — add me</strong>.
            </p>
          ) : (
            <div style={{ maxHeight: 260, overflowY: "auto" }}>
              {matches.slice(0, 50).map(d => (
                <div className="driver-row" key={d.id}>
                  <span style={{ flex: 1 }}>{d.display_name || d.name}</span>
                  <button className="btn btn-primary" type="button" disabled={busy}
                    style={{ marginTop: 0, padding: "4px 12px" }} onClick={() => claim(d)}>
                    That&rsquo;s me
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <form onSubmit={createDriver}>
          <div className="field">
            <label>The name you race under</label>
            <input required value={newName} onChange={e => setNewName(e.target.value)} maxLength={60}
              placeholder="e.g. J. May" />
            <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
              This creates a new driver in the league&rsquo;s roster and links it to your account right
              away — no waiting. If it turns out the league already had you under a different name, an
              admin can merge the two and every result comes across.
            </span>
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy || !newName.trim()}>
            {busy ? "Adding…" : "Add me as a driver"}
          </button>
        </form>
      )}
    </div>
  );
}
