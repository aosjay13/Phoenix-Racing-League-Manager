// Driver aliases / connected accounts — the platform usernames one human racer
// uses across games. Stored on the global driver doc (drivers/<id>.aliases) as
// an ordered array of { label, value } pairs, so the set is fully extensible:
// admins can edit values, add custom platforms, or remove fields entirely.
//
// The importer (CSV paste today, any OCR path in future) matches an imported
// name against a driver's primary name AND every alias value — so a GT7 export
// that lists a PSN username still resolves to the right Driver Profile. See
// matchDriver in lib/resultsImport.js.

// The platforms every driver starts with in the edit modal. Kept here (not in
// the component) so both the UI and any server-side seeding agree.
export const DEFAULT_ALIAS_LABELS = [
  "Discord Name",
  "PSN Username",
  "Xbox Gamertag",
  "Steam Username",
  "iRacing Name",
  "iRacing ID#",
];

// Coerce whatever is stored (or missing) into a clean [{label, value}] array.
export function normalizeAliases(stored) {
  if (!Array.isArray(stored)) return [];
  return stored
    .filter(a => a && typeof a === "object")
    .map(a => ({ label: String(a.label ?? "").trim(), value: String(a.value ?? "").trim() }))
    .filter(a => a.label);
}

// Merge saved aliases over the default platform list for editing: every default
// label appears once (pre-filled if saved), followed by any custom platforms the
// admin added. This is what the edit modal renders.
export function withDefaults(stored) {
  const saved = normalizeAliases(stored);
  const byLabel = new Map(saved.map(a => [a.label.toLowerCase(), a]));
  const rows = DEFAULT_ALIAS_LABELS.map(label => ({
    label,
    value: byLabel.get(label.toLowerCase())?.value || "",
  }));
  const defaultsLower = new Set(DEFAULT_ALIAS_LABELS.map(l => l.toLowerCase()));
  for (const a of saved) if (!defaultsLower.has(a.label.toLowerCase())) rows.push(a);
  return rows;
}

// The non-empty alias value strings — the extra names the importer fuzzy-matches
// against alongside the driver's primary name.
export function aliasValues(stored) {
  return normalizeAliases(stored).map(a => a.value).filter(Boolean);
}
