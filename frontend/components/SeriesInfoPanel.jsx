"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { api } from "@/lib/api";

// The Dashboard's "Series Information" section — deliberately NOT a sidebar
// item, so it only takes up room when it has something to say.
//
// It renders for a signed-in player when either is true:
//   • they're on the roster of a season that requires a car lock-in, or
//   • there's a season open to sign up for.
// Otherwise it renders nothing at all, and the Dashboard looks exactly as it
// always has. /api/users/me/series answers both questions (and `show`) in one
// call.
export function SeriesInfoPanel() {
  const { user, loading } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!user) { setData(null); return; }
    let live = true;
    api("/api/users/me/series")
      .then(res => { if (live) setData(res); })
      .catch(() => { if (live) setData(null); });
    return () => { live = false; };
  }, [user]);

  if (loading || !user || !data) return null;

  const needsDriver = !data.driver;
  const openSeasons = data.my_seasons.filter(s => s.open && s.requires_car);
  // Nothing to ask and nothing to join — stay out of the way entirely. A player
  // with no driver profile still sees it when there's something to join, since
  // linking is the first step of doing so.
  if (!data.show) return null;

  const toPick = data.needs_pick_count;
  const signups = data.open_signups.length;

  return (
    <>
      <div className="section-header" style={{ marginTop: 28 }}>
        <h3>Series Information</h3>
      </div>
      <Link href="/series-info" className="series-info-card">
        <span className="series-info-icon" aria-hidden="true">🚗</span>
        <span className="series-info-body">
          <strong>
            {needsDriver
              ? "Link your driver profile to get started"
              : toPick
                ? `Lock in your car — ${toPick} season${toPick === 1 ? "" : "s"} waiting on you`
                : openSeasons.length
                  ? "Your car selections"
                  : "Sign up for a series"}
          </strong>
          <span>
            {needsDriver
              ? "Claim your driver from the roster (or add yourself) to sign up and pick a car."
              : [
                openSeasons.length
                  ? `${openSeasons.length} active series ${openSeasons.length === 1 ? "asks" : "ask"} you to choose a car`
                  : null,
                signups ? `${signups} season${signups === 1 ? "" : "s"} open for sign-up` : null,
              ].filter(Boolean).join(" · ") || "See what your series needs from you"}
          </span>
        </span>
        {toPick > 0 && <span className="series-info-badge">{toPick}</span>}
        <span className="series-info-go" aria-hidden="true">→</span>
      </Link>

      {/* The seasons themselves, one row each, so the common case — "which car
          did I pick for Season 4?" — is answered without a click. */}
      {openSeasons.length > 0 && (
        <div className="list-rows" style={{ marginTop: 10 }}>
          {openSeasons.map(s => (
            <Link key={s.season_id} href={`/series-info/${s.season_id}`} className="list-row">
              <span className="list-row-name">
                <strong>{s.series_name} · {s.season_name}</strong>
                <span>{s.game_name || "—"}{s.class_names.length ? ` · ${s.class_names.join(", ")}` : ""}</span>
              </span>
              <span className="list-row-meta">
                {s.picks.map(p => (
                  <span key={p.class_id || "season"}>
                    <span className="list-row-meta-label">{p.class_name || "Car"}</span>
                    <span className="list-row-meta-value">
                      {p.car || (p.locked ? "Not chosen" : "Choose →")}
                    </span>
                  </span>
                ))}
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
