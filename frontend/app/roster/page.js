"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { useSortable } from "@/components/useSortable";
import { AdminGate } from "@/components/AdminGate";
import { ImageUpload } from "@/components/ImageUpload";
import { api } from "@/lib/api";

// Resolve the current top-dropdown selection into a roster scope, exactly the
// way the stats page does. The deepest concrete selection wins.
function useScope(league) {
  const { gameId, seriesId, seasonId, game, series, season } = league;
  return useMemo(() => {
    if (seasonId)
      return { params: `scope=season&season_id=${seasonId}`, title: `${series?.name ?? ""} ${season?.name ?? "Season"} Roster`.trim() };
    if (seriesId)
      return { params: `scope=series&series_id=${seriesId}`, title: `${series?.name ?? "Series"} Roster` };
    if (gameId)
      return { params: `scope=game&game_id=${gameId}`, title: `${game?.name ?? "Game"} Roster` };
    return { params: "scope=league", title: "League Roster" };
  }, [gameId, seriesId, seasonId, game, series, season]);
}

// The table + its sorting live in a child so that switching scope (which flips
// the Number column on/off) remounts it and re-applies the default sort.
function RosterTable({ rows, showNumber, onEdit, onDelete, canManage }) {
  // Default: by number (ascending → sequential) in a series, else by name A→Z.
  // Both "number" and "name" are treated as ascending-by-default here.
  const { sorted, clickSort, arrow } = useSortable(rows, showNumber ? "number" : "name", ["number", "name"]);

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {showNumber && <th className="sortable" onClick={() => clickSort("number")}>#{arrow("number")}</th>}
            <th className="sortable" onClick={() => clickSort("name", true)}>Driver{arrow("name")}</th>
            <th>Team</th>
            <th>Linked Account</th>
            {canManage && <th></th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map(d => (
            <tr key={d.key}>
              {showNumber && <td><span className="badge">{d.number ?? "—"}</span></td>}
              <td className="driver-name-cell">{d.name}</td>
              <td className="team-cell">{d.team_name ?? "—"}</td>
              <td className="team-cell">{d.user_id ? "Linked" : "—"}</td>
              {canManage && (
                <td style={{ textAlign: "right" }}>
                  <button className="btn btn-ghost" style={{ marginTop: 0, padding: "4px 10px" }} onClick={() => onEdit(d)}>Edit</button>
                  {d.entry_id && (
                    <button className="btn btn-danger" style={{ marginTop: 0, padding: "4px 10px", marginLeft: 6 }} onClick={() => onDelete(d)}>✕</button>
                  )}
                </td>
              )}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={5} style={{ color: "var(--ink-1)" }}>No drivers in this scope yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function RosterInner() {
  const league = useLeague();
  const { gameId, seriesId, series, seriesList } = league;
  const scope = useScope(league);

  const [roster, setRoster] = useState(null);
  const [gameRoster, setGameRoster] = useState([]); // scope=game rows, for the per-series editor
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [toast, setToast] = useState(null);

  const [driverForm, setDriverForm] = useState({ name: "", number: "", team_id: "", user_id: "" });
  const [editingKey, setEditingKey] = useState(null);
  const [seriesNums, setSeriesNums] = useState({}); // seriesId -> number string (per-series editor)
  const [teamForm, setTeamForm] = useState({ name: "", color: "", logo_url: "" });
  const [editTeamId, setEditTeamId] = useState(null);

  // A concrete season to write to. Editing is only possible once a series is
  // selected (that pins us to the series' latest season).
  const editSeasonId = seriesId ? roster?.edit_season_id ?? null : null;
  const canManage = !!editSeasonId;

  const load = useCallback(async () => {
    const r = await api(`/api/roster?${scope.params}`);
    setRoster(r);
    const u = await api("/api/users");
    setUsers(u);
    if (gameId) {
      const g = await api(`/api/roster?scope=game&game_id=${gameId}`);
      setGameRoster(g.rows);
    } else {
      setGameRoster([]);
    }
    if (seriesId && r.edit_season_id) {
      const t = await api(`/api/teams?season_id=${r.edit_season_id}`);
      setTeams(t);
    } else {
      setTeams([]);
    }
  }, [scope.params, gameId, seriesId]);

  useEffect(() => { setRoster(null); load().catch(err => showToast("error", err.message)); }, [load]);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }

  function resetDriverForm() {
    setEditingKey(null);
    setDriverForm({ name: "", number: "", team_id: "", user_id: "" });
    setSeriesNums({});
  }

  // Per-series numbers for the driver being edited, gathered from the
  // game-wide roster so every series in the game is represented.
  const editingSeriesEntries = useMemo(() => {
    if (!editingKey) return {};
    return gameRoster.find(r => r.key === editingKey)?.series_entries ?? {};
  }, [editingKey, gameRoster]);

  function startEdit(row) {
    setEditingKey(row.key);
    setDriverForm({ name: row.name, number: row.number ?? "", team_id: row.team_id ?? "", user_id: row.user_id ?? "" });
    const game = gameRoster.find(r => r.key === row.key)?.series_entries ?? {};
    const nums = {};
    for (const [sid, e] of Object.entries(game)) nums[sid] = e.number ?? "";
    setSeriesNums(nums);
  }

  async function saveDriver(e) {
    e.preventDefault();
    if (!editSeasonId) return;
    try {
      const body = {
        name: driverForm.name,
        team_id: driverForm.team_id,
        user_id: driverForm.user_id,
      };
      if (driverForm.number !== "") body.number = driverForm.number;

      // If this driver already has an entry in the target season, patch it;
      // otherwise add them to that season's roster.
      const existing = editingKey ? editingSeriesEntries[seriesId] : null;
      const existingId = existing && existing.season_id === editSeasonId ? existing.entry_id : null;
      if (existingId) await api(`/api/entries/${existingId}`, { method: "PATCH", body });
      else await api("/api/entries", { method: "POST", body: { ...body, season_id: editSeasonId } });

      showToast("success", existingId ? "Driver updated." : "Driver added to roster.");
      resetDriverForm();
      await load();
    } catch (err) { showToast("error", err.message); }
  }

  // Save one series' car number for the driver being edited. Only series where
  // the driver already has an entry can be set here.
  async function saveSeriesNumber(sid) {
    const entry = editingSeriesEntries[sid];
    if (!entry) return;
    const raw = seriesNums[sid];
    if (raw === "" || raw == null) { showToast("error", "Enter a car number first."); return; }
    try {
      await api(`/api/entries/${entry.entry_id}`, { method: "PATCH", body: { number: raw } });
      showToast("success", "Series number saved.");
      await load();
    } catch (err) { showToast("error", err.message); }
  }

  async function deleteDriver(row) {
    if (!row.entry_id) return;
    if (!confirm(`Remove ${row.name} from this season's roster?`)) return;
    try { await api(`/api/entries/${row.entry_id}`, { method: "DELETE" }); await load(); }
    catch (err) { showToast("error", err.message); }
  }

  async function saveTeam(e) {
    e.preventDefault();
    if (!editSeasonId) return;
    try {
      if (editTeamId) await api(`/api/teams/${editTeamId}`, { method: "PATCH", body: teamForm });
      else await api("/api/teams", { method: "POST", body: { ...teamForm, season_id: editSeasonId } });
      showToast("success", editTeamId ? "Team updated." : "Team created.");
      setTeamForm({ name: "", color: "", logo_url: "" });
      setEditTeamId(null);
      await load();
    } catch (err) { showToast("error", err.message); }
  }

  async function deleteTeam(id) {
    if (!confirm("Delete this team?")) return;
    try { await api(`/api/teams/${id}`, { method: "DELETE" }); await load(); }
    catch (err) { showToast("error", err.message); }
  }

  const rows = roster?.rows ?? [];
  const showNumber = !!roster?.show_number;

  return (
    <section>
      <div className="page-title">
        <h2>{scope.title}</h2>
        {roster && <span className="page-badge">{rows.length} Drivers · {roster.seasons_counted} Season{roster.seasons_counted === 1 ? "" : "s"}</span>}
      </div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.88rem" }}>
        Use the Game / Series / Season menus above to change scope. Pick a specific series to see and sort by car numbers.
        Click the # or Driver headers to toggle sorting.
      </p>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      {canManage ? (
        <div className="two-col">
          <div className="form-card">
            <h3>{editingKey ? "Edit Driver" : "Add Driver"}</h3>
            <form onSubmit={saveDriver}>
              <div className="field">
                <label>Driver Name</label>
                <input required value={driverForm.name} onChange={e => setDriverForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. J. May" />
              </div>
              <div className="field">
                <label>Car Number · {series?.name ?? "this series"}</label>
                <input type="number" value={driverForm.number} onChange={e => setDriverForm(f => ({ ...f, number: e.target.value }))} placeholder="13" />
              </div>
              <div className="field">
                <label>Team</label>
                <select value={driverForm.team_id} onChange={e => setDriverForm(f => ({ ...f, team_id: e.target.value }))}>
                  <option value="">No team</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Linked Player Account (for profile stats)</label>
                <select value={driverForm.user_id} onChange={e => setDriverForm(f => ({ ...f, user_id: e.target.value }))}>
                  <option value="">Not linked</option>
                  {users.map(u => <option key={u.uid} value={u.uid}>{u.display_name}</option>)}
                </select>
              </div>

              {editingKey && Object.keys(editingSeriesEntries).length > 0 && (
                <div className="field" style={{ marginTop: 4 }}>
                  <label>Car Numbers by Series</label>
                  <p style={{ margin: "0 0 8px", color: "var(--ink-2)", fontSize: "0.8rem" }}>
                    Set the number this driver runs in each series they race.
                  </p>
                  {seriesList.map(s => {
                    const entry = editingSeriesEntries[s.id];
                    return (
                      <div className="driver-row" key={s.id} style={{ gap: 8 }}>
                        <span style={{ flex: 1 }}>{s.name}</span>
                        {entry ? (
                          <>
                            <input type="number" style={{ width: 80 }} value={seriesNums[s.id] ?? ""}
                              onChange={e => setSeriesNums(n => ({ ...n, [s.id]: e.target.value }))} placeholder="—" />
                            <button className="btn btn-ghost" type="button" style={{ marginTop: 0, padding: "4px 10px" }}
                              onClick={() => saveSeriesNumber(s.id)}>Save</button>
                          </>
                        ) : (
                          <span style={{ color: "var(--ink-2)", fontSize: "0.8rem" }}>Not on this series&rsquo; roster</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <button className="btn btn-primary" type="submit">{editingKey ? "Save Changes" : "Add Driver"}</button>
              {editingKey && (
                <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={resetDriverForm}>Cancel</button>
              )}
            </form>
          </div>

          <div className="form-card">
            <h3>{editTeamId ? "Edit Team" : "Add Team"}</h3>
            <form onSubmit={saveTeam}>
              <div className="field">
                <label>Team Name</label>
                <input required value={teamForm.name} onChange={e => setTeamForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Phoenix Motorsports" />
              </div>
              <ImageUpload label="Team Logo" kind="team-logo" value={teamForm.logo_url}
                onUploaded={url => setTeamForm(f => ({ ...f, logo_url: url }))} />
              <button className="btn btn-primary" type="submit">{editTeamId ? "Save Changes" : "Create Team"}</button>
              {editTeamId && (
                <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }}
                  onClick={() => { setEditTeamId(null); setTeamForm({ name: "", color: "", logo_url: "" }); }}>Cancel</button>
              )}
            </form>

            {teams.length > 0 && (
              <div style={{ marginTop: 20 }}>
                {teams.map(t => (
                  <div className="driver-row" key={t.id}>
                    {t.logo_url ? <img src={t.logo_url} alt="" className="avatar avatar-sm" style={{ borderRadius: 6 }} /> : <span>🛡</span>}
                    <span style={{ flex: 1 }}>{t.name}</span>
                    <button className="btn btn-ghost" title="Edit" style={{ marginTop: 0, padding: "4px 10px" }}
                      onClick={() => { setEditTeamId(t.id); setTeamForm({ name: t.name, color: t.color || "", logo_url: t.logo_url || "" }); }}>✎</button>
                    <button className="btn btn-danger" style={{ marginTop: 0, padding: "4px 10px" }} onClick={() => deleteTeam(t.id)}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="empty-state" style={{ marginTop: 12 }}>
          <span className="empty-state-icon">⊞</span>
          <p>Viewing the overall roster.</p>
          <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: 0 }}>
            Select a specific Series above to manage drivers, teams, and per-series car numbers.
          </p>
        </div>
      )}

      <div className="section-header"><h3>{scope.title}</h3></div>
      {!roster ? (
        <div className="skeleton" style={{ height: 220, marginTop: 8 }} />
      ) : (
        <RosterTable
          key={scope.params}
          rows={rows}
          showNumber={showNumber}
          onEdit={startEdit}
          onDelete={deleteDriver}
          canManage={canManage}
        />
      )}
    </section>
  );
}

export default function RosterPage() {
  return <AdminGate><RosterInner /></AdminGate>;
}
