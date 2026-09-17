"use client";

import { useId, useState } from "react";
import { Modal } from "@/components/Modal";
import { api } from "@/lib/api";
import { ALL_BONUS_TYPES, BONUS_TYPES } from "@/lib/standings";
import { BangerBonusFields } from "@/components/PointsFields";
import { listToTableOrZero, tableToList } from "@/lib/pointsTemplates";
import { CUSTOM_POINTS_OPTION, isCustomPointsId } from "@/lib/customPoints";
import { PointsScaleField } from "@/components/PointsScaleField";

const isBuiltin = id => String(id).startsWith("builtin-");

function bonusesToStrings(src) {
  let b = src || {};
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  return Object.fromEntries(ALL_BONUS_TYPES.map(([k]) => [k, String(b[k] ?? 0)]));
}

const fromTemplate = t => ({
  race: tableToList(t.race_points), qual: tableToList(t.qual_points), bonuses: bonusesToStrings(t.bonus_points),
});

// The editable comma-list view of whatever points system `value` points at:
// "" → the base structure this session falls back to (the class's own points
// when it has them, else the season's), "none" → nothing (handled by the
// caller), the custom option → this session's own structure if it has one, else
// the base structure as a starting point to type over, any other id → that
// template from the normalized list.
function fieldsFor(value, templates, baseConfig, customTemplate) {
  if (value === CUSTOM_POINTS_OPTION) {
    return customTemplate ? fromTemplate(customTemplate) : fieldsFor("", templates, baseConfig, null);
  }
  const t = templates.find(x => x.id === value);
  if (t) return fromTemplate(t);
  const cfg = baseConfig || {};
  return { race: tableToList(cfg.racePoints), qual: tableToList(cfg.qualPoints), bonuses: bonusesToStrings(cfg.bonuses) };
}

const monoBox = {
  padding: 10, border: "1px solid var(--border)", borderRadius: 9,
  background: "var(--bg-elevated)", color: "var(--ink-0)",
  fontFamily: "monospace", fontSize: "0.85rem", resize: "vertical",
};

// Inline points-structure manager, opened from the results editor of any
// session (Qualifying, a race, a Heat, a Consolation, the Feature). Lets an
// admin assign the session's points system — the default it inherits, no
// points at all, a builtin or saved template, or a structure typed for this
// session alone — and view/edit the structure itself as comma lists + bonus
// values, applying the edits to the session (and, if they're worth keeping,
// saving them as a template too) in one step, without leaving the screen.
//
// `baseConfig` is what "no override" scores under, already resolved by the
// caller through season → class, and `baseLabel` names it — so on a class's
// session the default option reads "Pro points" and shows Pro's structure,
// not the season's.
// `banger` (the session's series is a Demo Derby / Banger Racing series) adds
// the banger bonus values to the structure below, so a session can pay its own
// rate per takedown just as it can its own points per position.
//
// ── Custom for this session only ──────────────────────────────────────────
// `onAssignCustom(session, { race_points, qual_points, bonus_points }, type)`
// saves the numbers below on THIS session and nowhere else (see
// lib/customPoints.js). It's the answer to the one-off — a rain-shortened
// feature paying half points, a double-points finale — that shouldn't leave a
// template behind in the library for every season afterwards. `customTemplate`
// is the structure this session already carries that way, if it has one, so
// reopening the editor shows the numbers in force rather than the default
// again. Without the callback the editor behaves exactly as it did: assign an
// existing system, or save a template.
export function PointsEditorModal({
  session, sessionType, value, templates, baseConfig, baseLabel = "Season default",
  classLabel = "", banger = false, onAssign, onAssignCustom = null, customTemplate = null,
  startCustom = false, onTemplatesChanged, onClose,
}) {
  // A session already scoring on its own structure opens on that structure —
  // its id is a real assignment, but it belongs to no list the dropdown offers,
  // so the custom option is what represents it.
  const initial = (startCustom || isCustomPointsId(value)) ? CUSTOM_POINTS_OPTION : (value || "");
  const [selection, setSelection] = useState(initial);
  const [fields, setFields] = useState(() => fieldsFor(initial, templates, baseConfig, customTemplate));
  // A custom structure is "edited" from the moment it opens: its numbers are
  // there to be applied to this session, not to be assigned by id.
  const [dirty, setDirty] = useState(initial === CUSTOM_POINTS_OPTION);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const savedSelected = templates.find(t => t.id === selection && !isBuiltin(t.id));
  const forQualifying = sessionType === "qualifying";
  const custom = selection === CUSTOM_POINTS_OPTION;
  const fieldId = useId();
  const sessionLabel = classLabel ? `${classLabel}'s ${session}` : session;

  function changeSelection(id) {
    setSelection(id);
    setFields(fieldsFor(id, templates, baseConfig, customTemplate));
    // Opening the custom editor is itself the edit: the numbers shown are a
    // starting point to type over, and applying them is what the admin came
    // for, so the buttons below shouldn't wait to be told they changed.
    setDirty(id === CUSTOM_POINTS_OPTION);
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

  // The numbers as typed, saved on this session alone — no name, no template.
  const applyCustom = () => run(() => onAssignCustom(session, templateBody(), sessionType));

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
    <Modal title={`Points Structure · ${classLabel ? `${classLabel} · ` : ""}${session}`} onClose={onClose}>
      <div className="field" style={{ marginTop: 12 }}>
        <label>Points system for {classLabel ? `${classLabel}'s ${session}` : "this session"}</label>
        <select value={selection} onChange={e => changeSelection(e.target.value)}>
          <option value="">{baseLabel}</option>
          <option value="none">No points — all drivers score 0</option>
          {onAssignCustom && (
            <option value={CUSTOM_POINTS_OPTION}>
              ✏️ Custom points — this session only{customTemplate ? " (in use)" : ""}
            </option>
          )}
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
            {custom
              ? `These numbers belong to ${sessionLabel} and nothing else — edit them and apply, and no template is created or changed.`
              : selection === ""
                ? `Viewing ${baseLabel.toLowerCase()}. Edit below and apply to customize ${classLabel ? `${classLabel}'s ` : "this "}session.`
                : "Edit below, then apply the changes to this session or save them as a template."}
          </p>
          {/* Both scales take a paste straight out of a spreadsheet — the same
              box the Season and Class forms use, so a scale is filled the same
              way wherever it is edited. See PointsScaleField. */}
          <PointsScaleField
            id={`${fieldId}-race-points`}
            label="Race Points — comma-separated, 1st place first (blank = 0 points)"
            what="Race Points" rows={3} value={fields.race} textareaStyle={monoBox}
            placeholder="350, 320, 300, 280, 260, …"
            onChange={next => edit({ race: next })} />
          <PointsScaleField
            id={`${fieldId}-qual-points`}
            label={`Qualifying Points — comma-separated, pole first (blank = 0 points)${forQualifying ? "" : " · used by this structure's Qualifying session"}`}
            what="Qualifying Points" rows={2} value={fields.qual} textareaStyle={monoBox}
            placeholder="35, 32, 30, 28, 26, …"
            onChange={next => edit({ qual: next })} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
            {BONUS_TYPES.map(([key, label]) => (
              <div className="field" key={key}><label>{label}</label>
                <input type="number" min="0" value={fields.bonuses[key]}
                  onChange={e => edit({ bonuses: { ...fields.bonuses, [key]: e.target.value } })} /></div>
            ))}
          </div>
          {banger && (
            <BangerBonusFields value={fields} onPatch={patch => edit(patch)} />
          )}
        </>
      )}

      {error && <div className="toast toast-error" style={{ position: "static", marginTop: 8 }}>{error}</div>}

      {(dirty || custom) && selection !== "none" ? (
        <>
          {/* The one-off path, first because it's the one that needs no
              decision: apply the numbers here and be done. Saving a template is
              the deliberate extra step, for a scale the league will use again. */}
          {onAssignCustom && (
            <>
              <button className="btn btn-primary" type="button" disabled={busy} onClick={applyCustom}>
                {busy ? "Applying…" : `Apply to ${sessionLabel} only`}
              </button>
              <span style={{ display: "block", marginTop: 4, fontSize: "0.78rem", color: "var(--ink-2)" }}>
                Scores {sessionLabel} on exactly these numbers. Nothing is added to your template list,
                and no other session or event changes.
              </span>
            </>
          )}
          {savedSelected && (
            <button className={onAssignCustom ? "btn btn-ghost" : "btn btn-primary"} type="button"
              style={onAssignCustom ? { marginTop: 10 } : undefined} disabled={busy} onClick={updateTemplate}>
              {busy ? "Saving…" : `Update “${savedSelected.name}” & Apply`}
            </button>
          )}
          <div className="field" style={{ marginTop: 12 }}>
            <label>{savedSelected ? "…or save as a new template" : "…or save as a template you can reuse"}</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Heat Race Points" style={{ flex: 1 }} />
              <button className={onAssignCustom ? "btn btn-ghost" : "btn btn-primary"} type="button" style={{ marginTop: 0 }}
                disabled={busy} onClick={saveAsNew}>
                {busy ? "Saving…" : "Save & Apply"}
              </button>
            </div>
          </div>
        </>
      ) : (
        <button className="btn btn-primary" type="button" disabled={busy} onClick={assign}>
          {busy ? "Applying…" : `Apply to ${sessionLabel}`}
        </button>
      )}
      <button className="btn btn-ghost" type="button" style={{ marginLeft: 8 }} onClick={onClose}>Cancel</button>
    </Modal>
  );
}
