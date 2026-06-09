"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/",          label: "Dashboard",        icon: "◈" },
  { href: "/roster",    label: "Roster",            icon: "⊞" },
  { href: "/schedule",  label: "Schedule",          icon: "⊟" },
  { href: "/race-entry",label: "Race Entry",        icon: "⊕" },
  { href: "/standings", label: "Standings",         icon: "⊛" },
];

export function AppShell({ children }) {
  const pathname = usePathname();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">🏁</div>
          <div>
            <h1>Apex League</h1>
            <p className="sidebar-tagline">Control Center</p>
          </div>
        </div>

        <span className="nav-section-label">Navigation</span>
        <nav>
          {navItems.map((item) => {
            const isActive = item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
            return (
              <Link
                className={`nav-link${isActive ? " active" : ""}`}
                key={item.href}
                href={item.href}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div style={{ marginTop: "auto", paddingTop: 24, borderTop: "1px solid var(--border)" }}>
          <p style={{ margin: 0, fontSize: "0.72rem", color: "var(--ink-2)", paddingLeft: 12 }}>
            Season 2026 · Apex League
          </p>
        </div>
      </aside>

      <main className="main">{children}</main>
    </div>
  );
}
