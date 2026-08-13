"use client";

import { useCallback, useEffect, useState } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { api } from "@/lib/api";
import {
  additionDetail, additionsTitle, groupBySeason, pendingElsewhere, pendingElsewhereTitle,
} from "@/lib/rosterAdditions";
import { markRosterSeen, ROSTER_SEEN_EVENT } from "@/lib/rosterAlerts";

// The two strips at the top of Admin ▸ Driver Roster, which between them fix
// the same blind spot at opposite ends of the sign-up process.
//
// The roster screen is scoped to ONE season — the one the dropdowns are on.
// That's right for working on it, and wrong for hearing about anything else:
//
//   • a sign-up WAITING in another season never appeared at all, so an admin
//     sitting on Season 3 had no way of knowing two people were queued for
//     Season 4 short of steering the menus at every season in turn;
//   • an APPROVED sign-up landed on that other season's roster and the queue
//     emptied, so there was nothing left on screen to say it had happened, or
//     where.
//
// Both strips therefore say the same three things: who, which roster, and a
// button that steers the scope menus at it.

// Steer the Game / Series / Season menus at one season. Set parent-first: each
// tier re-fetches its children and keeps a selection that's valid under the new
// parent, so all three land together.
function useOpenRoster() {
  const league = useLeague();
  return useCallback(group => {
    if (group.game_id) league.setGameId(group.game_id);
    if (group.series_id) league.setSeriesId(group.series_id);
    if (group.season_id) league.setSeasonId(group.season_id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [league]);
}

// One season's worth of people, with the button that goes there.
function SeasonGroup({ group, onOpen, cta }) {
  return (
    <div className="roster-news-group">
      <div className="roster-news-group-head">
        <span>
          <strong>{group.series_name} · {group.season_name}</strong>
          {group.game_name ? <span className="roster-news-game"> {group.game_name}</span> : null}
        </span>
        {/* One button per roster, not per driver: one trip settles everyone who
            joined (or is waiting for) that season. */}
        <button type="button" className="btn btn-primary roster-news-go" onClick={() => onOpen(group)}>
          {cta}
        </button>
      </div>
      <ul className="roster-news-list">
        {group.drivers.map(d => {
          const detail = additionDetail(d);
          return (
            <li key={d.id}>
              <span className="badge">{d.number || "—"}</span>
              <span className="roster-news-name">{d.name}</span>
              {detail && <span className="roster-news-detail">{detail}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// "3 drivers added to 2 rosters since you last looked" — the panel the sidebar
// badge points at.
//
// Marking it read is a deliberate button, not something opening the screen
// does: an admin who glances at the page on their way somewhere else hasn't
// read it, and a notification that clears itself before it's been taken in is
// worse than none.
export function RosterAdditions({ additions }) {
  const openRoster = useOpenRoster();
  if (!additions.length) return null;

  return (
    <div className="roster-news">
      <div className="roster-news-head">
        <span className="roster-news-icon" aria-hidden="true">🎉</span>
        <div>
          <strong>{additionsTitle(additions)} since you last looked</strong>
          <span>
            These sign-ups have been approved, so they&rsquo;re already on the roster — this is
            just so you know where they landed.
          </span>
        </div>
        <button type="button" className="btn btn-ghost roster-news-dismiss" onClick={markRosterSeen}>
          Got it
        </button>
      </div>
      {groupBySeason(additions).map(g => (
        <SeasonGroup key={g.season_id || `${g.series_name}-${g.season_name}`}
          group={g} onOpen={openRoster} cta="Open this roster →" />
      ))}
    </div>
  );
}

// "2 sign-ups waiting in 1 other season" — the same idea for the queue.
//
// It fetches the league-wide queue itself rather than being handed it, because
// the panel underneath deliberately asks for one season's worth: that panel is
// where sign-ups are approved, and approving from a list spanning every season
// is how you approve somebody onto the wrong one.
export function RosterPendingElsewhere({ seasonId }) {
  const [rows, setRows] = useState([]);
  const openRoster = useOpenRoster();

  const load = useCallback(() => {
    api("/api/admin/signup-requests")
      .then(r => setRows(Array.isArray(r) ? r : []))
      .catch(() => setRows([]));
  }, []);

  useEffect(() => {
    load();
    // Approving or denying one fires this, so the strip shrinks as the queue is
    // worked rather than going stale behind the panel that's working it.
    window.addEventListener(ROSTER_SEEN_EVENT, load);
    return () => window.removeEventListener(ROSTER_SEEN_EVENT, load);
  }, [load]);

  const groups = pendingElsewhere(rows, seasonId);
  if (!groups.length) return null;

  return (
    <div className="roster-news is-waiting">
      <div className="roster-news-head">
        <span className="roster-news-icon" aria-hidden="true">⏳</span>
        <div>
          <strong>{pendingElsewhereTitle(groups)}</strong>
          <span>
            Waiting on you, but not in the season below — the queue under this only covers the
            season you&rsquo;re scoped to. Open one to review it there.
          </span>
        </div>
      </div>
      {groups.map(g => (
        <SeasonGroup key={g.season_id || `${g.series_name}-${g.season_name}`}
          group={g} onOpen={openRoster} cta="Review these →" />
      ))}
    </div>
  );
}
