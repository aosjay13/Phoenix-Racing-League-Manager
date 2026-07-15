// Comma-list ⇄ points-table helpers, plus built-in real-world templates.

// "40, 35, 34" → { 1: 40, 2: 35, 3: 34 }
export function listToTable(str) {
  if (!str) return null;
  const nums = String(str).split(/[,\s]+/).filter(Boolean).map(Number).filter(n => !Number.isNaN(n));
  if (!nums.length) return null;
  return Object.fromEntries(nums.map((n, i) => [i + 1, n]));
}

// { 1: 40, 2: 35 } (or JSON string) → "40, 35"
export function tableToList(table) {
  if (!table) return "";
  let obj = table;
  if (typeof table === "string") {
    try { obj = JSON.parse(table); } catch { return ""; }
  }
  const positions = Object.keys(obj).map(Number).filter(n => !Number.isNaN(n)).sort((a, b) => a - b);
  return positions.map(p => obj[p]).join(", ");
}

// Real-world scoring, editable after loading.
// race/qual values are comma lists (position 1 first).
export const BUILTIN_TEMPLATES = [
  {
    id: "builtin-nascar",
    name: "NASCAR (Cup style)",
    // Winner 40 (win bonus included), 2nd 35, then -1 per spot; 36th+ score 1
    race: [40, 35, ...Array.from({ length: 32 }, (_, i) => 34 - i), 1, 1, 1, 1, 1].join(", "),
    qual: "",
    bonuses: { pole: 1, best_lap: 0, most_laps_led: 1, lead_a_lap: 1, halfway_point: 0, hard_charger: 0 },
  },
  {
    id: "builtin-imsa",
    name: "IMSA",
    // 350, 320, 300, 280, 260, then -10 per spot (min 10); qualifying mirrors ÷10
    race: [350, 320, 300, 280, 260, ...Array.from({ length: 25 }, (_, i) => 250 - 10 * i)].join(", "),
    qual: [35, 32, 30, 28, 26, ...Array.from({ length: 25 }, (_, i) => 25 - i).filter(n => n >= 1)].join(", "),
    bonuses: { pole: 0, best_lap: 0, most_laps_led: 0, lead_a_lap: 0, halfway_point: 0, hard_charger: 0 },
  },
  {
    id: "builtin-arca",
    name: "ARCA Menards",
    // Winner 46 (43 + 3 win bonus), 2nd 42, then -1 per spot (min 4)
    race: [46, ...Array.from({ length: 39 }, (_, i) => 42 - i).filter(n => n >= 4)].join(", "),
    qual: "",
    bonuses: { pole: 1, best_lap: 0, most_laps_led: 1, lead_a_lap: 1, halfway_point: 0, hard_charger: 0 },
  },
  {
    id: "builtin-f1",
    name: "Formula 1",
    race: "25, 18, 15, 12, 10, 8, 6, 4, 2, 1",
    qual: "",
    bonuses: { pole: 0, best_lap: 0, most_laps_led: 0, lead_a_lap: 0, halfway_point: 0, hard_charger: 0 },
  },
  {
    id: "builtin-indycar",
    name: "IndyCar",
    // 50, 40, 35, 32, 30, 28, 26, 24, 22, 20, then -1 per spot; 25th-33rd score 5
    race: [50, 40, 35, 32, 30, 28, 26, 24, 22, 20, ...Array.from({ length: 14 }, (_, i) => 19 - i), ...Array(9).fill(5)].join(", "),
    qual: "",
    bonuses: { pole: 1, best_lap: 0, most_laps_led: 2, lead_a_lap: 1, halfway_point: 0, hard_charger: 0 },
  },
];
