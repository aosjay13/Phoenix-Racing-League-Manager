"use client";

import Link from "next/link";
import { useState } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { DISCORD_INVITE_URL } from "@/components/DiscordCallout";
import { useMySignups } from "@/components/MySignupsProvider";
import { api } from "@/lib/api";

// "Welcome to Formula Phoenix!" — the banner across the top of the Dashboard
// the first time a player opens it after an admin approves their sign-up.
//
// Being let in was as quiet as being turned down used to be. The request left
// the queue, a roster entry appeared, and unless the player happened to open
// Sign-ups and notice their series had moved from "waiting on an admin" to
// "racing", nothing told them they were in — the one moment a league most wants
// to feel like an arrival, and it passed in silence.
//
// So it's deliberately the loudest thing on the screen, and it says what to do
// next rather than just congratulating: the schedule for their series, the
// league calendar, and the Discord (where the roles that actually get them into
// a lobby are handed out).
//
// It clears on a deliberate **Got it** rather than by being seen, the same rule
// the roster's additions panel and the denial notice follow: a welcome that
// vanishes because the page happened to load isn't a welcome. Dismissing marks
// the request read (PATCH /api/signup-requests/[id]) and it never returns.
export function WelcomeToSeries() {
  const { data, reload } = useMySignups();
  const league = useLeague();
  const [busy, setBusy] = useState("");

  const welcome = data?.welcome || [];
  if (!welcome.length) return null;

  async function dismiss(id) {
    setBusy(id);
    try {
      await api(`/api/signup-requests/${id}`, { method: "PATCH" });
      await reload();
    } catch {
      // Nothing useful to say: the banner is good news, and failing to put it
      // away is not worth an error message. It'll still be here next time.
    } finally {
      setBusy("");
    }
  }

  // The league's own name, so the sign-off greets people by the league they
  // actually joined rather than a name hard-coded into the app.
  const leagueName = league?.league?.name || "the league";

  return (
    <>
      {welcome.map(w => (
        <section className="welcome-banner" key={w.id} aria-labelledby={`welcome-${w.id}`}>
          <span className="welcome-confetti" aria-hidden="true">🎉</span>
          <div className="welcome-body">
            <h3 id={`welcome-${w.id}`}>Welcome to {w.series_name}!</h3>
            <p className="welcome-sub">
              You&rsquo;re on the roster for <strong>{w.season_name}</strong>
              {[w.number ? `#${w.number}` : "", w.car].filter(Boolean).length
                ? <> — {[w.number ? `#${w.number}` : "", w.car].filter(Boolean).join(" · ")}</>
                : null}. Here&rsquo;s where to go next.
            </p>

            <div className="welcome-actions">
              <Link href="/schedule" className="btn btn-primary">📅 See your series schedule</Link>
              <Link href="/calendar" className="btn btn-primary">🗓️ League calendar</Link>
              <a className="btn welcome-discord" href={DISCORD_INVITE_URL}
                target="_blank" rel="noopener noreferrer">
                Join the Discord ↗<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </div>

            <p className="welcome-foot">
              Join the Discord if you haven&rsquo;t already — that&rsquo;s where race nights are
              called. Enjoy your time at {leagueName}!
            </p>
          </div>

          <button type="button" className="btn btn-ghost welcome-dismiss"
            disabled={busy === w.id} onClick={() => dismiss(w.id)}>
            {busy === w.id ? "…" : "Got it"}
          </button>
        </section>
      ))}
    </>
  );
}
