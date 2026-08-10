"use client";

import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";

// `minLevel` narrows the gate past "any staff role" for the pages only the
// senior roles run — the approvals queue is Moderator and up, so a Statistician
// clears the baseline check but not this one. Omitted (the default) keeps the
// original behaviour: any staff role passes. The API routes behind these pages
// enforce the same floor themselves; this only decides what's worth rendering.
export function AdminGate({ children, minLevel = null }) {
  const { user, isAdmin, roleLevel, loading } = useAuth();
  if (loading) return <div className="skeleton" style={{ height: 160 }} />;
  if (!user) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon">🔒</span>
        <p>Sign in with a league staff account to access this page.</p>
        <Link href="/login" className="btn btn-primary">Sign In</Link>
      </div>
    );
  }
  if (minLevel != null && roleLevel < minLevel) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon">🔒</span>
        <p>This page is for league Moderators and above.</p>
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon">🔒</span>
        <p>This page is for league staff only.</p>
      </div>
    );
  }
  return children;
}
