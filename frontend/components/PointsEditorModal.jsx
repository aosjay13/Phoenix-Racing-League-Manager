"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { api } from "@/lib/api";
import { BONUS_TYPES, resolveSeasonConfig } from "@/lib/standings";
import { listToTableOrZero, tableToList } from "@/lib/pointsTemplates";

const isBuiltin = id => String(id).startsWith("builtin-");

function bonusesToStrings(src) {
  let b = src || {};
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  return Object.fromEntries(BONUS_TYPES.map(([k]) => [k, String(b[k] ?? 0)]));
}

// The editable comma-list view of whatever points system `value` points at:
// "" → the season default, "none" → nothing (handled by the caller), any
// other id → that template from the normalized list.
function fieldsFor(value, templates, season) {
  const t = templates.find(x => x.id === value);
  if (t) {
    return { race: tableToList(t.race_points), qual: tableToList(t.qual_points), bonuses: bonusesToStrings(t.bonus_points) };
  }
  const cfg = resolveSeasonConfig(season || {});
  return { race: tableToList(cfg.racePoints), qual: tableToList(cfg.qualPoints), bonuses: bonusesToStrings(cfg.bonuses) };
}

const monoBox = {
  padding: 10, border: "1px solid var(--border)", borderRadius: 9,
  background: "var(--bg-elevated)", color: "var(--ink-0)",
  fontFamily: "monospace", fontSize: "0.85rem", resize: "vertical",
};

// Inline points-structure manager, opened from the results editor of any
// session (Qualifying, a race, a Heat, a Consolation, the Feature). Lets an
// admin assign the session's points system — season default, no points at
// all, a builtin or saved template — and view/edit the structure itself as
// comma lists + bonus values, saving edits back as a new or updated template
// and applying them to the session in one step, without leaving the screen.
export function PointsEditorModal({ session, sessionType, value, templates, season, onAssign, onTemplatesChanged, onClose }) {
  const [selection, setSelection] = useState(value || "");
  const [fields, setFields] = useState(() => fieldsFor(value || "", templates, season));
  const [dirty, setDirty] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const savedSelected = templates.find(t => t.id === selection && !isBuiltin(t.id));
  const forQualifying = sessionType === "qualifying";

  function changeSelection(id) {
    setSelection(id);
    setFields(fieldsFor(id, templates, season));
    setDirty(false);
    setError(null);
  }

  function edit(patch) {
    setFields(f => ({ ...f, ...patch }));
    setDirty(true);
  }

  // Blank points save as an explicit 0 rather than falling back to a default
  // scale, so an empty box scores 0 for this session.
  const templateBody = () => ({
    race_points: listToTableOrZero(fields.race),
    qual_points: listToTableOrZero(fields.qual),
    bonus_points: Object.fromEntries(Object.entries(fields.bonuses).map(([k, v]) => [k, Number(v || 0)])),
  });

  async function run(fn) {
    setBusy(true);
    setError(null);
    try { await fn(); onClose(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const assign = () => run(() => onAssign(session, selection, sessionType));

  const updateTemplate = () => run(async () => {
    await api(`/api/points-templates/${selection}`, { method: "PATCH", body: templateBody() });
    await onTemplatesChanged?.();
    await onAssign(session, selection, sessionType);
  });

  const saveAsNew = () => run(async () => {
    if (!name.trim()) throw new Error("Give the new template a name first.");
    const created = await api("/api/points-templates", { method: "POST", body: { name: name.trim(), ...templateBody() } });
    await onTemplatesChanged?.();
    await onAssign(session, created.id, sessionType);
  });

  return (
    <Modal title={`Points Structure · ${session}`} onClose={onClose}>
      <div className="field" style={{ marginTop: 12 }}>
        <label>Points system for this session</label>
        <select value={selection} onChange={e => changeSelection(e.target.value)}>
          <option value="">Season default</option>
          <option value="none">No points — all drivers score 0</option>
          <optgroup label="Standard">
            {templates.filter(t => isBuiltin(t.id)).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </optgroup>
          {templates.some(t => !isBuiltin(t.id)) && (
            <optgroup label="My Templates">
              {templates.filter(t => !isBuiltin(t.id)).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </optgroup>
          )}
        </select>
      </div>

      {selection === "none" ? (
        <p style={{ color: "var(--ink-1)", fontSize: "0.85rem" }}>
          This session will award <strong>0 points</strong> to every driver — positions, bonuses and all.
          Results can still be entered and counted for stats.
        </p>
      ) : (
        <>
          <p style={{ margin: "0 0 4px", color: "var(--ink-1)", fontSize: "0.8rem" }}>
            {selection === "" ? "Viewing the season default. Edit below and save as a template to customize this session." : "Edit below, then update the template or save your changes as a new one."}
          </p>
          <div className="field"><label>Race Points — comma-separated, 1st place first (blank = 0 points)</label>
            <textarea rows={3} value={fields.race} style={monoBox}
              placeholder="350, 320, 300, 280, 260, …"
              onChange={e => edit({ race: e.target.value })} /></div>
          <div className="field"><label>Qualifying Points — comma-separated, pole first (blank = 0 points){forQualifying ? "" : " · folded into race scores"}</label>
            <textarea rows={2} value={fields.qual} style={monoBox}
              placeholder="35, 32, 30, 28, 26, …"
              onChange={e => edit({ qual: e.target.value })} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
            {BONUS_TYPES.map(([key, label]) => (
              <div className="field" key={key}><label>{label}</label>
                <input type="number" min="0" value={fields.bonuses[key]}
                  onChange={e => edit({ bonuses: { ...fields.bonuses, [key]: e.target.value } })} /></div>
            ))}
          </div>
        </>
      )}

      {error && <div className="toast toast-error" style={{ position: "static", marginTop: 8 }}>{error}</div>}

      {dirty ? (
        <>
          {savedSelected && (
            <button className="btn btn-primary" type="button" disabled={busy} onClick={updateTemplate}>
              {busy ? "Saving…" : `Update “${savedSelected.name}” & Apply`}
            </button>
          )}
          <div className="field" style={{ marginTop: 12 }}>
            <label>{savedSelected ? "…or save as a new template" : "Save as a new template & apply it here"}</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Heat Race Points" style={{ flex: 1 }} />
              <button className="btn btn-primary" type="button" style={{ marginTop: 0 }} disabled={busy} onClick={saveAsNew}>
                {busy ? "Saving…" : "Save & Apply"}
              </button>
            </div>
          </div>
        </>
      ) : (
        <button className="btn btn-primary" type="button" disabled={busy} onClick={assign}>
          {busy ? "Applying…" : `Apply to ${session}`}
        </button>
      )}
      <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={onClose}>Cancel</button>
    </Modal>
  );
}
