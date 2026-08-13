"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { messagesChanged } from "@/components/MessagesProvider";
import { useAdminMessages } from "@/lib/messageAlerts";
import { api } from "@/lib/api";
import {
  adminNote, adminThreadsNeedingReply, messageTitle, messageTone, replies, unreadByAdmin,
} from "@/lib/messages";

// The admins' side of the message board, on the Approvals screen.
//
// Approvals already answers "somebody is waiting — who, and for what?" for
// requests. This answers the same question for the conversation those requests
// start: a player replying to a decision ("I fixed the number, can I try
// again?", "why was I taken off the roster?") is waiting on a person just as
// surely as a pending sign-up is, and had nowhere to be seen before.
//
// The queue rule is deliberately the same one pending sign-ups follow: a
// player's reply is an outstanding JOB, not a notification. It stays here — and
// on the sidebar badge — until an admin answers it or explicitly marks it read.
// Longest wait first, so nobody is left at the bottom of a list forever.
export function AdminMessages() {
  const { roleLevel } = useAuth();
  const { rows, reload } = useAdminMessages(roleLevel);
  const [showAll, setShowAll] = useState(false);

  const waiting = adminThreadsNeedingReply(rows);
  const rest = rows.filter(m => !unreadByAdmin(m));

  if (!rows.length) return null;

  return (
    <section className="admin-msgs">
      <div className="section-header">
        <h3>
          Player replies
          {waiting.length > 0 && <span className="admin-msgs-badge">{waiting.length}</span>}
        </h3>
      </div>
      {waiting.length === 0 ? (
        <p className="admin-msgs-clear">✅ Nothing waiting — every player reply has been answered.</p>
      ) : (
        <>
          {/* Only worth explaining when there's something to act on. An admin
              with a clear queue doesn't need the mechanism described to them
              every time they open the page. */}
          <p className="admin-msgs-intro">
            Every decision you make lands on that player&rsquo;s Dashboard, and they can answer it
            there. Their answers arrive here, longest wait first.
          </p>
          {waiting.map(msg => <AdminThread key={msg.id} msg={msg} reload={reload} waiting />)}
        </>
      )}

      {rest.length > 0 && (
        <details className="msg-earlier" open={showAll}
          onToggle={e => setShowAll(e.currentTarget.open)}>
          <summary>
            <span className="msg-earlier-caret" aria-hidden="true">▸</span>
            Everything else you&rsquo;ve sent
            <span className="msg-earlier-count">{rest.length}</span>
          </summary>
          <div className="msg-earlier-body">
            {rest.map(msg => <AdminThread key={msg.id} msg={msg} reload={reload} />)}
          </div>
        </details>
      )}
    </section>
  );
}

function AdminThread({ msg, reload, waiting = false }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const thread = replies(msg);
  const note = adminNote(msg);

  async function send(e) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    await run(() => api(`/api/admin/messages/${msg.id}`, { method: "POST", body: { body } }));
    setDraft("");
  }

  // "Seen, nothing to say" — takes it off the queue without writing anything.
  // Without this an admin who has dealt with something in the Discord can never
  // clear the badge, and a badge that can't be cleared is one people stop
  // reading.
  async function dismiss() {
    await run(() => api(`/api/admin/messages/${msg.id}`, { method: "PATCH" }));
  }

  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
      messagesChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`admin-msg msg-${messageTone(msg)}${waiting ? " admin-msg-waiting" : ""}`}>
      <div className="admin-msg-head">
        <strong>{msg.user_name || "A player"}</strong>
        <span className="admin-msg-about">{messageTitle(msg)}</span>
      </div>

      {note && (
        <blockquote className="msg-note">
          <span className="msg-note-label">You wrote:</span>{note}
        </blockquote>
      )}

      {thread.length > 0 && (
        <ol className="msg-thread">
          {thread.map(r => (
            <li key={r.id} className={`msg-reply msg-reply-${r.side}`}>
              <span className="msg-reply-who">
                {r.side === "admin" ? `${r.name} (you)` : r.name}
              </span>
              <p>{r.body}</p>
            </li>
          ))}
        </ol>
      )}

      {error && <p className="field-error">{error}</p>}

      <form className="msg-reply-form" onSubmit={send}>
        <label className="sr-only" htmlFor={`admin-reply-${msg.id}`}>Your reply</label>
        <textarea id={`admin-reply-${msg.id}`} rows={2} value={draft} maxLength={2000}
          placeholder="Answer them — this appears on their Dashboard…"
          onChange={e => setDraft(e.target.value)} />
        <div className="msg-reply-actions">
          <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()}>
            {busy ? "Sending…" : "Send"}
          </button>
          {waiting && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={dismiss}>
              Mark read
            </button>
          )}
        </div>
      </form>
    </article>
  );
}
