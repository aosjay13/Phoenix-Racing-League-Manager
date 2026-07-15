"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function DriversPage() {
  const [users, setUsers] = useState(null);

  useEffect(() => {
    api("/api/users").then(setUsers).catch(() => setUsers([]));
  }, []);

  if (!users) return <div className="skeleton" style={{ height: 240 }} />;

  return (
    <section>
      <div className="page-title">
        <h2>Drivers</h2>
        <span className="page-badge">{users.length} Registered</span>
      </div>
      <p style={{ marginTop: 4, color: "var(--ink-1)", fontSize: "0.9rem" }}>
        Every registered player. Open a profile to see career stats across all games.
      </p>

      {users.length === 0 ? (
        <div className="empty-state"><span className="empty-state-icon">🏎</span><p>No registered players yet.</p></div>
      ) : (
        <div className="quick-links" style={{ marginTop: 18 }}>
          {users.map(u => (
            <Link href={`/drivers/${u.uid}`} key={u.uid}>
              <div className="quick-card" style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                {u.photo_url
                  ? <img src={u.photo_url} alt="" className="avatar" />
                  : <span className="avatar avatar-fallback">{String(u.display_name || "?")[0]?.toUpperCase()}</span>}
                <div>
                  <strong>{u.display_name}</strong>
                  <span style={{ display: "block" }}>{u.country || " "}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
