import { StandingsTable } from "../../components/StandingsTable";

async function getStandings() {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";
  try {
    const res = await Promise.race([
      fetch(`${base}/api/standings?season=2026&drop_weeks=1`, { cache: "no-store" }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3500)),
    ]);
    if (!res.ok) return [];
    const json = await res.json();
    return json.rows || [];
  } catch {
    return [];
  }
}

export default async function StandingsPage() {
  const rows = await getStandings();

  return (
    <section>
      <div className="page-title">
        <h2>Standings</h2>
        <span className="page-badge">Drop Week Applied</span>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state" style={{ textAlign: "left", padding: "32px 0" }}>
          <span className="empty-state-icon">🏆</span>
          <p>No standings yet for this season.</p>
          <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: 0 }}>
            Add drivers, schedule races, and submit results to populate this view.
          </p>
        </div>
      ) : (
        <>
          <p style={{ marginTop: 8, fontSize: "0.85rem", color: "var(--ink-1)" }}>
            Each driver&apos;s single worst result is dropped from their point total.
          </p>
          <StandingsTable rows={rows} />
        </>
      )}
    </section>
  );
}
