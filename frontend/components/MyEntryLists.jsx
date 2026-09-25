"use client";

import { useAuth } from "@/components/AuthProvider";
import { EntryListRows } from "@/components/EntryList";
import { useMySignups } from "@/components/MySignupsProvider";
import { joinedSeasons, standingLabel } from "@/lib/entryList";

// The Dashboard's "Entry Lists" section: one row for every running series this
// player has joined — on the roster, or signed up and waiting — each opening
// the full field in a dialog.
//
// It renders NOTHING for anybody who hasn't joined a series. The list is for
// the drivers in it; somebody still deciding has the Sign-ups screen, and the
// API refuses them the list itself anyway (see lib/entryList.js).
//
// Unlike Series Information above it, this doesn't narrow to the Game ▸ Series
// dropdowns. A player is in a handful of series at most, and a list of the
// people they're racing shouldn't vanish because the Dashboard happened to
// open on a different series.
export function MyEntryLists() {
  const { user, loading } = useAuth();
  const { data } = useMySignups();

  if (loading || !user || !data) return null;
  const seasons = joinedSeasons(data);
  if (!seasons.length) return null;

  return (
    <>
      <div className="section-header" style={{ marginTop: 28 }}>
        <h3>Entry Lists</h3>
      </div>
      <p style={{ margin: 0, color: "var(--ink-2)", fontSize: "0.82rem" }}>
        Who else is signed up for your series — numbers, classes, teams and cars.
      </p>
      <EntryListRows
        seasons={seasons}
        sub={s => [s.game_name, standingLabel(s)].filter(Boolean).join(" · ")}
      />
    </>
  );
}
