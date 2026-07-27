# Phoenix Racing League Manager
**Donate here:** [https://www.paypal.com/paypalme/krossx13](https://www.paypal.com/paypalme/krossx13), [https://cash.app/$disciplejtmay](https://cash.app/$disciplejtmay), [https://venmo.com/u/aosjay13](https://venmo.com/u/aosjay13)

**GitHub:** [aosjay13/Phoenix-Racing-League-Manager](https://github.com/aosjay13/Phoenix-Racing-League-Manager)

Multi-game racing league manager built to replace the league spreadsheet. Anyone can sign up
for a driver account; league admins build out the full hierarchy with custom names and logos:

**League** (e.g. Prodigy Racing Association) → **Game** (e.g. iRacing) → **Series** (e.g. Asphalt Assault Series) → **Season** (Season 1, 2, 3…) → **Class** (Pro, Amateur, GT3, LMP2… — optional) → **Race** (Race 1, 2, 3…)

A **League** is the top-level, fully-isolated environment: every game, series, season, race,
driver, team, track, and result belongs to exactly one league. A **League Switcher** in the top
bar swaps the active league, re-rendering the whole app for that league's data. Only the **Owner**
can create new (empty) leagues; the active league is renamed under **League Setup → League Settings**.

A **Game/Series/Season/Class** selector sits at the top of every page — pick "All" at any level to
widen a view (e.g. league-wide stats), or drill down to one exact season or class. The **Class**
menu lists "All Classes" (the combined, whole-field view) followed by the classes defined in the
selected season; a season that doesn't run classes simply stays on "All Classes".

## Features

- 🔐 **Login for everyone** — email/password or Google sign-in (Firebase Auth)
- 🧑‍✈️ **Player profiles** — public profile pages with editable picture, bio, country; career
  stats auto-aggregated across all games with a per-game breakdown
- 🏆 **Live standings** — driver *and* team championships with a configurable points scale,
  bonus points, and drop weeks per season
- 🎽 **Multi-class championships** — split a season into classes (Pro/Amateur, GT3/LMP2); each
  scores its own isolated championship, with an optional combined overall title across the field,
  optionally its own race calendar, and optionally its own qualifying and race at events every
  class runs together — each class with its own pole, winner and field
- 🖼 **Social graphic exporter** — league name + logo branding and per-column stat toggles, so
  the downloaded PNG/JPG shows exactly the columns you want
- ⬆ **Bulk roster import** — roll a whole roster into a new season in one click, from the series
  or a cloned past season, with duplicates skipped automatically
- ⏱ **Fast race entry** — one grid per race, pre-filled with the roster; supports multiple
  sessions per race (e.g. Qualifying + Race), scored independently; re-submitting a race
  overwrites cleanly for corrections
- 📊 **Stats & Roster filtering** — Game/Series/Season dropdowns filter Stats and Roster
  everywhere, with sortable columns and per-series car numbers
- 🖼 **Custom branding** — upload game, series, season, team, and track logos
- 👑 **Admin roles** — set `ADMIN_EMAILS`; admins get Race Entry, Roster & Teams, and League Setup

## Getting live (beta)

Follow **[SETUP-BETA.md](SETUP-BETA.md)** — Firebase project + Vercel import of this GitHub
repo. Every push to `main` auto-deploys.

## Local Development

```bash
cd frontend
npm install
npm run dev
```

Create `frontend/.env.local` from the root `.env.example` and fill in your Firebase values.
The app runs at `http://localhost:3000`.

## How to Use

### For players

1. **Sign in** (top right) with email/password or Google. This creates your public driver
   profile automatically.
2. **Profile** — edit your display name, avatar, bio, country, and car number. Ask a league
   admin to link your roster entry to your account so your race results feed your stats.
3. **Drivers** — browse every registered player; open a profile to see career stats,
   broken out per game and combined across all games (starts, wins, podiums, poles, average
   finish, titles, etc.).
4. **Schedule** — the season's race calendar. Completed races are clickable and show full
   results. Admins get **+ New Race** here; on the cross-season feed (Season set to "All
   Seasons" with a series picked) there's a **+ New Season** button too, offering every option
   League Setup does and dropping you onto the new season's empty calendar.
5. **Standings** — driver and team championship tables for the selected season, with
   points, gaps to the leader, and per-category stats. Click any column header to sort.
6. **Stats** — use the Game/Series/Season/Class menus to scope driver stats to a class, a
   season, a whole series, a whole game, or the entire league. Pick "All" at any level to
   widen the scope.
7. **Records** — the record holder in each category for the current scope, plus **Avg Drivers
   per Race**: the average field size across every completed race in scope. Empty and upcoming
   events are ignored, and a heat weekend counts its Feature field once rather than each heat.

### For league admins

Admin pages appear in the sidebar once your email is in `ADMIN_EMAILS` (see setup below).

1. **League Setup** (`/admin`) — build the hierarchy top-down:
   - **Game** — name + logo (e.g. "iRacing").
   - **Series** — name + logo under a game (e.g. "Asphalt Assault Series").
   - **Season** — name (e.g. "Season 3") under a series; set drop weeks, the points scale
     (or pick a built-in template), qualifying points, and bonus points (most laps led,
     fastest lap, etc.). **Enable Overall Championship** decides whether a multi-class season
     also crowns one champion across the whole field on top of the per-class titles.
   - **Classes** *(optional)* — split the season's field into separately-scored groups
     ("Pro"/"Amateur", "GT3"/"LMP2"). Leave it empty for an ordinary single-class season —
     nothing changes. Classes created here fill the **Class** menu in the top bar, which scopes
     Standings, Stats and Records to one class at a time. Assign drivers to a class on the
     Roster page or from the Class column in the results grid; deleting a class only unassigns
     its drivers, never their points or stats. Give a class a **Car Type** and the schedule,
     event pages and Class menu all show which car goes with which class — leave it blank to
     inherit the season's car. **Per-Class Schedules** (a season setting) lets each class run
     its own calendar — see Races below.
   - **Races** — name, track (+ track logo), round number, date, and session list (e.g.
     `Qualifying, Race` for a weekend with a scored qualifying session and a main race).
     With **Per-Class Schedules** on for the season, each race also gets a **Class** field:
     leave it on *All Classes (shared)* for a round everyone runs, or pick a class to put the
     round on that class's calendar alone. A class's Schedule and Race Entry then show its own
     rounds plus the shared ones, and a class-only round offers just that class's drivers
     (plus any unclassified) when entering results.
     **Separate Results by Class** is the other half: when several classes race the *same*
     round, it gives each class its own Qualifying and Race — its own pole, its own P1, its own
     field — instead of one combined grid. Set the default on the season and flip any single
     event on its Race Info tab. On a split event, the Schedule, Race Entry and race edit
     screens all show an **Entering results for &lt;class&gt;** menu at the top; pick the class,
     enter its grid, switch to the next.
2. **Roster & Teams** (`/roster`) — select a **Series** in the top dropdowns to manage that
   series' roster:
   - **Teams** — create teams with logos.
   - **Drivers** — add a driver, assign their team, class, car number, and (optionally) link
     them to a registered player account so their results count toward that account's profile
     stats.
   - **Import Roster** — the season-rollover shortcut. Bulk-add every driver in the series, or
     clone a specific past season's roster, in one write. Drivers already on the season's
     roster are skipped rather than duplicated (matched by global driver id, then linked
     account, then name), so it's safe to run twice or to top up a half-built roster. Team and
     class don't carry over — both are per-season records — so imported drivers land
     unassigned.
   - **Car numbers by series** — a driver can run a different number in each series they're
     part of; when editing a driver, set/update their number per series in one place.
   - With **no series selected**, the Roster shows the combined driver list across every
     series in scope (Number column is hidden, since a single number doesn't apply) —
     useful for seeing the whole league roster at a glance.
3. **Race Entry** (`/race-entry`) — pick a season, then a race, then fill in the results
   grid (one row per driver: finishing position, laps led, incidents, DNF/DNS status).
   Save — standings, stats, and every linked player's profile update immediately.
   Re-open and re-save a race any time to correct results; it overwrites cleanly.
   You can also jump straight to a race's edit screen from **Schedule** (✎ icon) — it has
   **Race Info** and **Race Results** tabs in one place, including per-session (qualifying)
   results editing.

### Typical first-time flow

`Sign in as admin → League Setup: create Game → Series → Season → Races → Roster & Teams:
add Teams and Drivers (link accounts where possible) → Race Entry: enter results after each
race → Standings/Stats update automatically.`

## Project Layout

```
frontend/
  app/
    api/            ← Next.js API routes (all writes require a Firebase ID token)
      games/ series/ seasons/ teams/ entries/ races/ results/ standings/
      stats/ roster/ users/ upload/
    page.js         ← Dashboard (per selected season)
    standings/      ← Driver + team points tables
    stats/          ← Scoped driver stats (season/series/game/league), sortable
    schedule/       ← Season calendar
    race-entry/     ← Admin: submit/edit race results
    roster/         ← Admin: roster + teams, scoped by game/series/season
    admin/          ← Admin: build games/series/seasons/races, upload logos
    drivers/        ← Player directory + public profiles (/drivers/[uid])
    races/[id]/     ← Race results view; races/[id]/edit ← admin race info + results editor
    profile/        ← Edit your own profile
    login/          ← Sign in / create account
  lib/              ← Firebase admin + client init, auth guards, standings math, shared CRUD
  components/       ← AppShell, Auth/League providers, ImageUpload, AdminGate, RaceResultsEditor
firebase/           ← Firestore + Storage security rules
backend/            ← Legacy Python backend (unused; superseded by Next.js API routes)
```

**One editor per entity, wherever it's opened.** Several things can be created from more than
one screen — a season from League Setup *or* the Schedule's **+ New Season**, a driver from the
Roster *or* inline in a results grid. Those share a form component rather than each screen
rendering its own fields (`components/SeasonForm.jsx`, `components/DriverForm.jsx`), with the
field list, defaults and API serialization in a matching pure module (`lib/seasonForm.js`). The
caller supplies only what it alone knows — the parent id, whether this is a create or an edit,
the submit button — so a quick-create dialog can never quietly offer fewer options, or write a
different document, than the full setup screen. Add a field once, in the shared form, and every
entry point gets it. Follow the same split when adding a second way to create something.

## Data model (Firestore collections)

`leagues (name, owner_id, logo_url, created_at)` is the top-level partition. Every
hierarchy/pool collection — `games`, `series`, `seasons`, `races`, `entries`, `teams`,
`results`, `drivers`, `tracks`, `points_templates` — carries a `league_id` and is read/written
scoped to the active league (sent as an `X-League-Id` header; see `lib/serverAuth.js`
`getRequestLeagueId`/`scopeByLeague`). `users` and `claim_requests` are **not** league-scoped —
accounts and their roles span leagues.

`games (league_id)` → `series (game_id)` → `seasons (series_id, game_id, drop_weeks, points_scale,
combined_championship)` → `races (season_id, sessions[])`, `classes (season_id, name, sort_order)`
and `entries (season_id, team_id, class_id, user_id, number)` / `teams (season_id)` →
`results (race_id, season_id, entry_id, class_id)`. `users` holds player profiles; linking a
roster entry to a user account is what feeds their public career stats.

**Classes** are the optional fourth tier. A class belongs to one season; a roster entry points at
one via `class_id`, and each saved result records the class the driver ran in *at the time*, so
re-classing a driver mid-season never rewrites the class championships they already scored in. The
stats engine resolves a result's class as "the class stamped on the result, else the driver's
current entry class" — which is also why results saved before a season had classes still fall into
the right class once drivers are assigned. Passing `class_id` to `/api/standings` or `/api/stats`
re-scores the whole table over just that class (its own points, ranks, gaps and averages) rather
than filtering rows out of the combined table.

**Per-class schedules.** By default every class shares one season calendar. Turning on a season's
**Per-Class Schedules** lets a race be pinned to a single class via `races.class_id`; a race left
unpinned stays *shared* by every class, so a season can mix a common opener with class-specific
rounds. A class's calendar is therefore "its own rounds plus every shared round" (`raceInClass` in
`lib/classFilter.js`), which is what Schedule, Race Entry and the race-count/field-size metrics all
filter on. Results are always scoped by the *driver's* class, independent of which calendar the race
sits on, so a shared race still splits cleanly into each class's championship. Turning the toggle
back off deletes nothing — pinned races simply show for everyone again.

**Per-class results (separate sessions at a shared event).** Per-class *schedules* answer "which
class's calendar is this round on"; per-class *results* answer the different question of how a round
that several classes run together is scored. With **Separate Results by Class** off (the default),
one combined grid holds the whole field and a Class column tags each row — there is a single outright
P1. Turn it on and each class enters its **own** Qualifying and Race at that event: its own pole, its
own P1, its own field, numbered 1..N within the class. The setting lives on the season (the default
for new events) and on each event's Race Info tab (`races.per_class_results`, unset = inherit the
season), resolved by `racePerClassResults` in `lib/classFilter.js`. A round already pinned to one
class is single-class, so it never splits.

Storage doesn't change shape: results have always carried the class the driver ran in, so a session
is identified by `(session_type, session, class)`. What changes is the *scope* of a write. The
results editor sends `session_class` — a class id, or `__none` for the unclassified group — with
each save and delete, and the server replaces only that class's slice of the session, leaving the
other classes that raced the same round untouched (`matchesSession` in `app/api/results/route.js`).
Inside a scoped grid the roster picker, the loaded rows, the qualifying-to-start mapping and any
driver created inline are all that class's; the per-row Class dropdown disappears, because every row
in that grid is the class named in the bar above it.

Everything downstream follows the same scope. Schedule rows summarised for a class show that class's
pole, winner and field size (`summarizeRace(..., classId)`); the event page groups each session's
table by class; and Skill Rating exchanges are keyed by class on a split event, so a Pro driver is
never rated against an Amateur car they never shared a grid with. Since a split event has no single
outright order, an overall championship across classes just adds their points together — turn
**Enable Overall Championship** off for a pure class-championship season.

**Which car goes with which class.** The car on track is a three-level fallback, most specific
first: `races.car` (this one event runs something different) → `classes.car` (this class's machinery
all season) → `seasons.car` (the season default, and the only level that existed before). All three
are free text and any may be blank, so a single-class season is unchanged. `carForRace` in
`lib/classFilter.js` is the one place that order lives.

Because a shared round can put two classes in different cars, "the car" isn't always a single value.
`soleCarForRace` returns one only when it's honest — no classes, a round pinned to one class, classes
that happen to agree, or a race-level override that collapses the split — and null otherwise;
`carsByClassForRace` returns the per-class breakdown for exactly that null case. The Schedule's Car
column shows one car normally and a class-by-class list at "All Classes" when they differ, the event
header does the same, the top-bar Class menu reads "Pro · GT3", and a track's winners list credits
each win to the *winner's* class car rather than the season default.

**Race dates are calendar dates, not timestamps.** A race `date` is stored as a bare `YYYY-MM-DD`
string with no time component, and every display/comparison goes through `lib/raceDate.js`. Handing
that string to `new Date()` parses it as *UTC midnight*, which renders a day early in any western
timezone (July 20 showing as July 19) — so the helpers parse to local midnight and compare dates as
strings instead. There are no time-of-day inputs in the scheduler; the date an admin picks is the
date everyone sees, in every timezone.

**Track types** come from the shared list in `lib/trackTypes.js`, which drives the creation/edit
forms, the Tracks directory's type filter, and its section grouping. Dirt racing is split by surface
into `Dirt Oval` and `Dirt Road Course`. A track saved with a value outside the list still displays
and stays selectable while editing, so nothing has to be in the list to survive.

**Containment migration:** existing data created before the multi-league layer is safely
partitioned by an Owner-only, idempotent, additive-only backfill (`POST /api/admin/leagues/migrate`,
surfaced as a button in **League Setup → League Settings**). It creates the first default league
and stamps `league_id` onto every existing record that lacks one — never deleting or overwriting
anything, and safe to re-run.

A driver's car `number` lives on their per-season `entry`, so it's naturally scoped to a
series (every season belongs to exactly one series) — a driver can carry a different number
in each series they race in. Drivers are unified across seasons/series for stats and roster
aggregation by `user_id` when linked, otherwise by roster name.

Everything runs through the server API — clients never talk to Firestore directly (see
`firebase/firestore.rules` and `firebase/storage.rules`).
