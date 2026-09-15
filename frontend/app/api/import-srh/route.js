import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/serverAuth";
import { parseSrhPage, parseSrhRef, srhPageError, srhSegmentTable } from "@/lib/srhImport";

export const dynamic = "force-dynamic";

// One-click import of a night's results from SimRacerHub.
//
// A statistician pastes the SimRacerHub race URL (or just its id) into the
// importer on the results screen; this fetches that page, reads every session
// on it — practice, qualifying, the heats, the consolation, the feature — and
// hands each back as a table in the shape the shared importer already
// understands (see lib/srhImport.js and lib/resultsImport.js).
//
// Two things this route deliberately does NOT do:
//
//   • It never writes. Nothing here touches Firestore. The rows go to the
//     browser, fill the results grid for review, and are saved only when the
//     statistician presses Save — which is what keeps every points, bonus and
//     flag calculation in the one place that owns it (Calculate-on-Write; see
//     components/SessionEditor.jsx). An importer that wrote results directly
//     would be a second, quietly diverging scorer.
//   • It doesn't match drivers. Matching an imported name to a roster place is
//     done once, in lib/resultsImport.js, against every name a driver answers
//     to — their profile name, their name in this game, and each connected
//     account (Discord, PSN, Xbox, Steam, iRacing). That runs in the review
//     table, where a statistician can correct a match, create a missing driver
//     or skip a row. Re-implementing it here would give two answers to the same
//     question and no way to fix either.
//
// It exists at all because a browser can't fetch simracerhub.com directly: the
// site sends no CORS headers, so the request has to be made server-side.
//
//   GET /api/import-srh?url=<SimRacerHub race URL>
//   GET /api/import-srh?id=<schedule or race id>
//
// Open to any staff role, Statistician included — this is their job.

// SimRacerHub race pages run ~200 KB. The cap is what stops a redirect to
// something enormous from being read into memory, not a real page limit.
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20000;

const UA = "PhoenixRacingLeagueManager/1.0 (+results importer)";

// Fetch one page as text, refusing to read past MAX_BYTES. Throws with a
// message worth showing an admin.
async function fetchPage(url) {
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
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error("That SimRacerHub page is too large to import.");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export const GET = withAdmin(async (request) => {
  const { searchParams } = new URL(request.url);
  const input = (searchParams.get("url") || searchParams.get("id") || "").trim();

  // parseSrhRef is also the guard on where this route will make a request to:
  // it yields simracerhub.com URLs or nothing at all.
  const ref = parseSrhRef(input);
  if (!ref.ok) return NextResponse.json({ error: ref.error }, { status: 400 });

  // A bare number could be a schedule id or a race id; SimRacerHub tells them
  // apart only by being asked, so both are tried and the first page that
  // carries results wins.
  let failure = { error: "Could not read that SimRacerHub race.", status: 502 };
  for (const url of ref.urls) {
    let html;
    try {
      html = await fetchPage(url);
    } catch (err) {
      failure = { error: err.message, status: 502 };
      continue;
    }

    const doc = parseSrhPage(html);
    if (!doc?.segments?.length) {
      // The page answered, it just isn't a scored race — SimRacerHub usually
      // says why ("No races found for Schedule ID …"), and that's worth far
      // more to whoever mistyped an id than a generic failure.
      failure = {
        error: srhPageError(html)
          || "That SimRacerHub page has no results on it yet — check the race has been scored.",
        status: 404,
      };
      continue;
    }

    return NextResponse.json({
      ok: true,
      source_url: url,
      ref: { param: ref.param, id: ref.id },
      event: doc.event,
      // Each session as a table the review grid can load straight away: the
      // column mapping falls out of these headers (see mapHeaders), and
      // `provisional` marks the drivers SimRacerHub paid without them racing.
      segments: doc.segments.map(segment => {
        const { headers, rows, provisional } = srhSegmentTable(segment);
        return {
          key: segment.key,
          race_id: segment.race_id,
          name: segment.name,
          raw_name: segment.raw_name,
          type: segment.type,
          driver_count: segment.driver_count,
          headers,
          rows,
          provisional,
        };
      }),
    });
  }

  return NextResponse.json({ error: failure.error }, { status: failure.status });
});
