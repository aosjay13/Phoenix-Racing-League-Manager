"use client";

import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { DriverLinkGate } from "@/components/DriverLinkGate";
import { useMySignups } from "@/components/MySignupsProvider";

// "My Series" — the seasons this player is ON, and what each of them still
// wants from them (a car to lock in, a number to run).
//
// JOINING a series is NOT here any more. It has its own sidebar menu — see
// app/signups — because it's the one thing a brand-new player comes to the app
// to do and it shouldn't be a section halfway down a page they'd have to know
// to look at. This screen keeps what only makes sense once you're already in,
// and links across for the rest. (A season's own screen still offers the same
// form in a dialog for somebody who arrived on it directly — it's the shared
// <SignupForm> either way, so the two can't ask for different things.)
export default function SeriesInfoPage() {
  const { user, loading } = useAuth();
  // Loaded once for the whole app (components/MySignupsProvider.jsx), so this
  // screen, Sign-ups and the sidebar badge never disagree about what a player
  // is on.
  const { data, error, reload } = useMySignups();

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
        <button className="btn btn-primary" onClick={reload}>Retry</button>
      </div>
    );
  }

  if (!data) return <div className="skeleton" style={{ height: 240 }} />;

  // A player with no driver profile yet has nothing to show here — signing up
  // is how they get one, so they're pointed at Sign-ups. The claim panel stays
  // for the other route in: someone the league already has on its books, whose
  // race history should come with them.
  const unlinked = !data.driver;
  const openToJoin = (data.open_signups || []).filter(s => !s.my_pending).length;

  return (
    <section>
      <div className="page-title">
        <h2>My Series</h2>
        {data.driver && <span className="page-badge">Racing as {data.driver.name}</span>}
      </div>
      <p className="page-intro">
        {unlinked
          ? "The series you're racing show up here once you've joined one. Head to Sign-ups to get on a grid."
          : "The series you're racing and the car you've locked in for each. Only seasons that are upcoming or under way can be changed."}
      </p>

      {/* The way in to joining, from the screen a player is most likely to be
          on when they decide they want another series. */}
      <Link href="/signups" className="series-info-card" style={{ marginTop: 16 }}>
        <span className="series-info-icon" aria-hidden="true">📝</span>
        <span className="series-info-body">
          <strong>{unlinked ? "Sign up for a series" : "Join another series"}</strong>
          <span>
            {openToJoin
              ? `${openToJoin} season${openToJoin === 1 ? "" : "s"} open to join — it takes about a minute`
              : "See what's open to join and where your sign-ups have got to"}
          </span>
        </span>
        {openToJoin > 0 && <span className="series-info-badge">{openToJoin}</span>}
        <span className="series-info-go" aria-hidden="true">→</span>
      </Link>

      {unlinked && (
        <div style={{ marginTop: 18 }}>
          <DriverLinkGate pendingClaim={data.pending_claim} onLinked={reload} />
        </div>
      )}

      {!unlinked && (
        <>
          <div className="section-header" style={{ marginTop: 22 }}>
            <h3>Seasons you&rsquo;re in</h3>
          </div>
          {/* Running seasons only. A season an admin marked complete is dropped
              by the API, so a finished series simply isn't here — its results
              live on Standings and Stats, which is where finished racing
              belongs. */}
          {data.my_seasons.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state-icon">🏁</span>
              <p>Nothing running right now.</p>
              <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: 0 }}>
                Seasons you&rsquo;ve finished aren&rsquo;t listed here — see{" "}
                <Link href="/standings" style={{ color: "var(--accent-cyan)" }}>Standings</Link>{" "}
                for those. Anything open to join is on{" "}
                <Link href="/signups" style={{ color: "var(--accent-cyan)" }}>Sign-ups</Link>.
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
    </section>
  );
}
