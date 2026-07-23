"use client";

import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";

export function AdminGate({ children }) {
  const { user, isAdmin, loading } = useAuth();
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
