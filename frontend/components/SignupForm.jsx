"use client";

import { useEffect, useMemo, useState } from "react";
import { AliasEditor } from "@/components/AliasEditor";
import { api } from "@/lib/api";
import { withDefaults } from "@/lib/aliases";
import {
  NUMBER_TAKEN_MESSAGE, carAvailability, carFullMessage, missingSignupFields,
  missingSignupMessage, sortRosterByNumber,
} from "@/lib/carSelection";
import { isNumberChange, numberClaimed, rosterWithPending } from "@/lib/signupQueue";
import {
  IRACING_ID_LABEL, IRACING_NAME_LABEL,
  cleanSignupDriverInfo, missingAliasMessage, missingRequiredAliases,
  requiredAliases, suggestedAliases,
} from "@/lib/signupRequest";

// Read one platform username out of the alias rows, by label.
function aliasValue(rows, label) {
  const key = String(label).toLowerCase();
  return rows.find(r => String(r.label ?? "").toLowerCase() === key)?.value || "";
}

// An alias this game asks for is tied to the game where that's what it MEANS —
// an iRacing name is the name results import under for iRacing, so mapping it
// lets that game's tables show it. A Discord/Steam/PSN/Xbox name is the same
// account across every game a person plays, so it stays unmapped.
const GAME_SCOPED_LABELS = new Set([IRACING_NAME_LABEL.toLowerCase(), IRACING_ID_LABEL.toLowerCase()]);

// The season sign-up form. It renders ITSELF from what the admin asked for:
// a car number field only where a number is REQUIRED, and the car question only
// where a car list exists. Nothing is hard-coded about which fields a league
// wants — see resolveSignupRules in lib/carSelection.js.
//
// There is ONE car question. The admin types their list into Car Selection in
// League Setup and every entry on it becomes a radio button here — plain
// `input[type="radio"]`, so it's the same control as every other tick box and
// radio in the app (one block in globals.css draws them all). Whichever one a
// driver picks is what shows against their name on the roster once an admin
// approves them, on the season's car-selection screen and in the admin queue
// alike.
//
// "Only where it's required" is the rule for the number, and it's resolved down
// the same game → series → season → class chain as everything else: a league
// that doesn't run car numbers (or a season, or one class of it, that switches
// them off) shows no number question at all, rather than offering an optional
// box for something nobody uses. Picking a class re-resolves it, so a class that
// requires numbers inside a season that doesn't asks for one the moment it's
// chosen — and a number typed before the question went away is dropped rather
// than submitted unseen.
//
// Whatever is filled in, submitting NEVER puts anyone on the roster: it files a
// pending request for an admin (POST /api/signup-requests). The form says so
// before it's sent, so an approval isn't a surprise.
//
// Used inline under the season selector on /series-info, and inside a dialog
// from a season's own screen — one component, so the two can't drift.
// `knownAliases` is everything this ACCOUNT has already told the league it goes
// by — the driver profile's rows when there is one, and otherwise whatever they
// gave on a sign-up that's still waiting on an admin. It's separate from
// `driver` because a first-time player has the second and not the first, and
// asking them for their Discord name twice in one sitting because no admin has
// been to the queue yet is exactly the retyping this is here to prevent.
export function SignupForm({ season, driver, knownAliases, knownName, onDone, onCancel }) {
  const isNewDriver = !driver?.id;
  const saved = knownAliases?.length ? knownAliases : driver?.aliases;
  const [name, setName] = useState(driver?.name || knownName || "");
  const [classId, setClassId] = useState("");
  const [number, setNumber] = useState("");
  const [car, setCar] = useState("");
  const [aliases, setAliases] = useState(() => withDefaults(saved));
  const [games, setGames] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Which required boxes this person has actually been to. An empty required
  // field is not a MISTAKE until somebody has had a go at it: opening the form
  // and being met by four red-outlined inputs reads as "you've done something
  // wrong" to a player who has done nothing at all yet, which is the opposite
  // of what a first sign-up should feel like. So a field turns red only once
  // it's been touched and left blank — everything still to fill in is listed
  // calmly under the button instead. See `untouched` below.
  const [touched, setTouched] = useState(() => new Set());
  const touch = label => setTouched(prev => (prev.has(label) ? prev : new Set(prev).add(label)));

  useEffect(() => { api("/api/games").then(setGames).catch(() => setGames([])); }, []);

  // A class can ask for more than its season does, so what's rendered changes
  // the moment one is picked.
  const rules = (classId && season.class_rules?.[classId]) || season.rules || {};
  // The one switch that decides whether this sign-up is asked for a car number
  // at all. Everything below reads it rather than `rules.require_number`, so the
  // field, its validation and what gets submitted can't disagree.
  const asksNumber = !!rules.require_number;
  const carOptions = rules.car_options || [];
  // Cars the admin capped, and how much of each cap is used. Counts everyone
  // on the roster AND everyone still waiting on approval — five people all
  // picking the last Ferrari because none of them had been approved yet is the
  // pile-up the cap exists to prevent. See carAvailability in
  // lib/carSelection.js, which the API refuses on too.
  const carEntries = rules.car_entries || carOptions.map(name => ({ name, max: null }));
  const gameName = season.game_name || "";
  // What this sign-up must carry: the Discord name (every game, no exceptions)
  // plus whichever platform identities the parent GAME was configured to
  // require in League Setup — Steam, PSN, Xbox, iRacing name/ID. The season row
  // carries the game's flags so the form can render itself without a second
  // round trip. See lib/signupRequest.js.
  const game = useMemo(
    () => ({ name: gameName, ...(season.game_requirements || {}) }),
    [gameName, season.game_requirements]);
  const required = useMemo(() => requiredAliases(game), [game]);
  const suggested = useMemo(() => suggestedAliases(game), [game]);
  // Which of them the driver profile already answered, frozen at mount: those
  // inputs come pre-filled and say so, rather than asking for something the
  // league already knows.
  const fromProfile = useMemo(() => {
    const rows = withDefaults(saved);
    return new Set(rows.filter(a => a.value).map(a => a.label.toLowerCase()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Where those answers came from, so the tick beside a pre-filled box tells
  // the truth for a player who hasn't got a profile yet.
  const savedFrom = driver?.id ? "your profile" : "your last sign-up";

  // A car that isn't on the newly-picked class's list can't stay selected.
  useEffect(() => {
    if (car && !carOptions.includes(car)) setCar("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  // A number typed while the question was on screen must not survive the
  // question disappearing: it would be submitted invisibly, and a clash with
  // somebody else's number would disable Submit with nothing on screen to
  // explain why.
  useEffect(() => {
    if (!asksNumber && number) setNumber("");
  }, [asksNumber, number]);

  // Any alias the game insists on gets a row up front rather than hiding behind
  // "＋ Add platform".
  useEffect(() => {
    if (!required.length) return;
    setAliases(rows => {
      const have = new Set(rows.map(r => String(r.label ?? "").toLowerCase()));
      const add = required.filter(r => !have.has(r.label.toLowerCase()))
        .map(r => ({
          label: r.label, value: "", is_display: false,
          game_id: GAME_SCOPED_LABELS.has(r.label.toLowerCase()) ? (season.game_id || "") : "",
        }));
      return add.length ? [...rows, ...add] : rows;
    });
  }, [required, season.game_id]);

  // Write one required platform username back into the alias rows the form
  // submits — the same rows the "edit everything" editor below shows, so the
  // two views of the same answer can never disagree.
  function setRequiredAlias(label, value) {
    setAliases(rows => {
      const key = String(label).toLowerCase();
      const at = rows.findIndex(r => String(r.label ?? "").toLowerCase() === key);
      if (at === -1) {
        return [...rows, {
          label, value, is_display: false,
          game_id: GAME_SCOPED_LABELS.has(key) ? (season.game_id || "") : "",
        }];
      }
      return rows.map((r, i) => (i === at ? { ...r, value } : r));
    });
  }

  // The roster a driver reads to avoid a clash: everyone racing, plus everyone
  // already waiting on approval, in car-number order.
  const roster = useMemo(
    () => rosterWithPending(season.roster || [], season.pending || []),
    [season.roster, season.pending]);
  // People waiting to get IN. A pending car-number change is in the same queue
  // and its number is just as spoken for, but it isn't another driver joining,
  // so it doesn't belong in this count.
  const pendingJoins = useMemo(
    () => (season.pending || []).filter(p => !isNumberChange(p)),
    [season.pending]);
  const numbersTaken = useMemo(
    () => roster.filter(r => String(r.number ?? "").trim()).length, [roster]);
  const numberTaken = asksNumber && numberClaimed(season.roster || [], season.pending || [], number);
  const takenCars = useMemo(() => {
    const counts = {};
    for (const r of roster) if (r.car) counts[r.car] = (counts[r.car] || 0) + 1;
    return counts;
  }, [roster]);
  // Nobody on this form holds a car yet — they're signing up — so no car is
  // exempt from its own cap here.
  const capacity = useMemo(
    () => carAvailability(carEntries, roster, ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(carEntries), roster]);
  const capacityFor = name =>
    capacity.find(c => c.name.toLowerCase() === String(name).toLowerCase()) || null;
  // A car that filled up while this form was open must not stay selected: it
  // would be refused on submit with the radio still showing it chosen.
  const chosenFull = car ? capacityFor(car)?.full : false;
  useEffect(() => {
    if (chosenFull) setCar("");
  }, [chosenFull]);

  const missing = missingSignupFields(
    { require_number: rules.require_number, require_car: rules.require_car,
      car_options: carOptions },
    { number, car });
  const missingAliases = missingRequiredAliases(aliases, game);
  const problem = !name.trim()
    ? "Enter the name you race under."
    : missing.length ? missingSignupMessage(missing)
      : missingAliases.length ? missingAliasMessage(missingAliases)
        : "";
  const blocked = busy || numberTaken || !!problem;
  // Nothing on this form has been filled in yet, so what's outstanding is a
  // to-do list rather than a list of errors. The moment anything is typed it
  // goes back to being flagged in red, because by then it IS something left
  // undone rather than something not yet started.
  const untouched = !touched.size;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // Belt and braces on the hidden number: the state is cleared the moment the
    // question goes away, and it's dropped again here, so nothing that was never
    // asked for can ride along on the request.
    const info = cleanSignupDriverInfo({
      name, aliases, number: asksNumber ? number : "",
      class_ids: classId ? [classId] : [],
    });
    try {
      await api("/api/signup-requests", {
        method: "POST",
        body: {
          season_id: season.season_id,
          name: info.name,
          number: info.number,
          car,
          class_ids: info.class_ids,
          aliases: info.aliases,
          ...(isNewDriver ? { new_driver: { name: info.name, aliases: info.aliases } } : {}),
        },
      });
      onDone({ season });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.88rem" }}>
        <strong>{season.series_name} · {season.season_name}</strong>
        {season.game_name ? ` · ${season.game_name}` : ""}
      </p>

      {/* Every sign-up waits on an admin — say so before it's sent. */}
      <div className="signup-approval-note">
        <strong>Sign-ups are reviewed by a league admin.</strong> Submitting puts you in the pending
        queue with the choices below; you&rsquo;ll be on the official roster once an admin approves it.
        {isNewDriver && " You're not in the league's driver list yet, so approving this creates your driver profile too."}
      </div>

      {/* The admin's own instructions for this series. */}
      {rules.note && <p className="lockin-note">{rules.note}</p>}

      <div className="field">
        <label htmlFor="signup_name">The name you race under</label>
        <input id="signup_name" required value={name} maxLength={60}
          onChange={e => { touch("name"); setName(e.target.value); }}
          onBlur={() => touch("name")} placeholder="e.g. J. May" />
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

      {/* Car number — asked for only where the admin requires one. A league,
          season or class that doesn't run numbers shows nothing here at all. */}
      {asksNumber && (
        <div className="field">
          <label htmlFor="signup_number">
            Car Number <span className="field-req">required</span>
          </label>
          <input id="signup_number" type="text" inputMode="numeric" maxLength={3}
            className={numberTaken ? "is-invalid" : undefined}
            aria-invalid={numberTaken || undefined}
            value={number} onChange={e => setNumber(e.target.value)} placeholder="e.g. 07" />
          {numberTaken && <p className="field-error">{NUMBER_TAKEN_MESSAGE}</p>}
        </div>
      )}

      {/* Car Selection — the ONE car question, and only when the admin
          published a list to choose from. One radio per entry on that list,
          drawn by the app's shared checkbox/radio rule in globals.css rather
          than anything of this form's own. Choosing is never a trap: an
          optional list keeps a "No car selected" option, and a required one
          drops it, because the point of requiring it is that one is chosen. */}
      {carOptions.length > 0 && (
        <div className="field">
          <span className="field-label" id="signup_car_label">
            Car Selection {rules.require_car ? <span className="field-req">required</span> : "(optional)"}
          </span>
          <div className="option-rows" role="radiogroup" aria-labelledby="signup_car_label">
            {carOptions.map(c => {
              const cap = capacityFor(c);
              const full = !!cap?.full;
              return (
                <label className={`check-row check-row-center${full ? " is-full" : ""}`} key={c}
                  title={full ? carFullMessage(cap) : undefined}>
                  <input type="radio" name="signup_car" value={c} disabled={full}
                    checked={car === c} onChange={() => setCar(c)} />
                  <span>
                    {c}
                    {/* What's left of a capped car, or simply how many have it
                        where there's no cap. A full one says so in words as
                        well as being greyed out — colour alone isn't an
                        explanation. */}
                    {full ? (
                      <span className="car-full-tag">FULL · {cap.taken} of {cap.max}</span>
                    ) : cap?.max != null ? (
                      <span style={{ color: "var(--ink-2)", fontSize: "0.78rem" }}>
                        {" "}· {cap.left} of {cap.max} left
                      </span>
                    ) : takenCars[c] ? (
                      <span style={{ color: "var(--ink-2)", fontSize: "0.78rem" }}>
                        {" "}· {takenCars[c]} already
                      </span>
                    ) : null}
                  </span>
                </label>
              );
            })}
            {!rules.require_car && (
              <label className="check-row check-row-center">
                <input type="radio" name="signup_car" value=""
                  checked={!car} onChange={() => setCar("")} />
                <span style={{ color: "var(--ink-2)" }}>No car selected</span>
              </label>
            )}
          </div>
        </div>
      )}

      {/* Transparency: who's on the roster and who's already asked, so nobody
          picks a number or a car that's spoken for. */}
      <details className="roster-peek" open={roster.length > 0 && roster.length <= 8}>
        {/* Written as an instruction, not a label. This is the answer to
            "which numbers can I have?" and it was being missed completely: a
            dim grey line the same size as the body text, marked only by a
            small ▸, reads as a caption rather than something to press. It
            leads with the ACTION now, and says which way pressing it goes. */}
        <summary>
          <span className="roster-peek-icon" aria-hidden="true">{asksNumber ? "#" : "☰"}</span>
          <span className="roster-peek-summary">
            <strong>
              {/* Numbers are the headline where a number is what's being
                  chosen; where the series doesn't run them, the roster is
                  simply who's in. */}
              <span className="roster-peek-when-shut">
                {asksNumber ? "See which numbers are taken" : "See who's on the roster"}
              </span>
              <span className="roster-peek-when-open">
                {asksNumber ? "Numbers already taken" : "On the roster"}
              </span>
            </strong>
            <span className="roster-peek-sub">
              {asksNumber
                ? <>{numbersTaken} number{numbersTaken === 1 ? "" : "s"} spoken for</>
                : <>{roster.length} driver{roster.length === 1 ? "" : "s"}</>}
              {pendingJoins.length ? ` · ${pendingJoins.length} awaiting approval` : ""}
            </span>
          </span>
          <span className="roster-peek-chevron" aria-hidden="true">▾</span>
        </summary>
        {roster.length === 0 ? (
          <p className="roster-peek-empty">
            {asksNumber
              ? "Nobody has signed up yet — every number is free."
              : "Nobody has signed up yet — you'd be the first."}
          </p>
        ) : (
          <ul className="roster-peek-list">
            {roster.map((r, i) => (
              <li key={`${r.number ?? ""}-${r.name}-${i}`}>
                {/* The number badge earns its place where numbers are part of
                    the sign-up, or where this driver happens to carry one; a
                    series that doesn't run them gets a column of em-dashes
                    otherwise. */}
                {(asksNumber || String(r.number ?? "").trim()) && (
                  <span className="badge">{String(r.number ?? "").trim() || "—"}</span>
                )}
                <span className="roster-peek-name">
                  {r.name}
                  {r.pending && <span className="roster-peek-pending">pending</span>}
                </span>
                {r.car && <span className="roster-peek-class">{r.car}</span>}
                {r.class_names?.length > 0 && (
                  <span className="roster-peek-class">{r.class_names.join(" · ")}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </details>

      {/* The contact & platform details this sign-up can't go in without: the
          Discord name every league sign-up needs, plus whatever the parent game
          asks for. Anything already on the driver profile is filled in and
          flagged as such, so the common case is "read it and submit"; anything
          typed here is saved back to the profile by the API, so it's asked for
          once and never again. */}
      {required.length > 0 && (
        <div className="signup-required-fields">
          <label style={{ display: "block" }}>Contact &amp; Platform Details</label>
          <p style={{ margin: "0 0 10px", fontSize: "0.78rem", color: "var(--ink-2)" }}>
            Required to race in {season.game_name || "this game"}. We save these to your profile,
            so you only ever type them once — the next series you join fills them in for you.
          </p>
          {required.map(r => {
            const value = aliasValue(aliases, r.label);
            const blank = !value.trim();
            // Blank AND been-to. An untouched empty box is simply not filled in
            // yet, which is a to-do, not a mistake.
            const wrong = blank && touched.has(r.label);
            const prefilled = !blank && fromProfile.has(r.label.toLowerCase());
            const id = `signup_alias_${r.label.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`;
            return (
              <div className="field" key={r.label}>
                <label htmlFor={id}>
                  {r.label} <span className="field-req">required</span>
                  {prefilled && (
                    <span className="signup-prefilled"
                      title={`Taken from ${savedFrom} — change it here if it's out of date`}>
                      ✓ from {savedFrom}
                    </span>
                  )}
                </label>
                <input id={id} value={value} maxLength={80} disabled={busy}
                  className={wrong ? "is-invalid" : undefined}
                  aria-invalid={wrong || undefined}
                  onChange={e => { touch(r.label); setRequiredAlias(r.label, e.target.value); }}
                  onBlur={() => touch(r.label)}
                  placeholder={r.label} />
                <p className="signup-required-why">{r.why}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Everything else a driver goes by. Collapsed, because the fields that
          matter for this sign-up are already answered above — this is for
          adding the platforms this game doesn't ask about. */}
      <details className="signup-alias-more">
        <summary>Other platform names &amp; connected accounts</summary>
        <AliasEditor aliases={aliases} onChange={setAliases} games={games}
          disabled={busy} required={required} suggested={suggested} showHelp={false} />
      </details>

      {/* Why Submit is still greyed out. Neutral until the form has been
          started — on a form nobody has touched this is a list of what's
          coming, and red text saying so reads as a telling-off for not having
          done it yet. */}
      {problem && !numberTaken && (
        <p className={untouched ? "signup-todo" : "field-error"} style={{ marginTop: 10 }}>
          {problem}
        </p>
      )}
      {error && <p className="field-error" style={{ marginTop: 10 }}>{error}</p>}

      <button className="btn btn-primary" type="submit" disabled={blocked}>
        {busy ? "Submitting…" : "Submit Sign Up"}
      </button>
      {onCancel && (
        <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }}
          onClick={onCancel} disabled={busy}>Cancel</button>
      )}
    </form>
  );
}
