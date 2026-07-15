"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ImageUpload } from "@/components/ImageUpload";
import { api } from "@/lib/api";

export default function MyProfilePage() {
  const { user, profile, loading, refreshProfile } = useAuth();
  const [form, setForm] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (profile && !form) {
      setForm({
        display_name: profile.display_name || "",
        photo_url: profile.photo_url || "",
        bio: profile.bio || "",
        country: profile.country || "",
        number: profile.number ?? "",
      });
    }
  }, [profile, form]);

  if (loading) return <div className="skeleton" style={{ height: 240 }} />;
  if (!user) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon">👤</span>
        <p>Sign in to edit your driver profile.</p>
        <Link href="/login" className="btn btn-primary">Sign In</Link>
      </div>
    );
  }
  if (!form) return <div className="skeleton" style={{ height: 240 }} />;

  function set(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/users/me", {
        method: "PATCH",
        body: { ...form, number: form.number === "" ? null : Number(form.number) },
      });
      await refreshProfile();
      setToast({ type: "success", msg: "Profile saved." });
    } catch (err) {
      setToast({ type: "error", msg: err.message });
    } finally {
      setBusy(false);
      setTimeout(() => setToast(null), 3500);
    }
  }

  return (
    <section>
      <div className="page-title">
        <h2>My Profile</h2>
        <Link href={`/drivers/${user.uid}`} className="page-badge">View public profile →</Link>
      </div>

      <div className="form-card">
        <form onSubmit={handleSave}>
          <ImageUpload label="Profile Picture" kind="avatar" value={form.photo_url}
            onUploaded={url => setForm(f => ({ ...f, photo_url: url }))} />
          <div className="field">
            <label>Display Name</label>
            <input required value={form.display_name} onChange={set("display_name")} />
          </div>
          <div className="field">
            <label>Preferred Car Number</label>
            <input type="number" value={form.number} onChange={set("number")} placeholder="13" />
          </div>
          <div className="field">
            <label>Country / Region</label>
            <input value={form.country} onChange={set("country")} placeholder="USA" />
          </div>
          <div className="field">
            <label>Bio</label>
            <textarea rows={4} value={form.bio} onChange={set("bio")} placeholder="Tell the league about yourself…"
              style={{ padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg-elevated)", color: "var(--ink-0)", fontSize: "0.95rem", fontFamily: "inherit", outline: "none", resize: "vertical" }} />
          </div>
          {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
          <button className="btn btn-primary" disabled={busy} type="submit">{busy ? "Saving…" : "Save Profile"}</button>
        </form>
      </div>
    </section>
  );
}
