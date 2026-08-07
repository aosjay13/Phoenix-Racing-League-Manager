"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { DriverLinkGate } from "@/components/DriverLinkGate";
import { api } from "@/lib/api";

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
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState(null);
  const [joinClasses, setJoinClasses] = useState({});   // season id -> class id ("" = none)
  const [joinNumbers, setJoinNumbers] = useState({});   // season id -> car number

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

  async function signUp(season) {
    setBusyId(season.season_id);
    try {
      const classId = joinClasses[season.season_id] || "";
      const res = await api("/api/users/me/series", {
        method: "POST",
        body: {
          season_id: season.season_id,
          class_ids: classId ? [classId] : [],
          number: joinNumbers[season.season_id] || "",
        },
      });
      await load();
      showToast("success", res.already_entered
        ? `You were already on ${season.season_name}'s roster.`
        : `You're signed up for ${season.series_name} · ${season.season_name}.`);
    } catch (err) { showToast("error", err.message); }
    finally { setBusyId(null); }
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

  if (!data.driver) {
    return (
      <section>
        {header}
        <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.9rem", maxWidth: 640 }}>
          Sign up for a series and lock in the car you&rsquo;ll race — all from here.
        </p>
        <DriverLinkGate pendingClaim={data.pending_claim} onLinked={load} />
      </section>
    );
  }

  return (
    <section>
      {header}
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.9rem", maxWidth: 660 }}>
        The series you&rsquo;re racing, the car you&rsquo;ve locked in for each, and anything still open
        to sign up for. Only seasons that are upcoming or under way can be joined or changed.
      </p>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

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
                {!s.open && (
                  <span>
                    <span className="list-row-meta-label">Season</span>
                    <span className="list-row-meta-value">Complete</span>
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

      <div className="section-header" style={{ marginTop: 26 }}>
        <h3>Open Sign-ups</h3>
      </div>
      {data.open_signups.length === 0 ? (
        <p style={{ fontSize: "0.85rem", color: "var(--ink-2)" }}>
          Nothing open right now — every upcoming season already has you on it.
        </p>
      ) : (
        <div className="signup-grid">
          {data.open_signups.map(s => (
            <div className="form-card signup-card" key={s.season_id}>
              <h3 style={{ marginTop: 0 }}>{s.series_name}</h3>
              <p style={{ margin: "0 0 10px", color: "var(--ink-2)", fontSize: "0.82rem" }}>
                {s.season_name}{s.game_name ? ` · ${s.game_name}` : ""}
                {s.requires_car && (
                  <> · <span style={{ color: "var(--accent-cyan)" }}>
                    car lock-in required{s.car_count ? ` (${s.car_count} to choose from)` : ""}
                  </span></>
                )}
              </p>
              {s.classes.length > 0 && (
                <div className="field">
                  <label>Class</label>
                  <select value={joinClasses[s.season_id] ?? ""}
                    onChange={e => setJoinClasses(m => ({ ...m, [s.season_id]: e.target.value }))}>
                    <option value="">Decide later / unclassified</option>
                    {s.classes.map(c => (
                      <option key={c.id} value={c.id}>{c.car ? `${c.name} · ${c.car}` : c.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field">
                <label>Car Number (optional)</label>
                <input type="text" inputMode="numeric" maxLength={3}
                  value={joinNumbers[s.season_id] ?? ""}
                  onChange={e => setJoinNumbers(m => ({ ...m, [s.season_id]: e.target.value }))}
                  placeholder="e.g. 07" />
              </div>
              <button className="btn btn-primary" type="button" disabled={busyId === s.season_id}
                onClick={() => signUp(s)}>
                {busyId === s.season_id ? "Signing up…" : "Sign Up"}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
