"use client";

// Pick the classes one driver races in. A driver can be in several at once —
// Pro and Am, GT3 and LMP2 — from a single roster entry, so nobody has to be
// added to the roster once per class. Ticking nothing means Unclassified: they
// still count toward the season's overall championship, just not a class one.
//
// The value is an ordered array of class ids; the first is the driver's primary
// class, which is what a single-class field (a standings row's Class column, an
// unstamped result) falls back to.
export function ClassPicker({ classes = [], value = [], onChange, disabled = false }) {
  const selected = Array.isArray(value) ? value : [];

  function toggle(id) {
    onChange(selected.includes(id) ? selected.filter(c => c !== id) : [...selected, id]);
  }

  if (!classes.length) return null;

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      {classes.map(c => (
        <label
          key={c.id}
          title={selected[0] === c.id && selected.length > 1 ? `${c.name} — primary class` : c.name}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "0.85rem", cursor: disabled ? "default" : "pointer" }}
        >
          <input type="checkbox" disabled={disabled} checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
          {c.name}
        </label>
      ))}
      {selected.length === 0 && (
        <span style={{ fontSize: "0.78rem", color: "var(--ink-2)" }}>Unclassified</span>
      )}
    </div>
  );
}
