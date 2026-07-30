// Helpers for the race-results Race Time / Interval columns.
//
// A "time" is a clock string like "1:23:45.678" (h:m:s.ms), "1:23.456"
// (m:s.ms), or "12.345" (s.ms). An "interval" (gap behind the leader) is
// either a time gap (optionally "+"-prefixed) or a laps-down marker like
// "1L", "2L" (case-insensitive) meaning that many laps behind.

export function parseTime(str) {
  if (str == null) return null;
  const s = String(str).trim().replace(/^\+/, "");
  if (!s) return null;
  const parts = s.split(":").map(p => p.trim());
  if (!parts.length || parts.some(p => p === "" || isNaN(Number(p)))) return null;
  let sec = 0;
  for (const p of parts) sec = sec * 60 + Number(p);
  return sec < 0 ? null : sec;
}

const pad = (n, w = 2) => String(n).padStart(w, "0");

function breakdown(totalSec) {
  const ms = Math.round(totalSec * 1000);
  return {
    h: Math.floor(ms / 3600000),
    m: Math.floor((ms % 3600000) / 60000),
    s: Math.floor((ms % 60000) / 1000),
    millis: ms % 1000,
  };
}

// Total elapsed race time, e.g. "1:23.456" or "1:02:03.004".
export function formatTime(totalSec) {
  if (totalSec == null || isNaN(totalSec) || totalSec < 0) return "";
  const { h, m, s, millis } = breakdown(totalSec);
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}.${pad(millis, 3)}`;
  return `${m}:${pad(s)}.${pad(millis, 3)}`;
}

// Gap behind the leader, e.g. "+2.345" or "+1:02.345".
export function formatGap(gapSec) {
  if (gapSec == null || isNaN(gapSec) || gapSec < 0) return "";
  const { h, m, s, millis } = breakdown(gapSec);
  if (h > 0) return `+${h}:${pad(m)}:${pad(s)}.${pad(millis, 3)}`;
  if (m > 0) return `+${m}:${pad(s)}.${pad(millis, 3)}`;
  return `+${s}.${pad(millis, 3)}`;
}

// A signed gap string → seconds, negative allowed ("-0.180" → -0.18). parseTime
// itself rejects negatives (a lap or elapsed time can't be one); a gap between
// two entered times legitimately can be.
export function parseDelta(str) {
  if (str == null) return null;
  const s = String(str).trim();
  if (!s) return null;
  if (s.startsWith("-")) {
    const v = parseTime(s.slice(1));
    return v == null ? null : -v;
  }
  return parseTime(s);
}

// A signed gap, e.g. "+2.345" or "-0.180". Unlike formatGap, a negative value
// renders rather than blanking: on a qualifying sheet a driver placed below
// someone with a slower time shows "-0.180" instead of nothing, so an
// out-of-order grid is visible instead of silently swallowed.
export function formatDelta(gapSec) {
  if (gapSec == null || isNaN(gapSec)) return "";
  if (gapSec < 0) return `-${formatGap(-gapSec).slice(1)}`;
  return formatGap(gapSec);
}

// "3L" / "3 l" → 3 (laps behind the leader); anything else → null.
export function parseLapsDown(str) {
  if (str == null) return null;
  const m = String(str).trim().match(/^(\d+)\s*[lL]$/);
  return m ? Number(m[1]) : null;
}

// The interval string is a time gap (not a laps-down marker).
export function isGapTime(str) {
  return str != null && String(str).trim() !== "" && parseLapsDown(str) == null && parseTime(str) != null;
}

// Laps a driver completed, given the event's total race distance.
//   - DNF/DNS: whatever lap they reached (entered manually).
//   - N laps down (interval "NL"): total − N.
//   - otherwise (lead-lap finisher): total.
// Returns null when it can't be derived (no total, or manual case).
export function deriveLaps(row, totalLaps) {
  const total = Number(totalLaps) || null;
  if (!total) return null;
  if (row.status === "dnf" || row.status === "dns" || row.status === "dq") return null;
  const ld = parseLapsDown(row.interval);
  return ld != null ? Math.max(0, total - ld) : total;
}
