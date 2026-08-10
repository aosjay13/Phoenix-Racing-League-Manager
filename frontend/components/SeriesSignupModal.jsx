"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import { AliasEditor } from "@/components/AliasEditor";
import { api } from "@/lib/api";
import { withDefaults } from "@/lib/aliases";
import { NUMBER_TAKEN_MESSAGE, carNumberTaken, sortRosterByNumber } from "@/lib/carSelection";
import {
  NEW_DRIVER_KIND, cleanSignupDriverInfo, requiredAliases, signupProblem, suggestedAliases,
} from "@/lib/signupRequest";

// The dialog behind "Sign Up" on a season. It's one form covering everything
// the league needs to put someone on a roster, which is why the button opens it
// rather than signing up on the spot:
//
//   • the name they race under and their car number (checked against the
//     season's roster as it's typed),
//   • the class, where the season runs them, and
//   • their Aliases / Connected Accounts — the platform usernames the Smart
//     Importer maps results back to this driver with. An iRacing season won't
//     take a sign-up without the driver's iRacing ID#, because a league invite
//     can't be sent without it (see lib/signupRequest.js).
//
// Where it goes depends on whether the league already knows them:
//
//   linked driver → the entry is created now, and their aliases are saved onto
//                   their profile.
//   no driver yet → NOTHING is created. The whole form is filed as a pending
//                   request for an admin to approve; adding a driver to the
//                   league is never automatic. They're told that plainly before
//                   they submit, so an approval isn't a surprise.
export function SeriesSignupModal({ season, driver, onClose, onDone }) {
  const isNewDriver = !driver?.id;
  const [name, setName] = useState(driver?.name || "");
  const [number, setNumber] = useState("");
  const [classId, setClassId] = useState("");
  const [aliases, setAliases] = useState(() => withDefaults(driver?.aliases));
  const [games, setGames] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { api("/api/games").then(setGames).catch(() => setGames([])); }, []);

  const gameName = season.game_name || "";
  const required = useMemo(() => requiredAliases(gameName), [gameName]);
  const suggested = useMemo(() => suggestedAliases(gameName), [gameName]);

  // Any alias this game insists on gets a row up front, so it's asked for
  // rather than hidden behind "＋ Add platform".
  useEffect(() => {
    if (!required.length) return;
    setAliases(rows => {
      const have = new Set(rows.map(r => String(r.label ?? "").toLowerCase()));
      const missing = required
        .filter(r => !have.has(r.label.toLowerCase()))
        .map(r => ({ label: r.label, value: "", game_id: season.game_id || "", is_display: false }));
      return missing.length ? [...rows, ...missing] : rows;
    });
  }, [required, season.game_id]);

  const roster = sortRosterByNumber(season.roster || []);
  const numberTaken = carNumberTaken(season.taken_numbers, number);
  const problem = signupProblem({ name, aliases, gameName });
  const blocked = busy || numberTaken || !!problem;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const info = cleanSignupDriverInfo({ name, aliases, number, class_ids: classId ? [classId] : [] });
    try {
      if (isNewDriver) {
        // Files a request. Deliberately creates nothing — see the route.
        await api("/api/claim-requests", {
          method: "POST",
          body: {
            kind: NEW_DRIVER_KIND,
            driver_name: info.name,
            aliases: info.aliases,
            signup: {
              season_id: season.season_id,
              class_ids: info.class_ids,
              number: info.number,
            },
          },
        });
        onDone({ requested: true, season });
      } else {
        // Keep their profile's aliases current, then take the entry.
        await api("/api/users/me/driver", { method: "PATCH", body: { aliases: info.aliases } });
        const res = await api("/api/users/me/series", {
          method: "POST",
          body: {
            season_id: season.season_id,
            class_ids: info.class_ids,
            number: info.number,
            name: info.name,
          },
        });
        onDone({ requested: false, season, already_entered: !!res.already_entered });
      }
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={`Sign up — ${season.series_name}`} onClose={busy ? () => {} : onClose}>
      <form onSubmit={submit}>
        <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.88rem" }}>
          <strong>{season.season_name}</strong>{season.game_name ? ` · ${season.game_name}` : ""}
          {season.requires_car && <> · you&rsquo;ll pick your car once you&rsquo;re on the roster.</>}
        </p>

        {isNewDriver && (
          <div className="signup-approval-note">
            <strong>You&rsquo;re not in the league&rsquo;s driver list yet.</strong> Filling this in sends a
            request to the league admins — nothing is created until one of them approves it. You&rsquo;ll
            be added to the roster automatically once they do.
          </div>
        )}

        <div className="field">
          <label htmlFor="signup_name">The name you race under</label>
          <input id="signup_name" required autoFocus value={name} maxLength={60}
            onChange={e => setName(e.target.value)} placeholder="e.g. J. May" />
          {!isNewDriver && (
            <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>
              How you&rsquo;ll be listed in this series. Your profile name stays {driver.name}.
            </span>
          )}
        </div>

        {season.classes?.length > 0 && (
          <div className="field">
            <label htmlFor="signup_class">Class</label>
            <select id="signup_class" value={classId} onChange={e => setClassId(e.target.value)}>
              <option value="">Decide later / unclassified</option>
              {season.classes.map(c => (
                <option key={c.id} value={c.id}>{c.car ? `${c.name} · ${c.car}` : c.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="field">
          <label htmlFor="signup_number">Car Number (optional)</label>
          <input id="signup_number" type="text" inputMode="numeric" maxLength={3}
            className={numberTaken ? "is-invalid" : undefined}
            aria-invalid={numberTaken || undefined}
            value={number} onChange={e => setNumber(e.target.value)} placeholder="e.g. 07" />
          {numberTaken && <p className="field-error">{NUMBER_TAKEN_MESSAGE}</p>}
        </div>

        {/* The series roster, so a free number can be picked without leaving
            the dialog. Listed by number, not alphabetically. */}
        <details className="roster-peek">
          <summary>
            Series roster — {roster.filter(r => String(r.number ?? "").trim()).length} number
            {roster.filter(r => String(r.number ?? "").trim()).length === 1 ? "" : "s"} taken
          </summary>
          {roster.length === 0 ? (
            <p className="roster-peek-empty">Nobody has signed up yet — every number is free.</p>
          ) : (
            <ul className="roster-peek-list">
              {roster.map((r, i) => (
                <li key={`${r.number ?? ""}-${r.name}-${i}`}>
                  <span className="badge">{String(r.number ?? "").trim() || "—"}</span>
                  <span className="roster-peek-name">{r.name}</span>
                  {r.class_names?.length > 0 && (
                    <span className="roster-peek-class">{r.class_names.join(" · ")}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </details>

        {required.length > 0 && (
          <div className="signup-required-note">
            {required.map(r => (
              <p key={r.label} style={{ margin: 0 }}>
                <strong>{r.label} is required for {season.game_name}.</strong> {r.why}
              </p>
            ))}
          </div>
        )}

        <AliasEditor aliases={aliases} onChange={setAliases} games={games}
          disabled={busy} required={required} suggested={suggested} />

        {problem && !numberTaken && <p className="field-error" style={{ marginTop: 10 }}>{problem}</p>}
        {error && <p className="field-error" style={{ marginTop: 10 }}>{error}</p>}

        <button className="btn btn-primary" type="submit" disabled={blocked}>
          {busy
            ? (isNewDriver ? "Sending…" : "Signing up…")
            : (isNewDriver ? "Send Request to Admins" : "Sign Up")}
        </button>
        <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }}
          onClick={onClose} disabled={busy}>Cancel</button>
      </form>
    </Modal>
  );
}
