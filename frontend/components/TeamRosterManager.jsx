"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useLeague } from "@/components/LeagueProvider";
import { rawBundlePath } from "@/components/useRawBundle";
import { indexBundle } from "@/lib/rawIndex";
import { buildRoster } from "@/lib/rosterCompute";
import { buildStandings } from "@/lib/standingsCompute";
import { Modal } from "@/components/Modal";
import { ImageUpload } from "@/components/ImageUpload";
import { ensureDriverId } from "@/lib/driverPool";

// ─────────────────────────────────────────────────────────────────────────────
// Team Roster — the team-side mirror of the Driver Roster.
//
// Teams are persistent entities in a global pool (see lib/teams.js); this
// screen manages who drives for them IN ONE SEASON. The Game ▸ Series ▸ Season
// menus at the top of the page choose that season, exactly as they choose the
// scope everywhere else, and everything below is that season's lineups:
//
//   ＋ Add Team to Season   pick a team from the pool, or create a new one
//   ＋ Add Driver           search the season's roster / the global driver pool
//
// A driver belongs to one team per season, so adding them to a second team
// moves them (the API takes them off the other lineup) — which is what keeps
// the stats cascade unambiguous: their results roll up to exactly one team.
// ─────────────────────────────────────────────────────────────────────────────

// A filtering picker: type to narrow, click to choose. Used for "which driver"
// and "which team", both of which can run to hundreds of options.
function SearchPicker({ options, placeholder, emptyLabel, onPick, onCancel, autoFocus = true }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? options.filter(o => o.label.toLowerCase().includes(needle) || (o.hint || "").toLowerCase().includes(needle))
    : options;

  return (
    <div style={{ border: "1px solid var(--line, rgba(255,255,255,0.12))", borderRadius: 8, padding: 10, marginTop: 8 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input autoFocus={autoFocus} value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} style={{ flex: 1 }} />
        {onCancel && <button className="btn btn-ghost" type="button" style={{ marginTop: 0, padding: "4px 10px" }} onClick={onCancel}>Cancel</button>}
      </div>
      <div style={{ maxHeight: 220, overflowY: "auto", marginTop: 8 }}>
        {shown.length === 0 && (
          <p style={{ margin: "6px 2px", fontSize: "0.82rem", color: "var(--ink-2)" }}>{emptyLabel}</p>
        )}
        {shown.map(o => (
          <button key={o.value} type="button" className="btn btn-ghost"
            style={{ marginTop: 0, width: "100%", textAlign: "left", padding: "6px 10px", display: "flex", gap: 8, alignItems: "baseline" }}
            onClick={() => onPick(o)}>
            <span>{o.label}</span>
            {o.hint && <span style={{ color: "var(--ink-2)", fontSize: "0.78rem" }}>{o.hint}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

const blankTeam = { name: "", color: "", logo_url: "" };

export function TeamRosterManager() {
  const league = useLeague();
  const { gameId, seriesId, seasonId, game, series, seasons } = league;

  // The season being managed. An explicit Season pick wins; with a series
  // selected but "All Seasons" showing, we manage its newest season (the list
  // arrives newest first) — the same fallback the Driver Roster uses, so the
  // two screens are never editing different seasons.
  const targetSeasonId = seasonId || (seriesId ? seasons[0]?.id ?? "" : "");
  const targetSeason = seasons.find(s => s.id === targetSeasonId) || null;

  const [data, setData] = useState(null);          // { teams: [...] } for the season
  const [pool, setPool] = useState([]);            // global teams
  const [roster, setRoster] = useState([]);        // this season's driver roster
  const [driverPool, setDriverPool] = useState([]);// global drivers
  const [teamPoints, setTeamPoints] = useState({});// team_id -> season standings row
  const [loadError, setLoadError] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);

  const [addingTeam, setAddingTeam] = useState(false);   // team picker open
  const [creatingTeam, setCreatingTeam] = useState(false); // new-team modal open
  const [newTeam, setNewTeam] = useState({ ...blankTeam });
  const [editTeam, setEditTeam] = useState(null);        // team row being edited
  const [editForm, setEditForm] = useState({ ...blankTeam });
  const [addDriverFor, setAddDriverFor] = useState(null); // team_id whose picker is open

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }

  const load = useCallback(async () => {
    const [teams, drivers] = await Promise.all([api("/api/teams"), api("/api/drivers")]);
    setPool(teams);
    setDriverPool(drivers);
    if (!targetSeasonId) {
      setData(null);
      setRoster([]);
      setTeamPoints({});
      return;
    }
    const seasonTeams = await api(`/api/team-seasons?season_id=${targetSeasonId}`);
    setData(seasonTeams);
    // Best-effort: the season's team standings, so an admin can see the
    // aggregation land the moment a lineup changes. Never blocks the screen.
    //
    // Scored here rather than asked for: the season's raw documents come back
    // uncalculated (see lib/rawBundle.js) and the same buildStandings the
    // Standings page runs turns them into the team table.
    // One bundle answers both halves of this screen: who is on the season's
    // roster, and what each team has scored. Both are derived here from raw
    // documents (see lib/rosterCompute.js and lib/standingsCompute.js).
    try {
      const res = await fetch(rawBundlePath({ scope: "season", seasonId: targetSeasonId }));
      const bundle = await res.json();
      if (!res.ok) throw new Error(bundle?.error || "Season unavailable");
      const index = indexBundle(bundle);
      setRoster(buildRoster(index, { scope: "season", seasonId: targetSeasonId }).body?.rows ?? []);
      const standings = buildStandings(index, { seasonId: targetSeasonId });
      setTeamPoints(Object.fromEntries((standings.body?.teams ?? []).map(t => [t.team_id, t])));
    } catch { setRoster([]); setTeamPoints({}); }
  }, [targetSeasonId]);

  useEffect(() => {
    setData(null);
    setLoadError(null);
    setAddDriverFor(null);
    setAddingTeam(false);
    load().catch(err => { setLoadError(err.message); });
  }, [load]);

  const rows = data?.teams ?? [];

  // Global teams not yet entered in this season.
  const poolNotInSeason = useMemo(() => {
    const inSeason = new Set(rows.map(r => r.team_id));
    return pool.filter(t => !inSeason.has(t.id));
  }, [pool, rows]);

  // Which team each driver is already on this season, so the picker can say so
  // (picking them anyway moves them, which the API does in one step).
  const teamOfDriver = useMemo(() => {
    const map = {};
    for (const row of rows) for (const id of row.driver_ids) map[id] = row.team_name;
    return map;
  }, [rows]);

  // Who can be added: the season's roster first (they're already racing it),
  // then anyone else in the global driver pool.
  const driverOptions = useCallback((teamId) => {
    const own = new Set(rows.find(r => r.team_id === teamId)?.driver_ids ?? []);
    const seen = new Set();
    const options = [];
    for (const r of roster) {
      const id = r.driver_id || "";
      if (id && (own.has(id) || seen.has(id))) continue;
      if (id) seen.add(id);
      options.push({
        value: id ? `driver:${id}` : `entry:${r.entry_id}`,
        label: r.display_name || r.name,
        hint: teamOfDriver[id] ? `on ${teamOfDriver[id]}` : "on this season's roster",
        driver_id: id || null,
        name: r.name,
        user_id: r.user_id || "",
        entry_id: r.entry_id || null,
      });
    }
    for (const d of driverPool) {
      if (own.has(d.id) || seen.has(d.id)) continue;
      seen.add(d.id);
      options.push({
        value: `driver:${d.id}`,
        label: d.name,
        hint: teamOfDriver[d.id] ? `on ${teamOfDriver[d.id]}` : "driver pool",
        driver_id: d.id,
        name: d.name,
        user_id: d.user_id || "",
        entry_id: null,
      });
    }
    return options;
  }, [rows, roster, driverPool, teamOfDriver]);

  // A team entered in this season only through legacy per-season data has no
  // lineup document yet; create one before editing it.
  async function ensureMapping(row) {
    if (row.id) return row.id;
    const created = await api("/api/team-seasons", {
      method: "POST",
      body: { team_id: row.team_id, season_id: targetSeasonId, driver_ids: row.driver_ids },
    });
    return created.id;
  }

  async function run(label, fn) {
    setBusy(true);
    try {
      await fn();
      await load();
      if (label) showToast("success", label);
    } catch (err) { showToast("error", err.message); }
    finally { setBusy(false); }
  }

  function addTeamToSeason(teamId) {
    setAddingTeam(false);
    return run("Team added to the season.", () =>
      api("/api/team-seasons", { method: "POST", body: { team_id: teamId, season_id: targetSeasonId } }));
  }

  function createTeam(e) {
    e.preventDefault();
    const body = { ...newTeam, name: newTeam.name.trim(), season_id: targetSeasonId };
    setCreatingTeam(false);
    setNewTeam({ ...blankTeam });
    return run("Team created and added to the season.", () => api("/api/teams", { method: "POST", body }));
  }

  function saveTeam(e) {
    e.preventDefault();
    const id = editTeam.team_id;
    const body = { name: editForm.name.trim(), color: editForm.color, logo_url: editForm.logo_url };
    setEditTeam(null);
    return run("Team updated.", () => api(`/api/teams/${id}`, { method: "PATCH", body }));
  }

  function removeTeamFromSeason(row) {
    if (!confirm(`Remove ${row.team_name} from ${targetSeason?.name ?? "this season"}? The team keeps its other seasons and every race result stays on record.`)) return;
    return run("Team removed from the season.", async () => {
      const mappingId = await ensureMapping(row);
      await api(`/api/team-seasons/${mappingId}`, { method: "DELETE" });
    });
  }

  function addDriver(row, option) {
    setAddDriverFor(null);
    return run(`${option.label} added to ${row.team_name}.`, async () => {
      // A lineup names GLOBAL drivers, so a roster row that predates the driver
      // pool is resolved (or created) there first, and its entry is linked back
      // — the same thing the Driver Roster does when it needs an identity.
      let driverId = option.driver_id;
      if (!driverId) {
        // Every option here is already on this season's roster or in the driver
        // pool, so this backfills the identity of somebody who exists rather
        // than deciding whether they're new — it resolves through every name
        // they answer to (see lib/driverMatch.js) and never stops to ask.
        driverId = await ensureDriverId({
          name: option.name, user_id: option.user_id, pool: driverPool, confirmDuplicate: true,
        });
        if (option.entry_id) await api(`/api/entries/${option.entry_id}`, { method: "PATCH", body: { driver_id: driverId } });
      }
      const mappingId = await ensureMapping(row);
      await api(`/api/team-seasons/${mappingId}`, {
        method: "PATCH",
        body: { driver_ids: [...new Set([...row.driver_ids, driverId])] },
      });
    });
  }

  function removeDriver(row, driver) {
    return run(`${driver.name} removed from ${row.team_name}.`, async () => {
      const mappingId = await ensureMapping(row);
      await api(`/api/team-seasons/${mappingId}`, {
        method: "PATCH",
        body: { driver_ids: row.driver_ids.filter(id => id !== driver.driver_id) },
      });
    });
  }

  const scopeLabel = [game?.name, series?.name, targetSeason?.name].filter(Boolean).join(" · ");

  if (!targetSeasonId) {
    return (
      <section>
        <div className="page-title"><h2>Team Roster</h2></div>
        <div className="empty-state" style={{ marginTop: 12 }}>
          <span className="empty-state-icon">🛡</span>
          <p>Choose a season to manage its teams.</p>
          <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: 0 }}>
            A team&rsquo;s driver line-up belongs to one season, so pick a <strong>Game</strong>,{" "}
            <strong>Series</strong> and <strong>Season</strong> from the menus at the top of the page.
            {gameId && !seriesId && " Select a series to get started."}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="page-title">
        <h2>Team Roster</h2>
        {data && <span className="page-badge">{rows.length} Team{rows.length === 1 ? "" : "s"} · {targetSeason?.name ?? "Season"}</span>}
        <span style={{ display: "flex", gap: 10, marginLeft: "auto" }}>
          <button className="btn btn-primary" style={{ marginTop: 0 }} disabled={busy}
            onClick={() => { setAddingTeam(a => !a); }}>
            ＋ Add Team to Season
          </button>
        </span>
      </div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.88rem" }}>
        Teams are permanent — they live in a league-wide pool and keep their history. What changes each
        season is who drives for them, which is what you set here.
        {scopeLabel && <> Editing <strong>{scopeLabel}</strong>.</>}
        {" "}Every point, win, pole and finish these drivers score this season rolls up into the team&rsquo;s
        totals, and each season adds to the team&rsquo;s all-time record.
      </p>

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      {/* Teams from before they were league-wide documents: one doc per season,
          held together only by their name. Everything on this screen already
          works with them — this folds each name into the single permanent team
          it always meant, so the league is on one model rather than two. */}
      {rows.some(r => r.legacy) && (
        <div className="form-card">
          <h3 style={{ marginTop: 0 }}>Bring these teams up to date</h3>
          <p style={{ color: "var(--ink-1)", fontSize: "0.88rem", margin: "0 0 10px" }}>
            {rows.filter(r => r.legacy).length} of this season&rsquo;s teams are stored the old way — a separate
            record per season, matched up by name. Upgrading merges each name into one permanent team and
            writes this season&rsquo;s line-up from the drivers already tagged with it. Nothing is deleted:
            every roster entry is re-pointed at the surviving team first, and no race result is touched.
          </p>
          <button className="btn btn-primary" type="button" disabled={busy}
            onClick={() => run(null, async () => {
              const res = await api("/api/admin/teams/migrate", { method: "POST" });
              showToast("success", `${res.teams_kept} team${res.teams_kept === 1 ? "" : "s"} upgraded · `
                + `${res.mappings_created} season line-up${res.mappings_created === 1 ? "" : "s"} created · `
                + `${res.entries_repointed} roster entr${res.entries_repointed === 1 ? "y" : "ies"} re-pointed.`);
            })}>
            {busy ? "Working…" : "Upgrade Teams"}
          </button>
        </div>
      )}

      {addingTeam && (
        <div className="form-card">
          <h3 style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Add a Team to {targetSeason?.name ?? "this season"}</span>
            <button className="btn btn-ghost" type="button" style={{ marginTop: 0 }}
              onClick={() => { setAddingTeam(false); setCreatingTeam(true); }}>
              ＋ New Team
            </button>
          </h3>
          <SearchPicker
            options={poolNotInSeason.map(t => ({ value: t.id, label: t.name, hint: t.seasons ? `${t.seasons} season${t.seasons === 1 ? "" : "s"}` : "no seasons yet" }))}
            placeholder="Search the team pool…"
            emptyLabel={pool.length ? "Every team in the pool is already in this season — create a new one." : "No teams in the pool yet — create the first one."}
            onPick={o => addTeamToSeason(o.value)}
            onCancel={() => setAddingTeam(false)}
          />
        </div>
      )}

      {loadError ? (
        <div className="empty-state" style={{ marginTop: 8 }}>
          <span className="empty-state-icon">⚠</span>
          <p>Couldn&rsquo;t load this season&rsquo;s teams.</p>
          <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: "0 0 12px" }}>{loadError}</p>
          <button className="btn btn-primary" onClick={() => load().catch(err => setLoadError(err.message))}>Retry</button>
        </div>
      ) : !data ? (
        <div className="skeleton" style={{ height: 220, marginTop: 8 }} />
      ) : rows.length === 0 ? (
        <div className="empty-state" style={{ marginTop: 12 }}>
          <span className="empty-state-icon">🛡</span>
          <p>No teams in {targetSeason?.name ?? "this season"} yet.</p>
          <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: 0 }}>
            Use <strong>Add Team to Season</strong> to bring one in from the pool, or create a brand-new team.
          </p>
        </div>
      ) : (
        rows.map(row => {
          const line = teamPoints[row.team_id];
          return (
            <div className="form-card" key={row.team_id}>
              <h3 style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {row.logo_url
                  ? <img src={row.logo_url} alt="" className="avatar avatar-sm" style={{ borderRadius: 6 }} />
                  : <span className="avatar avatar-sm avatar-fallback" style={{ borderRadius: 6, ...(row.color ? { background: row.color } : {}) }}>
                      {String(row.team_name || "?")[0]?.toUpperCase()}
                    </span>}
                <Link href={`/teams/${encodeURIComponent(row.team_id)}`} style={{ color: "inherit" }}>{row.team_name}</Link>
                <span className="page-badge">{row.drivers.length} Driver{row.drivers.length === 1 ? "" : "s"}</span>
                {line && (
                  <span className="page-badge" title="This season's team standings, aggregated from the drivers below">
                    {line.points} Pts · {line.wins} Win{line.wins === 1 ? "" : "s"} · {line.poles} Pole{line.poles === 1 ? "" : "s"}
                  </span>
                )}
                <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                  <button className="btn btn-ghost" type="button" style={{ marginTop: 0, padding: "4px 10px" }} disabled={busy}
                    onClick={() => { setEditTeam(row); setEditForm({ name: row.team_name, color: row.color || "", logo_url: row.logo_url || "" }); }}>
                    Edit Team
                  </button>
                  <button className="btn btn-ghost" type="button" style={{ marginTop: 0, padding: "4px 10px" }} disabled={busy}
                    onClick={() => setAddDriverFor(addDriverFor === row.team_id ? null : row.team_id)}>
                    {addDriverFor === row.team_id ? "Close" : "＋ Add Driver"}
                  </button>
                  <button className="btn btn-danger" type="button" style={{ marginTop: 0, padding: "4px 10px" }} disabled={busy}
                    onClick={() => removeTeamFromSeason(row)}>
                    Remove From Season
                  </button>
                </span>
              </h3>

              {row.drivers.length === 0 ? (
                <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "var(--ink-2)" }}>
                  No drivers on this team yet — until one is added, the team scores nothing this season.
                </p>
              ) : (
                row.drivers.map(d => (
                  <div className="driver-row" key={d.driver_id} style={{ gap: 8 }}>
                    <span style={{ flex: 1 }}>
                      {d.driver_id
                        ? <Link href={`/drivers/${d.driver_id}`} style={{ color: "var(--accent-cyan)" }}>{d.name}</Link>
                        : d.name}
                      {d.number != null && d.number !== "" && <span className="badge" style={{ marginLeft: 8 }}>#{d.number}</span>}
                      {!d.on_roster && (
                        <span style={{ marginLeft: 8, color: "var(--accent-gold, #ffb224)", fontSize: "0.76rem" }}
                          title="This driver isn't on the season's roster, so they have no results to contribute yet.">
                          not on the season roster
                        </span>
                      )}
                    </span>
                    <button className="btn btn-danger" type="button" style={{ marginTop: 0, padding: "4px 10px" }} disabled={busy}
                      title={`Remove ${d.name} from ${row.team_name} for this season`}
                      onClick={() => removeDriver(row, d)}>✕</button>
                  </div>
                ))
              )}

              {addDriverFor === row.team_id && (
                <SearchPicker
                  options={driverOptions(row.team_id)}
                  placeholder="Search drivers…"
                  emptyLabel="No drivers left to add — everyone is already on this team."
                  onPick={o => addDriver(row, o)}
                  onCancel={() => setAddDriverFor(null)}
                />
              )}
            </div>
          );
        })
      )}

      {creatingTeam && (
        <Modal title="New Team" onClose={() => setCreatingTeam(false)}>
          <form onSubmit={createTeam}>
            <p style={{ margin: "0 0 12px", fontSize: "0.8rem", color: "var(--ink-2)" }}>
              Added to the league&rsquo;s team pool and entered in{" "}
              <strong style={{ color: "var(--ink-1)" }}>{targetSeason?.name ?? "this season"}</strong>.
            </p>
            <div className="field">
              <label>Team Name</label>
              <input required autoFocus value={newTeam.name}
                onChange={e => setNewTeam(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Phoenix Motorsports" />
            </div>
            <div className="field">
              <label>Team Color</label>
              <input type="color" value={newTeam.color || "#888888"} style={{ width: 56, height: 34, padding: 2 }}
                onChange={e => setNewTeam(f => ({ ...f, color: e.target.value }))} />
            </div>
            <ImageUpload label="Team Logo" kind="team-logo" value={newTeam.logo_url}
              onUploaded={url => setNewTeam(f => ({ ...f, logo_url: url }))} />
            <button className="btn btn-primary" type="submit">Create Team</button>
            <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={() => setCreatingTeam(false)}>Cancel</button>
          </form>
        </Modal>
      )}

      {editTeam && (
        <Modal title={`Edit ${editTeam.team_name}`} onClose={() => setEditTeam(null)}>
          <form onSubmit={saveTeam}>
            <p style={{ margin: "0 0 12px", fontSize: "0.8rem", color: "var(--ink-2)" }}>
              This is the team&rsquo;s league-wide record, so a change here applies to every season it has raced.
            </p>
            <div className="field">
              <label>Team Name</label>
              <input required autoFocus value={editForm.name}
                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="field">
              <label>Team Color</label>
              <input type="color" value={editForm.color || "#888888"} style={{ width: 56, height: 34, padding: 2 }}
                onChange={e => setEditForm(f => ({ ...f, color: e.target.value }))} />
            </div>
            <ImageUpload label="Team Logo" kind="team-logo" value={editForm.logo_url}
              onUploaded={url => setEditForm(f => ({ ...f, logo_url: url }))} />
            <button className="btn btn-primary" type="submit">Save Changes</button>
            <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={() => setEditTeam(null)}>Cancel</button>
          </form>
        </Modal>
      )}
    </section>
  );
}
