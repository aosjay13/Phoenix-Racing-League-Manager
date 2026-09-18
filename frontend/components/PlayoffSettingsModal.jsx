"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import { PointsScaleField } from "@/components/PointsScaleField";
import { api } from "@/lib/api";
import {
  FINALE_MODES, PLAYOFF_FORMATS, QUALIFY_MODES, SEED_MODES, WILDCARD_MODES, WILDCARD_SEEDS,
  applyFormatPreset, defaultRoundsFor, describePlayoffFormat, normalizePlayoffConfig,
  playoffFormat, playoffSetupWarnings, resolveRegularRounds, splitRaces,
} from "@/lib/playoffs";

// ── The Playoff Format menu ────────────────────────────────────────────────
//
// Everything a league's playoff can be, in one dialog. It is deliberately a
// WORKSPACE rather than a form column (see components/Modal.jsx): a playoff is a
// ladder, and a ladder read a third at a time — or through a horizontal
// scrollbar — is a ladder nobody checks. At workspace width the rounds sit in a
// table the way they do on a whiteboard, with the shape of the format drawn
// underneath so a change to a number is visible as a change to the bracket.
//
// The six tabs are the six questions, in the order a league answers them:
//
//   Format   which shape are we racing, and where does the regular season end
//   Field    who is in it
//   Seeding  what do they start on
//   Rounds   how is it raced
//   Points   what is a result worth beyond the ordinary points
//   Champions who gets crowned, and what the crowns are called
//
// Picking a preset on the first tab fills in the other five. Nothing it writes
// is locked afterwards — that is the whole point of having a menu rather than a
// list of formats, since the format a league votes on in January has usually
// never been raced anywhere before.
//
// State lives in the caller (the season form), exactly like every other block of
// the season editor: `value` is the playoff config and `onChange` takes a whole
// new one. Nothing is saved from in here; closing the dialog leaves the season
// form holding the edits, and the form's own Save writes them.

const SECTIONS = [
  ["format", "Format", "🏆"],
  ["field", "The Field", "🚦"],
  ["seeding", "Seeding & Reset", "♻️"],
  ["rounds", "Rounds", "🪜"],
  ["points", "Playoff Points", "⭐"],
  ["titles", "Champions", "👑"],
];

const hint = { display: "block", fontWeight: 400, fontSize: "0.78rem", color: "var(--ink-2)" };
const subLabel = { fontSize: "0.78rem", color: "var(--ink-2)" };

// A radio list of {key, label, blurb} answers. Used for the three questions
// that are genuinely a choice between rules rather than a number — how drivers
// qualify, what they're reset to, and how the finale is settled — because a
// dropdown hides the explanation that makes the choice meaningful.
function ChoiceRows({ name, options, value, onChange, disabled }) {
  return (
    <div className="playoff-choices">
      {options.map(([key, label, blurb]) => (
        <label key={key} className={`playoff-choice${value === key ? " is-picked" : ""}`}>
          <input type="radio" name={name} value={key} disabled={disabled}
            checked={value === key} onChange={() => onChange(key)} />
          <span>
            <strong>{label}</strong>
            <span style={hint}>{blurb}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

// The format drawn as the bracket it is: the field, each round's cut, and the
// trophy. This is the part that makes the numbers above readable — "3 races,
// 12 advance" is a row in a table, but 16 → 12 → 8 → 4 → 🏆 is a playoff.
function LadderPreview({ config }) {
  const cfg = normalizePlayoffConfig(config);
  const everyone = cfg.qualify_mode === "all";
  const steps = [{
    key: "field",
    top: everyone ? "Everyone" : String(cfg.field_size),
    bottom: everyone ? "eligible" : `driver${cfg.field_size === 1 ? "" : "s"} qualify`,
  }];
  cfg.rounds.forEach((round, i) => {
    const last = i === cfg.rounds.length - 1;
    steps.push({
      key: `r${i}`,
      top: round.races ? `${round.races} race${round.races === 1 ? "" : "s"}` : "rest of season",
      bottom: round.name,
      arrow: true,
    });
    steps.push({
      key: `a${i}`,
      top: last ? "🏆" : String(round.advance),
      bottom: last ? cfg.champion_title : "advance",
      win: last,
    });
  });
  return (
    <div className="playoff-ladder">
      {steps.map(s => (
        <span key={s.key} className={`playoff-step${s.arrow ? " is-round" : ""}${s.win ? " is-win" : ""}`}>
          <strong>{s.top}</strong>
          <em>{s.bottom}</em>
        </span>
      ))}
    </div>
  );
}

export function PlayoffSettingsModal({
  value, onChange, onClose, races = [], seasonId = "", seasonName = "", disabled = false,
}) {
  const [section, setSection] = useState("format");
  // The season's roster, for the wildcard picker. Fetched here rather than
  // handed down, because it is the one thing in this dialog nothing else on the
  // season form needs — a league that never picks a wildcard never loads it.
  // A season being created has no roster yet, and the picker says so.
  const [roster, setRoster] = useState([]);
  useEffect(() => {
    if (!seasonId) { setRoster([]); return; }
    let live = true;
    api(`/api/entries?season_id=${seasonId}`)
      .then(rows => { if (live) setRoster(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (live) setRoster([]); });
    return () => { live = false; };
  }, [seasonId]);
  // Two views of the same config, and the difference matters. `raw` is what the
  // inputs are bound to — whatever is currently typed, half-finished numbers and
  // cleared boxes included — so a field can actually be emptied and retyped.
  // `cfg` is the same thing read as rules, and everything DERIVED reads that:
  // the summary line, the ladder drawing, the warnings and the calendar split.
  // Binding the inputs to the normalized copy would snap a box back to its
  // default the moment it was cleared, which makes a number impossible to edit.
  const raw = useMemo(() => {
    const base = normalizePlayoffConfig(value);
    const v = value || {};
    return {
      ...base,
      ...v,
      playoff_points: { ...base.playoff_points, ...(v.playoff_points || {}) },
      rounds: Array.isArray(v.rounds) && v.rounds.length ? v.rounds : base.rounds,
    };
  }, [value]);
  const cfg = useMemo(() => normalizePlayoffConfig(raw), [raw]);
  const warnings = useMemo(() => playoffSetupWarnings(cfg, races, roster), [cfg, races, roster]);
  const split = useMemo(() => splitRaces(races, cfg), [races, cfg]);
  const cutoff = resolveRegularRounds(cfg, races);

  const set = patch => onChange({ ...raw, ...patch });
  const field = name => e => set({ [name]: e.target.value });
  const check = name => e => set({ [name]: e.target.checked });
  const setPP = patch => set({ playoff_points: { ...raw.playoff_points, ...patch } });

  const rounds = raw.rounds;
  const setRounds = next => set({ rounds: next });
  const patchRound = (i, patch) => setRounds(rounds.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const removeRound = i => setRounds(rounds.filter((_, j) => j !== i));
  const moveRound = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= rounds.length) return;
    const next = [...rounds];
    [next[i], next[j]] = [next[j], next[i]];
    setRounds(next);
  };
  const addRound = () => setRounds([...rounds, {
    name: `Round ${rounds.length + 1}`,
    races: 1,
    advance: Math.max(1, Number(cfg.rounds[cfg.rounds.length - 1]?.advance ?? cfg.field_size) - 1),
    reset_base: Number(cfg.rounds[cfg.rounds.length - 1]?.reset_base ?? cfg.seed_base) + 1000,
  }]);
  const rebuildRounds = () => setRounds(defaultRoundsFor({ field_size: cfg.field_size, seed_base: cfg.seed_base }));

  const wildcards = cfg.wildcards;
  const pickedIds = new Set(wildcards.map(w => w.entry_id));
  // The name is stored beside the id so a pick still reads as a person when the
  // roster hasn't loaded, or after that entry is gone — see lib/playoffs.js.
  const addWildcard = entryId => {
    const entry = roster.find(e => e.id === entryId);
    if (!entry || pickedIds.has(entryId)) return;
    set({ wildcards: [...wildcards, { entry_id: entry.id, name: entry.name || "" }] });
  };
  const removeWildcard = entryId => set({ wildcards: wildcards.filter(w => w.entry_id !== entryId) });

  return (
    <Modal title={`Playoff Format${seasonName ? ` · ${seasonName}` : ""}`} size="workspace" onClose={onClose}>
      <p style={{ margin: "6px 0 0", color: "var(--ink-1)", fontSize: "0.86rem" }}>
        There is no one playoff format, so this menu doesn&rsquo;t offer one — it asks the six questions every
        format is an answer to. Start from a preset if your league runs something recognisable, then change
        anything you like: every number, every round and every rule below is yours.
      </p>

      <div className="playoff-summary">
        <span className="playoff-chip">{playoffFormat(cfg.format).icon} {playoffFormat(cfg.format).name}</span>
        <span style={{ fontSize: "0.84rem", color: "var(--ink-1)" }}>{describePlayoffFormat(cfg)}</span>
      </div>

      <LadderPreview config={cfg} />

      {races.length > 0 && (
        <p style={{ margin: "8px 0 0", fontSize: "0.82rem", color: "var(--ink-2)" }}>
          This season&rsquo;s calendar: <strong>{races.length}</strong> round{races.length === 1 ? "" : "s"} —
          {" "}<strong>{split.regular.length}</strong> in the regular season (through round {cutoff || "—"}),
          {" "}<strong>{split.playoff.length}</strong> in the playoff.
        </p>
      )}

      {warnings.length > 0 && (
        <ul className="playoff-warn">
          {warnings.map(w => <li key={w}>⚠ {w}</li>)}
        </ul>
      )}

      <div className="tab-row" style={{ marginTop: 14 }}>
        {SECTIONS.map(([key, label, icon]) => (
          <button key={key} type="button" className={`tab${section === key ? " active" : ""}`}
            onClick={() => setSection(key)}>
            <span aria-hidden="true" style={{ marginRight: 6 }}>{icon}</span>{label}
          </button>
        ))}
      </div>

      {/* ── Format ─────────────────────────────────────────────────────── */}
      {section === "format" && (
        <div className="playoff-section">
          <h4 className="playoff-heading">Pick a starting point</h4>
          <p style={subLabel}>
            A preset writes its answers into every other tab. It is a starting point, not a lock — change
            whatever you want afterwards, and the format simply becomes yours.
          </p>
          <div className="playoff-format-cards">
            {PLAYOFF_FORMATS.map(f => (
              <button key={f.key} type="button" disabled={disabled}
                className={`playoff-format-card${cfg.format === f.key ? " is-picked" : ""}`}
                onClick={() => onChange(applyFormatPreset(raw, f.key))}>
                <span className="playoff-format-icon" aria-hidden="true">{f.icon}</span>
                <strong>{f.name}</strong>
                <em>{f.tagline}</em>
                <span>{f.blurb}</span>
              </button>
            ))}
          </div>

          <h4 className="playoff-heading">Where does the regular season end?</h4>
          <div className="playoff-grid">
            <div className="field">
              <label htmlFor="playoff_regular_rounds">Regular season ends after round</label>
              <input id="playoff_regular_rounds" type="number" min="0" disabled={disabled}
                value={raw.regular_rounds} onChange={field("regular_rounds")} />
              <span style={subLabel}>
                Round {cfg.regular_rounds || cutoff || "?"} is the last regular-season race; everything after it
                is a playoff round. Leave it on <strong>0</strong> and it works itself out — the rounds your
                ladder asks for are counted back from the end of the calendar, so a 36-round season with a
                10-race ladder has a 26-round regular season without anybody typing 26.
              </span>
            </div>
            <div className="field">
              <label htmlFor="playoff_notes">The rule, in your own words</label>
              <textarea id="playoff_notes" rows={3} disabled={disabled} value={raw.notes}
                onChange={field("notes")}
                placeholder="e.g. Voted in at the January meeting — ties in the final round go to the higher seed." />
              <span style={subLabel}>
                Shown at the top of the Playoffs panel on Standings, so every driver reads the same rule you
                wrote down. Optional.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── The Field ──────────────────────────────────────────────────── */}
      {section === "field" && (
        <div className="playoff-section">
          <h4 className="playoff-heading">Who races for the title?</h4>
          <div className="playoff-grid">
            <div className="field">
              <label htmlFor="playoff_field_size">How many drivers make the playoff</label>
              <input id="playoff_field_size" type="number" min="1" disabled={disabled}
                value={raw.field_size} onChange={field("field_size")} />
              <span style={subLabel}>
                The size of the field that starts the playoff. Everybody else keeps racing and keeps scoring
                ordinary points — they just can&rsquo;t win the championship any more.
              </span>
            </div>
            <div className="field">
              <label htmlFor="playoff_min_starts">Minimum starts to be eligible</label>
              <input id="playoff_min_starts" type="number" min="0" disabled={disabled}
                value={raw.min_starts} onChange={field("min_starts")} />
              <span style={subLabel}>
                A driver who started fewer regular-season rounds than this can&rsquo;t make the field, however
                many points they scored. <strong>0</strong> lets anybody in — which is what most leagues want.
              </span>
            </div>
          </div>

          <h4 className="playoff-heading">How do they get in?</h4>
          <ChoiceRows name="playoff_qualify_mode" options={QUALIFY_MODES} value={raw.qualify_mode}
            disabled={disabled} onChange={v => set({ qualify_mode: v })} />

          <h4 className="playoff-heading">Wildcards</h4>
          <p style={subLabel}>
            Drivers you put in <strong>by name</strong>. No rule decides it — not points, not wins, not how
            many rounds they started — because leagues hand out a place for reasons a formula has never
            heard of: a dead PC for three rounds, a feeder-series champion, a vote at the meeting. A
            wildcard is in, full stop, and is seeded on their own points like everyone else unless you say
            otherwise below.
          </p>

          {wildcards.length > 0 && (
            <div className="playoff-wildcards">
              {wildcards.map(w => {
                const onRoster = !roster.length || roster.some(e => e.id === w.entry_id);
                return (
                  <span key={w.entry_id} className={`playoff-wildcard${onRoster ? "" : " is-missing"}`}>
                    🃏 {roster.find(e => e.id === w.entry_id)?.name || w.name || w.entry_id}
                    {!onRoster && <em title="This driver is no longer on the season's roster"> — off the roster</em>}
                    <button type="button" className="icon-btn" title="Remove this wildcard"
                      disabled={disabled} onClick={() => removeWildcard(w.entry_id)}>✕</button>
                  </span>
                );
              })}
            </div>
          )}

          <div className="field">
            <label htmlFor="playoff_add_wildcard">Add a wildcard</label>
            <select id="playoff_add_wildcard" value="" disabled={disabled || !roster.length}
              onChange={e => { addWildcard(e.target.value); }}>
              <option value="">
                {roster.length ? "Pick a driver from the roster…" : "No roster to pick from yet"}
              </option>
              {roster.filter(e => !pickedIds.has(e.id)).map(e => (
                <option key={e.id} value={e.id}>
                  {e.name}{e.number ? ` (#${e.number})` : ""}
                </option>
              ))}
            </select>
            <span style={subLabel}>
              {roster.length
                ? `${roster.length} driver${roster.length === 1 ? "" : "s"} on this season's roster. Pick as many as your format allows — each one takes a place in the field, or joins it, depending on the answer below.`
                : "This season has no roster yet, so there is nobody to pick. Add the drivers first and come back — everything else in this menu can be set up now."}
            </span>
          </div>

          {wildcards.length > 0 && (
            <>
              <h4 className="playoff-heading">Do the wildcards take a slot, or come on top?</h4>
              <ChoiceRows name="playoff_wildcard_mode" options={WILDCARD_MODES} value={raw.wildcard_mode}
                disabled={disabled} onChange={v => set({ wildcard_mode: v })} />

              <h4 className="playoff-heading">Where do they line up?</h4>
              <ChoiceRows name="playoff_wildcard_seed" options={WILDCARD_SEEDS} value={raw.wildcard_seed}
                disabled={disabled} onChange={v => set({ wildcard_seed: v })} />
            </>
          )}

          <div className="field check-row" style={{ marginTop: 12 }}>
            <input type="checkbox" id="playoff_show_non_playoff" disabled={disabled}
              checked={raw.show_non_playoff} onChange={check("show_non_playoff")} />
            <label htmlFor="playoff_show_non_playoff" style={{ margin: 0 }}>
              List the drivers who missed the cut
              <span style={hint}>
                On: the Playoffs panel shows the rest of the field below the cutline, on their season points,
                so a driver 3rd out can see exactly how far out they were. Off: the panel is the playoff field
                and nobody else.
              </span>
            </label>
          </div>
        </div>
      )}

      {/* ── Seeding ────────────────────────────────────────────────────── */}
      {section === "seeding" && (
        <div className="playoff-section">
          <h4 className="playoff-heading">What does the field start the playoff on?</h4>
          <ChoiceRows name="playoff_seed_mode" options={SEED_MODES} value={raw.seed_mode}
            disabled={disabled} onChange={v => set({ seed_mode: v })} />

          <div className="playoff-grid" style={{ marginTop: 12 }}>
            <div className="field">
              <label htmlFor="playoff_seed_base">Reset base</label>
              <input id="playoff_seed_base" type="number" disabled={disabled}
                value={raw.seed_base} onChange={field("seed_base")} />
              <span style={subLabel}>
                The number everyone in the field drops to. NASCAR&rsquo;s playoffs use <strong>2000</strong>;
                the 2004 Chase used <strong>5050</strong> for the top seed. Ignored when the points carry over
                untouched.
              </span>
            </div>
            <div className="field">
              <label htmlFor="playoff_seed_gap">Points between seeds</label>
              <input id="playoff_seed_gap" type="number" min="0" disabled={disabled}
                value={raw.seed_gap} onChange={field("seed_gap")} />
              <span style={subLabel}>
                Only used by <strong>Reset in seeded steps</strong>: the 1 seed starts on the base, the 2 seed
                this far back, and so on down the field. The 2004 Chase used 5.
              </span>
            </div>
          </div>

          <div className="field check-row">
            <input type="checkbox" id="playoff_carry_playoff_points" disabled={disabled}
              checked={raw.carry_playoff_points} onChange={check("carry_playoff_points")} />
            <label htmlFor="playoff_carry_playoff_points" style={{ margin: 0 }}>
              Playoff points carry through every reset
              <span style={hint}>
                On: the playoff points a driver banked (see the <strong>Playoff Points</strong> tab) are added
                to their reset in every round, so a dominant regular season is still worth something in
                October. Off: they pay once at seeding and are gone at the first reset.
              </span>
            </label>
          </div>
        </div>
      )}

      {/* ── Rounds ─────────────────────────────────────────────────────── */}
      {section === "rounds" && (
        <div className="playoff-section">
          <h4 className="playoff-heading">The rounds</h4>
          <p style={subLabel}>
            One row per round, raced in this order off the end of the regular season. A round is three numbers:
            how many races it runs, how many drivers come out of it, and what the survivors are reset to.
            One round of ten races that advances one driver is a Chase; four rounds cutting 16 → 12 → 8 → 4
            are elimination playoffs. Leave <strong>Races</strong> on 0 and the round takes every remaining
            round on the calendar.
          </p>

          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="stats-table playoff-rounds-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th style={{ textAlign: "left" }}>Round Name</th>
                  <th style={{ width: 90 }}>Races</th>
                  <th style={{ width: 110 }}>Advance</th>
                  <th style={{ width: 130 }}>Reset To</th>
                  <th style={{ width: 120 }}>Move</th>
                  <th style={{ width: 60 }} />
                </tr>
              </thead>
              <tbody>
                {rounds.map((r, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td style={{ textAlign: "left" }}>
                      <input value={r.name} disabled={disabled}
                        onChange={e => patchRound(i, { name: e.target.value })}
                        placeholder={`Round ${i + 1}`} />
                    </td>
                    <td>
                      <input type="number" min="0" value={r.races} disabled={disabled}
                        onChange={e => patchRound(i, { races: e.target.value })} />
                    </td>
                    <td>
                      {i === rounds.length - 1
                        ? <span title="The last round decides the title, so exactly one driver comes out of it">🏆 Champion</span>
                        : (
                          <input type="number" min="1" value={r.advance} disabled={disabled}
                            onChange={e => patchRound(i, { advance: e.target.value })} />
                        )}
                    </td>
                    <td>
                      <input type="number" value={r.reset_base} disabled={disabled}
                        onChange={e => patchRound(i, { reset_base: e.target.value })} />
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button type="button" className="icon-btn" title="Move up" disabled={disabled || i === 0}
                        onClick={() => moveRound(i, -1)}>↑</button>
                      <button type="button" className="icon-btn" title="Move down"
                        disabled={disabled || i === rounds.length - 1} onClick={() => moveRound(i, 1)}>↓</button>
                    </td>
                    <td>
                      <button type="button" className="icon-btn icon-btn-danger" title="Remove this round"
                        disabled={disabled || rounds.length <= 1} onClick={() => removeRound(i)}>🗑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <button type="button" className="btn btn-ghost" style={{ marginTop: 0 }} disabled={disabled}
              onClick={addRound}>+ Add a round</button>
            <button type="button" className="btn btn-ghost" style={{ marginTop: 0 }} disabled={disabled}
              title={`Throw these rounds away and generate a fresh ladder for a ${cfg.field_size}-driver field`}
              onClick={rebuildRounds}>↻ Rebuild from field size</button>
          </div>

          <h4 className="playoff-heading">How the rounds behave</h4>
          <div className="field check-row">
            <input type="checkbox" id="playoff_reset_between_rounds" disabled={disabled}
              checked={raw.reset_between_rounds} onChange={check("reset_between_rounds")} />
            <label htmlFor="playoff_reset_between_rounds" style={{ margin: 0 }}>
              Reset the points at the start of every round
              <span style={hint}>
                On: the survivors all drop to that round&rsquo;s <strong>Reset To</strong> number (plus their
                banked playoff points, if those carry), so every round is a fresh fight. Off: the points
                simply keep running from where the last round left them.
              </span>
            </label>
          </div>
          <div className="field check-row">
            <input type="checkbox" id="playoff_advance_on_win" disabled={disabled}
              checked={raw.advance_on_win} onChange={check("advance_on_win")} />
            <label htmlFor="playoff_advance_on_win" style={{ margin: 0 }}>
              Win a race in a round and you&rsquo;re through
              <span style={hint}>
                On: a race winner advances whatever the points say, and takes one of the round&rsquo;s slots
                with them — the rest go to the leading drivers on points. This is the rule that makes an
                elimination round worth watching from 12th.
              </span>
            </label>
          </div>

          <h4 className="playoff-heading">How the title is settled</h4>
          <ChoiceRows name="playoff_finale_mode" options={FINALE_MODES} value={raw.finale_mode}
            disabled={disabled} onChange={v => set({ finale_mode: v })} />
          <div className="field check-row" style={{ marginTop: 12 }}>
            <input type="checkbox" id="playoff_finale_reset" disabled={disabled}
              checked={raw.finale_reset} onChange={check("finale_reset")} />
            <label htmlFor="playoff_finale_reset" style={{ margin: 0 }}>
              The finalists start the last round dead level
              <span style={hint}>
                On: everyone who reaches the final round is put on the same number, with no playoff points and
                no seeding advantage — whoever beats the others wins the title. Off: they carry the gap they
                earned into it.
              </span>
            </label>
          </div>
        </div>
      )}

      {/* ── Playoff Points ─────────────────────────────────────────────── */}
      {section === "points" && (
        <div className="playoff-section">
          <h4 className="playoff-heading">Playoff points</h4>
          <p style={subLabel}>
            A second currency, banked rather than spent. The ordinary points structure still scores every race
            exactly as it always did — these are paid on top, they seed the field, and they are what survives a
            reset. They&rsquo;re read off results this app already records, so there is nothing extra to enter.
          </p>

          <div className="field check-row">
            <input type="checkbox" id="playoff_points_enabled" disabled={disabled}
              checked={raw.playoff_points_enabled} onChange={check("playoff_points_enabled")} />
            <label htmlFor="playoff_points_enabled" style={{ margin: 0 }}>
              This season pays playoff points
              <span style={hint}>
                Off: nothing below is paid and the field is seeded purely on where drivers finished the regular
                season. Plenty of formats want exactly that.
              </span>
            </label>
          </div>

          {cfg.playoff_points_enabled && (
            <>
              <div className="playoff-grid">
                <div className="field">
                  <label htmlFor="pp_win">Per race win</label>
                  <input id="pp_win" type="number" min="0" disabled={disabled}
                    value={raw.playoff_points.win} onChange={e => setPP({ win: e.target.value })} />
                  <span style={subLabel}>Paid for winning a race or a heat weekend&rsquo;s Feature. NASCAR pays 5.</span>
                </div>
                <div className="field">
                  <label htmlFor="pp_stage_win">Per heat / stage win</label>
                  <input id="pp_stage_win" type="number" min="0" disabled={disabled}
                    value={raw.playoff_points.stage_win} onChange={e => setPP({ stage_win: e.target.value })} />
                  <span style={subLabel}>
                    Paid for winning a heat or a consolation — this app&rsquo;s version of a stage win. NASCAR pays 1.
                  </span>
                </div>
                <div className="field">
                  <label htmlFor="pp_pole">Per pole</label>
                  <input id="pp_pole" type="number" min="0" disabled={disabled}
                    value={raw.playoff_points.pole} onChange={e => setPP({ pole: e.target.value })} />
                  <span style={subLabel}>Paid for topping a Qualifying session.</span>
                </div>
                <div className="field">
                  <label htmlFor="pp_regular_champion">To the regular season champion</label>
                  <input id="pp_regular_champion" type="number" min="0" disabled={disabled}
                    value={raw.playoff_points.regular_champion}
                    onChange={e => setPP({ regular_champion: e.target.value })} />
                  <span style={subLabel}>
                    A one-off bonus for leading the points when the regular season ends. NASCAR pays 15.
                  </span>
                </div>
              </div>

              <PointsScaleField
                id="playoff_points_positions"
                label="Playoff points by finishing position — comma-separated, 1st place first"
                what="playoff points" rows={2} disabled={disabled}
                value={raw.playoff_points.positions}
                placeholder="10, 9, 8, 7, 6, 5, 4, 3, 2, 1"
                onChange={next => setPP({ positions: next })}>
                <span style={subLabel}>
                  Optional, and paid on top of the win bonus above — for formats that reward a whole top ten
                  rather than only the winner. Leave it blank and only the values above are paid. Same box as
                  every other points scale, so you can paste it straight out of a spreadsheet.
                </span>
              </PointsScaleField>
            </>
          )}
        </div>
      )}

      {/* ── Champions ──────────────────────────────────────────────────── */}
      {section === "titles" && (
        <div className="playoff-section">
          <h4 className="playoff-heading">The regular season champion</h4>
          <div className="field check-row">
            <input type="checkbox" id="playoff_regular_season_champion" disabled={disabled}
              checked={raw.regular_season_champion} onChange={check("regular_season_champion")} />
            <label htmlFor="playoff_regular_season_champion" style={{ margin: 0 }}>
              Crown a regular season champion
              <span style={hint}>
                On: whoever leads the points when the last regular-season round is in the books is crowned, and
                the Playoffs panel says so. Plenty of series don&rsquo;t do this at all — switch it off and the
                regular season simply sets the playoff field.
              </span>
            </label>
          </div>
          {cfg.regular_season_champion && (
            <>
              <div className="field check-row">
                <input type="checkbox" id="playoff_regular_season_counts_title" disabled={disabled}
                  checked={raw.regular_season_counts_title} onChange={check("regular_season_counts_title")} />
                <label htmlFor="playoff_regular_season_counts_title" style={{ margin: 0 }}>
                  It counts as a title in career and team stats
                  <span style={hint}>
                    On: the regular season championship is a <strong>Championship</strong> on that driver&rsquo;s
                    record, alongside the playoff title — two crowns were decided, so a driver who takes both
                    scores both. Off: it&rsquo;s an honour the standings show, but nothing is added to their
                    titles.
                  </span>
                </label>
              </div>
              <div className="playoff-grid">
                <div className="field">
                  <label htmlFor="playoff_regular_season_title">What it&rsquo;s called</label>
                  <input id="playoff_regular_season_title" disabled={disabled}
                    value={raw.regular_season_title} onChange={field("regular_season_title")}
                    placeholder="Regular Season Champion" />
                  <span style={subLabel}>Shown on the standings and on the winning driver&rsquo;s record.</span>
                </div>
                <div className="field">
                  <label htmlFor="playoff_champion_title">What the playoff winner is called</label>
                  <input id="playoff_champion_title" disabled={disabled}
                    value={raw.champion_title} onChange={field("champion_title")}
                    placeholder="Champion" />
                  <span style={subLabel}>
                    &ldquo;Champion&rdquo;, &ldquo;Cup Champion&rdquo;, &ldquo;Title Holder&rdquo; — whatever
                    your league calls it.
                  </span>
                </div>
              </div>
            </>
          )}

          <p style={{ ...subLabel, marginTop: 12 }}>
            Both crowns are awarded only once the season is marked <strong>complete</strong>, exactly like
            every other championship in the app — and a season split into classes runs this playoff{" "}
            <strong>per class</strong>, so each class seeds its own field and crowns its own playoff champion.
          </p>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
        <span style={subLabel}>
          Nothing here is saved until you save the season — close this and the rest of the season form is
          still waiting.
        </span>
        <button type="button" className="btn btn-primary" style={{ marginTop: 0 }} onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
