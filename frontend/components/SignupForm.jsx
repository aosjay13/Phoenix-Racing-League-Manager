"use client";

import { useEffect, useMemo, useState } from "react";
import { AliasEditor } from "@/components/AliasEditor";
import { api } from "@/lib/api";
import { withDefaults } from "@/lib/aliases";
import {
  NUMBER_TAKEN_MESSAGE, missingSignupFields, missingSignupMessage, sortRosterByNumber,
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
// a car number field only if the season requires (or offers) one, a car
// dropdown only where a car list exists, a manufacturer dropdown only where
// that's a separate question. Nothing is hard-coded about which fields a league
// wants — see resolveSignupRules in lib/carSelection.js.
//
// Whatever is filled in, submitting NEVER puts anyone on the roster: it files a
// pending request for an admin (POST /api/signup-requests). The form says so
// before it's sent, so an approval isn't a surprise.
//
// Used inline under the season selector on /series-info, and inside a dialog
// from a season's own screen — one component, so the two can't drift.
export function SignupForm({ season, driver, onDone, onCancel }) {
  const isNewDriver = !driver?.id;
  const [name, setName] = useState(driver?.name || "");
  const [classId, setClassId] = useState("");
  const [number, setNumber] = useState("");
  const [car, setCar] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [aliases, setAliases] = useState(() => withDefaults(driver?.aliases));
  const [games, setGames] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { api("/api/games").then(setGames).catch(() => setGames([])); }, []);

  // A class can ask for more than its season does, so what's rendered changes
  // the moment one is picked.
  const rules = (classId && season.class_rules?.[classId]) || season.rules || {};
  const carOptions = rules.car_options || [];
  const manufacturerOptions = rules.manufacturer_options || [];
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
    const saved = withDefaults(driver?.aliases);
    return new Set(saved.filter(a => a.value).map(a => a.label.toLowerCase()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A car that isn't on the newly-picked class's list can't stay selected.
  useEffect(() => {
    if (car && !carOptions.includes(car)) setCar("");
    if (manufacturer && !manufacturerOptions.includes(manufacturer)) setManufacturer("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

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
  const numberTaken = numberClaimed(season.roster || [], season.pending || [], number);
  const takenCars = useMemo(() => {
    const counts = {};
    for (const r of roster) if (r.car) counts[r.car] = (counts[r.car] || 0) + 1;
    return counts;
  }, [roster]);

  const missing = missingSignupFields(
    { require_number: rules.require_number, require_car: rules.require_car,
      car_options: carOptions, require_manufacturer: rules.require_manufacturer,
      manufacturer_options: manufacturerOptions },
    { number, car, manufacturer });
  const missingAliases = missingRequiredAliases(aliases, game);
  const problem = !name.trim()
    ? "Enter the name you race under."
    : missing.length ? missingSignupMessage(missing)
      : missingAliases.length ? missingAliasMessage(missingAliases)
        : "";
  const blocked = busy || numberTaken || !!problem;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const info = cleanSignupDriverInfo({ name, aliases, number, class_ids: classId ? [classId] : [] });
    try {
      await api("/api/signup-requests", {
        method: "POST",
        body: {
          season_id: season.season_id,
          name: info.name,
          number: info.number,
          car,
          manufacturer,
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
          onChange={e => setName(e.target.value)} placeholder="e.g. J. May" />
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

      {/* Car number — always offered, marked required only where the admin
          said so. */}
      <div className="field">
        <label htmlFor="signup_number">
          Car Number {rules.require_number ? <span className="field-req">required</span> : "(optional)"}
        </label>
        <input id="signup_number" type="text" inputMode="numeric" maxLength={3}
          className={numberTaken ? "is-invalid" : undefined}
          aria-invalid={numberTaken || undefined}
          value={number} onChange={e => setNumber(e.target.value)} placeholder="e.g. 07" />
        {numberTaken && <p className="field-error">{NUMBER_TAKEN_MESSAGE}</p>}
      </div>

      {/* Car — only when the admin published a list to choose from. */}
      {carOptions.length > 0 && (
        <div className="field">
          <label htmlFor="signup_car">
            Car {rules.require_car ? <span className="field-req">required</span> : "(optional)"}
          </label>
          <select id="signup_car" value={car} onChange={e => setCar(e.target.value)}>
            <option value="">— No car selected —</option>
            {carOptions.map(c => (
              <option key={c} value={c}>{c}{takenCars[c] ? ` (${takenCars[c]} already)` : ""}</option>
            ))}
          </select>
        </div>
      )}

      {/* Manufacturer / model — a separate question where the league asks it. */}
      {rules.require_manufacturer && manufacturerOptions.length > 0 && (
        <div className="field">
          <label htmlFor="signup_manufacturer">
            Manufacturer / Model <span className="field-req">required</span>
          </label>
          <select id="signup_manufacturer" value={manufacturer}
            onChange={e => setManufacturer(e.target.value)}>
            <option value="">— Not selected —</option>
            {manufacturerOptions.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      )}

      {/* Transparency: who's on the roster and who's already asked, so nobody
          picks a number or a car that's spoken for. */}
      <details className="roster-peek" open={roster.length > 0 && roster.length <= 8}>
        <summary>
          Series roster — {roster.filter(r => String(r.number ?? "").trim()).length} number
          {roster.filter(r => String(r.number ?? "").trim()).length === 1 ? "" : "s"} spoken for
          {pendingJoins.length ? ` · ${pendingJoins.length} awaiting approval` : ""}
        </summary>
        {roster.length === 0 ? (
          <p className="roster-peek-empty">Nobody has signed up yet — every number is free.</p>
        ) : (
          <ul className="roster-peek-list">
            {roster.map((r, i) => (
              <li key={`${r.number ?? ""}-${r.name}-${i}`}>
                <span className="badge">{String(r.number ?? "").trim() || "—"}</span>
                <span className="roster-peek-name">
                  {r.name}
                  {r.pending && <span className="roster-peek-pending">pending</span>}
                </span>
                {(r.car || r.manufacturer) && (
                  <span className="roster-peek-class">{[r.car, r.manufacturer !== r.car ? r.manufacturer : null].filter(Boolean).join(" · ")}</span>
                )}
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
            Required to race in {season.game_name || "this game"}. We save these to your driver
            profile, so you only ever type them once.
          </p>
          {required.map(r => {
            const value = aliasValue(aliases, r.label);
            const blank = !value.trim();
            const prefilled = !blank && fromProfile.has(r.label.toLowerCase());
            const id = `signup_alias_${r.label.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`;
            return (
              <div className="field" key={r.label}>
                <label htmlFor={id}>
                  {r.label} <span className="field-req">required</span>
                  {prefilled && (
                    <span className="signup-prefilled" title="Taken from your driver profile — change it here if it's out of date">
                      ✓ from your profile
                    </span>
                  )}
                </label>
                <input id={id} value={value} maxLength={80} disabled={busy}
                  className={blank ? "is-invalid" : undefined}
                  aria-invalid={blank || undefined}
                  onChange={e => setRequiredAlias(r.label, e.target.value)}
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

      {problem && !numberTaken && <p className="field-error" style={{ marginTop: 10 }}>{problem}</p>}
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
