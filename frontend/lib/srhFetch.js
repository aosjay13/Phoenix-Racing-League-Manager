// Fetching pages from SimRacerHub, server-side.
//
// A browser can't read simracerhub.com at all — the site sends no CORS headers
// — so every import that reads it does so from a route handler, and they all
// need the same three things: a timeout, a cap on how much is read into memory,
// and a User-Agent that says who is asking. That's what this is.
//
// It deliberately does NOT decide what may be fetched. Where a request may go
// is settled before this is called, by parseSrhRef (a race) or
// parseSrhSeasonRef (a season) in lib/srhImport.js and lib/srhSchedule.js,
// which yield simracerhub.com URLs or nothing at all. Keeping the allowlist
// there and the transport here means a new importer can't accidentally arrive
// with a laxer guard of its own.
//
// Server-only: import it from route handlers, never from a component.

import { SRH_SCORING } from "@/lib/srhImport";

// SimRacerHub's pages run ~200 KB. The cap is what stops a redirect to
// something enormous being read into memory, not a real page limit.
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20000;

const UA = "PhoenixRacingLeagueManager/1.0 (+results importer)";

// Fetch one page as text, refusing to read past MAX_BYTES. Throws with a
// message worth showing an admin.
export async function srhFetchText(url) {
  let res;
  try {
    res = await fetch(url, {
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    });
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    throw new Error(timedOut ? "SimRacerHub took too long to answer." : "Could not reach SimRacerHub.");
  }
  if (!res.ok) throw new Error(`SimRacerHub answered ${res.status}.`);

  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new Error("That SimRacerHub page is too large to import.");

  if (!res.body) return await res.text();
  const decoder = new TextDecoder("utf-8");
  const reader = res.body.getReader();
  let text = "", bytes = 0;
  for (;;) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch {
      // SimRacerHub hangs up part way through a heavy page often enough to be
      // worth its own message: what arrived is half a document, and a parser
      // finding nothing in it would otherwise report "no schedule on that page".
      throw new Error("SimRacerHub cut the connection part way through that page — try again.");
    }
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error("That SimRacerHub page is too large to import.");
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}

// The name of one of SimRacerHub's cars, from its own page.
//
// A schedule draws each round's car as a picture — `images/car_186.png` — and
// most leagues don't switch the name on beside it, so the id is all a schedule
// gives up. The car's page is headed with its name, which is the only place to
// read it from. Null when it can't be, and a caller treats that as a car it
// simply doesn't set: a season's car is one field an admin can type, and a
// failed lookup must never fail the import.
export async function srhCarName(carId) {
  if (!/^\d+$/.test(String(carId ?? ""))) return null;
  try {
    const html = await srhFetchText(`${SRH_SCORING}/car_stats.php?car_id=${carId}`);
    const heading = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const name = heading ? heading[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() : "";
    return name || null;
  } catch {
    return null;
  }
}

// SimRacerHub's Tracks page — every venue it knows, in one request.
//
// Fetched once per schedule import, to turn each round's layout name into the
// venue behind it and to give a venue this app is about to create iRacing's own
// logo for it (see parseSrhTrackDirectory). Null when it can't be read, which
// costs the import nothing: tracks are then matched on their names alone and
// created with less filled in.
export async function srhTrackDirectoryHtml() {
  try {
    return await srhFetchText(`${SRH_SCORING}/tracks.php`);
  } catch {
    return null;
  }
}
