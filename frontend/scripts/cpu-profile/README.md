# Where the Fluid Active CPU goes

A harness for answering one question with numbers instead of guesses: **which
API routes are burning the Vercel Fluid Active CPU allowance, and why.**

```bash
npm run profile:cpu                                  # the default league
npm run profile:cpu -- --hotspots --growth           # the full picture
npm run profile:cpu -- --seasons 24 --growth         # what next year looks like
npm run profile:cpu -- --latency 0                   # prove wall time isn't the bill
npm run profile:cpu -- --only stats --iterations 10  # one route, harder
npm run profile:cpu -- --json report.json            # machine-readable
```

## Why CPU and not requests

Fluid bills **Active CPU** — time the function is actually executing — separately
from provisioned memory and from wall-clock duration. A route that waits 300ms
on Firestore and then does nothing costs almost nothing. A route that returns in
100ms having decoded 27,000 documents and scanned them repeatedly is expensive.
Request counts and response times both hide that difference, which is why an app
can feel fine and still empty the allowance.

So the harness measures `process.cpuUsage()` around each real route handler, and
reports the CPU/wall ratio next to it. The `CPU%` column is the whole point: the
routes at the top of the table are the ones the bill is made of.

## How a route is run without Firebase

Every route reaches Firestore and Auth through `@/lib/firebase`. `profile-hooks.mjs`
resolves that one specifier to `fake-firestore.mjs` — an in-memory double — so the
handler runs its **own unmodified code** against a synthetic league, with no
credentials, no network, and no risk of touching production data.

`dataset.mjs` builds that league: seasons bring rounds, rounds bring sessions,
sessions bring a result per driver. Twelve seasons of twenty-round championships
is roughly 27,000 result documents, which is four years of racing rather than an
exotic case.

## What is modeled, and what that means for the numbers

| | |
|---|---|
| **Route code** | Real. This is the measurement. |
| **`verifyIdToken`** | Real RS256 verification over a real JWT — the same crypto firebase-admin does once Google's certs are cached. |
| **Per-document decode** | Modeled as a structured round-trip per document, standing in for protobuf decoding. |
| **Network latency** | Simulated as idle time. Spends no CPU, on purpose. |
| **Cold start** | Real — the actual `firebase-admin` import, timed. |

Treat the absolute microseconds as a model, not an invoice. What the harness is
for is the **ranking** between routes and the **shape of the curve** as the
league grows, and both of those come from real code running over real object
graphs.

## The sections

**CPU per request** — every route, most expensive first, with documents decoded
and payload size beside it.

**Moved to the browser** — the screens whose maths used to be a route and now
runs on the viewer's machine, with the raw bundle each one reads. Vercel is
billed for none of that CPU, and the bundle is cacheable at the edge, so a
second view costs neither a calculation nor a function invocation. Read the two
columns together: this is the trade the refactor made — more bytes out, no
arithmetic in.

**Background polling** — the routes the browser calls on a timer with nobody
touching the app, multiplied out to CPU-per-open-tab-per-hour. The intervals are
parsed out of the client source at run time rather than written down here, so
this projection cannot drift away from the code it describes.

**`--hotspots`** — runs one suspected hot spot two ways over identical data and
compares the output as well as the time, so a speed-up that changed an answer
fails loudly instead of looking like a win.

**`--growth`** — the same routes at several league sizes. A route whose CPU
climbs faster than the data does is superlinear, and will keep getting worse on
its own. Probes are warmed at the largest size first; without that the first size
measured pays everyone's JIT cost and the curve reads backwards.

## Proving a refactor changed nothing

`payloads.mjs` dumps every payload a screen renders against the same seeded
dataset, so a change can be checked against the tree it came from rather than
eyeballed:

```bash
git stash && node --import ./scripts/cpu-profile/register.mjs \
  scripts/cpu-profile/payloads.mjs > /tmp/before.json && git stash pop
node --import ./scripts/cpu-profile/register.mjs \
  scripts/cpu-profile/payloads.mjs > /tmp/after.json
diff /tmp/before.json /tmp/after.json
```

It covers the success paths and the refusals — a missing param, an unknown
season, a team nobody has heard of — because a change that quietly turns a 404
into a 200 is still a broken change.

There is also a standing check that needs no "before" tree:

```bash
node --import ./scripts/cpu-profile/register.mjs \
  scripts/cpu-profile/payloads.mjs --verify
```

The digests in `payload-digests.json` were blessed from the **output of the old
server routes** — `/api/standings`, `/api/stats`, `/api/team-stats`,
`/api/skill-ratings`, `/api/schedule` — on this dataset, immediately before
those routes were deleted. So `--verify` is the permanent proof that moving the
championship maths into the browser did not move a single number, and it keeps
guarding the compute modules against every change after this one. Re-bless with
`--write-digests`, and only when an answer is meant to change.

## Adding a route

Add an entry to `ROUTES` in `profile.mjs` with its file and a URL. If the browser
polls it on a timer, set `poller` to the key of the module driving it so it joins
the polling projection.
