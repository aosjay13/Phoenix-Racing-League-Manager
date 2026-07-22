"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { DirectoryRow } from "@/components/DirectoryRow";
import { DriverEditModal } from "@/components/DriverEditModal";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export default function DriversPage() {
  const { isAdmin } = useAuth();
  const [drivers, setDrivers] = useState(null);
  const [editing, setEditing] = useState(null);   // driver row being edited
  const [deleting, setDeleting] = useState(null); // driver row being deleted

  useEffect(() => {
    // The global driver pool is the full roster of everyone who has raced,
    // whether or not they've made an account. Join with the account directory
    // so linked drivers can show their profile photo and country.
    Promise.all([api("/api/drivers"), api("/api/users")])
      .then(([pool, users]) => {
        const byUid = Object.fromEntries(users.map(u => [u.uid, u]));
        const rows = pool.map(d => {
          const account = d.user_id ? byUid[d.user_id] : null;
          return {
            id: d.id,
            name: account?.display_name || d.name,
            pool_name: d.name,
            notes: d.notes || "",
            photo_url: account?.photo_url || null,
            country: account?.country || null,
            linked: !!account,
          };
        });
        rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
        setDrivers(rows);
      })
      .catch(() => setDrivers([]));
  }, []);

  async function deleteDriver(driver) {
    await api(`/api/drivers/${driver.id}`, { method: "DELETE" });
    setDrivers(prev => (prev || []).filter(d => d.id !== driver.id));
  }

  function handleSaved(updated) {
    setDrivers(prev => (prev || [])
      .map(d => (d.id === updated.id
        // A linked driver keeps its account display name; an unlinked one takes
        // the new pool name.
        ? { ...d, pool_name: updated.name, notes: updated.notes ?? d.notes, name: d.linked ? d.name : updated.name }
        : d))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))));
    setEditing(null);
  }

  if (!drivers) return <div className="skeleton" style={{ height: 240 }} />;

  const linkedCount = drivers.filter(d => d.linked).length;

  return (
    <section>
      <div className="page-title">
        <h2>Drivers</h2>
        <span className="page-badge">{drivers.length} Drivers</span>
      </div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.9rem" }}>
        Everyone who has raced in the league. Open a profile to see career stats across all games.
        {" "}{linkedCount} of {drivers.length} have linked a player account.
      </p>

      {drivers.length === 0 ? (
        <div className="empty-state"><span className="empty-state-icon">🏎</span><p>No drivers yet.</p></div>
      ) : (
        <div className="list-rows">
          {drivers.map(d => (
            <DirectoryRow
              key={d.id}
              href={`/drivers/${d.id}`}
              linked={d.linked}
              avatar={{ url: d.photo_url }}
              title={d.name}
              subtitle={d.linked ? (d.country || "Linked account") : "Not linked"}
              meta={[{ label: "Account", value: d.linked ? "Linked" : "—" }]}
              actions={isAdmin ? (
                <>
                  <button type="button" className="btn btn-ghost" onClick={() => setEditing(d)}>Edit</button>
                  <button type="button" className="btn btn-danger" onClick={() => setDeleting(d)}>Delete</button>
                </>
              ) : null}
            />
          ))}
        </div>
      )}

      {editing && (
        <DriverEditModal
          driver={{ id: editing.id, name: editing.pool_name, notes: editing.notes, linked: editing.linked }}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete Driver"
          message={`Delete “${deleting.name}” from the driver pool? Their past race results stay on record, but their career profile and stats will no longer be tracked.`}
          confirmLabel="Delete Driver"
          onConfirm={() => deleteDriver(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </section>
  );
}
