import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/serverAuth";

// Gran Turismo 7 screenshot OCR. Admins drop one or more GT7 result/qualifying
// screenshots into the Smart Importer; this route sends them to Claude's vision
// model and returns a single ordered list of { position, driver, best_lap }.
//
// Why a Vision API route rather than a client-side OCR library: GT7 renders
// results as light text on a dark, semi-transparent background over race
// footage — the exact case classic OCR (tesseract.js) handles worst. A vision
// model reads the layout directly, tolerates the low contrast, and can combine
// the two screenshots a full 16-car lobby needs (positions 1-8 on one screen,
// 9-16 on the next) into one ordered field in a single call.
//
// The API key never leaves the server. The extracted rows are handed back to
// the same review pipeline the CSV importer uses (fuzzy name matching, the
// fastest-lap calculation, manual driver resolution) — nothing is saved here.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const MAX_IMAGES = 6;                 // two screenshots is typical; allow a few extra
const MAX_BYTES = 8 * 1024 * 1024;    // per image
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

// Structured-output schema — guarantees the model returns exactly this shape,
// so the route never has to defensively parse free-form text.
const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rows"],
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["position", "driver", "best_lap"],
        properties: {
          position: { type: "integer", description: "Finishing (or qualifying) position, 1 = first." },
          driver: { type: "string", description: "The driver's PSN name exactly as shown." },
          best_lap: { type: "string", description: "Best/fastest lap time as shown, e.g. '1:23.456'. Empty string if none is shown." },
        },
      },
    },
  },
};

const PROMPT = `These are one or more screenshots from Gran Turismo 7 showing race or qualifying results.

Layout notes:
- Finishing position is on the far left (1, 2, 3, ...).
- The driver's PSN name is the main text on each row.
- The "Best Lap" time is on the far right of each row (format m:ss.mmm, e.g. 1:23.456).
- A full 16-car lobby is split across two screenshots (positions 1-8 on one, 9-16 on the next). When multiple images are given, combine every row into a single list.

Extract every driver row you can read. Return them ordered by finishing position ascending. Transcribe PSN names exactly (they are case-sensitive and may contain unusual capitalization or numbers). If a row's best lap time is not visible, use an empty string. Do not invent rows or positions that are not shown.`;

export const POST = withAdmin(async (request) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Screenshot import is not configured — set ANTHROPIC_API_KEY on the server." },
      { status: 501 }
    );
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart image upload." }, { status: 400 });
  }

  const files = form.getAll("images").filter(f => f && typeof f !== "string");
  if (!files.length) return NextResponse.json({ error: "No images provided." }, { status: 400 });
  if (files.length > MAX_IMAGES) {
    return NextResponse.json({ error: `Too many images — up to ${MAX_IMAGES} at once.` }, { status: 400 });
  }

  const imageBlocks = [];
  for (const file of files) {
    if (!ALLOWED.includes(file.type)) {
      return NextResponse.json({ error: `Unsupported image type: ${file.type || "unknown"}` }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Each image must be under 8 MB." }, { status: 400 });
    }
    const data = Buffer.from(await file.arrayBuffer()).toString("base64");
    imageBlocks.push({ type: "image", source: { type: "base64", media_type: file.type, data } });
  }

  let res;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        // Adaptive thinking: reading low-contrast text off race footage benefits
        // from the model reasoning about the layout before transcribing.
        thinking: { type: "adaptive" },
        output_config: { format: { type: "json_schema", schema: RESULT_SCHEMA } },
        messages: [{ role: "user", content: [...imageBlocks, { type: "text", text: PROMPT }] }],
      }),
    });
  } catch (err) {
    return NextResponse.json({ error: `Vision request failed: ${err.message}` }, { status: 502 });
  }

  if (!res.ok) {
    let detail = `Vision request failed (${res.status})`;
    try { detail = (await res.json()).error?.message || detail; } catch {}
    return NextResponse.json({ error: detail }, { status: 502 });
  }

  const payload = await res.json();
  if (payload.stop_reason === "refusal") {
    return NextResponse.json({ error: "The vision model declined to read these images." }, { status: 422 });
  }

  // The structured-output text block holds the JSON we asked for.
  const textBlock = (payload.content || []).find(b => b.type === "text");
  let parsed;
  try {
    parsed = JSON.parse(textBlock?.text || "{}");
  } catch {
    return NextResponse.json({ error: "Could not read the results from the screenshots." }, { status: 502 });
  }

  const seen = new Set();
  const rows = (parsed.rows || [])
    .map(r => ({
      position: Number.isFinite(r.position) ? Number(r.position) : null,
      driver: String(r.driver ?? "").trim(),
      best_lap: String(r.best_lap ?? "").trim(),
    }))
    .filter(r => r.driver)
    // Drop a driver name repeated across overlapping screenshots (last write wins
    // via the Map below is unnecessary here — first occurrence is kept).
    .filter(r => {
      const key = r.driver.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9))
    // Renumber sequentially so gaps/duplicates from OCR become a clean 1..N grid;
    // the admin can still adjust any position in the review table.
    .map((r, i) => ({ position: r.position ?? i + 1, driver: r.driver, best_lap: r.best_lap }));

  if (!rows.length) {
    return NextResponse.json({ error: "No driver rows could be read from the screenshots." }, { status: 422 });
  }

  return NextResponse.json({ rows });
});
