"use client";

import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { useLeague } from "@/components/LeagueProvider";
import { useMySignups } from "@/components/MySignupsProvider";
import { rowInScope } from "@/lib/carSelection";

// The Dashboard's "Series Information" section — a scoped shortcut, not a menu
// of its own, so it only takes up room when it has something to say. Joining a
// series has its own sidebar item now (Sign-ups, app/signups); this card sends
// a player there when that's what's outstanding, and to My Series when what's
// outstanding is a car to lock in.
//
// It shows ACTIVE seasons only, in the scope the page is already on. A season
// an admin marked complete is gone from here AND from /series-info behind it —
// the API drops them (see /api/users/me/series), so a series whose seasons have
// all finished disappears from the flow entirely. Series Information is about
// what a player still has to do; finished racing lives on Standings and Stats.
// The season's own page still opens from a direct link and still says
// "Season over".
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
  // refetch. The payload itself is loaded once for the whole app — see
  // components/MySignupsProvider.jsx — so this card, the Sign-ups screen and the
  // badge on its nav item all read one answer.
  const { gameId, seriesId } = useLeague();
  const { data } = useMySignups();

  if (loading || !user || !data) return null;

  // A concrete Series wins; above it, the selected Game; above that,
  // everything — see rowInScope in lib/carSelection.js.
  const inScope = row => rowInScope(row, { gameId, seriesId });

  const needsDriver = !data.driver;
  // Running seasons only. The API already drops finished ones from my_seasons;
  // re-checking `open` here costs nothing and keeps a stale cached response
  // from putting a season that ended since the last load back on the page.
  const openSeasons = data.my_seasons.filter(s => s.open && s.requires_car && inScope(s));
  const signups = data.open_signups.filter(inScope);
  const toPick = openSeasons.filter(s => s.needs_pick).length;

  // Nothing to answer and nothing to join in this scope — stay out of the way.
  // A player with no driver profile still sees it when there's something to
  // join: signing up is how they get one, so the card sends them to Sign-ups.
  if (!openSeasons.length && !signups.length) return null;

  // Where the card goes. Anything about JOINING — a player with no driver
  // profile, or nothing to answer but a season open to sign up for — belongs on
  // the Sign-ups menu, which walks a first-timer through it. A car still to
  // lock in is answered on My Series, so that's where the card points instead.
  const href = needsDriver || (!toPick && !openSeasons.length) ? "/signups" : "/series-info";

  return (
    <>
      <div className="section-header" style={{ marginTop: 28 }}>
        <h3>Series Information</h3>
      </div>
      <Link href={href} className="series-info-card">
        <span className="series-info-icon" aria-hidden="true">{href === "/signups" ? "📝" : "🚗"}</span>
        <span className="series-info-body">
          <strong>
            {needsDriver
              ? "Sign up for a series to get started"
              : toPick
                ? `Lock in your car — ${toPick} season${toPick === 1 ? "" : "s"} waiting on you`
                : openSeasons.length
                  ? "Your car selections"
                  : "Sign up for a series"}
          </strong>
          <span>
            {needsDriver
              ? "Pick a series, fill in a short form, and an admin puts you on the grid."
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
