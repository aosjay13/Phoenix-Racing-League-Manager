"use client";

import { Fragment, useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useLeague } from "@/components/LeagueProvider";
import { useSortable } from "@/components/useSortable";
import { ImageUpload } from "@/components/ImageUpload";
import { DriverForm } from "@/components/DriverForm";
import { ClassPicker } from "@/components/ClassPicker";
import { Modal } from "@/components/Modal";
import { RosterImportModal } from "@/components/RosterImportModal";
import { PendingSignups } from "@/components/PendingSignups";
import { ensureDriverId } from "@/lib/driverPool";
import { entryClassIds } from "@/lib/classFilter";
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

// One driver's row in the "manage series" panel: shows/edits the alias name
// and number they use in one series, or offers to add them to it (with a
// chosen alias) if they aren't on that series yet. Every row here shares the
// same global driver identity — only the per-series alias/number differ.
function SeriesMembershipRow({ s, entry, defaultName, onAdd, onUpdate, onRemove }) {
  const [alias, setAlias] = useState(entry?.name ?? defaultName ?? "");
  const [num, setNum] = useState(entry?.number ?? "");

  useEffect(() => {
    setAlias(entry?.name ?? defaultName ?? "");
    setNum(entry?.number ?? "");
  }, [entry, defaultName]);

  if (!entry) {
    return (
      <div className="driver-row" style={{ gap: 8 }}>
        <span style={{ flex: 1, color: "var(--ink-2)" }}>{s.name}</span>
        <input style={{ width: 150 }} value={alias} onChange={e => setAlias(e.target.value)} placeholder="Name for this series" />
        <input type="text" inputMode="numeric" maxLength={3} style={{ width: 70 }} value={num} onChange={e => setNum(e.target.value)} placeholder="#" />
        <button className="btn btn-ghost" type="button" style={{ marginTop: 0, padding: "4px 10px" }}
          onClick={() => onAdd(s.id, alias, num)}>+ Add to Series</button>
      </div>
    );
  }
  return (
    <div className="driver-row" style={{ gap: 8 }}>
      <span style={{ flex: 1 }}>{s.name}</span>
      <input style={{ width: 150 }} value={alias} onChange={e => setAlias(e.target.value)} placeholder="Name for this series" />
      <input type="text" inputMode="numeric" maxLength={3} style={{ width: 70 }} value={num} onChange={e => setNum(e.target.value)} placeholder="#" />
      <button className="btn btn-ghost" type="button" style={{ marginTop: 0, padding: "4px 10px" }}
        onClick={() => onUpdate(entry, alias, num)}>Save</button>
      <button className="btn btn-danger" type="button" style={{ marginTop: 0, padding: "4px 10px" }}
        onClick={() => onRemove(entry, s.name)}>Remove</button>
    </div>
  );
}

// Inline number entry for pulling a global pool driver into the current series.
function PoolAddInline({ onAdd, onCancel }) {
  const [num, setNum] = useState("");
  return (
    <span style={{ display: "flex", gap: 6 }}>
      <input type="text" inputMode="numeric" maxLength={3} style={{ width: 70 }} value={num} onChange={e => setNum(e.target.value)} placeholder="#" autoFocus />
      <button className="btn btn-primary" type="button" style={{ marginTop: 0, padding: "4px 10px" }} onClick={() => onAdd(num)}>Add</button>
      <button className="btn btn-ghost" type="button" style={{ marginTop: 0, padding: "4px 10px" }} onClick={onCancel}>Cancel</button>
    </span>
  );
}

// The season/series roster + teams manager. Rendered as the "Roster & Teams"
// tab of the Drivers page (it used to be its own /roster screen), so drivers,
// their rosters and the accounts behind them all live under one menu.
export function RosterManager() {
  const league = useLeague();
  const { gameId, seriesId, series, seriesList } = league;
  const scope = useScope(league);

  const [roster, setRoster] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [gameRoster, setGameRoster] = useState([]); // scope=game rows, feeds the series-membership panel
  const [teams, setTeams] = useState([]);
  const [classes, setClasses] = useState([]);       // the edit season's classes, if it runs any
  const [importing, setImporting] = useState(false); // bulk-import modal open
  const [users, setUsers] = useState([]);
  const [driverPool, setDriverPool] = useState([]); // global drivers, independent of any season/series
  const [toast, setToast] = useState(null);
  const [poolOpen, setPoolOpen] = useState(false);
  const [poolForm, setPoolForm] = useState({ name: "", user_id: "" });
  const [poolAdding, setPoolAdding] = useState(null); // driver pool id currently being pulled into a series

  const [editMode, setEditMode] = useState(false);
  const [rowKey, setRowKey] = useState(null);       // key of the row being inline-edited
  const [rowForm, setRowForm] = useState(null);      // { name, number, team_id, user_id }
  const [seriesPanelKey, setSeriesPanelKey] = useState(null); // key of the row with the series panel open
  const [mergeFrom, setMergeFrom] = useState(null);   // roster row being merged AWAY
  const [mergeInto, setMergeInto] = useState("");     // survivor target ("row:<key>" | "pool:<id>")
  const [mergeBusy, setMergeBusy] = useState(false);
  const [linkRow, setLinkRow] = useState(null);       // roster row being linked to a pool driver
  const [linkTo, setLinkTo] = useState("");           // chosen pool driver id
  const [linkBusy, setLinkBusy] = useState(false);

  const [addForm, setAddForm] = useState({ name: "", number: "", team_id: "", user_id: "", class_ids: [] });
  const [pullKey, setPullKey] = useState("");        // "row:<key>" / "pool:<id>" chosen via "Link To Existing Driver"

  const [teamForm, setTeamForm] = useState({ name: "", color: "", logo_url: "" });
  const [editTeamId, setEditTeamId] = useState(null);

  // A concrete season to write to. Editing is only possible once a series is
  // selected (that pins us to the series' latest season).
  const editSeasonId = seriesId ? roster?.edit_season_id ?? null : null;
  const canManage = !!editSeasonId;

  const load = useCallback(async () => {
    const r = await api(`/api/roster?${scope.params}`);
    setRoster(r);
    setLoadError(null);
    const u = await api("/api/users");
    setUsers(u);
    const pool = await api("/api/drivers");
    setDriverPool(pool);
    if (gameId) {
      const g = await api(`/api/roster?scope=game&game_id=${gameId}`);
      setGameRoster(g.rows);
    } else {
      setGameRoster([]);
    }
    if (seriesId && r.edit_season_id) {
      const [t, c] = await Promise.all([
        api(`/api/teams?season_id=${r.edit_season_id}`),
        api(`/api/classes?season_id=${r.edit_season_id}`),
      ]);
      setTeams(t);
      setClasses(c);
    } else {
      setTeams([]);
      setClasses([]);
    }
  }, [scope.params, gameId, seriesId]);

  useEffect(() => {
    setRoster(null);
    load().catch(err => { setLoadError(err.message); showToast("error", err.message); });
  }, [load]);

  useEffect(() => {
    // Changing scope invalidates any in-progress inline edit / panel.
    setRowKey(null); setRowForm(null); setSeriesPanelKey(null);
  }, [scope.params]);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }

  // Every series this driver has an entry in, across the whole game — powers
  // the series-membership panel regardless of which scope we're viewing.
  function seriesEntriesFor(key) {
    return gameRoster.find(r => r.key === key)?.series_entries ?? {};
  }

  function startRowEdit(row) {
    setRowKey(row.key);
    setSeriesPanelKey(null);
    setRowForm({
      name: row.name, number: row.number ?? "", team_id: row.team_id ?? "",
      user_id: row.user_id ?? "", class_ids: row.class_ids ?? (row.class_id ? [row.class_id] : []),
    });
  }
  function cancelRowEdit() { setRowKey(null); setRowForm(null); }

  async function saveRow(row) {
    if (!rowForm) return;
    try {
      const body = { name: rowForm.name, team_id: rowForm.team_id, user_id: rowForm.user_id, class_ids: rowForm.class_ids ?? [] };
      if (rowForm.number !== "") body.number = rowForm.number;
      await api(`/api/entries/${row.entry_id}`, { method: "PATCH", body });
      // Push the primary name edit up to the global driver profile. The driver
      // PATCH then cascades that name onto this driver's entries across every
      // series/season (see lib/driverSync), so Standings, race results, the
      // results editor and Stats all show the current name — no more divergence
      // after a rename.
      const driverId = row.driver_id
        || (await ensureDriverId({ name: rowForm.name, user_id: rowForm.user_id }));
      if (driverId && rowForm.name?.trim()) {
        await api(`/api/drivers/${driverId}`, { method: "PATCH", body: { name: rowForm.name.trim() } });
        // Backfill the link on entries that predate driver_id, so the entry
        // resolves to this profile on future reads.
        if (!row.driver_id) await api(`/api/entries/${row.entry_id}`, { method: "PATCH", body: { driver_id: driverId } });
      }
      showToast("success", "Driver updated.");
      cancelRowEdit();
      await load();
    } catch (err) { showToast("error", err.message); }
  }

  // Merge one roster driver into another (e.g. a mistyped/renamed duplicate).
  // Resolves both sides to their global driver identity, then re-points the
  // loser's entries onto the survivor and records the old name as a "former
  // name" on the survivor's profile. All race results move across intact.
  //
  // The survivor can be another row on this roster OR any driver in the main
  // pool ("pool:<id>") — including one with no player account linked, so a
  // duplicate can be folded into the real driver's profile before (or without)
  // any account ever being attached to it.
  async function doMerge() {
    if (!mergeFrom || !mergeInto) return;
    const target = resolveMergeTarget(mergeInto);
    if (!target) return;
    setMergeBusy(true);
    try {
      const [fromId, intoId] = await Promise.all([
        ensureDriverId({ driverId: mergeFrom.driver_id, name: mergeFrom.name, user_id: mergeFrom.user_id }),
        target.driver_id
          ? Promise.resolve(target.driver_id)
          : ensureDriverId({ name: target.name, user_id: target.user_id }),
      ]);
      if (fromId === intoId) throw new Error("Those two are already the same driver.");
      const res = await api("/api/admin/drivers/merge", { method: "POST", body: { from_id: fromId, into_id: intoId } });
      setMergeFrom(null); setMergeInto("");
      await load();
      showToast("success", `Merged “${mergeFrom.name}” into “${target.name}” (${res.entries_moved} entr${res.entries_moved === 1 ? "y" : "ies"} moved).`);
    } catch (err) { showToast("error", err.message); }
    finally { setMergeBusy(false); }
  }

  // "row:<key>" → a driver already on this roster; "pool:<id>" → a driver from
  // the main (global) driver list, account-linked or not.
  function resolveMergeTarget(value) {
    const [kind, ...rest] = String(value).split(":");
    const id = rest.join(":");
    if (kind === "pool") {
      const d = driverPool.find(p => p.id === id);
      return d ? { name: d.name, driver_id: d.id, user_id: d.user_id ?? "" } : null;
    }
    const r = rows.find(x => x.key === id);
    return r ? { name: r.name, driver_id: r.driver_id ?? null, user_id: r.user_id ?? "" } : null;
  }

  // Every entry id this roster row is known to hold — its entries in the
  // season being edited, plus its latest entry in each series of the game.
  function entryIdsFor(row) {
    const ids = new Set(row.entry_ids ?? []);
    if (row.entry_id) ids.add(row.entry_id);
    for (const e of Object.values(seriesEntriesFor(row.key))) {
      if (e?.entry_id) ids.add(e.entry_id);
    }
    return [...ids];
  }

  // What the row currently resolves to in the main driver list, if anything.
  function currentProfileName(row) {
    if (!row?.driver_id) return "no profile yet";
    return driverPool.find(d => d.id === row.driver_id)?.name ?? row.profile_name ?? row.name;
  }

  // Point a roster driver at an existing driver in the main list. This is the
  // manual counterpart to the automatic name/account matching in
  // lib/driverPool — a roster driver added under a different name (or a legacy
  // entry with no driver_id at all) can be attached to the right profile even
  // when neither side has a player account to match on.
  //
  // Any entries already carrying this row's own driver_id are merged across
  // (so nothing is stranded and the old name is kept as a former name), then
  // every entry we know of is re-pointed at the chosen driver.
  async function doLink() {
    if (!linkRow || !linkTo) return;
    const target = driverPool.find(d => d.id === linkTo);
    if (!target) return;
    setLinkBusy(true);
    try {
      let moved = 0;
      if (linkRow.driver_id && linkRow.driver_id !== target.id) {
        const res = await api("/api/admin/drivers/merge", {
          method: "POST",
          body: { from_id: linkRow.driver_id, into_id: target.id },
        });
        moved = res.entries_moved ?? 0;
      }
      // Backfill the link on entries that never had a driver_id (or that the
      // merge above didn't cover), so they resolve to this profile from now on.
      const ids = entryIdsFor(linkRow);
      for (const id of ids) {
        await api(`/api/entries/${id}`, { method: "PATCH", body: { driver_id: target.id } });
      }
      setLinkRow(null); setLinkTo("");
      await load();
      showToast("success", `“${linkRow.name}” is now linked to ${target.name}${moved ? ` (${moved} entr${moved === 1 ? "y" : "ies"} moved)` : ""}.`);
    } catch (err) { showToast("error", err.message); }
    finally { setLinkBusy(false); }
  }

  // Fold a driver's duplicate season entries — the old "add them once per
  // class" workaround — into one entry that carries every class. Results move
  // across keeping the class they were scored in, so no history is lost.
  async function combineEntries(row) {
    const n = row.entry_ids?.length ?? 0;
    if (n < 2) return;
    if (!confirm(`${row.name} has ${n} separate entries this season (one per class). Combine them into one entry that races all of those classes? Every saved result moves across and keeps the class it was scored in.`)) return;
    try {
      const res = await api("/api/admin/entries/combine", { method: "POST", body: { entry_ids: row.entry_ids } });
      await load();
      showToast("success", `Combined ${n} entries into one${res.results_moved ? ` (${res.results_moved} result${res.results_moved === 1 ? "" : "s"} moved)` : ""}.`);
    } catch (err) { showToast("error", err.message); }
  }

  // Removing a driver from a roster deletes their entry, and their results in
  // that season go with it — there's nothing left to attach them to. The API
  // refuses at the first attempt when there ARE results and says how many, so
  // the admin is told what they're about to destroy and confirms that
  // specifically, rather than a bare "Remove?" quietly taking eight races of
  // somebody's history with it. Returns true when the entry was removed.
  async function removeEntry(entryId, name, where) {
    if (!entryId) return false;
    if (!confirm(`Remove ${name} from ${where}?`)) return false;
    try {
      await api(`/api/entries/${entryId}`, { method: "DELETE" });
      return true;
    } catch (err) {
      // 409 has-results: the one case worth a second question.
      if (!/recorded result/i.test(err.message)) { showToast("error", err.message); return false; }
      if (!confirm(`${err.message}\n\nDelete ${name} and those results anyway? This can't be undone.`)) {
        return false;
      }
      try {
        await api(`/api/entries/${entryId}?confirm=results`, { method: "DELETE" });
        return true;
      } catch (err2) { showToast("error", err2.message); return false; }
    }
  }

  async function deleteDriver(row) {
    if (!(await removeEntry(row.entry_id, row.name, "this roster"))) return;
    if (rowKey === row.key) cancelRowEdit();
    if (seriesPanelKey === row.key) setSeriesPanelKey(null);
    showToast("success", `${row.name} removed from the roster.`);
    await load();
  }

  // Resolve the latest/active season id for an arbitrary series, so a driver
  // can be added to a series they aren't currently on from anywhere.
  async function latestSeasonIdFor(sid) {
    // Newest first (by race date — see lib/seasonOrder.js), so the current
    // season is the head of the list.
    const seasons = await api(`/api/seasons?series_id=${sid}`);
    return seasons[0]?.id ?? null;
  }

  async function addToSeries(row, sid, name, number) {
    if (number === "" || number == null) { showToast("error", "Enter a car number first."); return; }
    if (!name || !name.trim()) { showToast("error", "Enter a name for this series first."); return; }
    try {
      const targetSeasonId = await latestSeasonIdFor(sid);
      if (!targetSeasonId) { showToast("error", "That series has no season to add drivers to yet."); return; }
      const driverId = await ensureDriverId({ driverId: row.driver_id, name: row.name, user_id: row.user_id });
      await api("/api/entries", {
        method: "POST",
        body: { name, user_id: row.user_id ?? "", team_id: "", number, season_id: targetSeasonId, driver_id: driverId },
      });
      showToast("success", "Driver added to series.");
      await load();
    } catch (err) { showToast("error", err.message); }
  }

  async function updateSeriesEntry(entry, name, number) {
    if (number === "" || number == null) { showToast("error", "Enter a car number first."); return; }
    if (!name || !name.trim()) { showToast("error", "Enter a name for this series first."); return; }
    try {
      await api(`/api/entries/${entry.entry_id}`, { method: "PATCH", body: { name, number } });
      showToast("success", "Series entry saved.");
      await load();
    } catch (err) { showToast("error", err.message); }
  }

  async function removeFromSeries(entry, seriesName) {
    if (!(await removeEntry(entry.entry_id, entry.name || "this driver", seriesName))) return;
    showToast("success", "Removed from series.");
    await load();
  }

  // Drivers elsewhere in this game who aren't yet on the currently selected
  // series' roster — candidates for "pull existing driver into this series".
  const pullCandidates = useMemo(() => {
    if (!seriesId) return [];
    return gameRoster.filter(r => !r.series_entries[seriesId]);
  }, [gameRoster, seriesId]);

  // The picked value is either "row:<gameRoster key>" (someone racing elsewhere
  // in this game) or "pool:<driver id>" (anyone in the main driver list, with
  // or without a player account) — both pin the new entry to that existing
  // driver identity instead of matching on name later.
  function pickPullCandidate(value) {
    setPullKey(value);
    const c = resolvePullCandidate(value);
    setAddForm(f => ({ ...f, name: c?.name ?? "", user_id: c?.user_id ?? "", number: "" }));
  }

  function resolvePullCandidate(value) {
    const [kind, ...rest] = String(value).split(":");
    const id = rest.join(":");
    if (kind === "pool") {
      const d = driverPool.find(p => p.id === id);
      return d ? { name: d.name, driver_id: d.id, user_id: d.user_id ?? "" } : null;
    }
    const r = gameRoster.find(x => x.key === id);
    return r ? { name: r.name, driver_id: r.driver_id ?? null, user_id: r.user_id ?? "" } : null;
  }

  function resetAddForm() {
    setPullKey("");
    setAddForm({ name: "", number: "", team_id: "", user_id: "", class_ids: [] });
  }

  async function addDriver(e) {
    e.preventDefault();
    if (!editSeasonId) return;
    try {
      const pulled = pullKey ? resolvePullCandidate(pullKey) : null;
      const driverId = await ensureDriverId({ driverId: pulled?.driver_id, name: addForm.name, user_id: addForm.user_id });
      const classIds = addForm.class_ids || [];
      const body = { name: addForm.name, team_id: addForm.team_id, user_id: addForm.user_id, driver_id: driverId, class_ids: classIds };
      if (addForm.number !== "") body.number = addForm.number;

      // Someone already on this season's roster is never added twice: adding
      // them again just means they're racing another class, so those classes
      // are folded into the entry they already have. That's what stops the same
      // name appearing on the roster once per class.
      const seasonEntries = await api(`/api/entries?season_id=${editSeasonId}`);
      const wanted = addForm.name.trim().toLowerCase();
      const existing = seasonEntries.find(en =>
        (driverId && en.driver_id === driverId) ||
        String(en.name || "").trim().toLowerCase() === wanted);

      if (existing) {
        const have = entryClassIds(existing);
        const merged = [...have, ...classIds.filter(c => !have.includes(c))];
        const patch = { class_ids: merged };
        if (addForm.team_id) patch.team_id = addForm.team_id;
        if (addForm.number !== "") patch.number = addForm.number;
        await api(`/api/entries/${existing.id}`, { method: "PATCH", body: patch });
        const added = merged.length - have.length;
        showToast("success", added
          ? `${existing.name} was already on this roster — added ${added === 1 ? "that class" : `${added} classes`} to their entry.`
          : `${existing.name} is already on this roster; their entry was updated.`);
      } else {
        await api("/api/entries", { method: "POST", body: { ...body, season_id: editSeasonId } });
        showToast("success", "Driver added to roster.");
      }
      resetAddForm();
      await load();
    } catch (err) { showToast("error", err.message); }
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

  // Teams are league-wide and permanent, so the roster's ✕ takes the team OUT
  // OF THIS SEASON rather than deleting it: its other seasons, its record and
  // every race result stay exactly as they are. Deleting a team outright is a
  // deliberate act, and lives on the Teams directory.
  async function removeTeamFromSeason(team) {
    if (!editSeasonId) return;
    if (!confirm(`Remove ${team.name} from this season? The team keeps its other seasons and all of its history.`)) return;
    try {
      let mappingId = team.mapping_id;
      if (!mappingId) {
        const created = await api("/api/team-seasons", {
          method: "POST",
          body: { team_id: team.id, season_id: editSeasonId, driver_ids: team.driver_ids || [] },
        });
        mappingId = created.id;
      }
      await api(`/api/team-seasons/${mappingId}`, { method: "DELETE" });
      showToast("success", `${team.name} removed from this season.`);
      await load();
    } catch (err) { showToast("error", err.message); }
  }

  // Standalone driver creation: adds an identity to the global pool without
  // touching any season/series — it's just sitting there ready to be pulled
  // into an event later (here, or from the race-entry autocomplete).
  async function createPoolDriver(e) {
    e.preventDefault();
    try {
      await api("/api/drivers", { method: "POST", body: poolForm });
      showToast("success", "Driver added to the global pool.");
      setPoolForm({ name: "", user_id: "" });
      await load();
    } catch (err) { showToast("error", err.message); }
  }

  async function deletePoolDriver(id, name) {
    if (!confirm(`Remove ${name} from the global driver pool? (Any existing series/season entries are unaffected.)`)) return;
    try { await api(`/api/drivers/${id}`, { method: "DELETE" }); await load(); }
    catch (err) { showToast("error", err.message); }
  }

  // Pull a pool driver into the currently selected series with a number.
  async function addPoolDriverToSeries(driver, number) {
    if (!editSeasonId) return;
    if (number === "" || number == null) { showToast("error", "Enter a car number first."); return; }
    try {
      await api("/api/entries", {
        method: "POST",
        body: { name: driver.name, user_id: driver.user_id || "", team_id: "", number, season_id: editSeasonId, driver_id: driver.id },
      });
      showToast("success", `${driver.name} added to ${series?.name ?? "this series"}.`);
      setPoolAdding(null);
      await load();
    } catch (err) { showToast("error", err.message); }
  }

  // Pool drivers not already on the currently selected series' roster —
  // matched by driver_id first (correct even if their alias there differs
  // from the pool's canonical name), falling back to name for legacy rows.
  const poolNotInSeries = useMemo(() => {
    if (!seriesId) return driverPool;
    const rows = roster?.rows ?? [];
    const inSeriesIds = new Set(rows.map(r => r.driver_id).filter(Boolean));
    const inSeriesNames = new Set(rows.map(r => r.name.trim().toLowerCase()));
    return driverPool.filter(d => !inSeriesIds.has(d.id) && !inSeriesNames.has(d.name.trim().toLowerCase()));
  }, [driverPool, seriesId, roster]);

  // Pool drivers offered in the "Link To Existing Driver" picker, minus anyone
  // already listed there through a roster entry elsewhere in this game.
  const poolPullOptions = useMemo(() => {
    const shown = new Set(pullCandidates.map(c => c.driver_id).filter(Boolean));
    return poolNotInSeries.filter(d => !shown.has(d.id));
  }, [poolNotInSeries, pullCandidates]);

  const rows = roster?.rows ?? [];
  const showNumber = !!roster?.show_number;
  const showActions = canManage && editMode;
  // The Class column only exists for a season that runs classes.
  const showClass = classes.length > 0;
  const colSpan = (showNumber ? 1 : 0) + (showClass ? 1 : 0) + 3 + (showActions ? 1 : 0);

  // Result of the most recent bulk import — feeds the success toast.
  function handleImported(res) {
    setImporting(false);
    const skipped = res.skipped ? ` ${res.skipped} already on the roster ${res.skipped === 1 ? "was" : "were"} skipped.` : "";
    if (res.imported === 0) showToast("success", `No new drivers to import.${skipped}`);
    else showToast("success", `Successfully imported ${res.imported} driver${res.imported === 1 ? "" : "s"}.${skipped}`);
    load().catch(err => showToast("error", err.message));
  }

  const { sorted, clickSort, arrow } = useSortable(rows, showNumber ? "number" : "name", ["number", "name"]);

  return (
    <section>
      <div className="page-title">
        <h2>{scope.title}</h2>
        <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {roster && <span className="page-badge">{rows.length} Drivers · {roster.seasons_counted} Season{roster.seasons_counted === 1 ? "" : "s"}</span>}
          {canManage && (
            <button className="btn btn-primary" style={{ marginTop: 0 }}
              title="Bulk-add every driver from this series, or clone a past season's roster — anyone already here is skipped"
              onClick={() => setImporting(true)}>
              ⬆ Bulk Import Drivers
            </button>
          )}
          {canManage && (
            <button className="btn btn-primary" style={{ marginTop: 0 }}
              onClick={() => { setEditMode(m => !m); cancelRowEdit(); setSeriesPanelKey(null); }}>
              {editMode ? "Done Editing" : "Edit Roster"}
            </button>
          )}
        </span>
      </div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.88rem" }}>
        Use the Game / Series / Season menus above to change scope. Pick a specific series to see and sort by car numbers.
        Click the # or Driver headers to toggle sorting.
        {canManage && !editMode && " Click “Edit Roster” to add, edit, or reassign drivers directly in the table."}
      </p>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      {/* Players waiting to be let onto this season's roster. Nothing they
          submitted is live until an admin approves it here — see
          components/PendingSignups.jsx. */}
      {canManage && (
        <PendingSignups
          seasonId={editSeasonId}
          seasonName={league.seasons.find(s => s.id === editSeasonId)?.name}
          onApproved={() => load().catch(err => showToast("error", err.message))}
        />
      )}

      <div className="form-card" style={{ maxWidth: "100%" }}>
        <h3 style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Driver Pool <span style={{ fontWeight: 400, fontSize: "0.8rem", color: "var(--ink-2)" }}>({driverPool.length} global)</span></span>
          <button className="btn btn-ghost" style={{ marginTop: 0 }} onClick={() => setPoolOpen(o => !o)}>
            {poolOpen ? "Hide" : "Manage"}
          </button>
        </h3>
        {!poolOpen ? (
          <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--ink-1)" }}>
            Create driver identities here without assigning them to a season or series right away —
            they&rsquo;ll be ready to pull into any series (or race, mid-entry) later.
          </p>
        ) : (
          <>
            <form onSubmit={createPoolDriver} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div className="field" style={{ marginBottom: 0, flex: "1 1 200px" }}>
                <label>Driver Name</label>
                <input required value={poolForm.name} onChange={e => setPoolForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. J. May" />
              </div>
              <div className="field" style={{ marginBottom: 0, flex: "1 1 200px" }}>
                <label>Linked Player Account (optional)</label>
                <select value={poolForm.user_id} onChange={e => setPoolForm(f => ({ ...f, user_id: e.target.value }))}>
                  <option value="">Not linked</option>
                  {users.map(u => <option key={u.uid} value={u.uid}>{u.display_name}</option>)}
                </select>
              </div>
              <button className="btn btn-primary" type="submit" style={{ marginTop: 0 }}>+ Create Driver</button>
            </form>

            {driverPool.length > 0 && (
              <div style={{ marginTop: 16 }}>
                {driverPool.map(d => (
                  <div className="driver-row" key={d.id} style={{ gap: 8 }}>
                    <span style={{ flex: 1 }}>
                      {d.name}
                      {d.user_id && <span style={{ marginLeft: 8, color: "var(--ink-2)", fontSize: "0.78rem" }}>Linked</span>}
                    </span>
                    {canManage && (
                      poolAdding === d.id ? (
                        <PoolAddInline driver={d} onAdd={num => addPoolDriverToSeries(d, num)} onCancel={() => setPoolAdding(null)} />
                      ) : (
                        poolNotInSeries.some(p => p.id === d.id) && (
                          <button className="btn btn-ghost" type="button" style={{ marginTop: 0, padding: "4px 10px" }}
                            onClick={() => setPoolAdding(d.id)}>
                            + Add to {series?.name ?? "series"}
                          </button>
                        )
                      )
                    )}
                    <button className="btn btn-danger" style={{ marginTop: 0, padding: "4px 10px" }}
                      onClick={() => deletePoolDriver(d.id, d.name)}>✕</button>
                  </div>
                ))}
              </div>
            )}
            {driverPool.length === 0 && (
              <p style={{ margin: "12px 0 0", fontSize: "0.85rem", color: "var(--ink-2)" }}>No global drivers yet — create one above.</p>
            )}
          </>
        )}
      </div>

      {!canManage && roster && seriesId && (
        <div className="empty-state" style={{ marginTop: 12 }}>
          <span className="empty-state-icon">⚠</span>
          <p>{series?.name ?? "This series"} doesn&rsquo;t have a season yet.</p>
          <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: 0 }}>
            Drivers are added to a season&rsquo;s roster, so create a season for this series first —
            head to <strong>League Setup</strong> and add one, then come back here.
          </p>
        </div>
      )}

      {!canManage && !seriesId && (
        <div className="empty-state" style={{ marginTop: 12 }}>
          <span className="empty-state-icon">⊞</span>
          <p>Viewing the overall roster.</p>
          <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: 0 }}>
            Select a specific Series above to manage drivers, teams, and per-series car numbers.
          </p>
        </div>
      )}

      {editMode && canManage && (
        <div className="two-col">
          <div className="form-card">
            <h3>Add Driver</h3>
            {(pullCandidates.length > 0 || poolPullOptions.length > 0) && (
              <div className="field">
                <label>Link To Existing Driver</label>
                <select value={pullKey} onChange={e => e.target.value ? pickPullCandidate(e.target.value) : resetAddForm()}>
                  <option value="">— New driver —</option>
                  {pullCandidates.length > 0 && (
                    <optgroup label="Racing elsewhere in this game">
                      {pullCandidates.map(c => <option key={c.key} value={`row:${c.key}`}>{c.name}</option>)}
                    </optgroup>
                  )}
                  {poolPullOptions.length > 0 && (
                    <optgroup label="Main driver list">
                      {poolPullOptions.map(d => (
                        <option key={d.id} value={`pool:${d.id}`}>{d.name}{d.user_id ? "" : " (no account)"}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <p style={{ margin: "4px 0 0", fontSize: "0.78rem", color: "var(--ink-2)" }}>
                  Pick someone from the main driver list to add them under the same profile — no player
                  account needed. Leave on “New driver” to create a brand-new identity.
                </p>
              </div>
            )}
            <form onSubmit={addDriver}>
              <DriverForm
                value={addForm}
                onChange={setAddForm}
                teams={teams}
                users={users}
                classes={classes}
                numberLabel={`Car Number · ${series?.name ?? "this series"}`}
              />
              <button className="btn btn-primary" type="submit">Add Driver</button>
              {(pullKey || addForm.name) && (
                <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={resetAddForm}>Clear</button>
              )}
            </form>
          </div>

          <div className="form-card">
            <h3>{editTeamId ? "Edit Team" : "Add Team"}</h3>
            <p style={{ margin: "0 0 10px", fontSize: "0.8rem", color: "var(--ink-2)" }}>
              Teams are league-wide and permanent; this adds one to <strong>this season</strong> (reusing the
              team of that name if it already exists). To build a team&rsquo;s driver line-up, use the{" "}
              <Link href="/teams?tab=roster" style={{ color: "var(--accent-cyan)" }}>Team Roster</Link> tab.
            </p>
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
                    <button className="btn btn-danger" title="Remove this team from the season" style={{ marginTop: 0, padding: "4px 10px" }}
                      onClick={() => removeTeamFromSeason(t)}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="section-header"><h3>{scope.title}</h3></div>
      {loadError ? (
        <div className="empty-state" style={{ marginTop: 8 }}>
          <span className="empty-state-icon">⚠</span>
          <p>Couldn&rsquo;t load the roster.</p>
          <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: "0 0 12px" }}>{loadError}</p>
          <button className="btn btn-primary" onClick={() => load().catch(err => { setLoadError(err.message); showToast("error", err.message); })}>
            Retry
          </button>
        </div>
      ) : !roster ? (
        <div className="skeleton" style={{ height: 220, marginTop: 8 }} />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {showNumber && <th className="sortable" onClick={() => clickSort("number")}>#{arrow("number")}</th>}
                <th className="sortable" onClick={() => clickSort("name", true)}>Driver{arrow("name")}</th>
                {showClass && <th>Class</th>}
                <th>Team</th>
                <th>Linked Account</th>
                {showActions && <th></th>}
              </tr>
            </thead>
            <tbody>
              {sorted.map(d => {
                const editing = rowKey === d.key;
                const panelOpen = seriesPanelKey === d.key;
                return (
                  <Fragment key={d.key}>
                    <tr>
                      {showNumber && (
                        <td>
                          {editing
                            ? <input type="text" inputMode="numeric" maxLength={3} style={{ width: 70 }} value={rowForm.number} onChange={e => setRowForm(f => ({ ...f, number: e.target.value }))} />
                            : <span className="badge">{d.number ?? "—"}</span>}
                        </td>
                      )}
                      <td className="driver-name-cell">
                        {editing
                          ? <input value={rowForm.name} onChange={e => setRowForm(f => ({ ...f, name: e.target.value }))} />
                          : (
                            <>
                              {d.display_name || d.name}
                              {/* Inside a game the roster shows that game's name for the
                                  driver, with their overall profile name underneath. */}
                              {d.game_alias && d.profile_name && d.game_alias !== d.profile_name && (
                                <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.74rem" }}>{d.profile_name}</span>
                              )}
                            </>
                          )}
                      </td>
                      {showClass && (
                        <td className="team-cell">
                          {editing
                            ? (
                              <ClassPicker
                                classes={classes}
                                value={rowForm.class_ids ?? []}
                                onChange={ids => setRowForm(f => ({ ...f, class_ids: ids }))}
                              />
                            )
                            // Every class this driver races this season, not just
                            // the first one they were put in.
                            : ((d.class_names ?? []).length
                              ? (
                                <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                                  {d.class_names.map(n => <span className="badge" key={n}>{n}</span>)}
                                </span>
                              )
                              : "—")}
                        </td>
                      )}
                      <td className="team-cell">
                        {editing
                          ? (
                            <select value={rowForm.team_id} onChange={e => setRowForm(f => ({ ...f, team_id: e.target.value }))}>
                              <option value="">No team</option>
                              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                          )
                          : (d.team_name ?? "—")}
                      </td>
                      <td className="team-cell">
                        {editing
                          ? (
                            <select value={rowForm.user_id} onChange={e => setRowForm(f => ({ ...f, user_id: e.target.value }))}>
                              <option value="">Not linked</option>
                              {users.map(u => <option key={u.uid} value={u.uid}>{u.display_name}</option>)}
                            </select>
                          )
                          : (d.user_id ? "Linked" : "—")}
                      </td>
                      {showActions && (
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          {editing ? (
                            <>
                              <button className="btn btn-primary" style={{ marginTop: 0, padding: "4px 10px" }} onClick={() => saveRow(d)}>Save</button>
                              <button className="btn btn-ghost" style={{ marginTop: 0, padding: "4px 10px", marginLeft: 6 }} onClick={cancelRowEdit}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button className="btn btn-ghost" style={{ marginTop: 0, padding: "4px 10px" }} onClick={() => startRowEdit(d)}>Edit</button>
                              <button className="btn btn-ghost" style={{ marginTop: 0, padding: "4px 10px", marginLeft: 6 }}
                                onClick={() => setSeriesPanelKey(panelOpen ? null : d.key)}>
                                {panelOpen ? "Hide Series" : "Series"}
                              </button>
                              {driverPool.length > 0 && (
                                <button className="btn btn-ghost" style={{ marginTop: 0, padding: "4px 10px", marginLeft: 6 }}
                                  title="Link this roster driver to a driver in the main list — no player account required"
                                  onClick={() => { setLinkRow(d); setLinkTo(""); }}>Link</button>
                              )}
                              {rows.length > 1 && (
                                <button className="btn btn-ghost" style={{ marginTop: 0, padding: "4px 10px", marginLeft: 6 }}
                                  title="Merge this driver into another (for duplicates / renamed drivers)"
                                  onClick={() => { setMergeFrom(d); setMergeInto(""); }}>Merge</button>
                              )}
                              {(d.entry_ids?.length ?? 0) > 1 && (
                                <button className="btn btn-ghost" style={{ marginTop: 0, padding: "4px 10px", marginLeft: 6, color: "var(--accent-gold)" }}
                                  title="This driver holds several entries this season — one per class, from before a single entry could carry more than one. Combine them into one multi-class entry, keeping every result."
                                  onClick={() => combineEntries(d)}>
                                  Combine {d.entry_ids.length}
                                </button>
                              )}
                              {d.entry_id && (
                                <button className="btn btn-danger" style={{ marginTop: 0, padding: "4px 10px", marginLeft: 6 }} onClick={() => deleteDriver(d)}>✕</button>
                              )}
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                    {panelOpen && (
                      <tr>
                        <td colSpan={colSpan} style={{ background: "var(--surface-2, rgba(255,255,255,0.03))" }}>
                          <div style={{ padding: "10px 4px" }}>
                            <strong style={{ fontSize: "0.85rem" }}>Aliases &amp; Numbers &mdash; tied to one global driver</strong>
                            <p style={{ margin: "2px 0 8px", color: "var(--ink-2)", fontSize: "0.8rem" }}>
                              {d.name} can run a different name and car number per series (useful when a game uses a
                              different username) — every series entry below stays linked to the same global driver.
                            </p>
                            {seriesList.map(s => (
                              <SeriesMembershipRow
                                key={s.id}
                                s={s}
                                entry={seriesEntriesFor(d.key)[s.id]}
                                defaultName={d.name}
                                onAdd={(sid, name, num) => addToSeries(d, sid, name, num)}
                                onUpdate={updateSeriesEntry}
                                onRemove={removeFromSeries}
                              />
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={Math.max(colSpan, 1)} style={{ color: "var(--ink-1)" }}>No drivers in this scope yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {importing && canManage && (
        <RosterImportModal
          seasonId={editSeasonId}
          seriesId={seriesId}
          seasonName={league.seasons.find(s => s.id === editSeasonId)?.name ?? "this season"}
          seriesName={series?.name}
          onClose={() => setImporting(false)}
          onImported={handleImported}
        />
      )}

      {mergeFrom && (
        <Modal title={`Merge “${mergeFrom.name}”`} onClose={mergeBusy ? () => {} : () => { setMergeFrom(null); setMergeInto(""); }}>
          <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.9rem" }}>
            Pick the driver to <strong>keep</strong>. Every race entry from <strong>{mergeFrom.name}</strong> moves onto
            them, and <strong>{mergeFrom.name}</strong> is kept as a former name on their profile. All results stay on
            record — nothing is lost.
          </p>
          <div className="field">
            <label>Keep this driver</label>
            <select value={mergeInto} onChange={e => setMergeInto(e.target.value)}>
              <option value="">Select the driver to keep…</option>
              <optgroup label="On this roster">
                {rows.filter(r => r.key !== mergeFrom.key).map(r => (
                  <option key={r.key} value={`row:${r.key}`}>{r.name}</option>
                ))}
              </optgroup>
              <optgroup label="Main driver list">
                {driverPool.filter(d => d.id !== mergeFrom.driver_id).map(d => (
                  <option key={d.id} value={`pool:${d.id}`}>{d.name}{d.user_id ? "" : " (no account)"}</option>
                ))}
              </optgroup>
            </select>
            <p style={{ margin: "4px 0 0", fontSize: "0.78rem", color: "var(--ink-2)" }}>
              The survivor can be anyone in the main driver list, whether or not a player account is linked to them.
            </p>
          </div>
          <button className="btn btn-primary" type="button" disabled={mergeBusy || !mergeInto} onClick={doMerge}>
            {mergeBusy ? "Merging…" : "Merge Drivers"}
          </button>
          <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} disabled={mergeBusy}
            onClick={() => { setMergeFrom(null); setMergeInto(""); }}>Cancel</button>
        </Modal>
      )}

      {linkRow && (
        <Modal title={`Link “${linkRow.name}”`} onClose={linkBusy ? () => {} : () => { setLinkRow(null); setLinkTo(""); }}>
          <p style={{ marginTop: 0, color: "var(--ink-1)", fontSize: "0.9rem" }}>
            Attach this roster driver to a driver in the <strong>main driver list</strong>. Their entries and results
            move onto that profile, so the two stop showing up as separate people. A player account isn&rsquo;t
            needed on either side — that&rsquo;s what makes cleaning up duplicate accounts easier later.
          </p>
          <p style={{ marginTop: 0, color: "var(--ink-2)", fontSize: "0.82rem" }}>
            Currently linked to: <strong>{currentProfileName(linkRow)}</strong>
          </p>
          <div className="field">
            <label>Driver in the main list</label>
            <select value={linkTo} onChange={e => setLinkTo(e.target.value)}>
              <option value="">Select a driver…</option>
              {driverPool.filter(d => d.id !== linkRow.driver_id).map(d => (
                <option key={d.id} value={d.id}>{d.name}{d.user_id ? "" : " (no account)"}</option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" type="button" disabled={linkBusy || !linkTo} onClick={doLink}>
            {linkBusy ? "Linking…" : "Link Driver"}
          </button>
          <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} disabled={linkBusy}
            onClick={() => { setLinkRow(null); setLinkTo(""); }}>Cancel</button>
        </Modal>
      )}
    </section>
  );
}
