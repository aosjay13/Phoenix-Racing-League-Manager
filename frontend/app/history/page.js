"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { api } from "@/lib/api";
import { formatRaceDate, isPastRaceDate, raceDateSortKey } from "@/lib/raceDate";
import { lapsAreSecondary } from "@/lib/raceLength";

// Race History — every race the league has ever run, newest first, in one
// continuous scrolling table that runs all the way back to the very first race.
//
// Deliberately NOT scoped to the selected season: history is the whole story,
// across seasons. The Game / Series selectors still narrow it (history of one
// series is a sensible thing to want), but Season does not — otherwise the list
// would stop at the season boundary instead of scrolling back to race #1.

const fmtDate = d => formatRaceDate(d, "short");

function Person({ p }) {
  if (!p || !p.name) return <span style={{ color: "var(--ink-2)" }}>—</span>;
  const id = p.driver_id || p.user_id;
  return id
    ? <Link href={`/drivers/${id}`} style={{ color: "var(--accent-cyan)" }}>{p.name}</Link>
    : <span>{p.name}</span>;
}

// Pole / Winner. A round several classes ran has one of each PER CLASS, so the
// cell stacks a line per class rather than showing one class's driver as if it
// were the round's — same treatment the Schedule gives it.
function PersonCell({ summary, classSummaries, field }) {
  if (classSummaries?.length && summary?.has_results) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {classSummaries.map(cs => (
          <span key={cs.class_id} style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}>
            <span className="badge" style={{ marginRight: 6 }}>{cs.class_name}</span>
            <Person p={cs[field]} />
          </span>
        ))}
      </div>
    );
  }
  return <Person p={summary?.[field]} />;
}

// One car for the round, or one line per class when the classes ran different
// machinery.
function CarCell({ summary, classCars }) {
  if (classCars?.length) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {classCars.map(c => (
          <span key={c.class_id} style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}>
            <span className="badge" style={{ marginRight: 6 }}>{c.class_name}</span>
            {c.car || <span style={{ color: "var(--ink-2)" }}>—</span>}
          </span>
        ))}
      </div>
    );
  }
  return summary?.car || <span style={{ color: "var(--ink-2)" }}>—</span>;
}

export default function HistoryPage() {
  const { gameId, seriesId, game, series } = useLeague();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    const qs = seriesId ? `series_id=${seriesId}` : gameId ? `game_id=${gameId}` : "";
    setRows(null);
    api(`/api/schedule${qs ? `?${qs}` : ""}`).then(setRows).catch(() => setRows([]));
  }, [gameId, seriesId]);

  // History is what has already happened: a race with saved results, or one
  // whose date has passed (run but not yet entered). Newest first, all the way
  // back. The Race # column counts the other way — the first race in history is
  // #1 — so the numbering stays stable as new races are added on top.
  const history = useMemo(() => {
    const past = (rows || [])
      .filter(r => r.summary?.has_results || isPastRaceDate(r.date))
      .sort((a, b) => raceDateSortKey(b.date, -Infinity) - raceDateSortKey(a.date, -Infinity));
    const total = past.length;
    return past.map((r, i) => ({ ...r, race_no: total - i }));
  }, [rows]);

  const scopeLabel = series?.name || game?.name || "All Games";

  return (
    <section>
      <div className="page-title">
        <h2>Race History</h2>
        <span className="page-badge">{scopeLabel}</span>
        {history.length > 0 && (
          <span className="page-badge">{history.length} Race{history.length === 1 ? "" : "s"}</span>
        )}
      </div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.9rem", maxWidth: 760 }}>
        Every race the league has run, starting with the most recent and scrolling back to the very
        first one. Narrow it with the Game / Series menus above — the Season menu doesn&apos;t apply
        here, so the list runs straight across every season.
      </p>

      {rows == null ? (
        <div className="skeleton" style={{ height: 260, marginTop: 16 }} />
      ) : history.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">📜</span>
          <p>No races have been run yet in this scope.</p>
        </div>
      ) : (
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table className="stats-table schedule-table">
            <thead>
              <tr>
                <th>Race #</th>
                <th>Race Date</th>
                <th className="sticky-col" style={{ textAlign: "left" }}>Event / Track</th>
                <th>Race Length</th>
                <th style={{ textAlign: "left" }}>Car</th>
                <th style={{ textAlign: "left" }}>Pole</th>
                <th style={{ textAlign: "left" }}>Winner</th>
                <th>Num Drivers</th>
                <th>Results</th>
              </tr>
            </thead>
            <tbody>
              {history.map(r => {
                const s = r.summary || {};
                return (
                  <tr key={r.id}>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.race_no}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.date)}</td>
                    <td className="sticky-col" style={{ textAlign: "left" }}>
                      <Link href={`/races/${r.id}`} style={{ color: "var(--accent-cyan)", fontWeight: 600 }}>{r.name}</Link>
                      {r.track && <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.78rem" }}>{r.track}</span>}
                      <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.72rem" }}>
                        {[r.series_name, r.season_name].filter(Boolean).join(" · ")}
                      </span>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {s.length_label || "—"}
                      {lapsAreSecondary(s.length_type) && !!s.laps && (
                        <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.72rem" }}
                          title="Laps the winner completed">{s.laps} laps</span>
                      )}
                      {s.laps_extended && (
                        <span title={`Scheduled ${s.scheduled_laps} laps — extended by a green-white-checkered / overtime finish`}
                          style={{ marginLeft: 5, fontSize: "0.7rem", color: "var(--accent-cyan)", fontWeight: 700 }}>GWC</span>
                      )}
                    </td>
                    <td style={{ textAlign: "left" }}><CarCell summary={s} classCars={r.class_cars} /></td>
                    <td style={{ textAlign: "left" }}><PersonCell summary={s} classSummaries={r.class_summaries} field="pole" /></td>
                    <td style={{ textAlign: "left", fontWeight: s.winner ? 600 : undefined }}>
                      <PersonCell summary={s} classSummaries={r.class_summaries} field="winner" />
                    </td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{s.num_drivers || "—"}</td>
                    <td>
                      {s.has_results
                        ? <Link href={`/races/${r.id}`} title="View race results" style={{ fontSize: "1.1rem" }}>🏁</Link>
                        : <span className="race-status status-completed" style={{ fontSize: "0.7rem" }}>TBD</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
