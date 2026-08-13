"use client";

import { clientAuth } from "@/lib/firebaseClient";
import { getActiveLeagueId } from "@/lib/leagueClient";

// Fetch wrapper that attaches the Firebase ID token when signed in, plus the
// active league id so every read/write is scoped to the selected league. The
// header is omitted when no league is active (e.g. before the containment
// migration), in which case the server falls back to unscoped data.
export async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const user = clientAuth().currentUser;
  if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;
  const leagueId = getActiveLeagueId();
  if (leagueId) headers["X-League-Id"] = leagueId;
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    // The whole error body travels with the Error, not just its message: a
    // refusal can be something the caller has to ACT on rather than merely
    // print. A 409 from POST /api/drivers, for instance, carries the drivers
    // the new one looked like, and the screen turns them into a "did you mean
    // one of these?" prompt (see lib/driverPool.js). `err.message` is unchanged
    // for every caller that only ever showed the text.
    let payload = null;
    try { payload = await res.json(); } catch {}
    const err = new Error(payload?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = payload || {};
    throw err;
  }
  return res.json();
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
