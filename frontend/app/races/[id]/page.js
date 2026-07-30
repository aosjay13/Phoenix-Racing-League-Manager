"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { useLeague } from "@/components/LeagueProvider";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ShareGraphicModal } from "@/components/ShareGraphicModal";
import { leagueLogos, driverDisplayName } from "@/lib/shareGraphic";
import { formatRaceDate } from "@/lib/raceDate";
import { gapColumns, formatDelta, parseTime, parseLapsDown } from "@/lib/raceTime";
import { carForRace, carsByClassForRace, classIdForScope, sessionClassScopes, soleCarForRace } from "@/lib/classFilter";
import { api } from "@/lib/api";

function DriverCell({ r }) {
  // On a game-specific event, prefer the driver's mapped alias (their on-track
  // name for this game) as the primary label, keeping the profile name as a
  // muted subtitle. Falls back to the profile name when no alias is mapped.
  const alias = r.game_alias && r.game_alias !== r.driver_name ? r.game_alias : null;
  const primary = alias || r.driver_name;
  return (
    <>
      {(r.driver_id || r.user_id)
        ? <Link href={`/drivers/${r.driver_id || r.user_id}`} style={{ color: "var(--accent-cyan)" }}>{primary}</Link>
        : primary}
      {r.driver_number != null && <span style={{ color: "var(--ink-2)", marginLeft: 6 }}>#{r.driver_number}</span>}
      {alias && <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.74rem" }}>{r.driver_name}</span>}
    </>
  );
}

function statusLabel(s) {
  return s === "finished" ? "Running" : (s || "").toUpperCase();
}

// A gap cell: seconds → "+0.312", or an em-dash when there's nothing to
// measure (the row on top, or a driver with no time).
const gapCell = sec => (sec == null ? "—" : formatDelta(sec));

// Elapsed race time per row, in finishing order, for the gap columns. Uses the
// stored Race Time where there is one and otherwise reconstructs it from the
// leader's time plus the stored interval — which is what lets results entered
// before these columns existed show gaps too. A driver laps down (interval
// "2L") or without either value has no comparable time at all.
function raceTimesInOrder(rows) {
  const leader = parseTime(rows[0]?.race_time);
  return rows.map(r => {
    const t = parseTime(r.race_time);
    if (t != null) return t;
    if (parseLapsDown(r.interval) != null) return null;
    const behind = parseTime(r.interval);
    return behind != null && leader != null ? leader + behind : null;
  });
}

// Coloured +/- SR change a driver earned in this race.
function SrDelta({ delta }) {
  if (delta == null) return <span style={{ color: "var(--ink-2)" }}>—</span>;
  if (delta === 0) return <span style={{ color: "var(--ink-2)" }}>±0</span>;
  const up = delta > 0;
  return (
    <span style={{ color: up ? "var(--positive, #34d399)" : "var(--negative, #f87171)", fontWeight: 600 }}>
      {up ? "+" : ""}{delta}
    </span>
  );
}

// Maps a session name (the currently viewed tab) back to the edit screen's
// top-level tab key, which for heat-format events is one of
// heats/consolation/feature rather than a single "results" tab.
function editTabFor(event, sessionTab) {
  if (sessionTab === "__qual") return "qualifying";
  if (!event.heat_format) return "results";
  if ((event.heats || []).includes(sessionTab)) return "heats";
  if ((event.consolations || []).includes(sessionTab)) return "consolation";
  return "feature";
}

export default function EventResultsPage() {
  const { id } = useParams();
  const router = useRouter();
  const { isAdmin } = useAuth();
  const { game, series, season: leagueSeason, league: activeLeague } = useLeague();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(null); // "qual" or session name
  const [classTab, setClassTab] = useState(null); // which class's results, on a split event
  const [confirmKind, setConfirmKind] = useState(null); // "event" | "session" | null
  const [sharing, setSharing] = useState(false);

  const load = () =>
    api(`/api/events/${id}`)
      .then(d => {
        setData(d);
        const withResults = d.races.find(s => s.results.length);
        setTab(prev => prev ?? (withResults ? withResults.name : (d.qualifying.length ? "__qual" : d.races[0]?.name ?? null)));
      })
      .catch(err => setError(err.message));
  useEffect(() => { load(); }, [id]);

  // Delete the whole event (race doc + every session's results); stats/points
  // recompute from results on read, so they scrub automatically.
  async function deleteEvent() {
    await api(`/api/races/${id}`, { method: "DELETE" });
    router.push("/schedule");
  }

  // Clear only the currently-viewed session's results, leaving the rest of the
  // event intact. Qualifying is isolated by type; every race-like session
  // matches by name (session_type defaults to "race" server-side).
  async function deleteSession() {
    const qs = new URLSearchParams({ race_id: id });
    if (tab === "__qual") { qs.set("session", "Qualifying"); qs.set("session_type", "qualifying"); }
    else { qs.set("session", tab); }
    // On a split event this clears only the class being viewed; the other
    // classes that raced the same round keep their results.
    if (activeClass) qs.set("session_class", activeClass.value);
    await api(`/api/results?${qs.toString()}`, { method: "DELETE" });
    await load();
  }

  if (error) return <div className="empty-state"><span className="empty-state-icon">🏁</span><p>{error}</p></div>;
  if (!data) return <div className="skeleton" style={{ height: 280 }} />;

  const { event, season, races, qualifying } = data;
  // A split event holds one set of results per class in every session — its own
  // pole, its own P1 — so the tables below are shown a class at a time.
  const splitByClass = !!data.per_class_results;
  const allResults = [...qualifying, ...races.flatMap(s => s.results)];
  const classScopes = splitByClass ? sessionClassScopes(data.classes || [], [], allResults) : [];
  const activeClass = splitByClass
    ? (classScopes.find(s => s.value === classTab) ?? classScopes[0] ?? null)
    : null;
  // Narrows any result list to the class being viewed. A combined event has no
  // class tabs, so this is the identity.
  const inClass = rs => (activeClass ? rs.filter(r => (r.class_id || "") === classIdForScope(activeClass.value)) : rs);
  // "Qualifying" / "Race 1", prefixed with the class when the event ran its
  // classes separately — so a delete never reads as clearing the whole field.
  const tabName = tab === "__qual" ? "Qualifying" : tab;
  const scopedName = activeClass ? `${activeClass.label} ${tabName}` : tabName;
  // Cars on track. `activeCar` is the class being viewed; `classCars` is the
  // non-empty list only when the classes here race different machinery, in which
  // case the header lists them all instead of naming one.
  const eventClasses = data.classes || [];
  const activeCar = carForRace(event, season, eventClasses.find(c => c.id === activeClass?.value));
  const classCars = carsByClassForRace(event, season, eventClasses);
  const headerCar = soleCarForRace(event, season, eventClasses);

  const hasQualifying = inClass(qualifying).length > 0;
  // An admin can run a qualifying session for visual purposes only — the grid
  // still shows here, but it's kept out of Poles / Average Start.
  const qualCountsStats = event.session_stats?.Qualifying;
  const activeRace = races.find(s => s.name === tab);
  const activeResults = inClass(activeRace?.results ?? []);
  // Provisional entries (points only, didn't race) are listed separately so
  // they never read as back-of-field finishers.
  const finishers = activeResults.filter(r => !r.provisional);
  const provisionals = activeResults.filter(r => r.provisional);
  // The SR column/banner only appear for the session that actually exchanged
  // Skill Rating (the main race / Feature) — detected by results carrying an
  // sr_delta. Strength of Field is recorded on the event.
  const showSr = finishers.some(r => r.sr_delta != null);
  const sof = event.strength_of_field;

  // Gap columns, worked out from the times on the results themselves — so every
  // session already in the database gets them without being re-entered.
  const qualRows = inClass(qualifying);
  const qualGaps = gapColumns(qualRows.map(r => parseTime(r.qual_time)));
  const raceGaps = gapColumns(raceTimesInOrder(finishers));

  // Shareable graphic for the currently-viewed session (Qualifying or a race).
  const eventDate = event.date ? formatRaceDate(event.date, "long", null) : null;
  const sharingQual = tab === "__qual";
  const sessionLabel = [activeClass?.label, sharingQual ? "Qualifying" : (tab || "Results")].filter(Boolean).join(" · ");
  const shareSource = sharingQual ? qualRows : finishers;
  // The exporter offers every column this results table shows, so any of them
  // can go on the graphic — including the derived gap columns. Pos/Driver are
  // locked on, since a row is unreadable without them; everything else is
  // ticked by default and one click away from being switched off.
  // `get` receives the row and its index, the index being what the gap columns
  // are keyed on.
  const shareSpec = sharingQual
    ? [
        { key: "pos", label: "Pos", align: "center", locked: true, get: r => r.position },
        { key: "driver", label: "Driver", align: "left", locked: true, get: driverDisplayName },
        { key: "team", label: "Team", align: "left", get: r => r.team ?? "—" },
        { key: "qual_time", label: "Qual Time", get: r => r.qual_time || "—" },
        { key: "qual_to_lead", label: "To Lead", get: (r, i) => gapCell(qualGaps[i]?.toLead) },
        { key: "qual_gap", label: "Gap", get: (r, i) => gapCell(qualGaps[i]?.gap) },
        { key: "points", label: "Pts", get: r => r.qual_points },
      ]
    : [
        { key: "pos", label: "Pos", align: "center", locked: true, get: r => r.finish_pos },
        { key: "driver", label: "Driver", align: "left", locked: true, get: driverDisplayName },
        { key: "team", label: "Team", align: "left", get: r => r.team ?? "—" },
        { key: "start", label: "Start", get: r => r.start_pos ?? "—" },
        { key: "race_time", label: "Race Time", get: r => (r.finish_pos === 1 ? (r.race_time || "—") : "—") },
        { key: "interval", label: "Int", get: r => (r.finish_pos === 1 ? "—" : (r.interval || r.race_time || "—")) },
        { key: "gap", label: "Gap", get: (r, i) => gapCell(raceGaps[i]?.gap) },
        { key: "best_lap", label: "Best Lap", get: r => r.fastest_lap_time || "—" },
        { key: "laps", label: "Laps", get: r => r.laps ?? "—" },
        { key: "laps_led", label: "Led", get: r => r.laps_led ?? 0 },
        { key: "incidents", label: "Inc", get: r => r.incidents ?? 0 },
        { key: "status", label: "Status", get: r => statusLabel(r.status) },
        { key: "points", label: "Pts", get: r => r.points },
        ...(showSr ? [{ key: "sr_delta", label: "SR ±", get: r => (r.sr_delta == null ? "—" : (r.sr_delta > 0 ? `+${r.sr_delta}` : r.sr_delta)) }] : []),
      ];
  const shareColumns = shareSpec.map(({ get, ...c }) => ({ align: "center", ...c }));
  const shareRows = shareSource.map((r, i) => {
    const pos = sharingQual ? r.position : r.finish_pos;
    return {
      rank: pos > 0 && pos <= 3 ? pos : undefined,
      cells: shareSpec.map(c => c.get(r, i)),
    };
  });
  // Event context carried into the image, so a results graphic stands alone
  // without the page around it.
  const shareMeta = [
    { label: "Race", value: event.name },
    { label: "Date", value: eventDate },
    { label: "Track", value: [event.track, data.track?.track_type, data.track?.length].filter(Boolean).join(" · "), wide: true },
    { label: "Series", value: [game?.name, series?.name].filter(Boolean).join(" · "), wide: true },
    { label: "Season", value: season?.name },
    { label: "Class", value: activeClass?.label },
    { label: "Session", value: tabName },
  ];
  // Offer the event's track logo alongside any logos from the selected league
  // context; dedupe by url so the same image isn't listed twice.
  const shareLogos = [
    event.track_logo_url && { label: `${event.track || "Track"} (Track)`, url: event.track_logo_url },
    ...leagueLogos({ league: activeLeague, game, series, season: leagueSeason }),
  ].filter(Boolean).filter((l, i, a) => a.findIndex(x => x.url === l.url) === i);

  return (
    <section>
      <ShareGraphicModal
        open={sharing}
        onClose={() => setSharing(false)}
        kind={`${event.name} ${sessionLabel}`}
        defaultTitle={`${event.name} — ${sessionLabel}`}
        subtitle={[event.track, eventDate, season?.name].filter(Boolean).join(" · ")}
        columns={shareColumns}
        rows={shareRows}
        meta={shareMeta}
        logos={shareLogos}
        leagueName={activeLeague?.name ?? ""}
        leagueLogoUrl={activeLeague?.logo_url ?? ""}
      />
      <div className="hero" style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
        {event.track_logo_url
          ? <img src={event.track_logo_url} alt="" className="avatar avatar-xl" style={{ borderRadius: 14 }} />
          : <div className="round-num" style={{ width: 72, height: 72, fontSize: "1.4rem" }}>R{event.round_number}</div>}
        <div>
          <div className="page-title" style={{ marginBottom: 2 }}>
            <h2>{event.name}</h2>
          </div>
          <p style={{ margin: "4px 0 0", color: "var(--ink-1)", fontSize: "0.9rem" }}>
            {event.track ? `${event.track} · ` : ""}
            {formatRaceDate(event.date, "full", "Date TBA")}
            {season ? ` · ${season.name}` : ""}
            {headerCar ? ` · ${headerCar}` : ""}
          </p>
          {classCars.length > 0 && (
            <p style={{ margin: "4px 0 0", display: "flex", gap: 10, flexWrap: "wrap", fontSize: "0.82rem", color: "var(--ink-1)" }}>
              {classCars.map(c => (
                <span key={c.class_id}>
                  <span className="badge" style={{ marginRight: 5 }}>{c.class_name}</span>{c.car || "—"}
                </span>
              ))}
            </p>
          )}
          <p style={{ margin: "6px 0 0", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <Link href="/schedule" style={{ color: "var(--accent-cyan)", fontSize: "0.85rem" }}>← Back to Schedule</Link>
            {shareRows.length > 0 && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ marginTop: 0, padding: "6px 12px", fontSize: "0.82rem" }}
                onClick={() => setSharing(true)}
              >
                🖼 Share Graphic
              </button>
            )}
            {isAdmin && (
              <>
                <Link
                  href={`/races/${event.id}/edit?tab=${editTabFor(event, tab)}${tab && tab !== "__qual" ? `&session=${encodeURIComponent(tab)}` : ""}`}
                  className="btn btn-ghost"
                  style={{ marginTop: 0, padding: "6px 12px", fontSize: "0.82rem" }}
                >
                  ✎ Edit Race
                </Link>
                <button
                  type="button"
                  className="btn btn-danger"
                  style={{ marginTop: 0, padding: "6px 12px", fontSize: "0.82rem" }}
                  onClick={() => setConfirmKind("event")}
                >
                  🗑 Delete Event
                </button>
              </>
            )}
          </p>
        </div>
      </div>

      {/* Which class's race am I looking at? Only on an event that ran its
          classes as separate sessions — each has its own pole and winner. */}
      {splitByClass && classScopes.length > 0 && (
        <div className="class-scope-bar">
          <label htmlFor="view-class">Class</label>
          <select id="view-class" value={activeClass?.value ?? ""} onChange={e => setClassTab(e.target.value)}>
            {classScopes.map(s => <option key={s.value} value={s.value}>{s.car ? `${s.label} · ${s.car}` : s.label}</option>)}
          </select>
          {activeCar && <span className="class-scope-chip" title="The car this class races">{activeCar}</span>}
          <span style={{ color: "var(--ink-1)", fontSize: "0.84rem" }}>
            Each class ran its own qualifying and race here, so every position below is
            {activeClass ? ` ${activeClass.label}'s` : " that class's"} own.
          </span>
        </div>
      )}

      <div className="tab-row" style={{ marginTop: 20 }}>
        {hasQualifying && (
          <button className={`tab${tab === "__qual" ? " active" : ""}`} onClick={() => setTab("__qual")}>Qualifying</button>
        )}
        {races.map(s => (
          <button key={s.name} className={`tab${tab === s.name ? " active" : ""}`} onClick={() => setTab(s.name)}>
            {s.name}
          </button>
        ))}
        {isAdmin && tab && (tab === "__qual" ? hasQualifying : activeResults.length > 0) && (
          <button
            type="button"
            className="icon-btn icon-btn-danger"
            title={`Delete the ${scopedName} results`}
            style={{ marginLeft: "auto" }}
            onClick={() => setConfirmKind("session")}
          >
            🗑 Delete {scopedName} results
          </button>
        )}
      </div>

      {isAdmin && confirmKind === "event" && (
        <ConfirmDialog
          title="Delete this event?"
          message={`Are you sure you want to delete "${event.name}"? This removes the event and all associated qualifying, heat, main, and race results — and the points and stats those results gave every driver. This cannot be undone.`}
          confirmLabel="Delete event"
          onConfirm={deleteEvent}
          onClose={() => setConfirmKind(null)}
        />
      )}
      {isAdmin && confirmKind === "session" && (
        <ConfirmDialog
          title={`Delete ${scopedName} results?`}
          message={`Are you sure you want to delete the ${scopedName} results for this event? This removes all associated points and stats for these drivers, and cannot be undone. The rest of the event${activeClass ? ", including every other class that raced here," : ""} is left untouched.`}
          confirmLabel="Delete results"
          onConfirm={deleteSession}
          onClose={() => setConfirmKind(null)}
        />
      )}

      {tab === "__qual" ? (
        <div className="table-wrap">
          {qualCountsStats === false && (
            <p style={{ margin: "0 0 8px", color: "var(--ink-2)", fontSize: "0.8rem" }}>
              Shown for reference only — this qualifying session doesn&rsquo;t count toward Poles or Average Start.
            </p>
          )}
          <table className="stats-table">
            <thead>
              <tr>
                <th>Pos</th><th style={{ textAlign: "left" }}>Driver</th><th style={{ textAlign: "left" }}>Team</th>
                <th>Qual Time</th>
                <th title="Gap to pole">To Lead</th>
                <th title="Gap to the car one position up">Gap</th>
                <th>Points</th>
              </tr>
            </thead>
            <tbody>
              {qualRows.map((r, i) => (
                <tr key={r.entry_id}>
                  <td>
                    <span className={`rank-badge ${r.position === 1 ? "rank-p1" : "rank-default"}`}>{r.position}</span>
                    {r.position === 1 && <span className="badge" title="Pole position" style={{ marginLeft: 6 }}>POLE</span>}
                  </td>
                  <td className="driver-name-cell" style={{ textAlign: "left" }}><DriverCell r={r} /></td>
                  <td style={{ textAlign: "left", color: "var(--ink-1)" }}>{r.team ?? "—"}</td>
                  <td>{r.qual_time || "—"}</td>
                  <td style={{ color: "var(--ink-1)" }}>{gapCell(qualGaps[i]?.toLead)}</td>
                  <td style={{ color: "var(--ink-1)" }}>{gapCell(qualGaps[i]?.gap)}</td>
                  <td className="points-cell">{r.qual_points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : activeRace && activeResults.length ? (
        <>
        {showSr && sof != null && (
          <div className="hero" style={{ marginTop: 16, marginBottom: 4, display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.78rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-2)" }}>
              Strength of Field
            </span>
            <span style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--accent-gold)" }}>{sof}</span>
            <span style={{ fontSize: "0.8rem", color: "var(--ink-2)" }}>
              average Skill Rating of the {finishers.length} starter{finishers.length === 1 ? "" : "s"}
            </span>
          </div>
        )}
        {finishers.length > 0 && (
        <div className="table-wrap">
          <table className="stats-table">
            <thead>
              <tr>
                <th>Pos</th><th title="Starting position">Start</th><th style={{ textAlign: "left" }}>Driver</th><th style={{ textAlign: "left" }}>Team</th>
                <th>Race Time</th>
                <th title="Gap to the winner">Int</th>
                <th title="Gap to the car one position up">Gap</th>
                <th>Best Lap</th><th>Laps</th><th>Led</th><th>Inc</th><th>Status</th><th>Points</th>
                {showSr && <th title="Skill Rating change from this race">SR ±</th>}
              </tr>
            </thead>
            <tbody>
              {finishers.map((r, i) => (
                <tr key={r.entry_id}>
                  <td>
                    <span className={`rank-badge ${r.finish_pos === 1 ? "rank-p1" : r.finish_pos === 2 ? "rank-p2" : r.finish_pos === 3 ? "rank-p3" : "rank-default"}`}>
                      {r.finish_pos}
                    </span>
                  </td>
                  <td style={{ color: "var(--ink-1)" }}>{r.start_pos ?? "—"}</td>
                  <td className="driver-name-cell" style={{ textAlign: "left" }}>
                    <DriverCell r={r} />
                    {r.fastest_lap && <span className="badge" title="Fastest lap" style={{ marginLeft: 6 }}>FL</span>}
                  </td>
                  <td style={{ textAlign: "left", color: "var(--ink-1)" }}>{r.team ?? "—"}</td>
                  <td>{r.finish_pos === 1 ? (r.race_time || "—") : "—"}</td>
                  <td>{r.finish_pos === 1 ? "—" : (r.interval || r.race_time || "—")}</td>
                  <td style={{ color: "var(--ink-1)" }}>{gapCell(raceGaps[i]?.gap)}</td>
                  <td>{r.fastest_lap_time || "—"}</td>
                  <td>{r.laps ?? "—"}</td>
                  <td>{r.laps_led ?? 0}</td>
                  <td>{r.incidents ?? 0}</td>
                  <td>{statusLabel(r.status)}</td>
                  <td className="points-cell">{r.points}</td>
                  {showSr && <td><SrDelta delta={r.sr_delta} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
        {provisionals.length > 0 && (
          <div className="table-wrap" style={{ marginTop: finishers.length ? 16 : 0 }}>
            <table className="stats-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }} colSpan={2}>Provisional Entries · points only, not counted in stats</th>
                  <th>Points</th>
                </tr>
              </thead>
              <tbody>
                {provisionals.map(r => (
                  <tr key={r.entry_id}>
                    <td style={{ width: 40 }}><span className="badge" title="Provisional">P</span></td>
                    <td className="driver-name-cell" style={{ textAlign: "left" }}><DriverCell r={r} /></td>
                    <td className="points-cell">{r.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </>
      ) : (
        <div className="empty-state">
          <span className="empty-state-icon">⏱</span>
          <p>No results recorded for {tab ? scopedName : "this event"} yet.</p>
        </div>
      )}
    </section>
  );
}
