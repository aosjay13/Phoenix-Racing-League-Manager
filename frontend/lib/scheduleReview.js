// The answers an admin gives a schedule import about its venues, and whether
// they are complete.
//
// Two importers put the same review table in front of an admin — the
// SimRacerHub one and the pasted one — and both have to decide the same thing:
// is this ready to create? Getting that wrong in either direction is bad in a
// way that only shows up afterwards. Too strict and a season can't be created;
// too loose and a season's worth of races is pointed at a venue nobody
// confirmed, or two venues are created under one name, which is the duplicate
// the whole venue check exists to prevent.
//
// So the rule is written once, here, and it is pure — the tables render it, and
// the tests can ask it directly.

const clean = s => String(s ?? "").trim();
const key = s => clean(s).toLowerCase();

// What each venue starts as, before the admin touches anything: a confident
// match is used, and everything else is created under the name the matcher
// suggested — which the admin can rename or point elsewhere.
export function initialTrackChoices(tracks = []) {
  return Object.fromEntries((tracks || []).map(t => [
    t.raw,
    t.status === "matched"
      ? { action: "use", track_id: t.track_id }
      : { action: "create", name: t.suggested_name, track_type: t.suggested_type },
  ]));
}

// What still needs answering. `choices` is keyed by the name the source used.
export function trackChoiceProblems(tracks = [], choices = {}) {
  const choiceFor = raw => choices[raw] || {};
  const creating = (tracks || []).filter(t => choiceFor(t.raw).action === "create");

  // Two venues can't be created under one name — the duplicate this whole
  // check exists to stop, arriving from the review table instead.
  const seen = new Map();
  const duplicateNames = new Set();
  for (const t of creating) {
    const k = key(choiceFor(t.raw).name);
    if (!k) continue;
    if (seen.has(k)) duplicateNames.add(k);
    seen.set(k, true);
  }

  const unnamed = creating.filter(t => !clean(choiceFor(t.raw).name));
  // "Use a track I already have" with no track picked. An unanswered one must
  // never fall through to creating something — see applyTrackDecisions.
  const unanswered = (tracks || []).filter(t => choiceFor(t.raw).action === "use" && !choiceFor(t.raw).track_id);

  return {
    creating,
    duplicateNames,
    unnamed,
    unanswered,
    ready: !duplicateNames.size && !unnamed.length && !unanswered.length,
  };
}
