"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ensureDriverId } from "@/lib/driverPool";
import { Modal } from "@/components/Modal";
import { DriverForm } from "@/components/DriverForm";

// The full driver-creation form, opened from the race-entry autocomplete's
// "+ Create new driver" option — same fields as the Roster page's Add Driver
// card, so a car number is always captured for this season's series, not
// just a bare name.
export function DriverCreateModal({ seasonId, seriesName, initialName, onClose, onCreated }) {
  const [form, setForm] = useState({ name: initialName || "", number: "", team_id: "", user_id: "" });
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    Promise.all([api(`/api/teams?season_id=${seasonId}`), api("/api/users")])
      .then(([t, u]) => { if (live) { setTeams(t); setUsers(u); } })
      .catch(() => {});
    return () => { live = false; };
  }, [seasonId]);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Registers (or reuses) the identity in the global pool, so it's tied
      // to one driver_id and reusable from Roster or another race.
      const driverId = await ensureDriverId({ name: form.name, user_id: form.user_id });
      const body = { name: form.name, team_id: form.team_id, user_id: form.user_id, driver_id: driverId, season_id: seasonId };
      if (form.number !== "") body.number = form.number;
      const entry = await api("/api/entries", { method: "POST", body });
      onCreated(entry);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Create Driver" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <DriverForm
          value={form}
          onChange={setForm}
          teams={teams}
          users={users}
          numberLabel={`Car Number${seriesName ? ` · ${seriesName}` : ""}`}
        />
        {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save Driver"}</button>
        <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={onClose} disabled={busy}>Cancel</button>
      </form>
    </Modal>
  );
}
