import { db } from "@/lib/firebase";
import { calculateStandings, DEFAULT_POINTS_SCALE } from "@/lib/standings";
import { StandingsTable } from "@/components/StandingsTable";

const CURRENT_SEASON = 2026;
const DROP_WEEKS = 1;

async function getStandings() {
  const [driversSnap, racesSnap] = await Promise.all([
    db().collection("drivers").where("season", "==", CURRENT_SEASON).get(),
    db().collection("races").where("season", "==", CURRENT_SEASON).get(),
  ]);

  const drivers = driversSnap.docs.map(d => d.data());
  const raceIds = racesSnap.docs.map(d => d.data().race_id);

  let results = [];
  for (const raceId of raceIds) {
    const snap = await db().collection("results").where("race_id", "==", raceId).get();
    results.push(...snap.docs.map(d => d.data()));
  }

  return calculateStandings(results, drivers, CURRENT_SEASON, DROP_WEEKS, DEFAULT_POINTS_SCALE);
}

export default async function StandingsPage() {
  const { rows } = await getStandings();

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
