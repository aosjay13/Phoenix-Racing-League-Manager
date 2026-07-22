"use client";

import { useState } from "react";
import { uploadImage } from "@/lib/api";

// Longest edge (px) any stored image is shrunk to. Keeps storage cheap and
// downloads fast — avatars/logos never display much larger than this.
const MAX_DIM = 128;

// Downscale a raster image in the browser so we never upload/store huge files.
// SVGs are vectors (already tiny) so they pass through untouched.
async function shrinkImage(file) {
  if (file.type === "image/svg+xml") return file;

  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  const scale = Math.min(1, MAX_DIM / Math.max(width, height));
  if (scale >= 1) {
    bitmap.close?.();
    return file; // already within bounds — don't re-encode
  }

  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  // Keep JPEGs as JPEG (with alpha-less content); everything else → PNG so we
  // don't flatten transparency on logos.
  const outType = file.type === "image/jpeg" ? "image/jpeg" : "image/png";
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error("Could not process image"))), outType, 0.9)
  );

  const ext = outType === "image/jpeg" ? "jpg" : "png";
  const base = (file.name || "image").replace(/\.[^.]+$/, "");
  return new File([blob], `${base}.${ext}`, { type: outType });
}

// Small "pick file → shrink → upload → preview" widget. Calls onUploaded(url).
export function ImageUpload({ label, kind = "logo", value, onUploaded }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const shrunk = await shrinkImage(file);
      onUploaded(await uploadImage(shrunk, kind));
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
      <span style={{ fontSize: "0.75rem", color: "var(--ink-1)" }}>
        Max {MAX_DIM}×{MAX_DIM}px, under 1 MB — larger images are automatically resized and their quality adjusted to fit.
      </span>
      {error && <span style={{ fontSize: "0.8rem", color: "#f87171" }}>{error}</span>}
    </div>
  );
}
