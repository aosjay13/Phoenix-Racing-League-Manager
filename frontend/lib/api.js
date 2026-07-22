"use client";

import { clientAuth } from "@/lib/firebaseClient";

// Fetch wrapper that attaches the Firebase ID token when signed in.
export async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const user = clientAuth().currentUser;
  if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

// Send one or more Gran Turismo 7 result/qualifying screenshots to the vision
// OCR route. Returns the extracted rows: [{ position, driver, best_lap }].
export async function importGt7Screenshots(files) {
  const user = clientAuth().currentUser;
  if (!user) throw new Error("Sign in required");
  const form = new FormData();
  for (const f of files) form.append("images", f);
  const res = await fetch("/api/import/gt7-ocr", {
    method: "POST",
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    body: form,
  });
  if (!res.ok) {
    let msg = "Screenshot import failed";
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return (await res.json()).rows;
}

export async function uploadImage(file, kind = "logo") {
  const user = clientAuth().currentUser;
  if (!user) throw new Error("Sign in required");
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  const res = await fetch("/api/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    body: form,
  });
  if (!res.ok) {
    let msg = "Upload failed";
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return (await res.json()).url;
}
