"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import { PLACEMENT_METRICS, previewAutoPlace } from "@/lib/placements";

// "Auto-Place Drivers" — deal the whole field into the divisions by lap time.
//
// It asks one question first, and it has to: **Best Lap or Average Lap?** The
// two orders genuinely differ. Best Lap rewards the driver who found one
// perfect lap; Average Lap rewards the one who could repeat it all night. Which
// of those a league sorts on is a decision about what its divisions MEAN, and
// the app has no business assuming it — a field split the wrong way is a whole
// season of drivers in the wrong division.
//
// So the choice is made here, with the resulting split shown live underneath
// it: how many drivers land in each bucket, and who is left out for having set
// no lap. Changing the metric redraws the answer before anything is applied.
//
// Nothing here is final. The placement it produces is a starting point — every
// card stays draggable afterwards, and nothing is saved until the admin saves.
export function AutoPlaceModal({ rows = [], buckets = [], defaultMetric = "best", onClose, onApply }) {
  const [metric, setMetric] = useState(defaultMetric === "average" ? "average" : "best");
  const preview = useMemo(() => previewAutoPlace(rows, buckets, { key: metric }), [rows, buckets, metric]);
  const nothingToDo = preview.placing === 0;

  return (
    <Modal title="Auto-place drivers" onClose={onClose}>
      <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.9rem", lineHeight: 1.55 }}>
        The field is ranked by the time you pick and split evenly across the divisions, quickest
        first — the top of the sheet into <strong>{buckets[0]?.label || "the first division"}</strong>,
        and on down. Review it on the board afterwards and drag anybody you disagree with.
      </p>

      <div className="field">
        <span className="field-label">Sort the field by</span>
        <div className="option-rows">
          {PLACEMENT_METRICS.map(m => (
            <label key={m.key} className="check-row" style={{ margin: 0, alignItems: "flex-start" }}>
              <input type="radio" name="auto_place_metric" value={m.key} checked={metric === m.key}
                onChange={() => setMetric(m.key)} />
              <span>
                {m.label}
                <span style={{ display: "block", fontWeight: 400, fontSize: "0.78rem", color: "var(--ink-2)" }}>
                  {m.hint}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="bonus-panel">
        <div className="bonus-panel-title">What this will do</div>
        {nothingToDo ? (
          <p className="bonus-panel-note" style={{ color: "var(--accent-gold)" }}>
            Nobody has set a usable lap yet, so there is nothing to sort. Enter some times on the
            sheet first, or place drivers by hand.
          </p>
        ) : (
          <>
            <div className="bonus-panel-row">
              {preview.counts.map(c => (
                <span key={c.key} className="bonus-chip">{c.label} · {c.count}</span>
              ))}
            </div>
            <p className="bonus-panel-note">
              {preview.placing} driver{preview.placing === 1 ? "" : "s"} placed by{" "}
              {metric === "average" ? "average lap" : "best lap"}.
            </p>
            {preview.noTime.length > 0 && (
              <p className="bonus-panel-note">
                Left in the unplaced pool — no lap time to sort on:{" "}
                {preview.noTime.slice(0, 8).join(", ")}
                {preview.noTime.length > 8 ? `, and ${preview.noTime.length - 8} more` : ""}.
              </p>
            )}
          </>
        )}
      </div>

      <button className="btn btn-primary" type="button" disabled={nothingToDo}
        onClick={() => onApply(preview.assignment, metric)}>
        Place {preview.placing} Driver{preview.placing === 1 ? "" : "s"}
      </button>
      <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={onClose}>Cancel</button>
    </Modal>
  );
}
