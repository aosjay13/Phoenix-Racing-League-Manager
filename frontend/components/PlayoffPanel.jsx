"use client";

import Link from "next/link";
import { useState } from "react";

// ── The Playoffs panel on Standings ────────────────────────────────────────
//
// What a season's playoff actually looks like right now: who made the field and
// on what, what each round did to it, and who is still alive. It sits above the
// championship table rather than replacing it, because both are true — the table
// is how the points stand, and this is who can still win.
//
// Everything on it is computed (lib/playoffs.js, through lib/standingsCompute.js)
// from the season's own rules and the results already on the board. Nothing here
// is entered by hand, so the bracket can't disagree with the results.
//
// `playoffs` is the payload buildPlayoffs() returns for the scope being viewed —
// the whole season at "All Classes", or one class's own bracket inside a class.
// Null for every season that doesn't run a playoff, which is when this renders
// nothing at all.

function Driver({ row }) {
  if (!row) return <span style={{ color: "var(--ink-2)" }}>—</span>;
  const id = row.driver_id || row.user_id;
  return id
    ? <Link href={`/drivers/${id}`} style={{ color: "inherit" }}>{row.driver_name}</Link>
    : <span>{row.driver_name}</span>;
}

const fmt = n => (Number.isFinite(Number(n)) ? Math.round(Number(n) * 100) / 100 : 0);

// One round of the ladder, as a card: its races, its field and what it did to
// them. A round nobody has reached yet still gets a card — a bracket you can
// only see the played half of is not a bracket.
function RoundCard({ round, active, championTitle }) {
  const run = round.races.filter(r => r.run).length;
  return (
    <div className={`playoff-round-card${active ? " is-active" : ""}${round.is_final ? " is-final" : ""}`}>
      <div className="playoff-round-head">
        <strong>{round.name}</strong>
        <span>
          {round.races.length
            ? `${run}/${round.races.length} race${round.races.length === 1 ? "" : "s"}`
            : "no rounds scheduled"}
        </span>
      </div>
      <span style={{ display: "block", fontSize: "0.72rem", color: "var(--ink-2)", marginBottom: 6 }}>
        {round.is_final
          ? (round.decided_on === "best_finish"
            ? `Best finisher takes the ${championTitle.toLowerCase()}`
            : `Leader at the end takes the ${championTitle.toLowerCase()}`)
          : `Top ${round.advance} advance`}
        {round.races.length > 0 && ` · rounds ${round.races[0].round_number}–${round.races[round.races.length - 1].round_number}`}
      </span>
      {round.rows.length === 0 ? (
        <span style={{ fontSize: "0.8rem", color: "var(--ink-2)" }}>Not reached yet.</span>
      ) : (
        <ul className="playoff-round-list">
          {round.rows.map((row, i) => {
            const cut = !round.is_final && i + 1 === round.advance && i + 1 < round.rows.length;
            return (
              <li key={row.entry_id}
                className={[
                  row.status === "advanced" ? "is-advanced" : "",
                  row.status === "eliminated" ? "is-eliminated" : "",
                  row.status === "champion" ? "is-champion" : "",
                  cut ? "playoff-cut" : "",
                ].filter(Boolean).join(" ")}
                title={`Started the round on ${fmt(row.started_on)} · scored ${fmt(row.round_points)} in it`}>
                <span className="playoff-seed">{row.seed ? `#${row.seed}` : ""}</span>
                <span className="playoff-name">
                  <Driver row={row} />
                  {row.status === "champion" && " 🏆"}
                  {row.round_wins > 0 && round.decided_on !== "best_finish" && (
                    <span title="Won a race in this round" style={{ marginLeft: 4 }}>🏁</span>
                  )}
                </span>
                <span className="playoff-pts">
                  {round.decided_on === "best_finish" && round.is_final && row.decider_finish
                    ? `P${row.decider_finish}`
                    : fmt(row.points)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function PlayoffPanel({ playoffs, seasonName = "", className = "" }) {
  const [showField, setShowField] = useState(false);
  if (!playoffs) return null;

  const cfg = playoffs.config;
  const status = playoffs.champion
    ? "Decided"
    : playoffs.started
      ? (playoffs.active_round?.name || "Under way")
      : playoffs.regular_complete
        ? "Field set"
        : "Regular season";

  return (
    <div className="playoff-panel">
      <div className="playoff-panel-head">
        <h3>🏆 Playoffs{className ? ` · ${className}` : ""}</h3>
        <span className="playoff-chip">{playoffs.format_name}</span>
        <span className="page-badge">{status}</span>
        {!playoffs.scheduled && (
          <span className="page-badge is-muted" title="The tick is on, but no round on the calendar falls after the regular season">
            Not scheduled
          </span>
        )}
      </div>

      <p style={{ margin: "6px 0 0", fontSize: "0.84rem", color: "var(--ink-1)" }}>
        {playoffs.summary}. The regular season is rounds 1&ndash;{playoffs.regular_rounds || "—"}
        {playoffs.playoff_race_ids.length > 0 && `, then ${playoffs.playoff_race_ids.length} playoff round${playoffs.playoff_race_ids.length === 1 ? "" : "s"}`}.
        {" "}The championship table below is still the season&rsquo;s full points &mdash; this is who those points can still win it for.
      </p>

      {cfg.notes && <p className="playoff-note">&ldquo;{cfg.notes}&rdquo;</p>}

      {(playoffs.regular_champion || playoffs.champion) && (
        <div className="playoff-crowns">
          {playoffs.regular_champion && (
            <span className="playoff-crown">
              🥇 <Driver row={playoffs.regular_champion} />
              <span>{playoffs.regular_champion.title} · {fmt(playoffs.regular_champion.points)} pts</span>
            </span>
          )}
          {playoffs.champion && (
            <span className="playoff-crown">
              🏆 <Driver row={playoffs.champion} />
              <span>{playoffs.champion.title}</span>
            </span>
          )}
        </div>
      )}

      {/* The field, and the cutline. Open by default before the playoff starts —
          while it's still a projection it IS the story — and tucked away once
          the rounds below have taken over. */}
      <button type="button" className="btn btn-ghost" style={{ marginTop: 10 }}
        onClick={() => setShowField(v => !v)}>
        {showField || !playoffs.started ? "▾" : "▸"} The Field
        {playoffs.seeds.length > 0 && ` · ${playoffs.seeds.length} in`}
      </button>

      {(showField || !playoffs.started) && (
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="stats-table">
            <thead>
              <tr>
                <th style={{ width: 50 }}>Seed</th>
                <th style={{ textAlign: "left" }}>Driver</th>
                <th>Regular Season</th>
                <th>Wins</th>
                <th title="Banked playoff points — they seed the field and survive every reset">Playoff Pts</th>
                <th title="What they start the playoff on">Starts On</th>
              </tr>
            </thead>
            <tbody>
              {playoffs.seeds.map((row, i) => (
                <tr key={row.entry_id} className={i + 1 === playoffs.seeds.length ? "playoff-cut" : undefined}>
                  <td>{row.seed}</td>
                  <td className="driver-name-cell" style={{ textAlign: "left" }}>
                    <Driver row={row} />
                    {row.qualified_by === "win" && (
                      <span className="playoff-badge" style={{ marginLeft: 6 }} title="In on a race win">in on a win</span>
                    )}
                    {row.qualified_by === "wildcard" && (
                      <span className="playoff-badge" style={{ marginLeft: 6 }}
                        title="A wildcard — put in the field by hand, not by points or wins">🃏 wildcard</span>
                    )}
                  </td>
                  <td>{fmt(row.regular_points)}</td>
                  <td>{row.wins}</td>
                  <td>{fmt(row.playoff_points)}</td>
                  <td className="points-cell">{fmt(row.points)}</td>
                </tr>
              ))}
              {playoffs.outsiders.length > 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "left" }}>
                    <span className="playoff-cut-label">— cutline —</span>
                  </td>
                </tr>
              )}
              {playoffs.outsiders.map(row => (
                <tr key={row.entry_id} style={{ opacity: 0.65 }}>
                  <td>{row.rank}</td>
                  <td className="driver-name-cell" style={{ textAlign: "left" }}><Driver row={row} /></td>
                  <td>{fmt(row.regular_points)}</td>
                  <td>{row.wins}</td>
                  <td>{fmt(row.playoff_points)}</td>
                  <td style={{ color: "var(--ink-2)" }}>out</td>
                </tr>
              ))}
            </tbody>
          </table>
          {playoffs.seeds.length === 0 && (
            <p style={{ margin: "8px 0 0", fontSize: "0.82rem", color: "var(--ink-2)" }}>
              Nobody has qualified yet &mdash; no regular-season results are on the board.
            </p>
          )}
        </div>
      )}

      <div className="playoff-rounds">
        {playoffs.rounds.map((round, i) => (
          <RoundCard key={`${round.name}-${i}`} round={round}
            active={i === playoffs.active_round_index && playoffs.started && !playoffs.champion}
            championTitle={cfg.champion_title} />
        ))}
      </div>
    </div>
  );
}
