"use client";

import Link from "next/link";
import { useState } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { DISCORD_INVITE_URL } from "@/components/DiscordCallout";
import { messagesChanged, useMessages } from "@/components/MessagesProvider";
import { api } from "@/lib/api";
import {
  adminNote, awaitingAdmin, messageActions, messageBody, messageKind, messageTitle,
  messageTone, openPlayerMessages, playerInbox, replies, unreadByPlayer,
} from "@/lib/messages";

// The player's message board, across the top of the Dashboard.
//
// Everything an admin does TO somebody now says so here: a sign-up approved or
// denied, a car number granted or refused, a driver profile linked, a removal
// from a season's roster. Before this, an admin's decision was a state change
// on a document and nothing else — the queue emptied and the player was left to
// infer what had happened from a roster they might not think to look at. Being
// *removed* from a season was the worst of them: entirely silent, and the one
// most likely to be read as the app losing their entry.
//
// It runs both ways. Every card has a reply box, and a reply lands in the
// admins' Approvals queue — so "why was I turned down?" reaches somebody
// instead of being asked into the void. That's the halves of the conversation:
// players ask in Approvals' inbox, admins answer here.
//
// Unread cards sit at the top, opened. Everything already dealt with folds away
// into "Earlier messages" rather than disappearing, because the record of what
// was decided and what was said about it is worth keeping.

// Where each kind of message points. A decision that doesn't tell you what to
// do next is only half of one — an approval should land you on the schedule, a
// denial back on the form.
const ACTIONS = {
  schedule: { href: "/schedule", label: "📅 See your series schedule" },
  calendar: { href: "/calendar", label: "🗓️ League calendar" },
  signups: { href: "/signups", label: "📝 Go to Sign-ups" },
  myseries: { href: "/signups", label: "📝 Your series" },
  profile: { href: "/profile", label: "👤 Your profile" },
};

export function MessageBoard() {
  const { rows, reload } = useMessages();
  const inbox = playerInbox(rows);
  if (!inbox.length) return null;

  // Open at the top: news they haven't read, plus any question of their own
  // still waiting on an admin. Everything settled folds away below.
  const open = openPlayerMessages(inbox);
  const openIds = new Set(open.map(m => m.id));
  const earlier = inbox.filter(m => !openIds.has(m.id));

  return (
    <div className="msg-board">
      {open.map(msg => (
        <MessageCard key={msg.id} msg={msg} reload={reload}
          unread={unreadByPlayer(msg)} waiting={awaitingAdmin(msg)} />
      ))}

      {earlier.length > 0 && (
        <details className="msg-earlier">
          <summary>
            <span className="msg-earlier-caret" aria-hidden="true">▸</span>
            Earlier messages from the league
            <span className="msg-earlier-count">{earlier.length}</span>
          </summary>
          <div className="msg-earlier-body">
            {earlier.map(msg => <MessageCard key={msg.id} msg={msg} reload={reload} />)}
          </div>
        </details>
      )}
    </div>
  );
}

function MessageCard({ msg, reload, unread = false, waiting = false }) {
  const league = useLeague();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(null);
  // The reply box stays out of the way until it's wanted: most cards are read
  // and closed, and a permanently open text area on every one of them turns
  // good news into a form to fill in.
  const [replying, setReplying] = useState(false);

  const kind = messageKind(msg);
  const tone = messageTone(msg);
  const note = adminNote(msg);
  const thread = replies(msg);
  const actions = messageActions(msg);
  const isWelcome = kind === "signup_approved";
  const leagueName = league?.league?.name || "the league";

  async function markRead() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/messages/${msg.id}`, { method: "PATCH" });
      await reload();
      messagesChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function send(e) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/messages/${msg.id}`, { method: "POST", body: { body } });
      setDraft("");
      setReplying(false);
      await reload();
      messagesChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`msg-card msg-${tone}${unread ? " msg-unread" : ""}`}
      aria-labelledby={`msg-${msg.id}`}>
      <span className="msg-icon" aria-hidden="true">
        {isWelcome ? "🎉" : tone === "good" ? "✅" : tone === "bad" ? "✋" : "📣"}
      </span>

      <div className="msg-body">
        <h3 id={`msg-${msg.id}`}>{messageTitle(msg)}</h3>
        {messageBody(msg) && <p className="msg-sub">{messageBody(msg)}</p>}

        {/* The admin's own words attached to the decision — the reason for a
            denial, the note on why somebody came off a roster. This is the part
            players actually want, so it gets its own block rather than being
            folded into a sentence. */}
        {note && (
          <blockquote className="msg-note">
            <span className="msg-note-label">From the admins:</span>{note}
          </blockquote>
        )}

        {actions.length > 0 && (
          <div className="msg-actions">
            {actions.map(a => (a === "discord" ? (
              <a key="discord" className="btn msg-discord" href={DISCORD_INVITE_URL}
                target="_blank" rel="noopener noreferrer">
                Join the Discord ↗<span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : ACTIONS[a] ? (
              <Link key={a} href={ACTIONS[a].href} className="btn btn-primary">
                {ACTIONS[a].label}
              </Link>
            ) : null))}
          </div>
        )}

        {isWelcome && (
          <p className="msg-foot">
            Join the Discord if you haven&rsquo;t already — that&rsquo;s where race nights are
            called. Enjoy your time at {leagueName}!
          </p>
        )}

        {thread.length > 0 && (
          <ol className="msg-thread">
            {thread.map(r => (
              <li key={r.id} className={`msg-reply msg-reply-${r.side}`}>
                <span className="msg-reply-who">
                  {r.side === "admin" ? `${r.name} (league admin)` : "You"}
                </span>
                <p>{r.body}</p>
              </li>
            ))}
          </ol>
        )}

        {/* Said in words, not by leaving the card sitting there looking odd:
            they've asked something and it hasn't been answered yet. */}
        {waiting && (
          <p className="msg-waiting">⏳ Sent to the admins — they&rsquo;ll answer here.</p>
        )}

        {error && <p className="field-error">{error}</p>}

        {replying ? (
          <form className="msg-reply-form" onSubmit={send}>
            <label className="sr-only" htmlFor={`reply-${msg.id}`}>Your reply</label>
            <textarea id={`reply-${msg.id}`} rows={3} value={draft} maxLength={2000}
              placeholder="Ask a question, or tell the admins what changed…"
              onChange={e => setDraft(e.target.value)} />
            <div className="msg-reply-actions">
              <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()}>
                {busy ? "Sending…" : "Send to the admins"}
              </button>
              <button type="button" className="btn btn-ghost" disabled={busy}
                onClick={() => { setReplying(false); setDraft(""); }}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="msg-card-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setReplying(true)}>
              💬 {thread.length ? "Reply again" : "Reply to the admins"}
            </button>
            {/* Cleared by a deliberate press, not by the page happening to
                load. A notice that puts itself away before it has been taken in
                is worse than none. */}
            {unread && (
              <button type="button" className="btn btn-ghost msg-dismiss" disabled={busy}
                onClick={markRead}>
                {busy ? "…" : "Got it"}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
