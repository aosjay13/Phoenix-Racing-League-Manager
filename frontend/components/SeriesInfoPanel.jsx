"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useLeague } from "@/components/LeagueProvider";
import { rowInScope } from "@/lib/carSelection";
import { api } from "@/lib/api";

// The Dashboard's "Series Information" section — deliberately NOT a sidebar
// item, so it only takes up room when it has something to say.
//
// It shows ACTIVE seasons only, in the scope the page is already on. Finished
// seasons are left out entirely: the Dashboard is about what to do next, and a
// league's back catalogue of completed seasons stacking up here just buries the
// one season that actually wants an answer. They're still on /series-info,
// which lists everything and says "Season over — sign-ups are done" against
// each, and on the season's own screen.
//
// So it renders for a signed-in player when, WITHIN the selected scope, either:
//   • they're on the roster of a running season that requires a car lock-in, or
//   • there's a season open to sign up for.
// Otherwise it renders nothing and the Dashboard looks as it always has.
export function SeriesInfoPanel() {
  const { user, loading } = useAuth();
  // The same Game ▸ Series selection the rest of the Dashboard follows, so this
  // section is about the series you're looking at rather than every series you
  // have ever raced. /api/users/me/series answers league-wide and the filtering
  // happens here, which means changing the dropdown re-scopes instantly with no
  // refetch.
  const { gameId, seriesId } = useLeague();
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

  // A concrete Series wins; above it, the selected Game; above that,
  // everything — see rowInScope in lib/carSelection.js.
  const inScope = row => rowInScope(row, { gameId, seriesId });

  const needsDriver = !data.driver;
  // Running seasons only — `open` is false for anything an admin has marked
  // complete.
  const openSeasons = data.my_seasons.filter(s => s.open && s.requires_car && inScope(s));
  const signups = data.open_signups.filter(inScope);
  const toPick = openSeasons.filter(s => s.needs_pick).length;

  // Nothing to answer and nothing to join in this scope — stay out of the way.
  // A player with no driver profile still sees it when there's something to
  // join, since linking is the first step of doing so.
  if (!openSeasons.length && !signups.length) return null;

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
                  ? `${openSeasons.length} active season${openSeasons.length === 1 ? "" : "s"} ${openSeasons.length === 1 ? "asks" : "ask"} you to choose a car`
                  : null,
                signups.length ? `${signups.length} season${signups.length === 1 ? "" : "s"} open for sign-up` : null,
              ].filter(Boolean).join(" · ") || "See what your series needs from you"}
          </span>
        </span>
        {toPick > 0 && <span className="series-info-badge">{toPick}</span>}
        <span className="series-info-go" aria-hidden="true">→</span>
      </Link>

      {/* The running seasons themselves, one row each, so the common case —
          "which car did I pick for Season 4?" — is answered without a click. */}
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
