"use client";

import { useState } from "react";
import { api } from "@/lib/api";

// "Your sign-up wasn't approved, and here's why" — the first thing on the
// Sign-ups screen for anyone an admin has turned down.
//
// A denial used to be silent. The request went to `denied` with the admin's
// reason attached, the queue emptied, and the player was told nothing at all —
// from their side indistinguishable from a sign-up that never arrived, so they
// filled in the identical form again and got denied again for the identical
// reason. An email goes out now too (see lib/mailer.js), but email may not even
// be configured, so this notice is the one that has to work.
//
// It's dismissed by a deliberate button, not by opening the screen, and until
// it is, that season is held out of the "pick a series" list below (the API
// flags it `my_denied`). That's the whole point: the reason gets read before
// the same form is filled in a second time. Pressing the button both marks it
// read AND drops them straight into the form for that series, so "fix it and
// try again" is one action rather than a hunt back through the list.
export function SignupDenials({ denials, onCleared, onRetry }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(null);

  if (!denials?.length) return null;

  async function clear(denial, retry) {
    setBusy(denial.id);
    setError(null);
    try {
      await api(`/api/signup-requests/${denial.id}`, { method: "PATCH" });
      await onCleared?.();
      if (retry) onRetry?.(denial);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="signup-denials">
      {denials.map(d => (
        <div className="signup-denial" key={d.id}>
          <div className="signup-denial-head">
            <span className="signup-denial-icon" aria-hidden="true">✋</span>
            <div className="signup-denial-title">
              <strong>Your sign-up for {d.series_name} · {d.season_name} wasn&rsquo;t approved</strong>
              <span>
                {/* What they asked for, so they can see which attempt this
                    was — someone who has tried twice needs to tell them
                    apart. */}
                {[d.number ? `#${d.number}` : "", d.car].filter(Boolean).join(" · ")
                  || "An admin turned it down."}
              </span>
            </div>
          </div>

          {/* The admin's own words, quoted. This is the whole reason the notice
              exists, so it gets its own block rather than being folded into a
              sentence. */}
          {d.reason ? (
            <blockquote className="signup-denial-reason">
              <span className="signup-denial-reason-label">Why:</span>
              {d.reason}
            </blockquote>
          ) : (
            <p className="signup-denial-noreason">
              The admin didn&rsquo;t leave a reason. Ask in the Discord if you&rsquo;re not sure
              why — they can tell you what to change.
            </p>
          )}

          <p className="signup-denial-foot">
            You can sign up again once that&rsquo;s sorted. Your details are already saved, so
            it&rsquo;s a much shorter form the second time.
          </p>

          {error && <p className="field-error">{error}</p>}

          <div className="signup-denial-actions">
            <button type="button" className="btn btn-primary" disabled={busy === d.id}
              onClick={() => clear(d, true)}>
              {busy === d.id ? "Working…" : "Got it — let me try again"}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy === d.id}
              onClick={() => clear(d, false)}>
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
