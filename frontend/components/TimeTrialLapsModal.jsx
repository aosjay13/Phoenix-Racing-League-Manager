"use client";

import { Modal } from "@/components/Modal";
import { averageLabel, lapRows, summarizeEntry } from "@/lib/timeTrials";

// Every lap one driver submitted, in full — the expanded view behind clicking a
// name on the sheet. The sheet itself shows the two summary columns; this is
// where the laps they were derived from are read, with the fastest one called
// out exactly as the grid bolds it.
export function TimeTrialLapsModal({ entry, averageLaps = 0, className = "", onClose }) {
  const row = summarizeEntry(entry, { averageLaps });
  const laps = lapRows(row.laps);

  return (
    <Modal title={row.name || "Driver"} onClose={onClose}>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 6 }}>
        <div>
          <div className="metric-label">Best Time</div>
          <div style={{ fontSize: "1.3rem", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "var(--accent-gold)" }}>
            {row.best_time || "—"}
          </div>
          {row.best_lap && <div style={{ fontSize: "0.76rem", color: "var(--ink-2)" }}>on lap {row.best_lap}</div>}
        </div>
        <div>
          <div className="metric-label">{averageLabel(averageLaps)}</div>
          <div style={{ fontSize: "1.3rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
            {row.avg_time || "—"}
          </div>
          {row.avg_laps_counted > 0 && (
            <div style={{ fontSize: "0.76rem", color: "var(--ink-2)" }}>
              from {row.avg_laps_counted} lap{row.avg_laps_counted === 1 ? "" : "s"}
            </div>
          )}
        </div>
        {className && (
          <div>
            <div className="metric-label">Division</div>
            <div style={{ fontSize: "1.05rem", fontWeight: 600, marginTop: 4 }}>
              <span className="class-scope-chip">{className}</span>
            </div>
          </div>
        )}
      </div>

      <div className="table-wrap" style={{ marginTop: 14 }}>
        <table className="stats-table">
          <thead>
            <tr><th>Lap</th><th>Time</th></tr>
          </thead>
          <tbody>
            {laps.length === 0 && (
              <tr><td colSpan={2} style={{ color: "var(--ink-2)" }}>No laps submitted yet.</td></tr>
            )}
            {laps.map(lap => {
              const isBest = lap.lap === row.best_lap;
              return (
                <tr key={lap.lap}>
                  <td>{lap.lap}</td>
                  <td style={{
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: isBest ? 700 : 400,
                    color: isBest ? "var(--accent-gold)" : (lap.seconds == null ? "var(--ink-2)" : "var(--ink-0)"),
                  }}>
                    {lap.text || "—"}
                    {isBest && <span style={{ marginLeft: 6, fontSize: "0.7rem" }}>fastest</span>}
                    {lap.text && lap.seconds == null && (
                      <span style={{ marginLeft: 6, fontSize: "0.7rem", color: "#e5484d" }}>unreadable</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {row.notes && (
        <p style={{ marginTop: 12, fontSize: "0.85rem", color: "var(--ink-1)" }}>{row.notes}</p>
      )}
    </Modal>
  );
}
