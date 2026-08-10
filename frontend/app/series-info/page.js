"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { DriverLinkGate } from "@/components/DriverLinkGate";
import { SeriesSignupModal } from "@/components/SeriesSignupModal";
import { sortRosterByNumber } from "@/lib/carSelection";
import { api } from "@/lib/api";

// One season a player can join. Its own card, because the car number needs
// checking against that season's roster as it's typed and the roster has to sit
// next to the field doing the checking.
//
// The roster shown here is the PUBLIC one — no admin controls, no account
// details, just who's racing under which number — and it's listed in car-number
// order rather than alphabetically, because the question being asked of it is
// "which numbers are gone?".
function SignupCard({ season, onOpen, blockedReason }) {
  const roster = sortRosterByNumber(season.roster || []);
  const numbered = roster.filter(r => String(r.number ?? "").trim());

  return (
    <div className="form-card signup-card">
      <h3 style={{ marginTop: 0 }}>{season.series_name}</h3>
      <p style={{ margin: "0 0 10px", color: "var(--ink-2)", fontSize: "0.82rem" }}>
        {season.season_name}{season.game_name ? ` · ${season.game_name}` : ""}
        {season.requires_car && (
          <> · <span style={{ color: "var(--accent-cyan)" }}>
            car lock-in required{season.car_count ? ` (${season.car_count} to choose from)` : ""}
          </span></>
        )}
      </p>

      {/* The series roster, so a driver can see what's taken before they even
          open the form. Listed by number, not alphabetically. */}
      <details className="roster-peek" open={roster.length > 0 && roster.length <= 8}>
        <summary>
          Series roster — {numbered.length} number{numbered.length === 1 ? "" : "s"} taken
          {roster.length !== numbered.length && ` · ${roster.length} driver${roster.length === 1 ? "" : "s"}`}
        </summary>
        {roster.length === 0 ? (
          <p className="roster-peek-empty">Nobody has signed up yet — every number is free.</p>
        ) : (
          <ul className="roster-peek-list">
            {roster.map((r, i) => (
              <li key={`${r.number ?? ""}-${r.name}-${i}`}>
                <span className="badge">{String(r.number ?? "").trim() || "—"}</span>
                <span className="roster-peek-name">{r.name}</span>
                {r.class_names?.length > 0 && (
                  <span className="roster-peek-class">{r.class_names.join(" · ")}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </details>

      {blockedReason
        ? <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--ink-2)" }}>{blockedReason}</p>
        : (
          <button className="btn btn-primary" type="button" onClick={() => onOpen(season)}>
            Sign Up
          </button>
        )}
    </div>
  );
}

// "My Active Series" — reached from the Dashboard's Series Information card
// rather than the sidebar, because it's only ever relevant to a signed-in
// player with something to answer.
//
// Three things live here, in the order a player meets them:
//   1. The driver-linking gate. Nothing below it works until the account points
//      at a driver profile, so it replaces the rest of the page rather than
//      sitting alongside it (see components/DriverLinkGate.jsx).
//   2. The series they're on the roster of, with the car they've locked in for
//      each — click through to change it.
//   3. Sign-ups: seasons still to run that they're not on yet.
//
// A season an admin has marked completed never appears as a sign-up, and shows
// as closed in the list — its roster and its cars are history.
export default function SeriesInfoPage() {
  const { user, loading } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  // The season whose sign-up dialog is open. Sign-up is a dialog rather than an
  // inline form because it collects the driver's whole identity, not just a
  // number — see components/SeriesSignupModal.jsx.
  const [signingUp, setSigningUp] = useState(null);

  const load = useCallback(() => {
    if (!user) { setData(null); return; }
    return api("/api/users/me/series")
      .then(res => { setData(res); setError(null); })
      .catch(err => { setError(err.message); setData(null); });
  }, [user]);

  useEffect(() => { load(); }, [load]);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }

  // The dialog did the writing (or filed the request); this just closes it and
  // says what happened.
  async function afterSignup({ requested, season, already_entered }) {
    setSigningUp(null);
    await load();
    showToast("success", requested
      ? `Request sent for ${season.series_name} · ${season.season_name}. An admin will review it and you'll be added to the roster once they approve.`
      : already_entered
        ? `You were already on ${season.season_name}'s roster.`
        : `You're signed up for ${season.series_name} · ${season.season_name}.`);
  }

  if (loading) return <div className="skeleton" style={{ height: 240 }} />;

  if (!user) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon">🚗</span>
        <p>Sign in to see your series and lock in your car.</p>
        <Link href="/login" className="btn btn-primary">Sign In</Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon">⚠</span>
        <p>Couldn&rsquo;t load your series.</p>
        <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: "0 0 12px" }}>{error}</p>
        <button className="btn btn-primary" onClick={load}>Retry</button>
      </div>
    );
  }

  if (!data) return <div className="skeleton" style={{ height: 240 }} />;

  const header = (
    <div className="page-title">
      <h2>Series Information</h2>
      {data.driver && <span className="page-badge">Racing as {data.driver.name}</span>}
    </div>
  );

  // A player with no driver profile yet still gets the sign-up list: signing up
  // IS how they ask to be added (the dialog files a request for an admin). The
  // claim panel sits above it for the other route in — someone the league
  // already has on its books, whose race history should come with them.
  const unlinked = !data.driver;

  return (
    <section>
      {header}
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.9rem", maxWidth: 660 }}>
        {unlinked
          ? "Sign up for a series and lock in the car you'll race — all from here. You're not in the league's driver list yet, so your first sign-up goes to an admin to approve."
          : "The series you're racing, the car you've locked in for each, and anything still open to sign up for. Only seasons that are upcoming or under way can be joined or changed."}
      </p>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      {unlinked && <DriverLinkGate pendingClaim={data.pending_claim} onLinked={load} />}

      {!unlinked && (
      <>
      <div className="section-header" style={{ marginTop: 22 }}>
        <h3>My Series</h3>
      </div>
      {data.my_seasons.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">🏁</span>
          <p>You&rsquo;re not on any season&rsquo;s roster yet.</p>
          <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: 0 }}>
            Anything open to join is listed below.
          </p>
        </div>
      ) : (
        <div className="list-rows">
          {data.my_seasons.map(s => (
            <Link key={s.season_id} href={`/series-info/${s.season_id}`}
              className={`list-row${s.open ? "" : " is-closed"}`}>
              {s.logo_url
                ? <img src={s.logo_url} alt="" className="avatar" style={{ borderRadius: 6 }} />
                : <span className="avatar avatar-fallback" style={{ borderRadius: 6 }}>{s.open ? "🏆" : "🏁"}</span>}
              <span className="list-row-name">
                <strong>{s.series_name} · {s.season_name}</strong>
                <span>
                  {[s.game_name, s.class_names.join(", "), s.number != null && s.number !== "" ? `#${s.number}` : null]
                    .filter(Boolean).join(" · ") || "—"}
                </span>
              </span>
              <span className="list-row-meta">
                {!s.open && (
                  <span style={{ minWidth: 160 }}>
                    <span className="list-row-meta-label">Season</span>
                    <span className="list-row-meta-value">Over — sign-ups are done</span>
                  </span>
                )}
                {s.picks.map(p => (
                  <span key={p.class_id || "season"}>
                    <span className="list-row-meta-label">{p.class_name || "My Car"}</span>
                    <span className="list-row-meta-value">
                      {p.car || (s.open && !p.locked ? "Choose →" : "—")}
                    </span>
                  </span>
                ))}
                {!s.requires_car && s.open && (
                  <span>
                    <span className="list-row-meta-label">Car lock-in</span>
                    <span className="list-row-meta-value">Not required</span>
                  </span>
                )}
              </span>
            </Link>
          ))}
        </div>
      )}
      </>
      )}

      <div className="section-header" style={{ marginTop: 26 }}>
        <h3>Open Sign-ups</h3>
      </div>
      {data.open_signups.length === 0 ? (
        <p style={{ fontSize: "0.85rem", color: "var(--ink-2)" }}>
          {data.closed_signups > 0
            // Says WHY nothing is open. A league whose seasons have all been
            // marked complete should read as "sign-ups are done", not as an
            // empty list that looks like something failed to load.
            ? <>Nothing open — {data.closed_signups === 1 ? "the other season is" : `all ${data.closed_signups} other seasons are`}{" "}
                marked complete, so those sign-ups are done. A new season will show up here once an
                admin creates one.</>
            : <>Nothing open right now — every upcoming season already has you on it.</>}
        </p>
      ) : (
        <div className="signup-grid">
          {data.open_signups.map(s => (
            <SignupCard key={s.season_id} season={s} onOpen={setSigningUp}
              // One open request at a time: filing a second while the first is
              // still with an admin would only be refused by the API.
              blockedReason={unlinked && data.pending_claim
                ? "You already have a request with the admins — you can sign up for more series once it's approved."
                : ""} />
          ))}
        </div>
      )}

      {signingUp && (
        <SeriesSignupModal
          season={signingUp}
          driver={data.driver}
          onClose={() => setSigningUp(null)}
          onDone={afterSignup}
        />
      )}
    </section>
  );
}
