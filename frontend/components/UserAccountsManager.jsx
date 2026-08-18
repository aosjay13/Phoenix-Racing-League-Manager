"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useAuth } from "@/components/AuthProvider";
import { useLeague } from "@/components/LeagueProvider";
import { USERS_SEEN_KEY, USERS_SEEN_EVENT, markUserAccountsSeen } from "@/lib/userAccountsAlerts";
import { api } from "@/lib/api";
import { normalizeAliases } from "@/lib/aliases";
import { NEW_DRIVER_KIND, requestKind } from "@/lib/signupRequest";
import { ROLE_LABELS, roleLevel, canManage, assignableRoles } from "@/lib/roles";

// Small coloured pill showing a role, keyed by the role's rank so Owner reads
// as the strongest. Used wherever a role can't (or shouldn't) be edited.
const ROLE_PILL = {
  owner: { bg: "var(--accent-amber, #ffb224)", fg: "#1a1205" },
  admin: { bg: "var(--accent-cyan, #2ee6d6)", fg: "#04201d" },
  moderator: { bg: "var(--border-accent, #3a5bd0)", fg: "#eaf0ff" },
  statistician: { bg: "var(--card-hover, #2a2a33)", fg: "var(--ink-0)" },
  player: { bg: "transparent", fg: "var(--ink-2)" },
};
function RoleBadge({ role, locked, title }) {
  const c = ROLE_PILL[role] || ROLE_PILL.player;
  return (
    <span title={title} style={{
      display: "inline-block", padding: "4px 12px", borderRadius: 999, minWidth: 96,
      fontSize: "0.8rem", fontWeight: 600, background: c.bg, color: c.fg,
      border: role === "player" ? "1px solid var(--border)" : "none",
    }}>
      {locked ? "🔒 " : ""}{ROLE_LABELS[role] || "Player"}
    </span>
  );
}

// Where an account stands between signing up and being a usable league member.
// The roster is listed from Firebase Auth, so accounts show up the moment they
// sign up — these pills say why one isn't fully set up yet.
function accountStatus(u) {
  if (!u.auth_known) return null;   // couldn't read Auth — say nothing rather than guess
  if (u.env_admin) return { label: "Active", tone: "ok", title: "Permanent Owner — exempt from email verification" };
  if (!u.email_verified) {
    return { label: "Unverified", tone: "warn", title: "Signed up but hasn't clicked the verification link yet — they can't use the league until they do." };
  }
  if (!u.has_profile) {
    return { label: "Not opened yet", tone: "info", title: "Email verified, but they haven't returned to the app since. Their profile finishes setting itself up on their next visit — role and driver links you set now are kept." };
  }
  return { label: "Active", tone: "ok", title: "Verified and set up" };
}

const STATUS_TONE = {
  ok: { bg: "transparent", fg: "var(--ink-2)", border: "1px solid var(--border)" },
  warn: { bg: "var(--accent-amber, #ffb224)", fg: "#1a1205", border: "none" },
  info: { bg: "var(--card-hover, #2a2a33)", fg: "var(--accent-cyan, #2ee6d6)", border: "1px solid var(--border-accent, #3a5bd0)" },
};

function StatusBadge({ status }) {
  if (!status) return null;
  const c = STATUS_TONE[status.tone] || STATUS_TONE.ok;
  return (
    <span title={status.title} style={{
      display: "inline-block", padding: "3px 10px", borderRadius: 999, whiteSpace: "nowrap",
      fontSize: "0.75rem", fontWeight: 600, background: c.bg, color: c.fg, border: c.border,
    }}>
      {status.label}
    </span>
  );
}

// One driver row is roughly this tall (padding + name + availability line +
// separator), so ten of them is the list height we aim for.
const DRIVER_ROW_H = 52;
const DRIVER_ROWS_VISIBLE = 10;
const DRIVER_LIST_MAX = DRIVER_ROW_H * DRIVER_ROWS_VISIBLE;
const SEARCH_BOX_H = 50;   // the search field above the list
const VIEWPORT_GAP = 12;   // breathing room against the window edge
const LIST_MIN = 120;      // never collapse to a sliver, even in a short window

// The sticky page header the panel must never grow under. It's translucent, so
// a dropdown sliding beneath it doesn't just get hidden — it shows through as a
// smear of half-legible rows over the league selectors. Measured rather than
// hard-coded: the topbar wraps to two rows on a narrow window.
function usableTop() {
  const bar = document.querySelector(".topbar");
  return (bar ? bar.getBoundingClientRect().bottom : 0) + VIEWPORT_GAP;
}

// Searchable driver-profile picker rendered as a proper select: a trigger that
// always shows the current link, and a roomy dropdown listing every driver with
// its availability (unclaimed / linked here / linked to another account).
//
// The panel is rendered into <body> as a FIXED element rather than absolutely
// inside the cell, and both halves of that matter:
//
//   • the picker sits in a table cell inside `.table-wrap`, which is
//     `overflow: auto` — an absolutely positioned panel is clipped by it, which
//     is what sliced the top row of the list in half;
//   • measuring "room above" against the top of the WINDOW ignored the sticky
//     topbar, so a row low on the page opened a full-height panel upwards that
//     ran up behind the league selectors.
//
// Fixed + portalled + measured against the topbar fixes both: it can't be
// clipped by any ancestor, and it can't grow into the one strip of the screen
// that isn't its to use.
function DriverLinkSelect({ drivers, valueId, valueName, disabled, onChange }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  // Where the panel hangs, how tall its list may be, and the trigger's position
  // on screen — recomputed whenever it opens, the window resizes, or anything
  // scrolls, so a fixed panel tracks the row it belongs to.
  const [placement, setPlacement] = useState(null);
  const boxRef = useRef(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    // The panel lives in a portal, so it is NOT inside boxRef — without
    // checking it too, mousedown inside the list would close the panel before
    // the click landed, and picking a driver would do nothing at all.
    function onDown(e) {
      const inTrigger = boxRef.current?.contains(e.target);
      const inPanel = panelRef.current?.contains(e.target);
      if (!inTrigger && !inPanel) { setOpen(false); setText(""); }
    }
    function onKey(e) { if (e.key === "Escape") { setOpen(false); setText(""); } }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, []);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  // Pick the side with more room — between the topbar and the bottom of the
  // window, which is all the space this panel is entitled to — and cap the list
  // to what actually fits there, never asking for more than ten rows.
  useEffect(() => {
    if (!open) { setPlacement(null); return undefined; }

    // Re-measured on every animation frame while the panel is open, rather than
    // only on scroll and resize.
    //
    // A fixed panel is anchored to viewport coordinates, so it has to be told
    // whenever its row moves — and scrolling is far from the only thing that
    // moves it. A success toast appearing or collapsing, the account list
    // reloading after a link, any of the app's reveal animations: each reflows
    // the page under a panel that then sits where the row used to be. Listening
    // for the specific causes means missing the next one; asking "where is the
    // row now?" each frame cannot.
    //
    // It costs one getBoundingClientRect per frame, only while a picker is
    // open, and state is only written when something actually moved — so the
    // idle case is a single cheap read and no re-render.
    let raf = 0;
    let last = null;
    function measure() {
      const rect = boxRef.current?.getBoundingClientRect();
      if (rect) {
        const top = usableTop();
        const below = window.innerHeight - VIEWPORT_GAP - rect.bottom;
        const above = rect.top - top;
        const up = below < Math.min(DRIVER_LIST_MAX + SEARCH_BOX_H, above);
        const room = (up ? above : below) - SEARCH_BOX_H;
        const next = {
          up,
          listMax: Math.max(LIST_MIN, Math.min(DRIVER_LIST_MAX, room)),
          left: rect.left,
          width: rect.width,
          top: rect.bottom,
          bottom: window.innerHeight - rect.top,
        };
        const moved = !last || Object.keys(next).some(k => (
          typeof next[k] === "number" ? Math.abs(next[k] - last[k]) > 0.5 : next[k] !== last[k]));
        if (moved) { last = next; setPlacement(next); }
      }
      raf = requestAnimationFrame(measure);
    }
    measure();
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const list = drivers || [];
  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return list;
    return list.filter(d => String(d.name || "").toLowerCase().includes(q));
  }, [list, text]);

  function pick(id, name) {
    setOpen(false);
    setText("");
    onChange?.(id, name);
  }

  return (
    <div ref={boxRef} style={{ position: "relative", minWidth: 260 }}>
      {/* Trigger — reads like a native <select>, always shows the current link. */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
          padding: "8px 12px", borderRadius: 9, cursor: disabled ? "default" : "pointer",
          background: "var(--bg-elevated)", border: `1px solid ${valueId ? "var(--border-accent)" : "var(--border)"}`,
          color: valueId ? "var(--ink-0)" : "var(--ink-2)", opacity: disabled ? 0.6 : 1,
        }}>
        <span className="avatar avatar-sm avatar-fallback">{valueId ? "🏎" : "＋"}</span>
        <span style={{ flex: 1, fontWeight: valueId ? 600 : 400 }}>
          {valueId ? valueName : "No driver linked — click to link"}
        </span>
        <span style={{ color: "var(--ink-2)", fontSize: "0.7rem" }}>▾</span>
      </button>

      {open && !disabled && placement && createPortal(
        <div ref={panelRef} style={{
          position: "fixed",
          // Under the sticky topbar (z-index 10) on purpose: the panel is
          // measured never to reach it, and if a future layout change ever lets
          // it, the header staying legible is the better failure.
          zIndex: 9,
          left: placement.left, width: placement.width,
          ...(placement.up ? { bottom: placement.bottom + 4 } : { top: placement.top + 4 }),
          background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10,
          boxShadow: "0 8px 24px rgba(0,0,0,0.35)", overflow: "hidden",
        }}>
          <div style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
            <input
              ref={inputRef}
              value={text}
              placeholder={`Search ${list.length} driver${list.length === 1 ? "" : "s"}…`}
              onChange={e => setText(e.target.value)}
              autoComplete="off"
              style={{ width: "100%" }}
            />
          </div>
          <div style={{ maxHeight: placement.listMax, overflowY: "auto", overscrollBehavior: "contain" }}>
            {/* Always-present "no driver" / unlink option. */}
            <button type="button" onClick={() => pick(null, null)}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
                padding: "9px 12px", background: !valueId ? "var(--accent-cyan-dim)" : "transparent",
                border: "none", borderBottom: "1px solid var(--border)",
                color: valueId ? "var(--accent-red, #e5484d)" : "var(--ink-1)", cursor: "pointer",
              }}>
              <span className="avatar avatar-sm avatar-fallback">{valueId ? "✕" : "—"}</span>
              <span>{valueId ? "Unlink current profile" : "No driver linked"}</span>
            </button>

            {matches.length === 0 ? (
              <div style={{ padding: "12px", color: "var(--ink-2)", fontSize: "0.85rem" }}>
                No driver matches “{text}”.
              </div>
            ) : matches.map(d => {
              const isCurrent = d.id === valueId;
              const takenElsewhere = d.user_id && !isCurrent;
              return (
                <button key={d.id} type="button" onClick={() => pick(d.id, d.name)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
                    padding: "9px 12px", background: isCurrent ? "var(--accent-cyan-dim)" : "transparent",
                    border: "none", borderBottom: "1px solid var(--border)", color: "var(--ink-0)", cursor: "pointer",
                  }}>
                  <span className="avatar avatar-sm avatar-fallback">🏎</span>
                  <span style={{ flex: 1 }}>
                    <strong style={{ display: "block" }}>{d.name}</strong>
                    <span style={{
                      fontSize: "0.72rem",
                      color: isCurrent ? "var(--accent-cyan)" : takenElsewhere ? "var(--accent-amber, #ffb224)" : "var(--ink-2)",
                    }}>
                      {isCurrent ? "✓ Linked to this account" : takenElsewhere ? "Linked to another account — picking overrides it" : "Available to link"}
                    </span>
                  </span>
                  {isCurrent && <span style={{ color: "var(--accent-cyan)" }}>✓</span>}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// The account directory: roles, driver-profile links and pending claims.
// Rendered as the "User Accounts" tab of the Drivers page (it used to be its
// own /admin/users screen).
export function UserAccountsManager() {
  const { user: me, role: myRole, roleLevel: myLevel } = useAuth();
  // Owner OF THIS LEAGUE. Only they may send a password reset — see the button
  // in the Manage column below, and the route that enforces the same rule.
  const isOwner = myRole === "owner";
  // Roles and driver links are per-league, so this whole screen is about ONE
  // league — the active one. Switching leagues re-asks for everything rather
  // than re-labelling what's on screen: the roster, the roles in it and the
  // driver profiles it links to are different data, not a different view.
  const { leagueId, league } = useLeague();
  const leagueName = league?.name || "this league";
  const [users, setUsers] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [requests, setRequests] = useState([]);   // pending driver-claim requests
  const [busy, setBusy] = useState({});   // uid -> true while a write is in flight
  const [reqBusy, setReqBusy] = useState({});   // request id -> true while resolving
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [deletingUser, setDeletingUser] = useState(null);   // account pending deletion
  const [resettingUser, setResettingUser] = useState(null); // account pending a password-reset email
  const [editingName, setEditingName] = useState(null);     // uid whose name is being edited
  const [nameDraft, setNameDraft] = useState("");
  // Timestamp of the admin's previous visit, captured before the effect below
  // stamps "now" — lets us flag the rows that signed up since then as NEW.
  const prevSeenRef = useRef(typeof window !== "undefined" ? (localStorage.getItem(USERS_SEEN_KEY) || "") : "");

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }

  const load = useCallback(async () => {
    setError(null);
    try {
      const [u, d, r] = await Promise.all([
        // `include_unaffiliated` adds the accounts that exist but belong to no
        // league yet — brand-new signups. They are NOT part of this league's
        // roster and are listed separately below; asking for them is what keeps
        // a fresh signup from being invisible to every league at once.
        api("/api/admin/users?include_unaffiliated=1"),
        api("/api/drivers"),
        api("/api/admin/claim-requests"),
      ]);
      setUsers(u);
      setDrivers(d);
      setRequests(r);
    } catch (err) {
      setError(err.message);
      setUsers([]);
    }
  }, []);
  // Re-runs on a league switch: every row above is scoped to one league.
  useEffect(() => { setUsers(null); load(); }, [load, leagueId]);

  // Opening this tab acknowledges every account that exists right now, clearing
  // the red "new signups" badges on the sidebar's Drivers link and on this tab
  // (see lib/userAccountsAlerts).
  useEffect(() => {
    if (users == null) return;
    markUserAccountsSeen();
  }, [users]);

  async function patchUser(uid, body, successMsg) {
    setBusy(b => ({ ...b, [uid]: true }));
    try {
      await api(`/api/admin/users/${uid}`, { method: "PATCH", body });
      await load();
      if (successMsg) showToast("success", successMsg);
    } catch (err) {
      showToast("error", err.message);
    } finally {
      setBusy(b => ({ ...b, [uid]: false }));
    }
  }

  async function resolveRequest(req, action) {
    setReqBusy(b => ({ ...b, [req.id]: true }));
    try {
      const res = await api(`/api/admin/claim-requests/${req.id}`, { method: "PATCH", body: { action } });
      await load();
      // Refresh the sidebar alert badge (pending count changed).
      window.dispatchEvent(new Event(USERS_SEEN_EVENT));
      if (action !== "approve") {
        showToast("success", `Denied ${req.user_name}'s request for ${req.driver_name}.`);
      } else if (requestKind(req) === NEW_DRIVER_KIND) {
        // The roster entry can fail to carry over on its own (season closed, or
        // their number went while they waited) — the route says so rather than
        // refusing the whole approval, and the admin needs to hear it.
        showToast(res.signup_note ? "error" : "success",
          `Added ${res.driver_name || req.driver_name} and linked ${req.user_name}.`
          + (res.entry_id ? " They're on the roster." : "")
          + (res.signup_note ? ` ${res.signup_note}` : ""));
      } else {
        showToast("success", `Linked ${req.user_name} → ${req.driver_name}.`);
      }
    } catch (err) {
      showToast("error", err.message);
    } finally {
      setReqBusy(b => ({ ...b, [req.id]: false }));
    }
  }

  // "Delete" means different things depending on whether this was the account's
  // last league, so the route decides and says which it did — the toast repeats
  // the truth rather than a guess made before the call.
  async function deleteAccount(u) {
    const res = await api(`/api/admin/users/${u.uid}`, { method: "DELETE" });
    await load();
    window.dispatchEvent(new Event(USERS_SEEN_EVENT));
    const who = u.display_name || u.email || "account";
    showToast("success", res?.removed_from_league
      ? `Removed ${who} from ${leagueName}. Their account and their other leagues are untouched.`
      : `Deleted ${who}.`);
  }

  function changeRole(u, newRole) {
    if (newRole === u.role) return;
    patchUser(u.uid, { role: newRole },
      `${u.display_name || "User"} is now ${ROLE_LABELS[newRole] || newRole} in ${leagueName}.`);
  }

  // Bring an unaffiliated account into this league. It is the same write as any
  // other role change — giving somebody a role in a league IS their membership
  // of it — so there is no separate "join" endpoint to keep in step.
  function joinLeague(u, newRole) {
    patchUser(u.uid, { role: newRole },
      `${u.display_name || u.email || "Account"} joined ${leagueName} as ${ROLE_LABELS[newRole] || newRole}.`);
  }

  // Email a player a link to set a new password. Owner-only, both here and in
  // the route behind it — a reset link is a way into somebody's account, which
  // is a different kind of power from editing league data. Thrown errors are
  // deliberately left to the ConfirmDialog, which keeps itself open and shows
  // them inline; the same shape deleteAccount uses.
  async function sendPasswordReset(u) {
    const res = await api(`/api/admin/users/${u.uid}/password-reset`, { method: "POST" });
    const who = u.display_name || u.email || "that account";
    // A queued email is not a delivered one: a league that hasn't set up the
    // mail extension collects the documents and sends nothing (see lib/mailer.js).
    // Say which happened rather than promising an inbox.
    showToast(res?.queued ? "success" : "error", res?.queued
      ? `Password reset link sent to ${res.email}. ${who} can use it to set a new password.`
      : `Couldn't queue the email for ${res?.email || who}. Check the league's email setup.`);
  }

  function startEditName(u) { setEditingName(u.uid); setNameDraft(u.display_name || ""); }
  function cancelEditName() { setEditingName(null); setNameDraft(""); }
  async function saveName(u) {
    const dn = nameDraft.trim();
    if (!dn || dn === (u.display_name || "")) { cancelEditName(); return; }
    await patchUser(u.uid, { display_name: dn }, `Renamed to “${dn}”.`);
    cancelEditName();
  }

  function linkDriver(u, driverId, driverName) {
    patchUser(u.uid, { driver_id: driverId || "" },
      driverId ? `Linked ${u.display_name || "user"} → ${driverName}.` : `Unlinked ${u.display_name || "user"}.`);
  }

  // Roles this admin is allowed to hand out (never above their own level).
  const roleOptions = useMemo(() => assignableRoles(myRole), [myRole]);
  // THIS league's roster, and — kept apart from it — the accounts that exist but
  // belong to no league yet. The second list is not the league's membership and
  // must never read as though it were: giving one of them a role is what makes
  // them a member here.
  const members = useMemo(() => (users || []).filter(u => u.in_league !== false), [users]);
  const outsiders = useMemo(() => (users || []).filter(u => u.in_league === false), [users]);
  const staffCount = useMemo(() => members.filter(u => roleLevel(u.role) >= roleLevel("statistician")).length, [members]);
  // Accounts that exist but aren't fully set up — unverified, or verified and
  // never opened again. Called out so a signup is never quietly missing.
  const pendingCount = useMemo(
    () => members.filter(u => u.auth_known && !u.env_admin && (!u.email_verified || !u.has_profile)).length,
    [members],
  );

  return (
    <section>
      <div className="page-title"><h2>User Accounts</h2><span className="page-badge">Admin</span></div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.9rem", maxWidth: 720 }}>
        Everyone who is a member of <strong>{leagueName}</strong> — including accounts that
        haven&apos;t verified their email yet, so a new signup is never missing from this list.
        Assign each account a <strong>role</strong> — Owner ▸ Admin ▸ Moderator ▸ Statistician all
        manage league data; Players don&apos;t — and link each account to the statistical{" "}
        <strong>Driver Profile</strong> it races as here, so you always know who is who.
        You can only manage accounts ranked at or below your own role.
      </p>
      <p style={{ marginTop: 4, color: "var(--ink-2)", fontSize: "0.82rem", maxWidth: 720 }}>
        Roles and driver links are <strong>per league</strong>. Everything you set here applies to{" "}
        {leagueName} and nowhere else — the same person can be an Admin in one league, a Player in
        another, and race under a different driver profile in each.
      </p>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      {requests.length > 0 && (
        <div className="form-card" style={{ marginTop: 16, borderColor: "var(--accent-amber, #ffb224)" }}>
          <h3 style={{ marginTop: 0, display: "flex", alignItems: "center", gap: 8 }}>
            Pending Driver Requests
            <span className="nav-badge" style={{ position: "static" }}>{requests.length}</span>
          </h3>
          <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.85rem", maxWidth: 720 }}>
            Players asking for a <strong>Driver Profile</strong>. Some are claiming one that already exists
            (approving writes the link, and auto-denies any other request for that same profile); the rest
            are new drivers asking to be added, which is the <strong>only</strong> way a player-created
            profile ever comes into being. Approving one of those creates the profile from what they
            submitted — and, when they asked to join a series, puts them on its roster too.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {requests.map(req => {
              const rBusy = !!reqBusy[req.id];
              const isNew = requestKind(req) === NEW_DRIVER_KIND;
              const aliases = normalizeAliases(req.aliases).filter(a => a.value);
              // A new driver whose name already exists in the pool is almost
              // certainly a duplicate — worth saying before it's approved.
              const clash = isNew && drivers.find(d =>
                String(d.name || "").trim().toLowerCase() === String(req.driver_name || "").trim().toLowerCase());
              return (
                <div key={req.id} style={{
                  display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap",
                  padding: "10px 12px", borderRadius: 10, background: "var(--card-hover)",
                }}>
                  {req.user_photo
                    ? <img src={req.user_photo} alt="" className="avatar avatar-sm" />
                    : <span className="avatar avatar-sm avatar-fallback">{String(req.user_name || "?")[0]?.toUpperCase()}</span>}
                  <span style={{ flex: 1, minWidth: 240 }}>
                    <strong>{req.user_name}</strong>
                    {req.user_email && <span style={{ color: "var(--ink-2)", fontSize: "0.78rem" }}> · {req.user_email}</span>}
                    <span style={{ display: "block", fontSize: "0.85rem", color: "var(--ink-1)" }}>
                      {isNew ? (
                        <>wants to be added as <strong style={{ color: "var(--accent-cyan)" }}>{req.driver_name}</strong></>
                      ) : (
                        <>wants to claim{" "}
                          <Link href={`/drivers/${req.driver_id}`} style={{ color: "var(--accent-cyan)", fontWeight: 600 }}>
                            {req.driver_name}
                          </Link>
                        </>
                      )}
                      {req.signup?.season_id && (
                        <> and to join{" "}
                          <strong>{req.signup.series_name} · {req.signup.season_name}</strong>
                          {req.signup.number ? ` as #${req.signup.number}` : ""}
                        </>
                      )}
                    </span>
                    {aliases.length > 0 && (
                      <span style={{ display: "block", marginTop: 4, fontSize: "0.78rem", color: "var(--ink-2)" }}>
                        {aliases.map(a => `${a.label}: ${a.value}`).join(" · ")}
                      </span>
                    )}
                    {clash && (
                      <span style={{ display: "block", marginTop: 4, fontSize: "0.78rem", color: "var(--accent-amber, #ffb224)" }}>
                        ⚠ A driver called “{clash.name}” already exists. Approving makes a second profile —
                        deny this and have them claim that one instead, or merge the two afterwards.
                      </span>
                    )}
                  </span>
                  <span style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-primary" style={{ marginTop: 0, padding: "6px 14px" }}
                      disabled={rBusy} onClick={() => resolveRequest(req, "approve")}>
                      {rBusy ? "…" : "✓ Approve"}
                    </button>
                    <button className="btn btn-ghost" style={{ marginTop: 0, padding: "6px 14px" }}
                      disabled={rBusy} onClick={() => resolveRequest(req, "deny")}>
                      Deny
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {error && <div className="empty-state"><span className="empty-state-icon">⚠️</span><p>{error}</p></div>}

      {users == null ? (
        <div className="skeleton" style={{ height: 240, marginTop: 16 }} />
      ) : members.length === 0 && !error ? (
        <div className="empty-state">
          <span className="empty-state-icon">👥</span>
          <p>Nobody has joined {leagueName} yet.</p>
        </div>
      ) : (
        <>
          <p style={{ fontSize: "0.8rem", color: "var(--ink-2)", margin: "12px 0 8px" }}>
            {members.length} account{members.length === 1 ? "" : "s"} in {leagueName} · {staffCount} staff
            {pendingCount > 0 && ` · ${pendingCount} not fully set up`}
          </p>
          <div className="table-wrap">
              <table className="stats-table" style={{ width: "100%", minWidth: 940 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Account</th>
                    <th style={{ textAlign: "left" }}>Email</th>
                    <th style={{ textAlign: "center" }}>Status</th>
                    <th style={{ textAlign: "left", minWidth: 240 }}>Linked Driver Profile</th>
                    <th style={{ textAlign: "center", minWidth: 150 }}>Role</th>
                    <th style={{ textAlign: "center", minWidth: isOwner ? 260 : 110 }}>Manage</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map(u => {
                    const isBusy = !!busy[u.uid];
                    const isMe = me?.uid === u.uid;
                    const isNew = (u.created_at || "") > prevSeenRef.current;
                    const name = u.display_name || u.email || "Unknown";
                    return (
                      <tr key={u.uid}>
                        <td style={{ textAlign: "left", whiteSpace: "normal" }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            {u.photo_url
                              ? <img src={u.photo_url} alt="" className="avatar avatar-sm" />
                              : <span className="avatar avatar-sm avatar-fallback">{String(name)[0]?.toUpperCase()}</span>}
                            {editingName === u.uid ? (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                <input autoFocus value={nameDraft} disabled={isBusy}
                                  onChange={e => setNameDraft(e.target.value)}
                                  onKeyDown={e => { if (e.key === "Enter") saveName(u); if (e.key === "Escape") cancelEditName(); }}
                                  style={{ width: 160, padding: "4px 8px" }} placeholder="Display name" />
                                <button type="button" className="btn btn-primary" style={{ marginTop: 0, padding: "4px 10px" }} disabled={isBusy} onClick={() => saveName(u)}>Save</button>
                                <button type="button" className="btn btn-ghost" style={{ marginTop: 0, padding: "4px 8px" }} disabled={isBusy} onClick={cancelEditName}>✕</button>
                              </span>
                            ) : (
                              <span>
                                <strong>{name}</strong>
                                {(isMe || canManage(myRole, u.role)) && (
                                  <button type="button" className="btn btn-ghost" title="Edit display name"
                                    style={{ marginTop: 0, padding: "0 6px", color: "var(--ink-2)" }}
                                    disabled={isBusy} onClick={() => startEditName(u)}>✎</button>
                                )}
                                {isMe && <span style={{ fontSize: "0.72rem", color: "var(--ink-2)" }}> (you)</span>}
                                {isNew && !isMe && <span className="nav-badge" style={{ marginLeft: 8, position: "static" }}>NEW</span>}
                              </span>
                            )}
                          </span>
                        </td>
                        <td style={{ textAlign: "left", whiteSpace: "normal", color: "var(--ink-1)" }}>{u.email || <span style={{ color: "var(--ink-2)" }}>—</span>}</td>
                        <td style={{ textAlign: "center" }}><StatusBadge status={accountStatus(u)} /></td>
                        <td style={{ textAlign: "left", whiteSpace: "normal" }}>
                          <DriverLinkSelect
                            drivers={drivers}
                            valueId={u.driver_id}
                            valueName={u.driver_name}
                            disabled={isBusy}
                            onChange={(id, dname) => linkDriver(u, id, dname)}
                          />
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {u.env_admin ? (
                            <RoleBadge role="owner" locked title="Permanent Owner set via ADMIN_EMAILS" />
                          ) : isMe ? (
                            <RoleBadge role={u.role} title="You can't change your own role" />
                          ) : !canManage(myRole, u.role) ? (
                            // Target ranks at or above the viewer — read-only.
                            <RoleBadge role={u.role} title={`${ROLE_LABELS[u.role]} ranks at or above your role — you can't change it`} />
                          ) : (
                            <select
                              value={u.role}
                              disabled={isBusy}
                              onChange={e => changeRole(u, e.target.value)}
                              style={{ minWidth: 140, padding: "6px 10px" }}
                              title="Set this account's role"
                            >
                              {roleOptions.map(r => (
                                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <span style={{ display: "inline-flex", gap: 6, alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
                            {/* Owner-only, and only where there's an address to
                                send to. A reset link is a way into somebody's
                                account, which is a different kind of power from
                                editing league data — so it doesn't come with the
                                other staff roles. Enforced by the route too. */}
                            {isOwner && !isMe && u.email && (
                              <button
                                type="button"
                                className="btn btn-ghost"
                                style={{ marginTop: 0, padding: "6px 10px" }}
                                disabled={isBusy}
                                onClick={() => setResettingUser(u)}
                                title={`Email ${u.email} a link to set a new password`}
                              >
                                🔑 Reset password
                              </button>
                            )}
                            {u.env_admin || isMe || !canManage(myRole, u.role) ? (
                              <span style={{ color: "var(--ink-2)", fontSize: "0.78rem" }} title={
                                isMe ? "You can't delete your own account"
                                  : u.env_admin ? "Permanent Owner — can't be deleted"
                                  : `${ROLE_LABELS[u.role]} ranks at or above your role — you can't delete it`
                              }>—</span>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-danger"
                                style={{ marginTop: 0, padding: "6px 14px" }}
                                disabled={isBusy}
                                onClick={() => setDeletingUser(u)}
                                title={u.league_count > 1
                                  ? `Takes them off ${leagueName} only — they belong to other leagues`
                                  : "Deletes the account outright — this is their only league"}
                              >
                                {u.league_count > 1 ? "Remove" : "Delete"}
                              </button>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
          </div>
        </>
      )}

      {outsiders.length > 0 && (
        <div className="form-card" style={{ marginTop: 20 }}>
          <h3 style={{ marginTop: 0 }}>Not in {leagueName} yet</h3>
          <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.85rem", maxWidth: 720 }}>
            Accounts that exist on this installation but belong to no league — almost always
            somebody who has just signed up. They are <strong>not</strong> members of {leagueName}:
            they can&apos;t be linked to a driver profile and they don&apos;t appear anywhere else in
            it. Giving one a role is what brings them in.
          </p>
          <div className="table-wrap">
            <table className="stats-table" style={{ width: "100%", minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Account</th>
                  <th style={{ textAlign: "left" }}>Email</th>
                  <th style={{ textAlign: "center" }}>Status</th>
                  <th style={{ textAlign: "center", minWidth: 170 }}>Add to {leagueName}</th>
                </tr>
              </thead>
              <tbody>
                {outsiders.map(u => {
                  const isBusy = !!busy[u.uid];
                  const name = u.display_name || u.email || "Unknown";
                  return (
                    <tr key={u.uid}>
                      <td style={{ textAlign: "left", whiteSpace: "normal" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          {u.photo_url
                            ? <img src={u.photo_url} alt="" className="avatar avatar-sm" />
                            : <span className="avatar avatar-sm avatar-fallback">{String(name)[0]?.toUpperCase()}</span>}
                          <strong>{name}</strong>
                          {(u.created_at || "") > prevSeenRef.current && (
                            <span className="nav-badge" style={{ position: "static" }}>NEW</span>
                          )}
                        </span>
                      </td>
                      <td style={{ textAlign: "left", whiteSpace: "normal", color: "var(--ink-1)" }}>
                        {u.email || <span style={{ color: "var(--ink-2)" }}>&mdash;</span>}
                      </td>
                      <td style={{ textAlign: "center" }}><StatusBadge status={accountStatus(u)} /></td>
                      <td style={{ textAlign: "center" }}>
                        <select
                          value=""
                          disabled={isBusy}
                          onChange={e => e.target.value && joinLeague(u, e.target.value)}
                          style={{ minWidth: 160, padding: "6px 10px" }}
                          title={`Give this account a role in ${leagueName}`}
                        >
                          <option value="">Add as&hellip;</option>
                          {roleOptions.map(r => (
                            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {resettingUser && (
        <ConfirmDialog
          title="Send Password Reset"
          message={`Email ${resettingUser.email} a link to set a new password for ${resettingUser.display_name || "this account"}? Their current password keeps working until they use the link, and nothing about their league standing changes.`}
          confirmLabel="Send Reset Email"
          busyLabel="Sending…"
          tone="primary"
          onConfirm={() => sendPasswordReset(resettingUser)}
          onClose={() => setResettingUser(null)}
        />
      )}

      {deletingUser && (deletingUser.league_count > 1 ? (
        <ConfirmDialog
          title={`Remove from ${leagueName}`}
          message={`Remove ${deletingUser.display_name || deletingUser.email || "this account"} from ${leagueName}? They lose their role here and the driver profile they raced as here returns to this league's unclaimed pool (race results stay on record). Their account, their sign-in and the ${deletingUser.league_count - 1} other league${deletingUser.league_count === 2 ? "" : "s"} they belong to are untouched.`}
          confirmLabel="Remove from League"
          onConfirm={() => deleteAccount(deletingUser)}
          onClose={() => setDeletingUser(null)}
        />
      ) : (
        <ConfirmDialog
          title="Delete Account"
          message={`${leagueName} is the only league ${deletingUser.display_name || deletingUser.email || "this account"} belongs to, so removing them here deletes the account outright. Their linked driver profile returns to the unclaimed pool (race results stay on record), and they'll be signed out and unable to sign back in. This can't be undone.`}
          confirmLabel="Delete Account"
          onConfirm={() => deleteAccount(deletingUser)}
          onClose={() => setDeletingUser(null)}
        />
      ))}
    </section>
  );
}
