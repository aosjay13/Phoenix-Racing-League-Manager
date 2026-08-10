"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { DriverLinkGate } from "@/components/DriverLinkGate";
import { SignupForm } from "@/components/SignupForm";
import { api } from "@/lib/api";

// The "Open Sign-ups" panel: a selector listing only the seasons still open to
// join, and the sign-up form for whichever is picked.
//
// A selector rather than a wall of cards because the form under it is long — it
// renders whatever the admin asked that series for — and showing several at once
// buried the one being filled in. Completed seasons never reach this list; the
// API leaves them out.
function OpenSignups({ seasons, driver, onDone }) {
  const [seasonId, setSeasonId] = useState(seasons[0]?.season_id ?? "");
  const chosen = seasons.find(s => s.season_id === seasonId) ?? seasons[0] ?? null;

  // A season can drop off the list (approved, or marked complete) while it's
  // the one selected — fall back rather than showing an empty panel.
  useEffect(() => {
    if (!seasons.some(s => s.season_id === seasonId)) setSeasonId(seasons[0]?.season_id ?? "");
  }, [seasons, seasonId]);

  if (!chosen) return null;

  return (
    <div className="form-card" style={{ maxWidth: "100%" }}>
      <div className="field">
        <label htmlFor="signup_season">Choose a series to sign up for</label>
        <select id="signup_season" value={chosen.season_id} onChange={e => setSeasonId(e.target.value)}>
          {seasons.map(s => (
            <option key={s.season_id} value={s.season_id}>
              {s.series_name} · {s.season_name}{s.game_name ? ` (${s.game_name})` : ""}
            </option>
          ))}
        </select>
        <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
          {seasons.length} season{seasons.length === 1 ? "" : "s"} open. Completed seasons aren&rsquo;t
          listed — those sign-ups are done.
        </span>
      </div>

      {chosen.my_pending ? (
        <div className="signup-approval-note" style={{ marginBottom: 0 }}>
          <strong>Your sign-up for this season is with the admins.</strong> You&rsquo;ll be on the
          official roster as soon as one of them approves it. Pick another series above to sign up
          for that one too.
        </div>
      ) : (
        // Keyed by season so switching series starts the form clean rather than
        // carrying the last one's number and car across.
        <SignupForm key={chosen.season_id} season={chosen} driver={driver} onDone={onDone} />
      )}
    </div>
  );
}

export default function SeriesInfoPage() {
  const { user, loading } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

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

  // Every sign-up goes to the pending queue — nobody reaches the official
  // roster without an admin approving it, so this always says "waiting".
  async function afterSignup({ season }) {
    await load();
    showToast("success",
      `Sign-up submitted for ${season.series_name} · ${season.season_name}. An admin will review it, `
      + "and you'll be on the roster once they approve.");
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
      {/* Running seasons only. A season an admin marked complete is dropped by
          the API, so a finished series simply isn't here — its results live on
          Standings and Stats, which is where finished racing belongs. */}
      {data.my_seasons.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">🏁</span>
          <p>Nothing running right now.</p>
          <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: 0 }}>
            Seasons you&rsquo;ve finished aren&rsquo;t listed here — see <Link href="/standings" style={{ color: "var(--accent-cyan)" }}>Standings</Link>{" "}
            for those. Anything open to join is below.
          </p>
        </div>
      ) : (
        <div className="list-rows">
          {data.my_seasons.map(s => (
            <Link key={s.season_id} href={`/series-info/${s.season_id}`} className="list-row">
              {s.logo_url
                ? <img src={s.logo_url} alt="" className="avatar" style={{ borderRadius: 6 }} />
                : <span className="avatar avatar-fallback" style={{ borderRadius: 6 }}>🏆</span>}
              <span className="list-row-name">
                <strong>{s.series_name} · {s.season_name}</strong>
                <span>
                  {[s.game_name, s.class_names.join(", "), s.number != null && s.number !== "" ? `#${s.number}` : null]
                    .filter(Boolean).join(" · ") || "—"}
                </span>
              </span>
              <span className="list-row-meta">
                {s.picks.map(p => (
                  <span key={p.class_id || "season"}>
                    <span className="list-row-meta-label">{p.class_name || "My Car"}</span>
                    <span className="list-row-meta-value">
                      {p.car || (p.locked ? "—" : "Choose →")}
                    </span>
                  </span>
                ))}
                {!s.requires_car && (
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
        <OpenSignups seasons={data.open_signups} driver={data.driver} onDone={afterSignup} />
      )}
    </section>
  );
}
