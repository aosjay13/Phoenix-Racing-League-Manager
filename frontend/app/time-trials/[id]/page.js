"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { useLeague } from "@/components/LeagueProvider";
import { TimeTrialLapsModal } from "@/components/TimeTrialLapsModal";
import { CompleteTimeTrialModal } from "@/components/CompleteTimeTrialModal";
import { ExportQualifyingModal } from "@/components/ExportQualifyingModal";
import { TimeTrialSettingsModal } from "@/components/TimeTrialSettingsModal";
import { PlacementDestinationsModal } from "@/components/PlacementDestinationsModal";
import { PlacementBoard } from "@/components/PlacementBoard";
import { AutoPlaceModal } from "@/components/AutoPlaceModal";
import { AddDriverToTrial } from "@/components/AddDriverToTrial";
import { formatRaceDate } from "@/lib/raceDate";
import {
  autoAssignClasses, autoAssignClassesWithinSeries, autoAssignSeries, averageLabel,
  normalizeLaps, rankEntries, summarizeEntries,
} from "@/lib/timeTrials";
import { assignRowToBucket, buildBuckets, pickedClasses, placementProgress } from "@/lib/placements";
import { importFromQueuePlan } from "@/lib/placementQueue";

// One Time Trial session — the sheet.
//
// Reading it: driver names down the side, every lap they submitted across, and
// the two derived columns (Best Time, Best Average Time) that everything else
// keys off. Both are one-click sortable. A driver's fastest lap is worked out in
// the browser from the laps themselves and shown in bold, so nobody has to mark
// it by hand and it can never disagree with the Best Time column beside it.
//
// Writing it: an admin types laps straight into the row. Nothing is saved until
// Save, so a mistyped lap is a keystroke to fix rather than a correction to a
// stored result.
//
// None of this is a race. No points, no finishing positions, and no entry in
// any standard statistic — the two ways out of this screen are the roster
// (Complete Session) and a race's qualifying grid (Export to Qualifying).

// A local sheet row. `id` is the stored document id once saved and a temporary
// key before that, so React keys and the placement assignments both survive the
// round trip.
let tempSeq = 0;
function blankRow(seed = {}) {
  return {
    id: `new-${++tempSeq}`,
    stored: false,
    name: "", number: "", driver_id: "", user_id: "", entry_id: "", signup_request_id: "",
    laps: [], assigned_class_id: "", assigned_series_id: "", notes: "",
    ...seed,
  };
}

// How many lap columns the grid shows: every lap anybody has actually run, plus
// one empty column to type the next one into — capped by the session's own
// Maximum Laps where it has one.
function lapColumnCount(rows, maxLaps) {
  const used = rows.reduce((n, r) => Math.max(n, normalizeLaps(r.laps).length), 0);
  const wanted = used + 1;
  return maxLaps ? Math.min(Math.max(wanted, 1), maxLaps) : Math.max(wanted, 1);
}

export default function TimeTrialPage() {
  const { id } = useParams();
  const router = useRouter();
  const { isAdmin } = useAuth();
  const { seasons, seriesList } = useLeague();

  const [trial, setTrial] = useState(null);
  const [trialSeason, setTrialSeason] = useState(null);
  const [classes, setClasses] = useState([]);
  // The series this night places into, each resolved to the season whose roster
  // it builds and that season's own classes — see the placement block below.
  const [trialSeries, setTrialSeries] = useState([]);
  const [rows, setRows] = useState([]);
  const [pool, setPool] = useState([]);
  // The global driver pool as it stands, and game_id -> name, so the add-driver
  // box can search every name a driver answers to and say which one matched.
  const [driverPool, setDriverPool] = useState([]);
  const [games, setGames] = useState({});
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [sort, setSort] = useState({ key: "best", asc: true });
  const [expanded, setExpanded] = useState(null);   // row id whose laps are open
  const [completing, setCompleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // A placement night has two ways of looking at the same sheet, and both are
  // needed: the BOARD is where drivers are sorted into divisions (columns of
  // cards, dragged), the SHEET is where laps are typed (a grid of inputs).
  // They edit the same rows, so switching between them mid-session loses
  // nothing — including unsaved changes.
  const [view, setView] = useState("sheet");
  const [destinationsOpen, setDestinationsOpen] = useState(false);
  const [autoPlaceOpen, setAutoPlaceOpen] = useState(false);
  // Pulling the waiting drivers in from the Placements Queue — see
  // importFromQueue below.
  const [importing, setImporting] = useState(false);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4500);
  }

  const load = useCallback(async () => {
    try {
      const data = await api(`/api/time-trials/${id}`);
      setTrial(data.trial);
      setTrialSeason(data.season || null);
      setClasses(data.classes || []);
      setTrialSeries(data.placement_series || []);
      setRows((data.entries || []).map(e => ({ ...blankRow(), ...e, stored: true })));
      setSort(s => ({ ...s, key: data.trial.sort_key === "average" ? "average" : s.key }));
      setDirty(false);
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Re-read everything the session's DESTINATIONS depend on — the trial doc,
  // its season, its classes and the series it places into (each with the
  // classes of the season it builds, which only the server can resolve) —
  // without touching the rows.
  //
  // That last part is the whole reason this exists beside `load`: laps typed
  // into the grid aren't saved until Save, and re-reading the sheet after
  // picking destinations would throw away a night's typing.
  const reloadTargets = useCallback(async () => {
    try {
      const data = await api(`/api/time-trials/${id}`);
      setTrial(data.trial);
      setTrialSeason(data.season || null);
      setClasses(data.classes || []);
      setTrialSeries(data.placement_series || []);
    } catch { /* leave the screen on what it already had */ }
  }, [id]);

  // Who can be added to the sheet: the global driver pool always, plus the
  // attached season's roster (which carries car numbers and the roster entry a
  // qualifying export files results against). Keyed on the season alone — the
  // trial doc changes every time a lap is saved, and the pool doesn't move with
  // it.
  useEffect(() => {
    if (!trial) return;
    let live = true;
    (async () => {
      const [drivers, entries, gameList] = await Promise.all([
        api("/api/drivers").catch(() => []),
        trial.season_id ? api(`/api/entries?season_id=${trial.season_id}`).catch(() => []) : Promise.resolve([]),
        api("/api/games").catch(() => []),
      ]);
      if (!live) return;
      setDriverPool(drivers);
      setGames(Object.fromEntries((gameList || []).map(g => [g.id, g.name])));
      const byName = new Map();
      for (const e of entries) {
        byName.set(String(e.name || "").trim().toLowerCase(), {
          name: e.name, driver_id: e.driver_id || "", user_id: e.user_id || "",
          entry_id: e.id, number: e.number ?? "", assigned_class_id: e.class_id || "", source: "roster",
        });
      }
      for (const d of drivers) {
        const key = String(d.name || "").trim().toLowerCase();
        if (!key || byName.has(key)) continue;
        byName.set(key, { name: d.name, driver_id: d.id, user_id: d.user_id || "", source: "driver pool" });
      }
      setPool([...byName.values()]);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trial?.season_id]);

  // ── Derived sheet ─────────────────────────────────────────────────────────
  const summarized = useMemo(
    () => summarizeEntries(rows, { averageLaps: trial?.average_laps }),
    [rows, trial?.average_laps]
  );

  // The display ORDER is held separately from the data, and settles only when
  // the sort changes or the field does (a driver added or removed, the sheet
  // loaded, a save). Ranking live off every keystroke would re-sort the table
  // under the cursor of the admin typing into it — a lap improving a driver's
  // best time would fling their row up the sheet mid-entry. So the columns sort
  // on click, exactly as asked, and stay put while laps are being typed.
  const [order, setOrder] = useState([]);
  const [rankNonce, setRankNonce] = useState(0);
  const rowsKey = rows.map(r => r.id).join("|");
  const summarizedRef = useRef(summarized);
  useEffect(() => { summarizedRef.current = summarized; }, [summarized]);
  useEffect(() => {
    setOrder(rankEntries(summarizedRef.current, sort).map(r => r.id));
  }, [sort, rowsKey, rankNonce]);
  const reRank = () => setRankNonce(n => n + 1);

  const sorted = useMemo(() => {
    const byId = new Map(summarized.map(r => [r.id, r]));
    const listed = order.map(id => byId.get(id)).filter(Boolean);
    // Anything the order hasn't caught up with yet (a row added this render)
    // still shows, at the back, rather than disappearing for a tick.
    const seen = new Set(listed.map(r => r.id));
    return [...listed, ...summarized.filter(r => !seen.has(r.id))];
  }, [summarized, order]);

  const lapCols = lapColumnCount(rows, trial?.max_laps);

  // ── Where this night places drivers ───────────────────────────────────────
  //
  // Two independent targets, and they compose. `placementSeries` is the list of
  // SERIES it sorts into — for the leagues whose divisions are series rather
  // than classes — each carrying the season whose roster it builds and THAT
  // season's classes. `placementClasses` is the classes of the trial's own
  // season, for everyone not placed into a series.
  const placementSeries = trialSeries;
  const seriesById = useMemo(
    () => Object.fromEntries(placementSeries.map(s => [s.series_id, s])),
    [placementSeries]
  );
  const classById = useMemo(
    () => Object.fromEntries([
      ...classes,
      ...placementSeries.flatMap(s => s.classes || []),
    ].map(c => [c.id, c])),
    [classes, placementSeries]
  );
  // The divisions this session places into, inside its OWN season: the ones
  // picked when it was created, falling back to every class the season runs.
  const placementClasses = useMemo(
    () => pickedClasses(classes, trial?.class_ids || []),
    [trial?.class_ids, classes]
  );

  // The classes a given row may be placed into — those of the season its roster
  // entry will actually be written to. A driver sorted into the Pro Series is
  // classified in the Pro Series' season, so offering the trial's own classes
  // would stamp them with a class id that season doesn't have.
  const classesForRow = useCallback(row => {
    const series = row.assigned_series_id ? seriesById[row.assigned_series_id] : null;
    return series ? (series.classes || []) : placementClasses;
  }, [seriesById, placementClasses]);

  const showSeriesPlacement = placementSeries.length > 0;
  // The division chips above the sheet, with a head count each. On a night that
  // also places into series these are every division across every series it
  // places into, since a driver's divisions come from their own series.
  const divisionChips = useMemo(() => {
    const pool = showSeriesPlacement
      ? [...placementSeries.flatMap(s => (s.classes || []).map(c => ({ ...c, series: s.series_name }))),
        ...placementClasses]
      : placementClasses;
    const seen = new Map();
    for (const c of pool) {
      if (seen.has(c.id)) continue;
      seen.set(c.id, {
        id: c.id,
        name: c.series ? `${c.series} · ${c.name}` : c.name,
        count: summarized.filter(r => r.assigned_class_id === c.id).length,
      });
    }
    return [...seen.values()];
  }, [showSeriesPlacement, placementSeries, placementClasses, summarized]);
  const showPlacement = !!trial && (trial.is_placement || placementClasses.length > 0 || showSeriesPlacement);

  // The seasons the Complete / Export dialogs may target. `seasons` from the
  // top bar covers only the series currently selected there — but this screen
  // is reached by id, and a trial routinely belongs to another series (or to
  // none). Without its own season folded in, the dialog opened on a trial from
  // a different series showed an empty selection and could not target the very
  // season the trial names.
  const seasonOptions = useMemo(() => (
    trialSeason && !seasons.some(s => s.id === trialSeason.id)
      ? [trialSeason, ...seasons]
      : seasons
  ), [trialSeason, seasons]);

  const completed = trial?.status === "completed";
  const canEdit = isAdmin && !completed;

  // ── The board ─────────────────────────────────────────────────────────────
  //
  // The same destinations, expressed as the trays a driver card is dropped
  // into: one per division the admin ticked, across every series this night
  // places into and this session's own season. See lib/placements.js.
  const buckets = useMemo(() => buildBuckets({
    placementSeries,
    placementClasses,
    classIds: trial?.class_ids || [],
    trialSeasonId: trial?.season_id || "",
    seasonName: trialSeason?.name || "",
  }), [placementSeries, placementClasses, trial?.class_ids, trial?.season_id, trialSeason?.name]);

  const bucketByKey = useMemo(() => Object.fromEntries(buckets.map(b => [b.key, b])), [buckets]);
  const progress = useMemo(() => placementProgress(summarized, buckets), [summarized, buckets]);

  // Once a session has somewhere to place drivers, the board is the screen it
  // wants to open on — that IS the night's job. A plain hot-lapping session,
  // or a placement night with no destinations picked yet, opens on the sheet.
  const openedOnBoard = useRef(false);
  useEffect(() => {
    if (openedOnBoard.current || !trial) return;
    if (trial.is_placement && buckets.length) { setView("board"); openedOnBoard.current = true; }
  }, [trial, buckets.length]);

  // Drop a driver into a division (or back into the unplaced pool). Both halves
  // of their placement are set together, because a class belongs to a season
  // and the series is what decides which season's roster they'll be written to.
  function moveRow(rowId, key) {
    const bucket = key ? bucketByKey[key] : null;
    const patch = row => assignRowToBucket(row, bucket, {
      classIdsFor: seriesId => (seriesById[seriesId]?.classes || []).map(c => c.id),
    });
    setRows(prev => prev.map(r => (r.id === rowId ? { ...r, ...patch(r) } : r)));
    setDirty(true);
  }

  // "Auto-Place Drivers" applied: the modal decided who goes where, this puts
  // them there. Every card stays draggable afterwards and nothing is written
  // until Save, so it's a first pass rather than a verdict.
  function applyAutoPlace(assignment, metric) {
    setRows(prev => prev.map(r => {
      const bucket = assignment[r.id] ? bucketByKey[assignment[r.id]] : null;
      if (!bucket) return r;
      return { ...r, ...assignRowToBucket(r, bucket, {
        classIdsFor: seriesId => (seriesById[seriesId]?.classes || []).map(c => c.id),
      }) };
    }));
    setDirty(true);
    setAutoPlaceOpen(false);
    setSort(s => ({ ...s, key: metric }));
    reRank();
    const placed = Object.keys(assignment).length;
    showToast("success", `Placed ${placed} driver${placed === 1 ? "" : "s"} by ${metric === "average" ? "average" : "best"} lap. Drag anyone you disagree with, then Save.`);
  }

  // ── Editing ───────────────────────────────────────────────────────────────
  function patchRow(rowId, patch) {
    setRows(prev => prev.map(r => (r.id === rowId ? { ...r, ...patch } : r)));
    setDirty(true);
  }

  function setLap(rowId, lapIndex, value) {
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      const laps = [...(r.laps || [])];
      while (laps.length <= lapIndex) laps.push("");
      laps[lapIndex] = value;
      return { ...r, laps };
    }));
    setDirty(true);
  }

  function addDriver(candidate) {
    // A driver pulled off the roster brings the class they're already in — but
    // only when it is one of THIS night's divisions. Otherwise it is either a
    // class from another season entirely (a night placing into series) or an
    // answer to the question the night exists to ask, pre-filled: the field
    // would open fully placed, with nothing showing as unassigned.
    const seeded = candidate.assigned_class_id || "";
    setRows(prev => [...prev, blankRow({
      name: candidate.name,
      driver_id: candidate.driver_id || "",
      user_id: candidate.user_id || "",
      entry_id: candidate.entry_id || "",
      number: candidate.number ?? "",
      assigned_class_id: (!trial?.is_placement && placementClasses.some(c => c.id === seeded)) ? seeded : "",
    })]);
    setDirty(true);
  }

  function removeRow(rowId) {
    setRows(prev => prev.filter(r => r.id !== rowId));
    setDirty(true);
  }

  // "Import from Placements Queue" — the whole field, in one press.
  //
  // Every driver approved for a placement in any of the divisions this session
  // is sorting into (see /api/time-trials/[id]/placements-queue, which decides
  // that from the trial's own destinations) arrives on the sheet as a row with
  // no laps and no division. That pools people who signed up for the Gold
  // Series and people who signed up for the Silver Series into ONE session, so
  // the field can be ranked against itself and distributed — which is what a
  // placement night is.
  //
  // The rows are UNSAVED, exactly like a driver added by hand: nothing is
  // written until Save, so the import can be reviewed, added to, or undone by
  // removing rows, and a night's typed laps survive pressing the button.
  async function importFromQueue() {
    setImporting(true);
    try {
      const res = await api(`/api/time-trials/${id}/placements-queue`);
      // No destinations picked yet. That isn't an error to shrug at — it's the
      // decision this button depends on — so it opens the dialog that fixes it.
      if (res.code === "no-destinations") {
        showToast("error", res.error);
        setDestinationsOpen(true);
        return;
      }
      const plan = importFromQueuePlan(res.rows || [], rows, res.destinations);
      if (!plan.add.length) {
        // Two different "nothing happened"s, and the difference matters: an
        // empty queue for these divisions is a different problem from a queue
        // whose drivers are already on this sheet.
        return showToast(plan.already.length ? "success" : "error", plan.already.length
          ? `Everybody waiting for these divisions is already on this sheet (${plan.already.length}).`
          : res.total
            ? `Nobody in the placements queue signed up for these divisions. ${res.total} ${res.total === 1 ? "driver is" : "drivers are"} waiting on other series — check Destinations.`
            : "Nobody is waiting on a placement session. Approve a placement-graded sign-up and they'll appear here.");
      }
      setRows(prev => [...prev, ...plan.add.map(seed => blankRow(seed))]);
      setDirty(true);
      reRank();
      showToast("success",
        `Imported ${plan.add.length} driver${plan.add.length === 1 ? "" : "s"} from the placements queue`
        + (plan.already.length ? ` (${plan.already.length} already on the sheet)` : "")
        + ". Nothing is saved yet — press Save Session.");
    } catch (err) {
      showToast("error", err.message);
    } finally {
      setImporting(false);
    }
  }

  // Moving a driver to another series moves which season's roster they'll join,
  // and a class belongs to a season — so a division that doesn't exist in the
  // new series is cleared rather than left as an id that roster can't resolve.
  function assignSeries(rowId, seriesId) {
    const allowed = (seriesById[seriesId]?.classes || []).map(c => c.id);
    setRows(prev => prev.map(r => (r.id === rowId
      ? {
        ...r,
        assigned_series_id: seriesId,
        assigned_class_id: (seriesId ? allowed : placementClasses.map(c => c.id)).includes(r.assigned_class_id)
          ? r.assigned_class_id
          : "",
      }
      : r)));
    setDirty(true);
  }

  // Fill a placement column from the times: the field is ranked by whichever
  // column the sheet is sorted on and split evenly across the chosen targets,
  // fastest first. It's a starting point, not a verdict — every cell stays
  // editable, and nothing is written until Save.
  const byTime = () => (sort.key === "average" ? "average" : "best");

  // Sort the whole field into the SERIES this night places into. Because a
  // series decides which season's classes a driver may take, any division that
  // no longer belongs to their new series is cleared rather than left pointing
  // at another season's class.
  function autoAssignToSeries() {
    const assignment = autoAssignSeries(summarized, placementSeries.map(s => s.series_id), { key: sort.key });
    if (!Object.keys(assignment).length) {
      return showToast("error", "Nobody has set a time yet, so there's nothing to sort.");
    }
    setRows(prev => prev.map(r => {
      const seriesId = assignment[r.id];
      if (!seriesId) return r;
      const allowed = (seriesById[seriesId]?.classes || []).map(c => c.id);
      return {
        ...r,
        assigned_series_id: seriesId,
        assigned_class_id: allowed.includes(r.assigned_class_id) ? r.assigned_class_id : "",
      };
    }));
    setDirty(true);
    reRank();
    showToast("success", `Sorted ${Object.keys(assignment).length} drivers into ${placementSeries.length} series by ${byTime()} time. Review, then Save.`);
  }

  // Sort into divisions. On a night that also places into series the split runs
  // once per series over that series' own drivers — so the top of the Pro
  // Series fills Pro's first division, rather than the whole field's fastest
  // drivers taking every quick division across every series.
  function autoAssignToClasses() {
    const assignment = showSeriesPlacement
      ? autoAssignClassesWithinSeries(
        summarized,
        seriesId => (seriesId
          ? (seriesById[seriesId]?.classes || []).map(c => c.id)
          : placementClasses.map(c => c.id)),
        { key: sort.key })
      : autoAssignClasses(summarized, placementClasses.map(c => c.id), { key: sort.key });
    if (!Object.keys(assignment).length) {
      return showToast("error", showSeriesPlacement
        ? "Nothing to sort — the series these drivers are in have no divisions, or nobody has set a time."
        : "Nobody has set a time yet, so there's nothing to sort.");
    }
    setRows(prev => prev.map(r => (assignment[r.id] ? { ...r, assigned_class_id: assignment[r.id] } : r)));
    setDirty(true);
    reRank();
    showToast("success", `Sorted ${Object.keys(assignment).length} drivers into divisions by ${byTime()} time. Review, then Save.`);
  }

  // Write the sheet. Returns whether it got there, so the callers below can
  // decide whether to carry on.
  async function save({ quiet = false } = {}) {
    setBusy(true);
    try {
      const payload = rows.map(r => ({
        // A row that has never been stored sends no id, so the server mints one.
        ...(r.stored ? { id: r.id } : {}),
        name: r.name, number: r.number, driver_id: r.driver_id, user_id: r.user_id, entry_id: r.entry_id,
        signup_request_id: r.signup_request_id,
        laps: r.laps, notes: r.notes,
        assigned_class_id: r.assigned_class_id, assigned_series_id: r.assigned_series_id,
      }));
      const saved = await api(`/api/time-trials/${id}/entries`, { method: "POST", body: { rows: payload } });
      setRows(saved.map(e => ({ ...blankRow(), ...e, stored: true })));
      setDirty(false);
      // Saving is the natural moment to re-rank: the sheet settles into the
      // order the newly-entered laps actually put it in.
      reRank();
      if (!quiet) showToast("success", "Session saved.");
      return true;
    } catch (err) {
      showToast("error", err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Complete Session and Export to Qualifying both work from the sheet AS
  // STORED — the roster run reads the trial's entries out of the database, it
  // can't see this page's state. So an admin who spent a night dragging cards
  // into divisions and pressed Complete without saving first built the roster
  // from the placements as they were BEFORE any of it, and the dialog's
  // preview looked plausible the whole way through.
  //
  // Nothing about that is the admin's mistake to make: the work is on screen,
  // so it goes to the database before either dialog opens. If the write fails
  // the error is shown and the dialog stays shut, rather than quietly
  // proceeding on stale placements.
  async function openAfterSaving(open) {
    if (dirty && !(await save({ quiet: true }))) return;
    open(true);
  }

  async function reopen() {
    try {
      const updated = await api(`/api/time-trials/${id}`, { method: "PATCH", body: { status: "open" } });
      setTrial(t => ({ ...t, ...updated }));
      showToast("success", "Session reopened for entry.");
    } catch (err) {
      showToast("error", err.message);
    }
  }

  function clickSort(key) {
    setSort(s => (s.key === key ? { key, asc: !s.asc } : { key, asc: true }));
  }
  const arrow = key => (sort.key === key ? (sort.asc ? " ▴" : " ▾") : "");

  if (error) return <div className="empty-state"><span className="empty-state-icon">⏱</span><p>{error}</p></div>;
  if (!trial) return <div className="skeleton" style={{ height: 320 }} />;

  const expandedRow = summarized.find(r => r.id === expanded) || null;

  return (
    <section>
      <div className="page-title">
        <div>
          <h2>⏱ {trial.name}</h2>
          <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "var(--ink-1)" }}>
            {[trial.track, trial.date ? formatRaceDate(trial.date) : null, trial.car,
              trial.max_laps ? `Max ${trial.max_laps} laps` : "Unlimited laps",
              averageLabel(trial.average_laps)].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Link href="/time-trials" style={{ color: "var(--ink-1)", fontSize: "0.85rem" }}>All sessions</Link>
          {isAdmin && (
            <button className="btn btn-ghost" type="button" style={{ marginTop: 0 }}
              title="Rename the session, change its lap limit, or attach it to a season"
              onClick={() => setSettingsOpen(true)}>
              ⚙ Settings
            </button>
          )}
          {isAdmin && (
            <button className="btn btn-ghost" type="button" style={{ marginTop: 0 }}
              title="Copy these best laps onto a scheduled race as its official Qualifying results"
              onClick={() => openAfterSaving(setExporting)} disabled={busy}>
              ⇥ Export to Qualifying
            </button>
          )}
          {isAdmin && (completed ? (
            <button className="btn btn-ghost" type="button" style={{ marginTop: 0 }} onClick={reopen}>
              Reopen Session
            </button>
          ) : (
            <button className="btn btn-primary" type="button" style={{ marginTop: 0 }}
              title="Close this session and, if you want, build the official roster from it"
              onClick={() => openAfterSaving(setCompleting)} disabled={busy}>
              ✓ Complete Session
            </button>
          ))}
        </div>
      </div>

      {completed && (
        <div className="class-scope-banner" style={{ marginTop: 12 }}>
          <span className="class-scope-chip">Completed</span>
          <span>
            This session is closed for entry. It stays available to{" "}
            <strong>Export to Qualifying</strong> and to the <strong>Import from Time Trial</strong>{" "}
            button on any race&rsquo;s Qualifying tab. Reopen it to change a lap.
          </span>
        </div>
      )}

      {trial.notes && (
        <p style={{ marginTop: 12, fontSize: "0.86rem", color: "var(--ink-1)" }}>{trial.notes}</p>
      )}

      <div className="bonus-panel" style={{ marginTop: 14 }}>
        <div className="bonus-panel-title">Time trials don&rsquo;t touch the record books the way races do</div>
        <p className="bonus-panel-note" style={{ marginTop: 4 }}>
          Nothing here counts toward Wins, Top 5s, Average Finish, Championships or any other racing
          statistic — a hot-lap session isn&rsquo;t a race. The laps <strong>are</strong> eligible for
          the Global / Series / Class <Link href="/records" style={{ color: "var(--accent-cyan)" }}>Track Records</Link>,
          and they become official results only when you deliberately export them to a race&rsquo;s
          qualifying.
        </p>
      </div>

      {showPlacement && (
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginTop: 14 }}>
          {/* Series placement — for the leagues whose divisions ARE series.
              Each chip names the season whose roster it builds, because that
              is where these drivers actually end up. */}
          {showSeriesPlacement && (
            <div className="field" style={{ margin: 0, maxWidth: 460 }}>
              <span className="field-label">Series</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {placementSeries.map(s => {
                  const n = summarized.filter(r => r.assigned_series_id === s.series_id).length;
                  return (
                    <span key={s.series_id} className="class-scope-chip"
                      title={s.season_name
                        ? `Builds the roster of ${s.season_name}`
                        : "No season picked yet — set one in Settings, or nobody placed here can be added to a roster"}>
                      {s.series_name} · {n}
                      {s.season_id
                        ? <span style={{ opacity: 0.7 }}> → {s.season_name}</span>
                        : <span style={{ color: "var(--accent-gold)" }}> → no season</span>}
                    </span>
                  );
                })}
                {summarized.some(r => !r.assigned_series_id) && (
                  <span className="page-badge is-muted">
                    {summarized.filter(r => !r.assigned_series_id).length} in no series
                  </span>
                )}
              </div>
            </div>
          )}
          <div className="field" style={{ margin: 0, maxWidth: 420 }}>
            <span className="field-label">Divisions</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {divisionChips.length
                ? divisionChips.map(c => (
                  <span key={c.id} className="class-scope-chip">{c.name} · {c.count}</span>
                ))
                : <span style={{ fontSize: "0.82rem", color: "var(--ink-2)" }}>
                  {showSeriesPlacement
                    ? "The series above are the divisions here — no classes inside them to sort into."
                    : "This session isn't attached to a season with classes yet — pick the season when you complete it."}
                </span>}
              {divisionChips.length > 0 && summarized.some(r => !r.assigned_class_id) && (
                <span className="page-badge is-muted">
                  {summarized.filter(r => !r.assigned_class_id).length} unassigned
                </span>
              )}
            </div>
          </div>
          {/* The sheet's own per-column splits. The board has one button for
              this ("Auto-Place Drivers", which asks which time to sort on);
              these are the row-by-row equivalents and stay where they were. */}
          {canEdit && view === "sheet" && showSeriesPlacement && (
            <button className="btn btn-ghost" type="button" style={{ marginTop: 0 }}
              title="Split the ranked field evenly across the series, fastest first. You can still change any row."
              onClick={autoAssignToSeries}>
              ⇅ Sort into series by time
            </button>
          )}
          {canEdit && view === "sheet" && divisionChips.length > 0 && (
            <button className="btn btn-ghost" type="button" style={{ marginTop: 0 }}
              title={showSeriesPlacement
                ? "Split each series' own drivers across that series' divisions, fastest first."
                : "Split the ranked field evenly across the divisions, fastest first. You can still change any row."}
              onClick={autoAssignToClasses}>
              ⇅ Sort into divisions by time
            </button>
          )}
        </div>
      )}

      {/* The placement bench. One row, three decisions: which view you're
          working in, where these drivers are going, and whether to let the
          times make the first pass. */}
      {showPlacement && (
        <div className="placement-bar">
          <div className="placement-bar-views" role="group" aria-label="How to work this session">
            <button type="button" className={`tab${view === "board" ? " active" : ""}`}
              title="Sort drivers into divisions by dragging them between columns"
              onClick={() => setView("board")}>🎽 Board</button>
            <button type="button" className={`tab${view === "sheet" ? " active" : ""}`}
              title="Type lap times into the grid"
              onClick={() => setView("sheet")}>⏱ Lap sheet</button>
          </div>
          <span className="placement-bar-progress">
            <strong>{progress.placed}</strong> of {progress.total} placed
            {progress.unplaced > 0 && <span className="placement-bar-left"> · {progress.unplaced} still to sort</span>}
          </span>
          {canEdit && (
            <button className="btn btn-ghost" type="button" style={{ marginTop: 0 }}
              title="Pick the series and classes these drivers are being sorted into — each becomes a column on the board"
              onClick={() => setDestinationsOpen(true)}>
              🎯 Destinations{buckets.length ? ` (${buckets.length})` : ""}
            </button>
          )}
          {/* The field this night is FOR. Everybody approved for a placement in
              any of the divisions above is waiting on a session somewhere; this
              is what pools them into this one instead of typing forty names off
              another screen. */}
          {canEdit && (
            <button className="btn btn-ghost" type="button" style={{ marginTop: 0 }}
              disabled={importing}
              title="Add every driver waiting on a placement for these divisions. They arrive unplaced and unsaved — review them, then Save."
              onClick={importFromQueue}>
              {importing ? "Importing…" : "⇩ Import from Placements Queue"}
            </button>
          )}
          {canEdit && view === "board" && (
            <button className="btn btn-primary" type="button" style={{ marginTop: 0 }}
              disabled={!buckets.length}
              title={buckets.length
                ? "Rank the field by lap time and split it evenly across the divisions"
                : "Pick some destinations first"}
              onClick={() => setAutoPlaceOpen(true)}>
              ⚡ Auto-Place Drivers
            </button>
          )}
        </div>
      )}

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      {view === "board" && showPlacement && (
        <PlacementBoard
          rows={summarized}
          buckets={buckets}
          metric={sort.key === "average" ? "average" : "best"}
          canEdit={canEdit}
          onMove={moveRow}
        />
      )}

      {/* Hidden rather than unmounted while the board is up: the lap grid holds
          typed-but-unsaved laps in its inputs, and re-mounting it would throw
          them away every time an admin glanced at the board. */}
      <div className="table-wrap" style={{ display: view === "board" && showPlacement ? "none" : undefined }}>
        <table className="stats-table">
          <thead>
            <tr>
              <th className="sticky-col">Driver</th>
              {showSeriesPlacement && <th style={{ textAlign: "left" }}>Series</th>}
              {showPlacement && <th style={{ textAlign: "left" }}>Division</th>}
              <th className="sortable" onClick={() => clickSort("best")}
                title="The driver's single fastest lap. Click to sort.">Best Time{arrow("best")}</th>
              <th className="sortable" onClick={() => clickSort("average")}
                title={`${averageLabel(trial.average_laps)}. Click to sort.`}>
                {averageLabel(trial.average_laps)}{arrow("average")}
              </th>
              {/* Laps that produced a time — so a row showing four entries and
                  "2" is a row with two unreadable ones in it, not a bug. */}
              <th title="Laps that produced a usable time. Open a driver to see every lap they submitted.">Laps</th>
              {Array.from({ length: lapCols }, (_, i) => <th key={i}>L{i + 1}</th>)}
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={5 + lapCols + (showPlacement ? 1 : 0) + (showSeriesPlacement ? 1 : 0)} style={{ color: "var(--ink-2)" }}>
                  No drivers on this sheet yet.
                  {canEdit && (showPlacement
                    // On a placement night the field is usually already in the
                    // app, waiting on exactly this session — say so, rather
                    // than leaving an admin to type it in.
                    ? " Press Import from Placements Queue to pull in everyone waiting on these divisions, or add one below."
                    : " Add one below.")}
                </td>
              </tr>
            )}
            {sorted.map((row, i) => (
              <tr key={row.id}>
                <td className="sticky-col" style={{ textAlign: "left" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {/* The medals mean "quickest here", so they only appear when
                        the sheet is actually in best-first order. Flip a column
                        to slowest-first and the badges go plain rather than
                        crowning the slowest driver. */}
                    <span className={`rank-badge rank-${sort.asc && i === 0 ? "p1" : sort.asc && i === 1 ? "p2" : sort.asc && i === 2 ? "p3" : "default"}`}>
                      {row.best_seconds == null ? "—" : i + 1}
                    </span>
                    <button type="button" className="btn btn-ghost"
                      style={{ marginTop: 0, padding: "2px 6px", color: "var(--accent-cyan)", fontWeight: 600 }}
                      title="Show every lap this driver submitted"
                      onClick={() => setExpanded(row.id)}>
                      {row.name || <em style={{ color: "var(--ink-2)" }}>Unnamed</em>}
                      {row.number ? <span style={{ color: "var(--ink-2)", marginLeft: 6 }}>#{row.number}</span> : null}
                    </button>
                  </div>
                </td>
                {showSeriesPlacement && (
                  <td style={{ textAlign: "left" }}>
                    {canEdit ? (
                      <select value={row.assigned_series_id || ""} style={{ minWidth: 140 }}
                        onChange={e => assignSeries(row.id, e.target.value)}>
                        <option value="">Unassigned</option>
                        {placementSeries.map(s => (
                          <option key={s.series_id} value={s.series_id}>{s.series_name}</option>
                        ))}
                      </select>
                    ) : (
                      row.assigned_series_id
                        ? <span className="class-scope-chip">{seriesById[row.assigned_series_id]?.series_name || "Series"}</span>
                        : <span style={{ color: "var(--ink-2)" }}>—</span>
                    )}
                  </td>
                )}
                {showPlacement && (
                  <td style={{ textAlign: "left" }}>
                    {/* The divisions on offer are the ones belonging to the
                        season this row's roster entry will be written to — the
                        series' season when they've been placed into one, else
                        this session's own. A class from another season would be
                        an id that roster doesn't have. */}
                    {canEdit && classesForRow(row).length > 0 ? (
                      <select value={row.assigned_class_id || ""} style={{ minWidth: 130 }}
                        onChange={e => patchRow(row.id, { assigned_class_id: e.target.value })}>
                        <option value="">Unassigned</option>
                        {classesForRow(row).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    ) : row.assigned_class_id ? (
                      <span className="class-scope-chip">{classById[row.assigned_class_id]?.name || "Class"}</span>
                    ) : (
                      <span style={{ color: "var(--ink-2)" }}>—</span>
                    )}
                  </td>
                )}
                <td style={{ fontWeight: 700, color: row.best_time ? "var(--accent-gold)" : "var(--ink-2)" }}>
                  {row.best_time || "—"}
                </td>
                <td>{row.avg_time || <span style={{ color: "var(--ink-2)" }}>—</span>}</td>
                <td>{row.laps_timed}</td>
                {Array.from({ length: lapCols }, (_, lapIdx) => {
                  const text = row.laps[lapIdx] ?? "";
                  // The driver's fastest lap, bolded automatically — derived
                  // from the laps themselves, never ticked by hand.
                  const isBest = row.best_lap === lapIdx + 1;
                  return (
                    <td key={lapIdx} style={{ padding: canEdit ? "4px 6px" : undefined }}>
                      {canEdit ? (
                        <input value={text} placeholder="—" inputMode="decimal"
                          style={{
                            width: 82, padding: "4px 6px", textAlign: "right",
                            fontVariantNumeric: "tabular-nums",
                            fontWeight: isBest ? 700 : 400,
                            color: isBest ? "var(--accent-gold)" : undefined,
                          }}
                          title={isBest ? "This driver's fastest lap" : "Lap time, e.g. 1:23.456"}
                          onChange={e => setLap(row.id, lapIdx, e.target.value)} />
                      ) : (
                        <span style={{ fontWeight: isBest ? 700 : 400, color: isBest ? "var(--accent-gold)" : undefined }}>
                          {text || "—"}
                        </span>
                      )}
                    </td>
                  );
                })}
                {canEdit && (
                  <td>
                    <button className="icon-btn icon-btn-danger" type="button" title={`Remove ${row.name || "this driver"}`}
                      onClick={() => removeRow(row.id)}>✕</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <>
          <AddDriverToTrial
            pool={pool}
            drivers={driverPool}
            games={games}
            taken={new Set(rows.map(r => String(r.name || "").trim().toLowerCase()).filter(Boolean))}
            onAdd={addDriver}
            onNotice={msg => showToast("success", msg)}
            disabled={busy}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
            <button className="btn btn-primary" type="button" style={{ marginTop: 0 }} disabled={busy} onClick={() => save()}>
              {busy ? "Saving…" : "Save Session"}
            </button>
            <button className="btn btn-ghost" type="button" style={{ marginTop: 0 }} onClick={reRank}
              title="Re-order the sheet by the laps entered since it was last ranked">
              ⇅ Re-sort now
            </button>
            {dirty && <span style={{ fontSize: "0.8rem", color: "var(--accent-gold)" }}>Unsaved changes</span>}
            <span style={{ fontSize: "0.8rem", color: "var(--ink-2)" }}>
              Lap times take any clock format — <code>1:23.456</code>, <code>83.456</code>,{" "}
              <code>1:02:03.004</code>. The sheet holds its order while you type; it re-ranks when
              you sort, re-sort or save.
            </span>
          </div>
        </>
      )}

      {expandedRow && (
        <TimeTrialLapsModal
          entry={expandedRow}
          averageLaps={trial.average_laps}
          className={classById[expandedRow.assigned_class_id]?.name || ""}
          onClose={() => setExpanded(null)}
        />
      )}

      {completing && (
        <CompleteTimeTrialModal
          trial={trial}
          seasons={seasonOptions}
          placementSeries={placementSeries}
          onClose={() => setCompleting(false)}
          onCompleted={(updated, res) => {
            setTrial(t => ({ ...t, ...updated }));
            // A roster run leaves the dialog open on its own summary of what it
            // wrote — the admin closes it when they've read it. "Complete only"
            // has nothing to report and closes itself.
            showToast("success", res
              ? `Roster${res.seasons?.length > 1 ? "s" : ""} updated — ${res.created} added, ${res.updated} re-classed.`
                + (res.placements_cleared
                  ? ` ${res.placements_cleared} off the placement roster.`
                  : "")
              : "Session completed.");
          }}
        />
      )}

      {settingsOpen && (
        <TimeTrialSettingsModal
          trial={trial}
          seasons={seasonOptions}
          seriesList={seriesList}
          onClose={() => setSettingsOpen(false)}
          onSaved={updated => {
            setSettingsOpen(false);
            setTrial(t => ({ ...t, ...updated }));
            // A season change brings a different set of divisions with it, so
            // the targets are re-read — but NOT the rows. Re-reading those threw
            // away whatever had been typed or dragged since the last save, for
            // a dialog that changed none of it. A placement that no longer
            // matches any division comes back to the unplaced pool on its own
            // (see groupRowsByBucket), which is the honest outcome anyway.
            reloadTargets();
            showToast("success", "Session settings saved.");
          }}
        />
      )}

      {exporting && (
        <ExportQualifyingModal
          trial={trial}
          seasons={seasonOptions}
          onClose={() => setExporting(false)}
          onExported={() => router.refresh()}
        />
      )}

      {destinationsOpen && (
        <PlacementDestinationsModal
          trial={trial}
          seriesList={seriesList}
          placementSeries={placementSeries}
          classes={classes}
          seasonName={trialSeason?.name || ""}
          onClose={() => setDestinationsOpen(false)}
          onSaved={updated => {
            setDestinationsOpen(false);
            setTrial(t => ({ ...t, ...updated }));
            // New destinations mean new columns, and the classes behind them are
            // resolved server-side — so the targets are re-read. The rows are
            // deliberately left alone: unsaved laps survive picking a division.
            reloadTargets();
            setView("board");
            showToast("success", rows.length
              ? "Destinations saved — drag drivers into their divisions."
              : "Destinations saved — press Import from Placements Queue to pull in everyone waiting on them.");
          }}
        />
      )}

      {autoPlaceOpen && (
        <AutoPlaceModal
          rows={summarized}
          buckets={buckets}
          defaultMetric={sort.key}
          onClose={() => setAutoPlaceOpen(false)}
          onApply={applyAutoPlace}
        />
      )}
    </section>
  );
}
