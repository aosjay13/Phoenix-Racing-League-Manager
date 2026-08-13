"use client";

import { useState } from "react";
import { groupRowsByBucket } from "@/lib/placements";

// The placement board: the unplaced field on the left, one column per division
// across the rest, and driver cards dragged between them.
//
// This is the whole point of the round-two placements work. Sorting forty
// drivers into divisions through a column of dropdowns means reading forty
// rows to answer "how big is Pro?", and it means an admin who isn't especially
// technical is doing careful data entry rather than the thing they actually
// came to do, which is a judgement call about pace. Trays and cards ARE the
// job: you can see the shape of every division at a glance, and moving
// somebody is picking them up and putting them down.
//
// Three ways to move a driver, on purpose — drag-and-drop is the nice one, not
// the only one:
//
//   • drag a card into a column (mouse / trackpad);
//   • the "Move to" menu on every card, which is what makes this work on a
//     phone or a tablet, where there is no dragging, and with a keyboard and a
//     screen reader, where there is no pointer at all;
//   • ✕ on a placed card sends them back to the unplaced pool.
//
// Nothing here writes anything. It edits the sheet in memory exactly as typing
// a lap does, and the page's Save is still what commits it.

// One driver, as a card. Draggable, and carrying the two numbers a placement
// decision is actually made on.
function DriverCard({ row, metric, buckets, currentKey, onMove, onDrag, canEdit }) {
  const time = metric === "average" ? row.avg_time : row.best_time;
  const other = metric === "average" ? row.best_time : row.avg_time;
  return (
    <div
      className={`placement-card${row.best_seconds == null ? " is-timeless" : ""}`}
      draggable={canEdit}
      onDragStart={e => {
        if (!canEdit) return;
        // Some browsers refuse to start a drag with nothing on the transfer.
        e.dataTransfer.setData("text/plain", row.id);
        e.dataTransfer.effectAllowed = "move";
        onDrag(row.id);
      }}
      onDragEnd={() => onDrag(null)}>
      <div className="placement-card-head">
        <span className="placement-card-name">
          {row.name || <em style={{ color: "var(--ink-2)" }}>Unnamed</em>}
          {row.number ? <span className="placement-card-number">#{row.number}</span> : null}
        </span>
        {canEdit && currentKey && (
          <button type="button" className="icon-btn" title="Send back to the unplaced pool"
            onClick={() => onMove(row.id, "")}>✕</button>
        )}
      </div>
      <div className="placement-card-times">
        <span className="placement-card-time">{time || "—"}</span>
        <span className="placement-card-alt">
          {metric === "average" ? "avg" : "best"} · {other ? `${other} ${metric === "average" ? "best" : "avg"}` : "no other time"}
        </span>
      </div>
      {canEdit && (
        // The accessible, touch-friendly twin of dragging. Same action, same
        // result — a board that only works with a mouse is a board half the
        // league can't use.
        <select className="placement-card-move" value={currentKey || ""}
          aria-label={`Move ${row.name || "this driver"} to a division`}
          onChange={e => onMove(row.id, e.target.value)}>
          <option value="">Unplaced</option>
          {buckets.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
        </select>
      )}
    </div>
  );
}

// One column. The pool is a column too — dropping somebody back into it is how
// a placement is undone, so it has to accept a drop like any other.
function BucketColumn({ bucket, rows, metric, buckets, onMove, onDrag, dragging, canEdit }) {
  const [over, setOver] = useState(false);
  const isPool = !bucket;
  const key = isPool ? "" : bucket.key;

  return (
    <div
      className={`placement-column${isPool ? " is-pool" : ""}${over && canEdit ? " is-over" : ""}${bucket?.incomplete ? " is-incomplete" : ""}`}
      onDragOver={e => { if (canEdit && dragging) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        setOver(false);
        if (!canEdit) return;
        e.preventDefault();
        const id = e.dataTransfer.getData("text/plain") || dragging;
        if (id) onMove(id, key);
      }}>
      <div className="placement-column-head">
        <span className="placement-column-title">{isPool ? "Unplaced drivers" : bucket.label}</span>
        <span className="placement-column-count">{rows.length}</span>
      </div>
      <span className="placement-column-sub">
        {isPool
          ? (rows.length ? "Drag these into a division" : "Everybody has a division")
          : bucket.sub}
      </span>
      {bucket?.incomplete && (
        <span className="placement-column-warn">
          ⚠ No season behind this destination — pick one in Destinations, or nobody placed here can
          be added to a roster.
        </span>
      )}
      <div className="placement-column-body">
        {rows.length === 0 && (
          <p className="placement-column-empty">
            {isPool ? "Nobody left to place." : canEdit ? "Drop drivers here" : "Nobody placed here"}
          </p>
        )}
        {rows.map(row => (
          <DriverCard key={row.id} row={row} metric={metric} buckets={buckets}
            currentKey={key} onMove={onMove} onDrag={onDrag} canEdit={canEdit} />
        ))}
      </div>
    </div>
  );
}

export function PlacementBoard({ rows = [], buckets = [], metric = "best", canEdit = true, onMove }) {
  // The card currently being dragged. Held so a drop still knows who moved on
  // the browsers that hand back an empty dataTransfer, and so the columns can
  // light up only while something is actually in the air.
  const [dragging, setDragging] = useState(null);
  const { byBucket, unplaced } = groupRowsByBucket(rows, buckets, { key: metric });

  if (!buckets.length) {
    return (
      <div className="empty-state" style={{ marginTop: 16 }}>
        <span className="empty-state-icon">🎽</span>
        <p>
          No divisions picked yet. Hit <strong>Destinations</strong> above and tick the series and
          classes these drivers are being sorted into — each one becomes a column here.
        </p>
      </div>
    );
  }

  return (
    <div className="placement-board">
      <BucketColumn bucket={null} rows={unplaced} metric={metric} buckets={buckets}
        onMove={onMove} onDrag={setDragging} dragging={dragging} canEdit={canEdit} />
      {buckets.map(b => (
        <BucketColumn key={b.key} bucket={b} rows={byBucket.get(b.key) || []} metric={metric}
          buckets={buckets} onMove={onMove} onDrag={setDragging} dragging={dragging} canEdit={canEdit} />
      ))}
    </div>
  );
}
