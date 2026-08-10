"use client";

import { useEffect, useState } from "react";
import { NEW_DRIVER_KIND, requestKind } from "@/lib/signupRequest";
import { api } from "@/lib/api";

// The pre-requisite for everything on the Series Information screens: a player
// account has to be attached to a driver profile from the global roster before
// they can be on a roster or lock in a car, because the car is stored on that
// driver's roster entry.
//
// Both ways through go to an admin — a driver profile is never created or
// linked automatically:
//
//   1. Claim an existing profile — you're already in the league's driver list
//      because your results have been entered. Approving hands over that
//      driver's whole race history.
//   2. Ask to be added as a new driver — you're genuinely new. Approving
//      creates the profile from what you submit here.
//
// Both file into the same queue (/api/claim-requests), reviewed on
// Drivers ▸ User Accounts. Signing up for a series does the same thing with the
// season attached, so a new player can do it in one step — see
// components/SeriesSignupModal.jsx.
//
// `onLinked` fires once a request has been filed, so the caller can reload.
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
    const asking = requestKind(pendingClaim) === NEW_DRIVER_KIND;
    return (
      <div className="form-card">
        <h3 style={{ marginTop: 0 }}>Waiting on an admin</h3>
        <p style={{ color: "var(--ink-1)", fontSize: "0.9rem", margin: 0 }}>
          {asking
            ? <>You&rsquo;ve asked to be added as <strong>{pendingClaim.driver_name}</strong>.</>
            : <>You&rsquo;ve asked to claim <strong>{pendingClaim.driver_name}</strong>.</>}
          {pendingClaim.signup?.season_name
            ? <> Once an admin approves it you&rsquo;ll be on <strong>{pendingClaim.signup.series_name} · {pendingClaim.signup.season_name}</strong>&rsquo;s roster and can pick your car.</>
            : <> As soon as an admin approves it, your series and car selections show up here.</>}
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

  // Files a request — deliberately creates nothing. Only an admin approving it
  // on Drivers ▸ User Accounts makes the driver profile exist.
  async function requestDriver(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true); setError(null);
    try {
      await api("/api/claim-requests", {
        method: "POST",
        body: { kind: NEW_DRIVER_KIND, driver_name: newName.trim(), aliases: [] },
      });
      setNotice(`Request sent to add ${newName.trim()} as a driver. An admin will review it.`);
      onLinked?.();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="form-card">
      <h3 style={{ marginTop: 0 }}>Link your driver profile</h3>
      <p style={{ color: "var(--ink-1)", fontSize: "0.9rem", marginTop: 0 }}>
        Rosters and car choices are recorded against a <strong>driver</strong>, not an account. If
        you&rsquo;ve raced in this league before you&rsquo;re already in the list below — claim
        yourself and your race history comes with you. Either way an admin reviews it before
        anything is linked.
      </p>
      <p style={{ color: "var(--ink-2)", fontSize: "0.82rem", marginTop: 0 }}>
        Brand new? You can skip this and just <strong>sign up for a series</strong> below — the
        sign-up form asks for the same details and goes to the same admins.
      </p>

      <div className="tab-row" style={{ marginTop: 0, marginBottom: 14 }}>
        <button type="button" className={`tab${mode === "claim" ? " active" : ""}`} onClick={() => setMode("claim")}>
          I&rsquo;m already on the roster
        </button>
        <button type="button" className={`tab${mode === "create" ? " active" : ""}`} onClick={() => setMode("create")}>
          I&rsquo;m new — ask to be added
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
        <form onSubmit={requestDriver}>
          <div className="field">
            <label>The name you race under</label>
            <input required value={newName} onChange={e => setNewName(e.target.value)} maxLength={60}
              placeholder="e.g. J. May" />
            <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
              This asks the league admins to add you as a driver — nothing is created until one of
              them approves it. If you already know which series you want, sign up for it instead:
              that form asks for your platform usernames too, so an admin can approve everything at
              once.
            </span>
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy || !newName.trim()}>
            {busy ? "Sending…" : "Send Request to Admins"}
          </button>
        </form>
      )}
    </div>
  );
}
