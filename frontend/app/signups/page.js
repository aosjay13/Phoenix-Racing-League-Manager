"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { DiscordCallout } from "@/components/DiscordCallout";
import { DriverLinkGate } from "@/components/DriverLinkGate";
import { SignupDenials } from "@/components/SignupDenials";
import { SignupForm } from "@/components/SignupForm";
import { useMySignups } from "@/components/MySignupsProvider";
import {
  JOIN_STEPS, nothingToJoinHeadline, nothingToJoinReason, seasonChips, seasonLabel,
  seasonStatus, signupNeeds, signupOverview,
} from "@/lib/signupFlow";

// ── Sign-ups ───────────────────────────────────────────────────────────────
//
// The one screen a player uses to get onto a grid, and the only one in the
// sidebar written for somebody who has never used this app before.
//
// It is deliberately a WALKTHROUGH rather than a form on a page. The three
// steps of joining — pick a series, fill in the short form, wait for an admin —
// are printed at the top before anything is asked for, and the screen only ever
// shows one of them at a time: the list of series, OR the form for the one that
// was chosen, OR the "you're in the queue" confirmation. Nothing about the
// process is left to be inferred from a disabled button.
//
// What it does NOT do is decide anything itself. Which seasons are open, what
// each one asks a sign-up to carry, and whether this account already has one
// waiting all come from /api/users/me/series; the lists and counts on screen
// come from lib/signupFlow.js, which is pure and tested. Submitting still goes
// through <SignupForm> — the same component the season's own screen opens in a
// dialog — so the two ways in ask for identical things and neither can put
// anybody on a roster without an admin.
//
// The car lock-in for a season already joined lives on /series-info/[seasonId];
// this screen links to it rather than duplicating it.

// The three steps, always in the same order, with the one being worked on lit
// up. A player who lands here mid-way ("I signed up, now what?") can see where
// they are without reading anything else.
function HowItWorks({ current = 1 }) {
  return (
    <ol className="join-steps" aria-label="How joining a series works">
      {JOIN_STEPS.map(s => (
        <li key={s.step} className={`join-step${s.step === current ? " is-current" : ""}${s.step < current ? " is-done" : ""}`}>
          <span className="join-step-num" aria-hidden="true">{s.step < current ? "✓" : s.step}</span>
          <span className="join-step-body">
            <strong>{s.title}</strong>
            <span>{s.blurb}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

// One series a driver could join, as a single big button. Everything on it
// answers "is this the one I want?" — the game it's played on, how many people
// are already in, and what the form is going to ask for — so nobody has to open
// three of them to find out.
function JoinCard({ season, onJoin }) {
  const chips = seasonChips(season);
  return (
    <button type="button" className="join-card" onClick={() => onJoin(season)}>
      {season.logo_url
        ? <img src={season.logo_url} alt="" className="join-card-logo" />
        : <span className="join-card-logo join-card-logo-fallback" aria-hidden="true">🏁</span>}
      <span className="join-card-body">
        <strong>{season.series_name}</strong>
        <span className="join-card-season">{season.season_name}</span>
        <span className="join-card-chips">
          {chips.map(c => <span className="join-chip" key={c}>{c}</span>)}
        </span>
      </span>
      <span className="join-card-go">
        <span className="btn btn-primary join-card-btn">Join this series</span>
      </span>
    </button>
  );
}

// Step 2: the form for the series they picked, with a way back that doesn't
// look like a browser button, and the "here's what you'll need" list printed
// above it so nothing in the form is a surprise.
function JoinFlow({ season, driver, knownAliases, knownName, onBack, onDone }) {
  const needs = signupNeeds(season);
  return (
    <>
      <button type="button" className="btn btn-ghost join-back" onClick={onBack}>
        ← Pick a different series
      </button>

      <div className="join-hero">
        {season.logo_url
          ? <img src={season.logo_url} alt="" className="join-hero-logo" />
          : <span className="join-hero-logo join-card-logo-fallback" aria-hidden="true">🏁</span>}
        <div>
          <h3>You&rsquo;re signing up for {season.series_name}</h3>
          <p>{season.season_name}{season.game_name ? ` · ${season.game_name}` : ""}</p>
        </div>
      </div>

      <HowItWorks current={2} />

      <div className="join-needs">
        <strong>What this form asks you for</strong>
        <ul>
          {needs.map(n => (
            <li key={n.key}>
              <span className="join-needs-label">{n.label}</span>
              <span className="join-needs-detail">{n.detail}</span>
            </li>
          ))}
        </ul>
        <p className="join-needs-foot">
          Anything already saved on your profile is filled in for you — you only ever type it once.
        </p>
      </div>

      <div className="form-card join-form">
        <SignupForm key={season.season_id} season={season} driver={driver}
          knownAliases={knownAliases} knownName={knownName}
          onDone={onDone} onCancel={onBack} />
      </div>
    </>
  );
}

// Step 3. Reached only by actually submitting, so it can say plainly what
// happens next and where to look for it — a player's most common next question
// is "did that work?", and an empty page back at the list doesn't answer it.
function Submitted({ season, onJoinAnother, moreToJoin }) {
  return (
    <>
      <HowItWorks current={3} />
      <div className="join-done">
        <span className="join-done-icon" aria-hidden="true">✅</span>
        <h3>You&rsquo;re in the queue for {seasonLabel(season)}</h3>
        <p>
          That&rsquo;s everything you needed to do. Your sign-up has gone to the league&rsquo;s
          admins — as soon as one of them approves it you&rsquo;ll be on the official roster, and
          this page will say so.
        </p>
        <p className="join-done-sub">
          Nothing else is needed from you in the meantime. You don&rsquo;t have to sign up again.
        </p>
        <div className="join-done-actions">
          {moreToJoin > 0 && (
            <button type="button" className="btn btn-primary" onClick={onJoinAnother}>
              Join another series
            </button>
          )}
          <Link href="/schedule" className="btn btn-ghost">See the race schedule</Link>
        </div>
      </div>
      {/* Said again here because this is the moment it's actionable: the form
          is done, and picking your roles in Discord is what's left. */}
      <DiscordCallout variant="next" />
    </>
  );
}

export default function SignupsPage() {
  const { user, loading } = useAuth();
  const { data, error, reload } = useMySignups();
  // Which of the three steps the screen is on: a season chosen but not yet
  // submitted is step 2, a season just submitted is step 3, neither is step 1.
  const [chosenId, setChosenId] = useState("");
  const [submitted, setSubmitted] = useState(null);
  const [claiming, setClaiming] = useState(false);

  if (loading) return <div className="skeleton" style={{ height: 280 }} />;

  // Signed out. Show the whole process anyway — somebody deciding whether to
  // make an account can see what joining involves before they do.
  if (!user) {
    return (
      <section>
        <div className="page-title"><h2>Sign-ups</h2></div>
        <p className="page-intro">
          This is where you join a series. It takes about a minute.
        </p>
        <HowItWorks current={1} />
        <DiscordCallout />
        <div className="empty-state">
          <span className="empty-state-icon">🏎</span>
          <p>Sign in (or create an account) to sign up for a series.</p>
          <Link href="/login" className="btn btn-primary">Sign In</Link>
        </div>
      </section>
    );
  }

  if (error && !data) {
    return (
      <section>
        <div className="page-title"><h2>Sign-ups</h2></div>
        <div className="empty-state">
          <span className="empty-state-icon">⚠</span>
          <p>Couldn&rsquo;t load the sign-up list.</p>
          <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: "0 0 12px" }}>{error}</p>
          <button className="btn btn-primary" onClick={reload}>Try again</button>
        </div>
      </section>
    );
  }

  if (!data) return <div className="skeleton" style={{ height: 280 }} />;

  const o = signupOverview(data);
  const denials = data.denied || [];
  // A season is joinable again the moment its denial is acknowledged — until
  // then it's held back, so the reason is read before the identical form is
  // filled in a second time. `chosen` looks at the UNFILTERED list so pressing
  // "let me try again" can drop them straight into that season's form.
  const joinable = o.joinable.filter(s => !s.my_denied);
  const chosen = o.joinable.find(s => s.season_id === chosenId) || null;

  // Submitting files a PENDING request — nobody reaches a roster without an
  // admin — so the confirmation says "in the queue", never "you're in".
  // `reload` is the shared provider's own load, so the sidebar badge drops the
  // series they just joined at the same moment this screen moves to step 3 —
  // no second fetch and no window where the two disagree.
  async function afterSignup({ season }) {
    setChosenId("");
    setSubmitted(season);
    await reload();
  }

  const header = (
    <div className="page-title">
      <h2>Sign-ups</h2>
      {data.driver && <span className="page-badge">Racing as {data.driver.name}</span>}
    </div>
  );

  if (submitted) {
    return (
      <section>
        {header}
        <Submitted
          season={submitted}
          moreToJoin={o.joinable.length}
          onJoinAnother={() => setSubmitted(null)}
        />
      </section>
    );
  }

  if (chosen) {
    return (
      <section>
        {header}
        <JoinFlow season={chosen} driver={data.driver} knownAliases={data.known_aliases}
          knownName={data.known_name} onBack={() => setChosenId("")} onDone={afterSignup} />
      </section>
    );
  }

  return (
    <section>
      {header}
      <p className="page-intro">
        Everything about joining a series lives here: pick one, fill in a short form, and an admin
        puts you on the grid. You can be in as many series at once as you like.
      </p>

      <HowItWorks current={1} />

      {/* Before anything else: a sign-up an admin turned down, and why. Held at
          the top until it's acknowledged — see components/SignupDenials.jsx. */}
      <SignupDenials denials={denials} onCleared={reload}
        onRetry={d => setChosenId(d.season_id)} />

      <DiscordCallout />

      {/* The one job that can be outstanding for somebody already on a roster.
          It's a different task from joining, so it gets its own banner at the
          top rather than being buried in the list of series below. */}
      {o.carsToPick.length > 0 && (
        <div className="join-todo">
          <span className="join-todo-icon" aria-hidden="true">🚗</span>
          <div className="join-todo-body">
            <strong>
              {o.carsToPick.length === 1
                ? "One series is waiting for you to choose a car"
                : `${o.carsToPick.length} series are waiting for you to choose a car`}
            </strong>
            <span>You&rsquo;re already on the roster — this is the last thing left.</span>
          </div>
          <div className="join-todo-links">
            {o.carsToPick.map(s => (
              <Link key={s.season_id} href={`/series-info/${s.season_id}`} className="btn btn-primary">
                Choose for {s.series_name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Sent, and waiting on somebody else. Said early and plainly, because
          "did my sign-up go through?" is the question that otherwise gets asked
          by submitting a second one. */}
      {(o.waiting.length > 0 || o.pendingClaim) && (
        <>
          <div className="section-header"><h3>Waiting on an admin</h3></div>
          <div className="join-list">
            {o.pendingClaim && (
              <div className="join-status-card">
                <span className="join-status-icon" aria-hidden="true">⏳</span>
                <div className="join-status-body">
                  <strong>Your request to race as {o.pendingClaim.driver_name}</strong>
                  <span>
                    An admin is reviewing it. Once they approve it, your race history and any
                    series you&rsquo;ve signed up for show up here.
                  </span>
                </div>
              </div>
            )}
            {o.waiting.map(s => (
              <div className="join-status-card" key={s.season_id}>
                <span className="join-status-icon" aria-hidden="true">⏳</span>
                <div className="join-status-body">
                  <strong>{seasonLabel(s)}</strong>
                  <span>
                    Your sign-up has been sent. You&rsquo;ll be on the roster as soon as an admin
                    approves it — there&rsquo;s nothing else to do.
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-header" style={{ marginTop: 26 }}>
        <h3>{joinable.length ? "Pick a series to join" : "Join a series"}</h3>
      </div>

      {/* A player with no driver profile can still sign up — the form files a
          request that creates the profile when it's approved — so this is
          reassurance, not a gate. The "I've raced here before" route sits
          behind a button because it's the rarer of the two. */}
      {o.needsDriver && !o.pendingClaim && (
        <div className="join-newcomer">
          <p>
            <strong>New here? You&rsquo;re in the right place.</strong> You don&rsquo;t have to set
            anything up first — pick a series below and the form asks for everything the league
            needs. An admin creates your driver profile when they approve it.
          </p>
          {claiming ? (
            <DriverLinkGate onLinked={reload} pendingClaim={null} />
          ) : (
            <button type="button" className="btn btn-ghost" onClick={() => setClaiming(true)}>
              I&rsquo;ve raced in this league before — find my name
            </button>
          )}
        </div>
      )}

      {joinable.length === 0 ? (
        // An empty list has to say WHICH of the reasons applies — a sign-up
        // that's already in, seasons already joined, seasons finished, or a
        // league with nothing scheduled. nothingToJoinReason picks it; getting
        // it wrong reads as a page that failed to load, or worse, as a sign-up
        // that vanished.
        <div className="empty-state">
          <span className="empty-state-icon">🏁</span>
          <p>{nothingToJoinHeadline(o)}</p>
          <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: 0 }}>
            {nothingToJoinReason(o)}
          </p>
        </div>
      ) : (
        <div className="join-list">
          {joinable.map(s => (
            <JoinCard key={s.season_id} season={s} onJoin={x => setChosenId(x.season_id)} />
          ))}
        </div>
      )}

      {/* Where they already are. Each row goes to that season's own screen —
          the car lock-in and "who's racing what" grid — so this stays a summary
          rather than a second copy of it. */}
      {o.racing.length > 0 && (
        <>
          <div className="section-header" style={{ marginTop: 26 }}>
            <h3>Series you&rsquo;re racing in</h3>
          </div>
          <div className="join-list">
            {o.racing.map(s => {
              const status = seasonStatus(s);
              return (
                <Link key={s.season_id} href={`/series-info/${s.season_id}`}
                  className={`join-status-card is-link${status.tone === "todo" ? " is-todo" : ""}`}>
                  <span className="join-status-icon" aria-hidden="true">
                    {status.tone === "todo" ? "🚗" : "🏁"}
                  </span>
                  <div className="join-status-body">
                    <strong>{seasonLabel(s)}</strong>
                    <span>{status.text}</span>
                  </div>
                  <span className="join-status-go" aria-hidden="true">→</span>
                </Link>
              );
            })}
          </div>
        </>
      )}

      <p className="join-foot">
        Stuck, or signed up for the wrong one? Ask a league admin — they can see every sign-up
        waiting and sort it out from their side.
      </p>
    </section>
  );
}
