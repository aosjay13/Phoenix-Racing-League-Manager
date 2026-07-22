"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function DriversPage() {
  const [drivers, setDrivers] = useState(null);

  useEffect(() => {
    // The global driver pool is the full roster of everyone who has raced,
    // whether or not they've made an account. Join with the account directory
    // so linked drivers can show their profile photo and country.
    Promise.all([api("/api/drivers"), api("/api/users")])
      .then(([pool, users]) => {
        const byUid = Object.fromEntries(users.map(u => [u.uid, u]));
        const rows = pool.map(d => {
          const account = d.user_id ? byUid[d.user_id] : null;
          return {
            id: d.id,
            name: account?.display_name || d.name,
            photo_url: account?.photo_url || null,
            country: account?.country || null,
            linked: !!account,
          };
        });
        rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
        setDrivers(rows);
      })
      .catch(() => setDrivers([]));
  }, []);

  if (!drivers) return <div className="skeleton" style={{ height: 240 }} />;

  const linkedCount = drivers.filter(d => d.linked).length;

  return (
    <section>
      <div className="page-title">
        <h2>Drivers</h2>
        <span className="page-badge">{drivers.length} Drivers</span>
      </div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.9rem" }}>
        Everyone who has raced in the league. Open a profile to see career stats across all games.
        {" "}{linkedCount} of {drivers.length} have linked a player account.
      </p>

      {drivers.length === 0 ? (
        <div className="empty-state"><span className="empty-state-icon">🏎</span><p>No drivers yet.</p></div>
      ) : (
        <div className="list-rows">
          {drivers.map(d => (
            <Link href={`/drivers/${d.id}`} key={d.id} className={`list-row${d.linked ? " linked" : ""}`}>
              {d.photo_url
                ? <img src={d.photo_url} alt="" className="avatar" />
                : <span className="avatar avatar-fallback">{String(d.name || "?")[0]?.toUpperCase()}</span>}
              <span className="list-row-name">
                <strong>{d.name}</strong>
                <span style={{ color: d.linked ? undefined : "var(--ink-2)" }}>
                  {d.linked ? (d.country || "Linked account") : "Not linked"}
                </span>
              </span>
              <span className="list-row-meta">
                <span>
                  <span className="list-row-meta-label">Account</span>
                  <span className="list-row-meta-value">{d.linked ? "Linked" : "—"}</span>
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
