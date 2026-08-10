"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { DriverLinkGate } from "@/components/DriverLinkGate";
import { SeriesSignupModal } from "@/components/SeriesSignupModal";
import { api } from "@/lib/api";

// One season's car lock-in screen: what the admin is asking for, the cars on
// offer, what the rest of the field has already taken, and the player's own
// dropdown + Lock-in Car button.
//
// Everything on it is driven by /api/car-selection, which resolves the settings
// down the series → season → class chain and answers with one "slot" per
// question this driver is being asked (see lib/carSelection.js). A season with
// classes that run their own car lists therefore renders one picker per class,
// and an ordinary season renders exactly one.

// One "pick your car" block — a slot, its instructions and the dropdown.
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
          {/* The cars on offer, spelled out — the dropdown holds the same list,
              but a driver deciding wants to see all of them at once. */}
          <p style={{ margin: "0 0 6px", fontSize: "0.78rem", color: "var(--ink-2)" }}>
            {slot.options.length} car{slot.options.length === 1 ? "" : "s"} available
          </p>
          <div className="lockin-options">
            {slot.options.map(car => (
              <span className={`badge${car === current ? " is-mine" : ""}`} key={car}>{car}</span>
            ))}
          </div>

          {disabled ? (
            <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: 0 }}>
              {seasonOver
                ? "Season over — car selections are final."
                : "Selections have been locked by an admin — your car can no longer be changed."}
            </p>
          ) : (
            <>
              <div className="field">
                <label>Choose from the available cars</label>
                <select value={choice} onChange={e => setChoice(e.target.value)}>
                  <option value="">— No car selected —</option>
                  {slot.options.map(car => <option key={car} value={car}>{car}</option>)}
                  {/* A car chosen before the admin edited the list stays visible,
                      so saving doesn't silently blank it. */}
                  {current && !slot.options.includes(current) && (
                    <option value={current}>{current} (no longer offered)</option>
                  )}
                </select>
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
      showToast("success", car ? `${car} locked in.` : "Car selection cleared.");
    } catch (err) { showToast("error", err.message); }
    finally { setBusy(false); }
  }

  // Sign-up is the shared dialog, so this screen asks for exactly the same
  // driver information the sign-up list does — including anything the game
  // insists on, like an iRacing customer ID.
  async function afterSignup({ requested }) {
    setSigningUp(false);
    await load();
    showToast("success", requested
      ? "Request sent. An admin will review it, and you'll be on the roster once they approve."
      : "You're on the roster — now pick your car.");
  }

  if (loading || (!data && !error)) return <div className="skeleton" style={{ height: 300 }} />;

  if (error) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon">⚠</span>
        <p>Couldn&rsquo;t load this season.</p>
        <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: "0 0 12px" }}>{error}</p>
        <Link href="/series-info" className="btn btn-primary">Back to Series Information</Link>
      </div>
    );
  }

  const { season, series, slots, roster, me, open } = data;
  // Which columns the transparency grid needs: one per slot the season offers,
  // so a season whose classes run their own lists shows a column per class.
  // A Car column per slot the season offers, so a season whose classes run
  // their own lists shows a column per class. None at all when no car lock-in
  // is required — the roster is then just the numbered entry list.
  const columns = slots;
  const carFor = (row, classId) => row.cars.find(c => String(c.class_id || "") === String(classId || ""))?.car || "";
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
        <Link href="/series-info" style={{ color: "var(--accent-cyan)" }}>← All my series</Link>
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
            <>
              <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: "0 0 12px" }}>
                Sign up and you&rsquo;ll be able to pick your car straight away.
              </p>
              <button className="btn btn-primary" type="button" onClick={() => setSigningUp(true)}>
                Sign Up for this Season
              </button>
            </>
          ) : (
            <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: 0 }}>
              Season over — sign-ups are done. This one closed before you joined it.
            </p>
          )}
        </div>
      ) : slots.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">✅</span>
          <p>No car selection is required for this season.</p>
          <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: 0 }}>
            You&rsquo;re on the roster{me.class_ids.length ? "" : " (unclassified)"} — nothing else to do here.
          </p>
        </div>
      ) : me.slots.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">✅</span>
          <p>Nothing to pick in your class.</p>
          <p style={{ fontSize: "0.85rem", color: "var(--ink-2)", margin: 0 }}>
            The car lock-in for this season applies to other classes.
          </p>
        </div>
      ) : (
        <div className="lockin-grid">
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
      )}

      {/* Transparency: the season's public roster — who's racing, under which
          number, in which car. Shown to anyone who opens the screen, signed in
          or not, and listed in car-number order because "which numbers are
          taken?" is the question it's read to answer. It renders even when no
          car lock-in is required, since the roster itself is the point. */}
      {(
        <>
          <div className="section-header" style={{ marginTop: 26 }}>
            <h3>{slots.length > 0 ? "Who’s Racing What" : "Series Roster"}</h3>
          </div>
          <p style={{ marginTop: 0, color: "var(--ink-2)", fontSize: "0.82rem" }}>
            {roster.length} driver{roster.length === 1 ? "" : "s"} on the roster ·{" "}
            {roster.filter(r => String(r.number ?? "").trim()).length} number
            {roster.filter(r => String(r.number ?? "").trim()).length === 1 ? "" : "s"} taken
            {slots.length > 0 && <> · {roster.filter(r => r.cars.some(c => c.car)).length} locked in</>}.
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
                    <td><span className="badge">{String(row.number ?? "").trim() || "—"}</span></td>
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
            classes: data.classes,
            requires_car: slots.length > 0,
            roster: roster.map(r => ({ number: r.number, name: r.name, class_names: r.class_names })),
            taken_numbers: roster.map(r => String(r.number ?? "").trim()).filter(Boolean),
          }}
          driver={me?.driver_id ? { id: me.driver_id, name: me.driver_name, aliases: me.aliases } : null}
          onClose={() => setSigningUp(false)}
          onDone={afterSignup}
        />
      )}
    </section>
  );
}
