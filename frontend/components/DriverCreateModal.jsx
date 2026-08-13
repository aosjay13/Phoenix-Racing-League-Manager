"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { duplicateReportFromError, ensureDriverId, isDuplicateDriverError } from "@/lib/driverPool";
import { duplicateReport } from "@/lib/driverMatch";
import { Modal } from "@/components/Modal";
import { DriverForm } from "@/components/DriverForm";
import { DriverMatchNote, DuplicateDriverPrompt } from "@/components/DuplicateDriverPrompt";

// The full driver-creation form, opened from the race-entry autocomplete's
// "+ Create new driver" option and from the Smart Importer's per-row "+ Create
// new driver…" — same fields as the Roster manager's Add Driver card, so a car
// number is always captured for this season's series, not just a bare name.
//
// Saving checks the global driver pool first. A name that belongs to someone
// already in the app — under ANY of the names they answer to, including the
// name they use in another game and their PSN/Xbox/Discord usernames — puts up
// the "is this someone you already have?" prompt instead of silently creating a
// second profile. Picking the existing driver still creates the roster entry
// this modal was opened to create; it just hangs it on the right person.
//
// `confirmDuplicate` skips that check because the caller has already run it
// (the race-entry autocomplete asks before it opens this form, so the question
// isn't put twice).
export function DriverCreateModal({ seasonId, seriesName, initialName, defaultClassId = "", confirmDuplicate = false, onClose, onCreated }) {
  const [form, setForm] = useState({
    name: initialName || "", number: "", team_id: "", user_id: "",
    // A driver can race several classes from one entry; the grid being entered
    // seeds the first one.
    class_ids: defaultClassId ? [defaultClassId] : [],
  });
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [classes, setClasses] = useState([]);
  const [pool, setPool] = useState([]);
  const [games, setGames] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [dupe, setDupe] = useState(null); // { name, report } while the prompt is up

  useEffect(() => {
    let live = true;
    Promise.all([
      api(`/api/teams?season_id=${seasonId}`),
      api("/api/users"),
      api(`/api/classes?season_id=${seasonId}`).catch(() => []),
      api("/api/drivers").catch(() => []),
      api("/api/games").catch(() => []),
    ])
      .then(([t, u, c, d, g]) => {
        if (!live) return;
        setTeams(t); setUsers(u); setClasses(c); setPool(d);
        setGames(Object.fromEntries((g || []).map(x => [x.id, x.name])));
      })
      .catch(() => {});
    return () => { live = false; };
  }, [seasonId]);

  // Create the season entry, on the driver identity given (or resolved).
  async function saveEntry({ driverId = null, confirm = false } = {}) {
    setBusy(true);
    setError(null);
    try {
      // Registers (or reuses) the identity in the global pool, so it's tied
      // to one driver_id and reusable from Roster or another race.
      const resolvedId = await ensureDriverId({
        driverId, name: form.name, user_id: form.user_id, pool, games, confirmDuplicate: confirm,
      });
      const body = { name: form.name, team_id: form.team_id, user_id: form.user_id, driver_id: resolvedId, season_id: seasonId, class_ids: form.class_ids || [] };
      if (form.number !== "") body.number = form.number;
      const entry = await api("/api/entries", { method: "POST", body });
      onCreated(entry);
    } catch (err) {
      if (isDuplicateDriverError(err)) setDupe({ name: form.name, report: duplicateReportFromError(err) });
      else setError(err.message);
      setBusy(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    const name = String(form.name || "").trim();
    // Ask before writing anything, so the prompt names the driver rather than
    // arriving after a half-finished create.
    if (!confirmDuplicate && name) {
      const report = duplicateReport(pool, { name, user_id: form.user_id }, { games });
      if (report.status !== "none" && report.status !== "linked") {
        setDupe({ name, report });
        return;
      }
    }
    saveEntry({ confirm: true });
  }

  return (
    <Modal title="Create Driver" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <DriverForm
          value={form}
          onChange={setForm}
          teams={teams}
          users={users}
          classes={classes}
          numberLabel={`Car Number${seriesName ? ` · ${seriesName}` : ""}`}
        />
        {!confirmDuplicate && (
          <DriverMatchNote pool={pool} games={games} name={form.name} user_id={form.user_id} />
        )}
        {error && <p style={{ color: "#e5484d", fontSize: "0.85rem" }}>{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save Driver"}</button>
        <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={onClose} disabled={busy}>Cancel</button>
      </form>

      {dupe && (
        <DuplicateDriverPrompt
          typedName={dupe.name}
          status={dupe.report.status}
          matches={dupe.report.matches}
          busy={busy}
          createLabel="No — this is a new driver"
          // Their entry for this season still gets created; it just hangs on
          // the driver who already exists, so every result they already have
          // stays with the same person.
          onUse={m => { setDupe(null); saveEntry({ driverId: m.driver_id, confirm: true }); }}
          onCreateAnyway={() => { setDupe(null); saveEntry({ confirm: true }); }}
          onCancel={() => setDupe(null)}
        />
      )}
    </Modal>
  );
}
