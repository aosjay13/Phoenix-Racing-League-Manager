"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { DriverLinkGate } from "@/components/DriverLinkGate";
import { mySignupsChanged } from "@/components/MySignupsProvider";
import { SeriesSignupModal } from "@/components/SeriesSignupModal";
import { api } from "@/lib/api";
import { NUMBER_CHANGE_KIND } from "@/lib/signupQueue";
import { NUMBER_TAKEN_MESSAGE } from "@/lib/carSelection";

// One season's car lock-in screen: what the admin is asking for, the cars on
// offer as one radio each, what the rest of the field has already taken, and
// the player's own Lock-in Car button.
//
// Everything on it is driven by /api/car-selection, which resolves the settings
// down the series → season → class chain and answers with one "slot" per
// question this driver is being asked (see lib/carSelection.js). A season with
// classes that run their own car lists therefore renders one picker per class,
// and an ordinary season renders exactly one.

// "Your car number", for a driver already on the roster — what they run today,
// and a way to ask for a different one.
//
// It asks; it never changes anything. A car number is unique in a season and
// handing them out is the league's call, so the request goes into the SAME
// queue a sign-up does and an admin approving it is what moves the number (see
// lib/signupQueue.js). The numbers already spoken for are listed right here, so
// the usual request is for one that's actually free.
function NumberCard({ current, request, taken, seasonOver, onRequest, onCancel, busy }) {
  const [wanted, setWanted] = useState("");
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState(false);

  const value = wanted.trim();
  const isMine = value && value === String(current ?? "").trim();
  const isTaken = !!value && taken.some(t => String(t).trim() === value);
  const problem = isMine
    ? "That's the number you already run."
    : isTaken ? NUMBER_TAKEN_MESSAGE : "";

  return (
    <div className="form-card lockin-card">
      <h3 style={{ marginTop: 0 }}>Your car number</h3>
      {current
        ? <p className="lockin-current">You run <strong>#{current}</strong></p>
        : <p className="lockin-current is-empty">You don&rsquo;t have a car number in this season.</p>}

      {request ? (
        <>
          <p style={{ margin: "0 0 10px", fontSize: "0.85rem", color: "var(--ink-1)" }}>
            You&rsquo;ve asked to change to <strong>#{request.number}</strong>. It&rsquo;s with the
            admins — your number changes when one of them approves it.
          </p>
          <button className="btn btn-ghost" type="button" style={{ marginTop: 0 }}
            disabled={busy} onClick={onCancel}>
            {busy ? "Working…" : "Withdraw the request"}
          </button>
        </>
      ) : seasonOver ? (
        <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: 0 }}>
          Season over — the roster is final, so numbers can&rsquo;t be changed.
        </p>
      ) : !asking ? (
        <button className="btn btn-ghost" type="button" style={{ marginTop: 0 }}
          onClick={() => setAsking(true)}>
          Request a different number
        </button>
      ) : (
        <form onSubmit={e => { e.preventDefault(); onRequest(value, reason.trim()); }}>
          <div className="field">
            <label htmlFor="wanted_number">The number you&rsquo;d like</label>
            <input id="wanted_number" type="text" inputMode="numeric" maxLength={3}
              className={problem ? "is-invalid" : undefined} aria-invalid={!!problem || undefined}
              value={wanted} onChange={e => setWanted(e.target.value)} placeholder="e.g. 07" />
            {problem && <p className="field-error">{problem}</p>}
          </div>
          <div className="field">
            <label htmlFor="wanted_reason">Why (optional)</label>
            <input id="wanted_reason" maxLength={300} value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. it's the number I've always raced" />
          </div>
          <p style={{ margin: "0 0 10px", fontSize: "0.78rem", color: "var(--ink-2)" }}>
            This goes to the league&rsquo;s admins. Your number doesn&rsquo;t change until one of
            them approves it.
          </p>
          <button className="btn btn-primary" type="submit" style={{ marginTop: 0 }}
            disabled={busy || !value || !!problem}>
            {busy ? "Sending…" : "Send Request"}
          </button>
          <button className="btn btn-ghost" type="button" style={{ marginTop: 0, marginLeft: 8 }}
            disabled={busy} onClick={() => { setAsking(false); setWanted(""); setReason(""); }}>
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}

// One "pick your car" block — a slot, its instructions and one radio per car.
// `seasonOver` (the admin marked the season complete) and `slot.locked` both
// make it read-only; the season being over is reported first, since it's the
// more final of the two.
function SlotPicker({ slot, current, seasonOver, onSave, busy }) {
  const [choice, setChoice] = useState(current || "");
  useEffect(() => { setChoice(current || ""); }, [current]);

  const disabled = seasonOver || slot.locked;
  const changed = (choice || "") !== (current || "");
  const label = slot.class_name ? `${slot.class_name} — your car` : "Your car";

  return (
    <div className="form-card lockin-card">
      <h3 style={{ marginTop: 0 }}>{label}</h3>
      {slot.note && <p className="lockin-note">{slot.note}</p>}
      {current
        ? <p className="lockin-current">Locked in: <strong>{current}</strong></p>
        : <p className="lockin-current is-empty">You haven&rsquo;t chosen a car yet.</p>}

      {slot.options.length === 0 ? (
        <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: 0 }}>
          No cars have been listed for this{slot.class_name ? " class" : " season"} yet — check back once
          an admin has added them.
        </p>
      ) : (
        <>
          <p style={{ margin: "0 0 6px", fontSize: "0.78rem", color: "var(--ink-2)" }}>
            {slot.options.length} car{slot.options.length === 1 ? "" : "s"} available
          </p>

          {disabled ? (
            /* Read-only: the cars on offer are still worth showing, but as
               badges rather than controls nobody can work. */
            <>
              <div className="lockin-options">
                {slot.options.map(car => (
                  <span className={`badge${car === current ? " is-mine" : ""}`} key={car}>{car}</span>
                ))}
              </div>
              <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: 0 }}>
                {seasonOver
                  ? "Season over — car selections are final."
                  : "Selections have been locked by an admin — your car can no longer be changed."}
              </p>
            </>
          ) : (
            <>
              {/* One radio per car, the same control the sign-up form asks the
                  same question with — the list used to be spelled out as badges
                  AND repeated in a dropdown, which is the whole list twice for
                  one choice. */}
              <div className="field">
                <span className="field-label" id={`slot_label_${slot.class_id || "season"}`}>
                  Choose from the available cars
                </span>
                <div className="option-rows" role="radiogroup"
                  aria-labelledby={`slot_label_${slot.class_id || "season"}`}>
                  {slot.options.map(car => (
                    <label className="check-row check-row-center" key={car}>
                      <input type="radio" name={`slot_car_${slot.class_id || "season"}`}
                        value={car} checked={choice === car} onChange={() => setChoice(car)} />
                      <span>{car}</span>
                    </label>
                  ))}
                  {/* A car chosen before the admin edited the list stays
                      selectable, so saving doesn't silently blank it. */}
                  {current && !slot.options.includes(current) && (
                    <label className="check-row check-row-center">
                      <input type="radio" name={`slot_car_${slot.class_id || "season"}`}
                        value={current} checked={choice === current}
                        onChange={() => setChoice(current)} />
                      <span>{current} <span style={{ color: "var(--ink-2)", fontSize: "0.78rem" }}>(no longer offered)</span></span>
                    </label>
                  )}
                  <label className="check-row check-row-center">
                    <input type="radio" name={`slot_car_${slot.class_id || "season"}`}
                      value="" checked={!choice} onChange={() => setChoice("")} />
                    <span style={{ color: "var(--ink-2)" }}>No car selected</span>
                  </label>
                </div>
              </div>
              <button className="btn btn-primary" type="button" disabled={busy || !changed}
                onClick={() => onSave(slot.class_id, choice)}>
                {busy ? "Saving…" : current ? "Change My Car" : "Lock in Car"}
              </button>
              {current && (
                <span style={{ marginLeft: 10, fontSize: "0.78rem", color: "var(--ink-2)" }}>
                  You can change this as often as you like until an admin locks it.
                </span>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

export default function SeasonCarSelectionPage() {
  const { seasonId } = useParams();
  const { user, loading } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [signingUp, setSigningUp] = useState(false);

  const load = useCallback(() => {
    if (!seasonId) return;
    return api(`/api/car-selection?season_id=${seasonId}`)
      .then(res => { setData(res); setError(null); })
      .catch(err => { setError(err.message); setData(null); });
  }, [seasonId]);

  useEffect(() => { load(); }, [load]);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }

  async function saveCar(classId, car) {
    setBusy(true);
    try {
      await api("/api/car-selection", { method: "POST", body: { season_id: seasonId, class_id: classId, car } });
      await load();
      // Drops the "car to choose" count on the Sign-ups badge straight away.
      mySignupsChanged();
      showToast("success", car ? `${car} locked in.` : "Car selection cleared.");
    } catch (err) { showToast("error", err.message); }
    finally { setBusy(false); }
  }

  // Ask for a different car number. Files a pending request through the same
  // queue a sign-up uses and changes nothing on the roster — see
  // /api/signup-requests.
  async function requestNumber(number, reason) {
    setBusy(true);
    try {
      await api("/api/signup-requests", {
        method: "POST",
        body: { kind: NUMBER_CHANGE_KIND, season_id: seasonId, number, reason },
      });
      await load();
      showToast("success",
        `Asked for #${number}. An admin will review it — your number changes once they approve.`);
    } catch (err) { showToast("error", err.message); }
    finally { setBusy(false); }
  }

  // Changed their mind before an admin got to it. Withdrawing frees the number
  // they had asked for straight away, so somebody else can have it.
  async function cancelNumberRequest(id) {
    setBusy(true);
    try {
      await api(`/api/signup-requests/${id}`, { method: "DELETE" });
      await load();
      showToast("success", "Number request withdrawn.");
    } catch (err) { showToast("error", err.message); }
    finally { setBusy(false); }
  }

  // Sign-up is the shared dialog, so this screen asks for exactly the same
  // things the Dashboard's sign-up panel does — and, like it, files a pending
  // request rather than putting anyone on the roster.
  async function afterSignup() {
    setSigningUp(false);
    await load();
    mySignupsChanged();
    showToast("success",
      "Sign-up submitted. An admin will review it, and you'll be on the roster once they approve.");
  }

  if (loading || (!data && !error)) return <div className="skeleton" style={{ height: 300 }} />;

  if (error) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon">⚠</span>
        <p>Couldn&rsquo;t load this season.</p>
        <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: "0 0 12px" }}>{error}</p>
        <Link href="/series-info" className="btn btn-primary">Back to My Series</Link>
      </div>
    );
  }

  const { season, series, slots, roster, me, open } = data;
  // A Car column per slot the season offers, so a season whose classes run
  // their own lists shows a column per class. With no slots at all there's
  // still a column whenever anybody HAS a car — that's the pick they made on
  // the sign-up form, and this grid is where the league reads who's in what.
  // Only a season where nothing has been chosen by anyone drops the column and
  // becomes the plain numbered entry list.
  const columns = slots.length
    ? slots
    : roster.some(r => r.cars.some(c => c.car))
      ? [{ class_id: "", class_name: "" }]
      : [];
  const carFor = (row, classId) => row.cars.find(c => String(c.class_id || "") === String(classId || ""))?.car || "";
  // Numbers somebody ELSE holds or has asked for. The caller's own entry is
  // excluded — that's the row a change would move, not a clash with it.
  const numbersSpokenFor = [
    ...roster.filter(r => r.entry_id !== me?.entry_id).flatMap(r => [r.number, r.wants_number]),
    ...(data.pending || []).map(p => p.number),
  ].map(n => String(n ?? "").trim()).filter(Boolean);
  const taken = {};
  for (const row of roster) {
    for (const c of row.cars) if (c.car) taken[c.car] = (taken[c.car] || 0) + 1;
  }

  return (
    <section>
      <div className="page-title">
        {season.logo_url || series?.logo_url
          ? <img src={season.logo_url || series.logo_url} alt="" className="avatar" style={{ borderRadius: 8 }} />
          : null}
        <h2>{series?.name ?? "Series"} · {season.name}</h2>
        <span className={`page-badge${open ? "" : " is-muted"}`}>{open ? "Open" : "Season over"}</span>
      </div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.9rem" }}>
        <Link href="/series-info" style={{ color: "var(--accent-cyan)" }}>← My Series</Link>
      </p>

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      {/* An admin has marked this season complete. Say so once, at the top, so
          every read-only control below is already explained. */}
      {!open && (
        <div className="season-over-banner">
          <span aria-hidden="true">🏁</span>
          <span>
            <strong>Season over — sign-ups are done.</strong> An admin has marked{" "}
            {season.name} complete, so nobody can join it and the cars below are final. Everything
            here stays on record.
          </span>
        </div>
      )}

      {!user ? (
        <div className="empty-state">
          <span className="empty-state-icon">🚗</span>
          <p>Sign in to lock in your car.</p>
          <Link href="/login" className="btn btn-primary">Sign In</Link>
        </div>
      ) : !me?.driver_id ? (
        <DriverLinkGate onLinked={load} />
      ) : !me.entry_id ? (
        <div className="empty-state">
          <span className="empty-state-icon">📋</span>
          <p>You&rsquo;re not on this season&rsquo;s roster.</p>
          {open ? (
            data.my_pending ? (
              <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: 0 }}>
                Your sign-up is with the admins. You&rsquo;ll be on the roster as soon as one of
                them approves it.
              </p>
            ) : (
            <>
              <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: "0 0 12px" }}>
                Sign up and an admin will review it — once approved you&rsquo;re on the roster.
              </p>
              <button className="btn btn-primary" type="button" onClick={() => setSigningUp(true)}>
                Sign Up for this Season
              </button>
            </>
            )
          ) : (
            <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: 0 }}>
              Season over — sign-ups are done. This one closed before you joined it.
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Their own answers for this season, in one grid: the car number
              they run (and a way to ask for a different one) beside whatever
              car pickers the season asks of them. The number card is always
              here — a season needn't require a car for numbers to matter. */}
          <div className="lockin-grid">
            <NumberCard
              current={me.number}
              request={me.number_request}
              taken={numbersSpokenFor}
              seasonOver={!open}
              busy={busy}
              onRequest={requestNumber}
              onCancel={() => cancelNumberRequest(me.number_request.id)}
            />
            {me.slots.map(slot => (
              <SlotPicker
                key={slot.class_id || "season"}
                slot={slot}
                current={me.picks.find(p => String(p.class_id || "") === String(slot.class_id || ""))?.car || ""}
                seasonOver={!open}
                busy={busy}
                onSave={saveCar}
              />
            ))}
          </div>

          {slots.length === 0 ? (
            <p style={{ marginTop: 10, fontSize: "0.85rem", color: "var(--ink-2)" }}>
              {/* No standing lock-in question here — but they may still have
                  chosen a car when they signed up, and that pick is theirs to
                  see rather than something only the roster grid knows. */}
              {me.selected_car
                ? <>You signed up in the <strong>{me.selected_car}</strong>. This season doesn&rsquo;t
                    ask you to lock a car in again, so an admin changes it from here on.</>
                : <>No car selection is required for this season — you&rsquo;re on the roster
                    {me.class_ids.length ? "" : " (unclassified)"}.</>}
            </p>
          ) : me.slots.length === 0 ? (
            <p style={{ marginTop: 10, fontSize: "0.85rem", color: "var(--ink-2)" }}>
              The car lock-in for this season applies to other classes, so there&rsquo;s nothing
              for you to pick.
            </p>
          ) : null}
        </>
      )}

      {/* Transparency: the season's public roster — who's racing, under which
          number, in which car. Shown to anyone who opens the screen, signed in
          or not, and listed in car-number order because "which numbers are
          taken?" is the question it's read to answer. It renders even when no
          car lock-in is required, since the roster itself is the point. */}
      {(
        <>
          <div className="section-header" style={{ marginTop: 26 }}>
            <h3>{columns.length > 0 ? "Who’s Racing What" : "Series Roster"}</h3>
          </div>
          <p style={{ marginTop: 0, color: "var(--ink-2)", fontSize: "0.82rem" }}>
            {roster.length} driver{roster.length === 1 ? "" : "s"} on the roster ·{" "}
            {roster.filter(r => String(r.number ?? "").trim()).length} number
            {roster.filter(r => String(r.number ?? "").trim()).length === 1 ? "" : "s"} taken
            {columns.length > 0 && <> · {roster.filter(r => r.cars.some(c => c.car)).length} locked in</>}.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Driver</th>
                  {columns.map(c => (
                    <th key={c.class_id || "season"}>{c.class_name ? `${c.class_name} Car` : "Car"}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roster.map(row => (
                  <tr key={row.entry_id} style={row.mine ? { background: "var(--accent-cyan-dim)" } : undefined}>
                    <td>
                      <span className="badge">{String(row.number ?? "").trim() || "—"}</span>
                      {/* Somebody has asked to move to this number and is
                          waiting on an admin — worth showing, so the next
                          driver choosing one doesn't ask for it too. */}
                      {row.wants_number && (
                        <span className="roster-peek-pending" title="Number change waiting on an admin">
                          → #{row.wants_number}
                        </span>
                      )}
                    </td>
                    <td className="driver-name-cell">
                      {row.driver_id
                        ? <Link href={`/drivers/${row.driver_id}`} style={{ color: "var(--accent-cyan)" }}>{row.name}</Link>
                        : row.name}
                      {row.mine && <span style={{ color: "var(--ink-2)", marginLeft: 6, fontSize: "0.76rem" }}>(you)</span>}
                      {row.class_names.length > 0 && (
                        <span style={{ display: "block", color: "var(--ink-2)", fontSize: "0.74rem" }}>
                          {row.class_names.join(" · ")}
                        </span>
                      )}
                    </td>
                    {columns.map(c => {
                      const car = carFor(row, c.class_id);
                      // A blank cell means either "hasn't chosen yet" or "this
                      // question isn't asked of them" — a class column only
                      // applies to that class's drivers.
                      const asked = row.cars.some(x => String(x.class_id || "") === String(c.class_id || ""));
                      return (
                        <td key={c.class_id || "season"} style={{ color: car ? undefined : "var(--ink-2)" }}>
                          {car || (asked ? "Not chosen" : "—")}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {roster.length === 0 && (
                  <tr><td colSpan={2 + columns.length} style={{ color: "var(--ink-2)" }}>
                    Nobody has signed up yet.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* A quick tally of how popular each car is — the thing a driver
              actually scans the grid for. */}
          {Object.keys(taken).length > 0 && (
            <div className="lockin-tally">
              {Object.entries(taken)
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .map(([car, n]) => (
                  <span className="badge" key={car}>{car} · {n}</span>
                ))}
            </div>
          )}
        </>
      )}

      {signingUp && (
        <SeriesSignupModal
          season={{
            season_id: season.id,
            season_name: season.name,
            series_name: series?.name ?? "Series",
            game_id: data.game_id || "",
            game_name: data.game_name || "",
            game_requirements: data.game_requirements || {},
            classes: data.classes,
            rules: data.rules,
            class_rules: data.class_rules,
            requires_car: slots.length > 0,
            roster: roster.map(r => ({ number: r.number, name: r.name, class_names: r.class_names })),
            pending: data.pending || [],
          }}
          driver={me?.driver_id ? { id: me.driver_id, name: me.driver_name, aliases: me.aliases } : null}
          onClose={() => setSigningUp(false)}
          onDone={afterSignup}
        />
      )}
    </section>
  );
}
