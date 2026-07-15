"use client";

import { useState } from "react";
import { uploadImage } from "@/lib/api";

// Small "pick file → upload → preview" widget. Calls onUploaded(url).
export function ImageUpload({ label, kind = "logo", value, onUploaded }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onUploaded(await uploadImage(file, kind));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  return (
    <div className="field">
      <label>{label}</label>
      <div className="upload-row">
        {value
          ? <img src={value} alt="" className="upload-preview" />
          : <span className="upload-preview upload-placeholder">🖼</span>}
        <input type="file" accept="image/*" onChange={handleChange} disabled={busy} />
        {busy && <span style={{ fontSize: "0.8rem", color: "var(--ink-1)" }}>Uploading…</span>}
      </div>
      {error && <span style={{ fontSize: "0.8rem", color: "#f87171" }}>{error}</span>}
    </div>
  );
}
