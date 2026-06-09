import Link from "next/link";
import { db } from "@/lib/firebase";
import { calculateStandings, DEFAULT_POINTS_SCALE } from "@/lib/standings";

const CURRENT_SEASON = 2026;

async function getDashboardStats() {
  const [driversSnap, racesSnap] = await Promise.all([
    db().collection("drivers").where("season", "==", CURRENT_SEASON).get(),
    db().collection("races").where("season", "==", CURRENT_SEASON).get(),
  ]);

  const drivers = driversSnap.docs.map(d => d.data());
  const races = racesSnap.docs.map(d => d.data());
  const raceIds = races.map(r => r.race_id);

  let results = [];
  for (const raceId of raceIds) {
    const snap = await db().collection("results").where("race_id", "==", raceId).get();
    results.push(...snap.docs.map(d => d.data()));
  }

  const today = new Date();
  const completed = races.filter(r => new Date(r.date) < today).length;
  const standings = calculateStandings(results, drivers, CURRENT_SEASON, 0, DEFAULT_POINTS_SCALE);
  const leader = standings.rows[0] ?? null;

  return {
    driverCount: drivers.length,
    totalRaces: races.length,
    completedRaces: completed,
    remaining: Math.max(0, races.length - completed),
    leader,
  };
}

const quickLinks = [
  { href: "/roster",     icon: "⊞", label: "Manage Roster",  sub: "Add or edit drivers"     },
  { href: "/schedule",   icon: "⊟", label: "View Schedule",  sub: "Full season calendar"    },
  { href: "/race-entry", icon: "⊕", label: "Enter Results",  sub: "Submit finish positions" },
  { href: "/standings",  icon: "⊛", label: "Standings",      sub: "Live points + drop week" },
];

export default async function DashboardPage() {
  const stats = await getDashboardStats();

  const metrics = [
    { icon: "🏎️", num: stats.driverCount,    label: "Active Drivers"   },
    { icon: "🗓️", num: stats.totalRaces,     label: "Scheduled Races"  },
    { icon: "✅", num: stats.completedRaces, label: "Completed Events" },
    { icon: "⏩", num: stats.remaining,      label: "Races Remaining"  },
  ];

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
          {metrics.map((m, i) => (
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
