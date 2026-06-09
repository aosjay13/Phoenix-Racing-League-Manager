import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";
const CURRENT_SEASON = 2026;

async function fetchJsonWithTimeout(url, fallback, ms = 3500) {
  try {
    const res = await Promise.race([
      fetch(url, { cache: "no-store" }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
    ]);
    if (!res.ok) return fallback;
    return await res.json();
  } catch {
    return fallback;
  }
}

async function getDashboardStats() {
  const [drivers, races, standings] = await Promise.all([
    fetchJsonWithTimeout(`${API}/api/drivers?season=${CURRENT_SEASON}`, []),
    fetchJsonWithTimeout(`${API}/api/races?season=${CURRENT_SEASON}`, []),
    fetchJsonWithTimeout(`${API}/api/standings?season=${CURRENT_SEASON}&drop_weeks=0`, { rows: [] }),
  ]);

  const today = new Date();
  const completed = Array.isArray(races) ? races.filter(r => new Date(r.date) < today).length : 0;
  const leader = standings?.rows?.[0] || null;

  return {
    driverCount: Array.isArray(drivers) ? drivers.length : 0,
    totalRaces: Array.isArray(races) ? races.length : 0,
    completedRaces: completed,
    remaining: Math.max(0, (Array.isArray(races) ? races.length : 0) - completed),
    leader,
  };
}

const metrics = (stats) => [
  { icon: "🏎️", num: stats.driverCount,    label: "Active Drivers"   },
  { icon: "🗓️", num: stats.totalRaces,     label: "Scheduled Races"  },
  { icon: "✅", num: stats.completedRaces, label: "Completed Events" },
  { icon: "⏩", num: stats.remaining,      label: "Races Remaining"  },
];

const quickLinks = [
  { href: "/roster",     icon: "⊞", label: "Manage Roster",      sub: "Add or edit drivers"     },
  { href: "/schedule",   icon: "⊟", label: "View Schedule",      sub: "Full season calendar"    },
  { href: "/race-entry", icon: "⊕", label: "Enter Results",      sub: "Submit finish positions" },
  { href: "/standings",  icon: "⊛", label: "Standings",          sub: "Live points + drop week" },
];

export default async function DashboardPage() {
  const stats = await getDashboardStats();

  return (
    <section>
      <div className="hero">
        <div className="page-title">
          <h2>Season {CURRENT_SEASON} Command Center</h2>
          {stats.leader && (
            <span className="page-badge">
              🏆 Leader: {stats.leader.driver_name} · {stats.leader.adjusted_points} pts
            </span>
          )}
        </div>
        <p style={{ marginTop: 10, color: "var(--ink-1)", fontSize: "0.92rem", maxWidth: 620 }}>
          Live overview of your racing league. Use the sidebar to manage the roster, enter race results, and view standings.
        </p>

        <div className="metrics">
          {metrics(stats).map((m, i) => (
            <article className="metric-card" key={m.label} style={{ animationDelay: `${i * 60}ms` }}>
              <span className="metric-icon">{m.icon}</span>
              <div className="metric-num">{m.num}</div>
              <div className="metric-label">{m.label}</div>
            </article>
          ))}
        </div>
      </div>

      <div className="section-header" style={{ marginTop: 28 }}>
        <h3>Quick Access</h3>
      </div>
      <div className="quick-links">
        {quickLinks.map(card => (
          <Link href={card.href} key={card.href}>
            <div className="quick-card">
              <span className="quick-card-icon">{card.icon}</span>
              <strong>{card.label}</strong>
              <span>{card.sub}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
