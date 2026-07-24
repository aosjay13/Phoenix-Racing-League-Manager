"use client";

// Shared driver-identity fields: Name, per-series Car Number, Class, Team, and
// an optional linked player account. Used by the Roster page's Add Driver card
// and by the race-entry "create driver on the fly" modal, so both surfaces
// stay in sync with the same fields and the same series-scoped number.
//
// The Class dropdown only appears for a season that actually runs classes —
// a single-class season never sees it.
export function DriverForm({ value, onChange, teams, users, classes = [], numberLabel = "Car Number" }) {
  return (
    <>
      <div className="field">
        <label>Driver Name</label>
        <input required value={value.name} onChange={e => onChange({ ...value, name: e.target.value })} placeholder="e.g. J. May" />
      </div>
      <div className="field">
        <label>{numberLabel}</label>
        <input type="text" inputMode="numeric" maxLength={3} value={value.number}
          onChange={e => onChange({ ...value, number: e.target.value })} placeholder="e.g. 01, 13, 007" />
      </div>
      {classes.length > 0 && (
        <div className="field">
          <label>Class</label>
          <select value={value.class_id ?? ""} onChange={e => onChange({ ...value, class_id: e.target.value })}>
            <option value="">Unclassified</option>
            {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      <div className="field">
        <label>Team</label>
        <select value={value.team_id} onChange={e => onChange({ ...value, team_id: e.target.value })}>
          <option value="">No team</option>
          {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label>Linked Player Account (for profile stats)</label>
        <select value={value.user_id} onChange={e => onChange({ ...value, user_id: e.target.value })}>
          <option value="">Not linked</option>
          {users.map(u => <option key={u.uid} value={u.uid}>{u.display_name}</option>)}
        </select>
      </div>
    </>
  );
}
