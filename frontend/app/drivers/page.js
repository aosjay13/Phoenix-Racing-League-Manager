"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { DirectoryRow } from "@/components/DirectoryRow";
import { RosterManager } from "@/components/RosterManager";
import { UserAccountsManager } from "@/components/UserAccountsManager";
import { DriverPoolCreateModal } from "@/components/DriverPoolCreateModal";
import { DriverEditModal } from "@/components/DriverEditModal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import { useUserAccountsAlerts, alertsTitle } from "@/lib/userAccountsAlerts";

// The global driver directory — the "Drivers" tab, and the only one every
// visitor sees.
function DriversDirectory() {
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
  const [syncing, setSyncing] = useState(false);       // name-backfill in progress
  const [merging, setMerging] = useState(null);        // duplicate driver being merged away
  const [mergeInto, setMergeInto] = useState("");      // survivor driver id
  const [mergeBusy, setMergeBusy] = useState(false);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }

  // Heal any historical desync in one pass: pushes every driver's current
  // profile name onto their old roster entries. Renames already cascade
  // automatically going forward; this is for data that predates that.
  async function syncNames() {
    setSyncing(true);
    try {
      const res = await api("/api/admin/drivers/sync-names", { method: "POST" });
      showToast("success", res.entries_synced
        ? `Synced ${res.entries_synced} entr${res.entries_synced === 1 ? "y" : "ies"} across ${res.drivers_touched} driver${res.drivers_touched === 1 ? "" : "s"}.`
        : "All driver names are already in sync.");
    } catch (err) { showToast("error", err.message); }
    finally { setSyncing(false); }
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
            // The directory isn't tied to a game, so it shows the overall
            // display name: the driver's own override first, then a linked
            // account's name, then the pool name (see lib/driverNames.js).
            name: d.display_name || account?.display_name || d.name,
            pool_name: d.name,
            account_name: account?.display_name || "",
            display_name: d.display_name || "",
            game_names: d.game_names || [],
            notes: d.notes || "",
            aliases: d.aliases || [],
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

  // Merge a duplicate (e.g. a mistyped name) into the correct driver: their
  // race entries move over and the duplicate is removed, so the old name stops
  // appearing everywhere — results stay intact under the surviving driver.
  async function mergeDrivers() {
    if (!merging || !mergeInto) return;
    setMergeBusy(true);
    try {
      const res = await api("/api/admin/drivers/merge", { method: "POST", body: { from_id: merging.id, into_id: mergeInto } });
      const target = (drivers || []).find(d => d.id === mergeInto);
      setMerging(null); setMergeInto("");
      await load();
      showToast("success", `Merged “${merging.name}” into “${target?.name ?? "driver"}” (${res.entries_moved} entr${res.entries_moved === 1 ? "y" : "ies"} moved).`);
    } catch (err) { showToast("error", err.message); }
    finally { setMergeBusy(false); }
  }

  function handleSaved(updated) {
    setDrivers(prev => (prev || [])
      .map(d => (d.id === updated.id
        // An explicit overall display name wins; without one, a linked driver
        // keeps its account display name and an unlinked one takes the new
        // pool name.
        ? {
            ...d,
            pool_name: updated.name,
            display_name: updated.display_name ?? d.display_name,
            game_names: updated.game_names ?? d.game_names,
            notes: updated.notes ?? d.notes,
            aliases: updated.aliases ?? d.aliases,
            name: (updated.display_name || "").trim() || d.account_name || updated.name,
          }
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
          <>
            <button className="btn btn-ghost" style={{ marginTop: 0, marginLeft: "auto" }} disabled={syncing}
              title="Push every driver's current profile name onto their old race entries (fixes any stale names in results/standings)."
              onClick={syncNames}>
              {syncing ? "Syncing…" : "↻ Sync names"}
            </button>
            <button className="btn btn-primary" style={{ marginTop: 0 }} onClick={() => setCreating(true)}>
              ＋ New Driver
            </button>
          </>
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
              actionsWide={isAdmin}
              actions={isAdmin ? (
                <>
                  <button type="button" className="btn btn-ghost" onClick={() => setEditing(d)}>Edit</button>
                  <button type="button" className="btn btn-ghost" title="Merge this duplicate into another driver" onClick={() => { setMerging(d); setMergeInto(""); }}>Merge</button>
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
          driver={{
            id: editing.id,
            name: editing.pool_name,
            display_name: editing.display_name,
            game_names: editing.game_names,
            account_name: editing.account_name,
            notes: editing.notes,
            aliases: editing.aliases,
            linked: editing.linked,
          }}
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
      {merging && (
        <Modal title={`Merge “${merging.name}”`} onClose={mergeBusy ? () => {} : () => { setMerging(null); setMergeInto(""); }}>
          <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.9rem" }}>
            Move every race entry from <strong>{merging.name}</strong> onto the correct driver, then remove
            this duplicate. All results stay on record under the surviving driver — nothing is lost.
          </p>
          <div className="field">
            <label>Merge into</label>
            <select value={mergeInto} onChange={e => setMergeInto(e.target.value)}>
              <option value="">Select the correct driver…</option>
              {(drivers || []).filter(d => d.id !== merging.id).map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" type="button" disabled={mergeBusy || !mergeInto} onClick={mergeDrivers}>
            {mergeBusy ? "Merging…" : "Merge Drivers"}
          </button>
          <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} disabled={mergeBusy}
            onClick={() => { setMerging(null); setMergeInto(""); }}>Cancel</button>
        </Modal>
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

// ── The Drivers menu ───────────────────────────────────────────────────────
// Everything about the people in the league lives here, one tab per view, so
// an admin never has to hop between menus (or scroll past one screen to reach
// the next): the public directory, the season roster & teams manager, and the
// player accounts behind the profiles.
const TABS = [
  { key: "directory", label: "Drivers",        icon: "🏎", admin: false },
  { key: "roster",    label: "Roster & Teams", icon: "⊞",  admin: true  },
  { key: "accounts",  label: "User Accounts",  icon: "👥", admin: true  },
];

function DriversTabs() {
  const { isAdmin } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const wanted = searchParams.get("tab") || "directory";
  // Same alert count the sidebar puts on the Drivers link, so an admin who
  // follows that badge here can see which tab it was pointing at.
  const alerts = useUserAccountsAlerts(isAdmin);

  const visible = TABS.filter(t => !t.admin || isAdmin);
  // A non-admin (or an admin whose role is still loading) can only ever be on
  // the directory, so an admin-only ?tab= falls back rather than showing blank.
  const tab = visible.some(t => t.key === wanted) ? wanted : "directory";

  function selectTab(key) {
    // Shallow URL update so the tab is linkable/back-buttonable without
    // re-running the route.
    router.replace(key === "directory" ? "/drivers" : `/drivers?tab=${key}`, { scroll: false });
  }

  return (
    <section>
      {visible.length > 1 && (
        <div className="tab-row" style={{ marginTop: 0, marginBottom: 18, flexWrap: "wrap" }}>
          {visible.map(t => {
            const badge = t.key === "accounts" ? alerts.total : 0;
            return (
              <button key={t.key} type="button" className={`tab${tab === t.key ? " active" : ""}`}
                onClick={() => selectTab(t.key)} title={badge > 0 ? alertsTitle(alerts) : undefined}>
                <span style={{ marginRight: 6 }}>{t.icon}</span>{t.label}
                {badge > 0 && (
                  <span className="nav-badge tab-badge">{badge > 99 ? "99+" : badge}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {tab === "directory" && <DriversDirectory />}
      {tab === "roster" && isAdmin && <RosterManager />}
      {tab === "accounts" && isAdmin && <UserAccountsManager />}
    </section>
  );
}

export default function DriversPage() {
  return (
    <Suspense fallback={<div className="skeleton" style={{ height: 240 }} />}>
      <DriversTabs />
    </Suspense>
  );
}
