// Places gained or lost since the latest round — the Chg column on the
// Standings table and on its share graphic. Kept quiet on purpose: a small
// arrow and a signed number in green or red, and a muted dash when nothing
// moved (or there's no earlier round to compare with).
//
// The colours are props rather than CSS variables because the share graphic is
// drawn in its own light or dark theme, whatever the app around it is using.
// The arrow and number sit at either end of a fixed-width box so a column of
// them lines up, the way SimRacerHub's does.
export function PositionChange({ value, up = "var(--positive, #34d399)", down = "var(--negative, #f87171)", flat = "var(--ink-2)" }) {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  if (!n) return <span style={{ color: flat }}>—</span>;
  const gained = n > 0;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "space-between",
      minWidth: "2.6em", color: gained ? up : down, fontWeight: 600, whiteSpace: "nowrap",
    }}>
      <span style={{ fontSize: "0.72em", marginRight: "0.4em" }}>{gained ? "▲" : "▼"}</span>
      <span>{gained ? "+" : "−"}{Math.abs(n)}</span>
    </span>
  );
}

// The same thing in words, for a tooltip.
export function positionChangeTitle(value) {
  if (value == null) return "No earlier round to compare with";
  if (value === 0) return "No change since the last round";
  const places = Math.abs(value) === 1 ? "place" : "places";
  return `${value > 0 ? "Gained" : "Lost"} ${Math.abs(value)} ${places} since the last round`;
}
