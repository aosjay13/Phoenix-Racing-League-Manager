"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { DirectoryRow } from "@/components/DirectoryRow";
import { DriverPoolCreateModal } from "@/components/DriverPoolCreateModal";
import { DriverEditModal } from "@/components/DriverEditModal";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export default function DriversPage() {
  const { user, isAdmin } = useAuth();
  const [drivers, setDrivers] = useState(null);
  const [users, setUsers] = useState([]);
  const [myDriverId, setMyDriverId] = useState(null);      // driver linked to me
  const [pendingIds, setPendingIds] = useState([]);        // driver ids I've requested
  const [claimBusy, setClaimBusy] = useState({});          // driver id -> true
  const [toast, setToast] = useState(null);
  const [creating, setCreating] = useState(false); // new-driver modal open
  const [editing, setEditing] = useState(null);   // driver row being edited
  const [deleting, setDeleting] = useState(null); // driver row being deleted
  const [unclaiming, setUnclaiming] = useState(false); // confirm unclaim dialog

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }

  // The global driver pool is the full roster of everyone who has raced,
  // whether or not they've made an account. Join with the account directory so
  // linked drivers can show their profile photo and country.
  function load() {
    const calls = [api("/api/drivers"), api("/api/users")];
    if (user) calls.push(api("/api/claim-requests").catch(() => []));
    return Promise.all(calls)
      .then(([pool, accts, myReqs]) => {
        setUsers(accts);
        const byUid = Object.fromEntries(accts.map(u => [u.uid, u]));
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
            mine: !!user && d.user_id === user.uid,
          };
        });
        rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
        setDrivers(rows);
        setMyDriverId(user ? (pool.find(d => d.user_id === user.uid)?.id || null) : null);
        setPendingIds((myReqs || []).filter(r => r.status === "pending").map(r => r.driver_id));
      })
      .catch(() => setDrivers([]));
  }

  useEffect(() => { load(); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Once you've claimed a driver (linked, or a request is pending), the claim
  // buttons on the other rows disappear — you get one driver identity per account.
  const hasClaimed = !!myDriverId || pendingIds.length > 0;

  async function claimDriver(d) {
    setClaimBusy(b => ({ ...b, [d.id]: true }));
    try {
      await api("/api/claim-requests", { method: "POST", body: { driver_id: d.id } });
      setPendingIds(ids => [...ids, d.id]);
      showToast("success", `Claim request sent for ${d.name}. An admin will review it.`);
    } catch (err) {
      showToast("error", err.message);
    } finally {
      setClaimBusy(b => ({ ...b, [d.id]: false }));
    }
  }

  // Rendered inside DirectoryRow for signed-in non-admins (admins keep Edit/Delete).
  function claimActions(d) {
    if (!user || isAdmin) return null;
    if (d.mine) {
      return <button type="button" className="btn btn-ghost" onClick={() => setUnclaiming(true)}>Unclaim</button>;
    }
    if (pendingIds.includes(d.id)) {
      return (
        <span className="page-badge" style={{ background: "rgba(255,178,36,0.14)", color: "var(--accent-amber, #ffb224)", border: "1px solid rgba(255,178,36,0.3)" }}>
          ⏳ Requested
        </span>
      );
    }
    if (!hasClaimed && !d.linked) {
      return (
        <button type="button" className="btn btn-primary" disabled={!!claimBusy[d.id]} onClick={() => claimDriver(d)}>
          {claimBusy[d.id] ? "…" : "Claim driver"}
        </button>
      );
    }
    return null;
  }

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
        {isAdmin && (
          <button className="btn btn-primary" style={{ marginTop: 0, marginLeft: "auto" }} onClick={() => setCreating(true)}>
            ＋ New Driver
          </button>
        )}
      </div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.9rem" }}>
        Everyone who has raced in the league. Open a profile to see career stats across all games.
        {" "}{linkedCount} of {drivers.length} have linked a player account.
      </p>
      {user && !isAdmin && !hasClaimed && (
        <p style={{ marginTop: 0, color: "var(--ink-2)", fontSize: "0.85rem" }}>
          Is one of these you? Hit <strong>Claim driver</strong> to request it — an admin approves before it's linked to your account.
        </p>
      )}

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

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
              ) : claimActions(d)}
            />
          ))}
        </div>
      )}

      {creating && (
        <DriverPoolCreateModal
          users={users}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); load(); }}
        />
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
      {unclaiming && (
        <ConfirmDialog
          title="Unclaim Driver"
          message="Unlink your account from this driver profile? Your race stats stay on record, but the profile returns to the unclaimed pool and you can claim a different one."
          confirmLabel="Unclaim"
          onConfirm={async () => {
            await api("/api/users/me/driver", { method: "DELETE" });
            await load();
            showToast("success", "You've unclaimed your driver profile.");
          }}
          onClose={() => setUnclaiming(false)}
        />
      )}
    </section>
  );
}
