// An in-memory stand-in for @/lib/firebase, so a route handler can be run and
// measured without a network or a service account.
//
// ── What this models, and what it does not ─────────────────────────────────
//
// Vercel's Fluid pricing bills ACTIVE CPU: the time the function is actually
// executing, not the time it spends waiting on someone else's I/O. So the
// question this harness answers is "how much CPU does this route burn?", and
// the two things that matter for it are:
//
//   1. Deserialization. Every document a query returns has to be decoded from
//      the wire into a JS object before any of the route's code can touch it.
//      That is real, per-document, in-function CPU, and it is the cost that
//      grows silently as a league races more seasons. Modeled here as a
//      structured round-trip per document (`DECODE_PER_DOC`), which is a
//      stand-in for protobuf decoding, not a measurement of it — the shape of
//      the curve is the finding, not the absolute constant.
//
//   2. The route's own work. Every map, filter, sort and nested scan the
//      handler runs over those documents. This is measured exactly, because it
//      is the real code running on real object graphs.
//
// Latency is simulated as idle time (a timer, no CPU), which is the point: it
// inflates wall-clock duration without adding a microsecond of Active CPU. If
// you profile with `--latency 0` the CPU numbers barely move, and that is the
// harness telling you the truth about where the bill comes from.

import { createSign, createVerify, generateKeyPairSync } from "node:crypto";

export const stats = {
  docsRead: 0, docsDecoded: 0, queries: 0, writes: 0, authVerifies: 0, authListed: 0,
};

export function resetStats() {
  for (const k of Object.keys(stats)) stats[k] = 0;
}

let store = {};
let options = { latencyMs: 12, decode: true };

// Install a dataset. `data` is { collectionName: [ {id, ...fields} ] }.
export function loadStore(data, opts = {}) {
  store = {};
  for (const [name, rows] of Object.entries(data)) {
    store[name] = new Map(rows.map(r => {
      const { id, ...fields } = r;
      return [id, fields];
    }));
  }
  options = { ...options, ...opts };
}

// One simulated round trip. Idle — deliberately spends no CPU, so the profile
// separates "waiting on Firestore" from "burning CPU on what it sent back".
function trip() {
  stats.queries++;
  if (!options.latencyMs) return Promise.resolve();
  return new Promise(r => setTimeout(r, options.latencyMs));
}

// The per-document decode every read pays before the handler sees a thing.
function decode(fields) {
  stats.docsRead++;
  if (!options.decode) return fields;
  stats.docsDecoded++;
  return JSON.parse(JSON.stringify(fields));
}

function snap(id, fields) {
  const data = decode(fields);
  return { id, exists: true, data: () => data, get: f => data[f], ref: { id } };
}

const OPS = {
  "==": (a, b) => a === b,
  "!=": (a, b) => a !== b,
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
  "in": (a, b) => Array.isArray(b) && b.includes(a),
  "not-in": (a, b) => Array.isArray(b) && !b.includes(a),
  "array-contains": (a, b) => Array.isArray(a) && a.includes(b),
  "array-contains-any": (a, b) => Array.isArray(a) && Array.isArray(b) && b.some(v => a.includes(v)),
};

class Query {
  constructor(name, filters = [], order = null, cap = null) {
    this.name = name;
    this.filters = filters;
    this.order = order;
    this.cap = cap;
  }

  where(field, op, value) {
    return new Query(this.name, [...this.filters, { field, op, value }], this.order, this.cap);
  }

  orderBy(field, dir = "asc") {
    return new Query(this.name, this.filters, { field, dir }, this.cap);
  }

  limit(n) { return new Query(this.name, this.filters, this.order, n); }

  // Field masks are a server-side projection: fewer bytes on the wire and less
  // to decode. Modeled, because it is one of the levers that actually helps.
  select(...fields) {
    const q = new Query(this.name, this.filters, this.order, this.cap);
    q.mask = fields;
    return q;
  }

  rows() {
    const src = store[this.name] || new Map();
    let out = [];
    for (const [id, fields] of src) {
      if (this.filters.every(f => OPS[f.op](fields[f.field], f.value))) out.push([id, fields]);
    }
    if (this.order) {
      const { field, dir } = this.order;
      out.sort((a, b) => (a[1][field] > b[1][field] ? 1 : a[1][field] < b[1][field] ? -1 : 0) * (dir === "desc" ? -1 : 1));
    }
    if (this.cap != null) out = out.slice(0, this.cap);
    return out;
  }

  async get() {
    await trip();
    const rows = this.rows();
    const docs = rows.map(([id, fields]) => {
      if (this.mask) {
        const picked = {};
        for (const f of this.mask) picked[f] = fields[f];
        return snap(id, picked);
      }
      return snap(id, fields);
    });
    return { docs, size: docs.length, empty: docs.length === 0, forEach: fn => docs.forEach(fn) };
  }

  // Aggregation query: the server counts and sends back a number. No documents
  // cross the wire, so there is nothing to decode — which is exactly why the
  // one route that uses it is the cheap one.
  count() {
    const q = this;
    return {
      async get() {
        await trip();
        const n = q.rows().length;
        return { data: () => ({ count: n }) };
      },
    };
  }
}

class CollectionRef extends Query {
  doc(id) { return new DocRef(this.name, id ?? `auto-${Math.random().toString(36).slice(2)}`); }
  async add(fields) {
    await trip();
    stats.writes++;
    const id = `auto-${Math.random().toString(36).slice(2)}`;
    (store[this.name] ??= new Map()).set(id, fields);
    return { id };
  }
}

class DocRef {
  constructor(name, id) { this.name = name; this.id = id; }
  collection(sub) { return new CollectionRef(`${this.name}/${this.id}/${sub}`); }
  async get() {
    await trip();
    const fields = (store[this.name] || new Map()).get(this.id);
    if (fields === undefined) return { id: this.id, exists: false, data: () => undefined, ref: this };
    return snap(this.id, fields);
  }
  async set(fields, opts = {}) {
    await trip();
    stats.writes++;
    const col = (store[this.name] ??= new Map());
    col.set(this.id, opts.merge ? { ...(col.get(this.id) || {}), ...fields } : fields);
  }
  async update(fields) {
    await trip();
    stats.writes++;
    const col = (store[this.name] ??= new Map());
    col.set(this.id, { ...(col.get(this.id) || {}), ...fields });
  }
  async delete() {
    await trip();
    stats.writes++;
    (store[this.name] || new Map()).delete(this.id);
  }
}

class WriteBatch {
  constructor() { this.ops = []; }
  set(ref, fields, opts) { this.ops.push(() => ref.set(fields, opts)); return this; }
  update(ref, fields) { this.ops.push(() => ref.update(fields)); return this; }
  delete(ref) { this.ops.push(() => ref.delete()); return this; }
  async commit() {
    await trip();
    stats.writes += this.ops.length;
    for (const op of this.ops) await op();
  }
}

class Firestore {
  collection(name) { return new CollectionRef(name); }
  batch() { return new WriteBatch(); }
  async getAll(...refs) { return Promise.all(refs.map(r => r.get())); }
  async runTransaction(fn) {
    return fn({
      get: ref => ref.get(),
      set: (ref, f, o) => ref.set(f, o),
      update: (ref, f) => ref.update(f),
      delete: ref => ref.delete(),
    });
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────
//
// verifyIdToken really does verify: an RS256 signature check over a real JWT,
// which is what firebase-admin does once Google's public certs are cached. That
// is genuine crypto CPU on every single authenticated request, so it is worth
// measuring rather than stubbing to zero.

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function mintToken(claims) {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "profiler" }));
  const payload = b64url(JSON.stringify({
    ...claims,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${b64url(signer.sign(privateKey))}`;
}

class Auth {
  async verifyIdToken(token) {
    stats.authVerifies++;
    const [h, p, s] = String(token).split(".");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${h}.${p}`);
    const ok = verifier.verify(publicKey, Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
    if (!ok) throw new Error("bad token");
    return JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  }

  // Paged exactly like the real one, and it is the whole account list every
  // time — there is no server-side filter for "accounts in this league".
  async listUsers(pageSize = 1000, pageToken) {
    await trip();
    const all = [...(store.users || new Map()).entries()];
    const start = pageToken ? Number(pageToken) : 0;
    const page = all.slice(start, start + pageSize);
    stats.authListed += page.length;
    const users = page.map(([uid, u]) => JSON.parse(JSON.stringify({
      uid,
      email: u.email,
      displayName: u.display_name,
      photoURL: u.photo_url ?? null,
      emailVerified: true,
      metadata: { creationTime: u.created_at, lastSignInTime: u.created_at },
      customClaims: {}, providerData: [{ providerId: "password", uid: u.email }],
    })));
    const next = start + pageSize;
    return { users, pageToken: next < all.length ? String(next) : undefined };
  }

  async getUser(uid) {
    await trip();
    const u = (store.users || new Map()).get(uid);
    if (!u) throw new Error("not found");
    return { uid, email: u.email, displayName: u.display_name, emailVerified: true, metadata: {} };
  }
  async updateUser(uid, fields) { await trip(); stats.writes++; return { uid, ...fields }; }
  async createUser(fields) { await trip(); stats.writes++; return { uid: `new-${Math.random()}`, ...fields }; }
  async getUserByEmail(email) {
    await trip();
    for (const [uid, u] of store.users || new Map()) if (u.email === email) return { uid, email, emailVerified: true, metadata: {} };
    throw new Error("not found");
  }
}

const firestore = new Firestore();
const auth = new Auth();

export function db() { return firestore; }
export function adminAuth() { return auth; }
export function bucket() {
  return { file: () => ({ save: async () => {}, makePublic: async () => {}, publicUrl: () => "https://example.invalid/x" }) };
}
