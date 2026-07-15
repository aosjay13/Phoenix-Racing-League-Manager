"use client";

import { useEffect, useState, useCallback } from "react";
import { useLeague } from "@/components/LeagueProvider";
import { AdminGate } from "@/components/AdminGate";
import { ImageUpload } from "@/components/ImageUpload";
import { api } from "@/lib/api";

function RosterInner() {
  const { seasonId, season } = useLeague();
  const [entries, setEntries] = useState([]);
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [driverForm, setDriverForm] = useState({ name: "", number: "", team_id: "", user_id: "" });
  const [editId, setEditId] = useState(null);
  const [teamForm, setTeamForm] = useState({ name: "", color: "", logo_url: "" });
  const [editTeamId, setEditTeamId] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    if (!seasonId) return;
    const [e, t, u] = await Promise.all([
      api(`/api/entries?season_id=${seasonId}`),
      api(`/api/teams?season_id=${seasonId}`),
      api("/api/users"),
    ]);
    setEntries(e); setTeams(t); setUsers(u);
  }, [seasonId]);

  useEffect(() => { load().catch(() => {}); }, [load]);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }

  async function saveDriver(e) {
    e.preventDefault();
    try {
      const body = { ...driverForm, season_id: seasonId };
      if (body.number === "") delete body.number;
      if (editId) await api(`/api/entries/${editId}`, { method: "PATCH", body });
      else await api("/api/entries", { method: "POST", body });
      showToast("success", editId ? "Driver updated." : "Driver added to roster.");
      setDriverForm({ name: "", number: "", team_id: "", user_id: "" });
      setEditId(null);
      load();
    } catch (err) { showToast("error", err.message); }
  }

  async function deleteDriver(id) {
    if (!confirm("Remove this driver from the season roster?")) return;
    try { await api(`/api/entries/${id}`, { method: "DELETE" }); load(); }
    catch (err) { showToast("error", err.message); }
  }

  async function saveTeam(e) {
    e.preventDefault();
    try {
      if (editTeamId) await api(`/api/teams/${editTeamId}`, { method: "PATCH", body: teamForm });
      else await api("/api/teams", { method: "POST", body: { ...teamForm, season_id: seasonId } });
      showToast("success", editTeamId ? "Team updated." : "Team created.");
      setTeamForm({ name: "", color: "", logo_url: "" });
      setEditTeamId(null);
      load();
    } catch (err) { showToast("error", err.message); }
  }

  async function deleteTeam(id) {
    if (!confirm("Delete this team?")) return;
    try { await api(`/api/teams/${id}`, { method: "DELETE" }); load(); }
    catch (err) { showToast("error", err.message); }
  }

  if (!seasonId) {
    return <div className="empty-state"><span className="empty-state-icon">⊞</span><p>Select a game, series and season above.</p></div>;
  }

  const teamName = id => teams.find(t => t.id === id)?.name ?? "—";

  return (
    <section>
      <div className="page-title">
        <h2>Roster &amp; Teams · {season?.name ?? ""}</h2>
        <span className="page-badge">{entries.length} Drivers · {teams.length} Teams</span>
      </div>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      <div className="two-col">
        <div className="form-card">
          <h3>{editId ? "Edit Driver" : "Add Driver"}</h3>
          <form onSubmit={saveDriver}>
            <div className="field">
              <label>Driver Name</label>
              <input required value={driverForm.name} onChange={e => setDriverForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. J. May" />
            </div>
            <div className="field">
              <label>Car Number</label>
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
            <button className="btn btn-primary" type="submit">{editId ? "Save Changes" : "Add Driver"}</button>
            {editId && (
              <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }}
                onClick={() => { setEditId(null); setDriverForm({ name: "", number: "", team_id: "", user_id: "" }); }}>
                Cancel
              </button>
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

      <div className="section-header"><h3>Season Roster</h3></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Driver</th><th>Team</th><th>Linked Account</th><th></th></tr></thead>
          <tbody>
            {entries.map(d => (
              <tr key={d.id}>
                <td><span className="badge">{d.number ?? "—"}</span></td>
                <td className="driver-name-cell">{d.name}</td>
                <td className="team-cell">{teamName(d.team_id)}</td>
                <td className="team-cell">{d.user_id ? (users.find(u => u.uid === d.user_id)?.display_name ?? "Linked") : "—"}</td>
                <td style={{ textAlign: "right" }}>
                  <button className="btn btn-ghost" style={{ marginTop: 0, padding: "4px 10px" }}
                    onClick={() => { setEditId(d.id); setDriverForm({ name: d.name, number: d.number ?? "", team_id: d.team_id ?? "", user_id: d.user_id ?? "" }); }}>
                    Edit
                  </button>
                  <button className="btn btn-danger" style={{ marginTop: 0, padding: "4px 10px", marginLeft: 6 }} onClick={() => deleteDriver(d.id)}>✕</button>
                </td>
              </tr>
            ))}
            {entries.length === 0 && <tr><td colSpan={5} style={{ color: "var(--ink-1)" }}>No drivers on the roster yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function RosterPage() {
  return <AdminGate><RosterInner /></AdminGate>;
}
