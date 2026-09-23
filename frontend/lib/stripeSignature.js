import crypto from "node:crypto";

// Verify a Stripe webhook's Stripe-Signature header, server-side only.
//
// Stripe signs `${t}.${rawBody}` with HMAC-SHA256 under the endpoint's whsec_
// secret and may send several v1 signatures while a secret is being rolled; any
// one matching is enough. The timestamp check stops an old, captured event from
// being replayed. `payload` has to be the body exactly as it arrived. Parsing
// and re-serializing it changes the bytes and every signature fails.
//
// Kept out of lib/billing.js because that file is imported by pages too, and
// the browser has no node:crypto.
export function verifyStripeSignature({ payload, header, secret, now = Date.now(), toleranceSec = 300 }) {
  if (!payload || !header || !secret) return false;
  let t = null;
  const sigs = [];
  for (const part of String(header).split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1") sigs.push(v);
  }
  if (!t || !/^\d+$/.test(t) || !sigs.length) return false;
  if (Math.abs(Math.floor(now / 1000) - Number(t)) > toleranceSec) return false;
  const want = crypto.createHmac("sha256", secret).update(`${t}.${payload}`, "utf8").digest();
  return sigs.some(sig => {
    if (!/^[0-9a-f]+$/i.test(sig)) return false;
    const got = Buffer.from(sig, "hex");
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  });
}
