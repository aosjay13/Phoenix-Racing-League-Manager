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
menu lists "All Classes" (the combined, whole-field view) followed by the classes raced in the
current scope — not just inside one season, so a class stays selectable (and answerable) series- or
game-wide. A season that doesn't run classes simply stays on "All Classes".

## Features

- 🔐 **Login for everyone** — email/password or Google sign-in (Firebase Auth)
- 🧑‍✈️ **Player profiles** — public profile pages with editable picture, bio, country; career
  stats auto-aggregated across all games with a per-game breakdown
- 🏆 **Live standings** — driver *and* team championships with a configurable points scale,
  bonus points, drop weeks per season, and a full tie-breaker chain (wins → podiums → top 5s →
  top 10s → average finish → poles → average start → best laps → laps led)
- 🎽 **Multi-class championships** — split a season into classes (Pro/Amateur, GT3/LMP2); each
  scores its own isolated championship, with an optional combined overall title across the field,
  optionally its own race calendar, and optionally its own qualifying and race at events every
  class runs together — each class with its own pole, winner and field
- 💥 **Demo Derby / Banger Racing mode** — flag a **series, a single season, or one class** as banger racing and its events capture
  **Takedowns**, a **Survival Bonus** (survived the longest) and a **Most Lethal Bonus** (most
  takedowns) on every results row, each worth whatever the points structure pays — points *per*
  takedown, plus a one-off value for each bonus. The stats show on that series' Standings and Stats
  only: never in the Overall or per-Game views, where a takedown count means nothing. Flag a class
  and a season can run a Banger class alongside its ordinary racing ones — only that class's grid,
  points and championship carry the derby stats
- 🏆 **Bracket Style Racing (drag racing / tournament brackets)** — flag a **series** or a single
  **class** and its events are entered as an elimination ladder instead of a 1..N finishing order.
  Pick the bracket size per race — **4**, **8**, **16** or **32** drivers — and the results grid lays
  itself out from it, so everyone knocked out in the same round shares a finishing position: one
  winner, one runner-up, **two** 3rd places (the semi-finals), **four** 4ths (the quarters), and so
  on. Unlike Demo Derby these are ordinary racing finishes — a bracket 3rd is a straight **3** in
  Average Finish, both 3rd-place drivers are paid identical points, and it all cascades into Wins,
  Podiums, Top 5s and the Overall and per-Game stats like any other result
- 🚗 **Car selection & lock-in** — flag a **series, a season, or one class** as requiring a car
  selection and publish the list of cars on offer. Every driver on that roster gets a **Series
  Information** section on their Dashboard where they pick their car from a dropdown and lock it
  in, see the instructions the admin left, and see the whole roster's picks side by side so
  nobody has to ask who's running what. Players can also **sign themselves up** for any season
  that's upcoming or under way (completed seasons are closed to both), claiming their driver
  profile — or adding themselves as a new driver — as part of the flow. Admins can freeze every
  pick with one **Lock the selections** switch when the entry list is final
- 🖼 **Social graphic exporter** — on Standings, Stats, Race Results, Skill Ratings, Records and the
  Schedule (a season's calendar, or the cross-season Upcoming / Recent Results feeds). League name
  + logo branding, a
  multi-select of *every* stat column the screen offers (with Select all / Clear / Reset), and full
  event metadata on results exports, so the downloaded PNG/JPG stands alone as a broadcast-style
  graphic
- ⬆ **Bulk roster import** — roll a whole roster into a new season in one click, from the series
  or a cloned past season, with duplicates skipped automatically
- ⏱ **Fast race entry** — one grid per race, pre-filled with the roster; supports multiple
  sessions per race (e.g. Qualifying + Race), scored independently; re-submitting a race
  overwrites cleanly for corrections
- 📊 **Stats & Roster filtering** — Game/Series/Season dropdowns filter Stats and Roster
  everywhere, with sortable columns and per-series car numbers
- 🖼 **Custom branding** — upload game, series, season, team, and track logos
- 👑 **Admin roles** — set `ADMIN_EMAILS`; admins get results entry from the Schedule, the
  Roster & Teams and User Accounts tabs on Drivers, and League Setup
- 💾 **Backup & restore** — the Owner can export the *entire* application to one JSON file and
  import it back after a crash, a corruption or a hack, with every record keeping its original ID
  so all the links survive; plus an automatic backup every Saturday at 3 AM Eastern, filed into the
  repo, a workflow artifact and (optionally) Google Drive

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
4. **Series Information** — a section on your **Dashboard** (not the sidebar) that appears only
   when there's something for you to do **in the series you're currently viewing**: a running
   season that wants you to lock in a car, or a season open to sign up for. It follows the
   Game/Series menus at the top of the page like everything else, and lists **active seasons
   only** — finished ones aren't shown there. Click through and you get:
   - **Linking your driver.** Sign-ups and car choices are recorded against a *driver*, not an
     account, so you need to point yours at one. If you've raced here before, find yourself in
     the list and hit **That's me**. If you're new, ask to be added. **Either way an admin
     approves it** — a driver profile is never created or linked automatically. Brand new
     players don't have to do this first: signing up for a series asks for the same details and
     files the same request, with the season attached.
   - **Signing up.** Every season still upcoming or under way that you're not on yet. Seasons
     marked complete never appear — and can't be joined. Each card carries that season's
     **series roster** — who's racing under which number, listed in car-number order — so you can
     see what's free before you start.

     **Sign Up** opens a form covering everything the league needs to put you on a roster: the
     name you race under, your class, your car number, and your **Aliases / Connected Accounts**
     — the platform usernames (Discord, PSN, Xbox, Steam, iRacing…) the Smart Importer matches
     results against, so a result posted under any of them lands on your profile. Type a number
     somebody already has and it's rejected as you type, with *"That number is already taken,
     please choose another number."*

     Some games ask for more. **An iRacing season won't take a sign-up without your iRacing ID#**,
     because iRacing leagues are invite-only and the organiser can't send you an invite without
     your customer ID — the field is marked required and the form won't submit until it's filled.

     If the league already knows you, the form puts you straight on the roster. If you're not in
     the driver list yet, **nothing is created**: the whole form is filed as a request, and an
     admin approving it creates your driver profile *and* your roster entry in one click. The
     form says so before you send it.
   - **When a season ends.** The moment an admin marks it complete, it closes to players: nobody
     else can sign up and nobody can change the car they locked in. It drops off the Dashboard
     section, which is about what's still to do — but it stays on this page, marked **Season over
     — sign-ups are done** with your car still on record, and its own screen says the same.
     Reopening the season undoes all of it.
   - **The series roster.** Every season's own screen shows its roster — number, driver, class
     and locked-in car — to anyone who opens it, admin or not. It's ordered by car number rather
     than alphabetically, because "who has 24?" and "which numbers are free?" are what it's read
     to answer.
   - **Locking in your car.** Pick from the cars the admin listed and hit **Lock in Car**. You
     can change your mind as often as you like until an admin locks the selections. Under it,
     the full roster shows exactly which car everyone else has taken, with a tally of how
     popular each one is.
5. **Schedule** — the season's race calendar. Completed races are clickable and show full
   results. Admins get **+ New Race** here; on the cross-season feed (Season set to "All
   Seasons" with a series picked) there's a **+ New Season** button too, offering every option
   League Setup does and dropping you onto the new season's empty calendar. **🖼 Share Graphic**
   exports the calendar as an image — the whole season's rounds, or (on the cross-season feed)
   Upcoming and Recent Results as separate posts.
6. **Standings** — driver and team championship tables for the selected season, with
   points, gaps to the leader, and per-category stats. Click any column header to sort. Level
   on points? The tie-breaker chain below decides, and every step of it is a column in the
   table so you can see why.
7. **Stats** — use the Game/Series/Season/Class menus to scope driver stats to a class, a
   season, a whole series, a whole game, or the entire league. Pick "All" at any level to
   widen the scope.
8. **Tracks** — open a venue for its own page: every race held there, a leaderboard of who has
   gone best, and its lap records. The **Class** menu scopes it too — the leaderboard, winners
   and headline record become that class's — while the per-game and per-class record breakdowns
   always stay side by side, since that's the comparison they exist to show.
9. **Records** — the record holder in each category for the current scope, plus **Avg Drivers
   per Race**: the average field size across every completed race in scope. Empty and upcoming
   events are ignored, and a heat weekend counts its Feature field once rather than each heat.
   **🖼 Share Graphic** posts the record book as one image — a row per category that has a holder
   (ties list everyone), with the average field size carried in the header as context. It follows
   the Drivers / Teams tab you're on. **Skill Ratings** exports the same way, medalling the top
   three like the standings do.

### Sharing a direct link

Every page is its own link. The Game/Series/Season/Class you're viewing is written into the
address bar as you pick it, so the URL always describes what's on screen — and **🔗 Copy link**
in the top bar copies it. Whoever opens it lands on exactly that view instead of on their own
last selection with your menu path to retrace:

| Link | Opens on |
| --- | --- |
| `/standings?league=…&game=…&series=…&season=…&class=GT3` | that season's GT3 championship |
| `/standings?…&tab=teams` | the team standings rather than drivers |
| `/races/<race-id>?session=Race+2` | that race weekend's Race 2 results |
| `/races/<race-id>?session=Qualifying` | its qualifying results |
| `/stats?…&season=all` | driver stats across every season of the series |

The rules are the same everywhere: `season=all` (or `game=all`, `class=all`) is an explicit
"All …", which is why a link to the all-time table stays on the all-time table. Anything the
link leaves out falls back to the reader's own saved selection, so an old bare link like
`/standings` behaves exactly as it always has. Driver, team and track pages
(`/drivers/<id>`, `/teams/<name>`, `/tracks/<id>`) were already direct links and are unchanged.

### For league admins

Admin pages appear in the sidebar once your email is in `ADMIN_EMAILS` (see setup below).

1. **League Setup** (`/admin`) — build the hierarchy top-down:
   - **Game** — name + logo (e.g. "iRacing").
   - **Series** — name + logo under a game (e.g. "Asphalt Assault Series").
   - **Season** — name (e.g. "Season 3") under a series; set drop weeks, the points scale
     (or pick a built-in template), qualifying points, and bonus points (most laps led,
     fastest lap, etc.). There is no separate pole bonus — pole is position 1 of the qualifying
     points list, so a pole is worth whatever the first number in that list says. **Enable Overall Championship** decides whether a multi-class season
     also crowns one champion across the whole field on top of the per-class titles.
   - **Classes** *(optional)* — split the season's field into separately-scored groups
     ("Pro"/"Amateur", "GT3"/"LMP2"). Leave it empty for an ordinary single-class season —
     nothing changes. Classes created here fill the **Class** menu in the top bar, which scopes
     Standings, Stats and Records to one class at a time. Assign drivers to a class on the
     Drivers ▸ Roster & Teams tab or from the Class column in the results grid; deleting a class
     only unassigns
     its drivers, never their points or stats. Give a class a **Car Type** and the schedule,
     event pages and Class menu all show which car goes with which class — leave it blank to
     inherit the season's car. Tick **This class scores on its own points structure** and the
     class gets its own scale, qualifying points and bonuses — the same editor the season uses,
     templates included — so Pro and Amateur can pay different points for the same finishing
     position. It starts seeded from the season's current points, and every screen follows it:
     switch class in the results grid and the Points column re-scores on that class's structure
     automatically. Leave it unticked (the default) and the class scores on the season's points
     exactly as before. **Per-Class Schedules** (a season setting) lets each class run its own
     calendar — see Races below.
   - **Races** — name, track (+ track logo), round number, date, and session list (e.g.
     `Qualifying, Race` for a weekend with a scored qualifying session and a main race).
     With **Per-Class Schedules** on for the season, each race also gets a **Class** field:
     leave it on *All Classes (shared)* for a round everyone runs, or pick a class to put the
     round on that class's calendar alone. A class's Schedule then shows its own
     rounds plus the shared ones, and a class-only round offers just that class's drivers
     (plus any unclassified) when entering results.
     **Separate Results by Class** is the other half: when several classes race the *same*
     round, it gives each class its own Qualifying and Race — its own pole, its own P1, its own
     field — instead of one combined grid. Set the default on the season and flip any single
     event on its Race Info tab. On a split event, the race edit
     screen shows an **Entering results for &lt;class&gt;** menu at the top; pick the class,
     enter its grid, switch to the next. The **Points system** picker next to the grid is that
     class's too on a split event — Pro's Race and Amateur's Race at the same event can score on
     different templates, and switching class swaps the picker with it.
   - **Require Car Selection / Lock-in** — offered identically on **Series**, **Seasons** and
     **Classes**, since a league might run one car list across a whole series or a different one
     per class. Tick it, list the **Available Cars** one per line, and every driver on that
     roster is asked to lock in their car from the **Series Information** section of their
     Dashboard. **Instructions for Drivers** ("Please lock in your car for the upcoming
     season") shows above their dropdown. **Lock the selections** freezes every pick when the
     entry list is final — untick it to reopen.

     It inherits like everything else here: the requirement is on if *any* level at or above
     turns it on, and the **most specific car list wins** — a class's list beats the season's,
     which beats the series'. So the common setup is one list on the series; a class that runs
     different machinery adds its own and its drivers pick from that instead. A driver is only
     ever asked once: their class's question if it has one, otherwise the season's. Picks are
     stored on the driver's roster entry (`entries.selected_car`), so an admin can correct one
     from the roster like any other entry field.
2. **Drivers** (`/drivers`) — everyone in the league, under one menu. The buttons at the top
   switch between its three views, so nothing is stacked into one long scroll:
   - **Drivers** — the public directory of every driver profile (admins get Edit / Merge /
     Delete and **Sync names**; players can claim their own profile).
     - **Display Names** — what a driver is *shown* as, set per context in the Edit dialog.
       The **overall display name** covers the directory, their profile, and All Games stats
       and records; leave it blank to keep using their linked account's name (or the pool
       name). Under it, add a **name per game** — pick the game, type the name — and that name
       takes over everywhere inside that game: its standings, race results, stats, records,
       skill ratings, roster and share graphics, with the overall name shown quietly beneath.
       So Ryan Maynard can be "Ryanbirdman" throughout BeamNG and "Ryan Maynard" everywhere
       else. Game names are matched by the Smart Importer too, so a BeamNG export listing
       "Ryanbirdman" still resolves to the right profile.
     - **Aliases / Connected Accounts** — the platform usernames a driver races under
       (Discord, PSN, Xbox, Steam, iRacing…), used by the Smart Importer to map imported
       names back to one profile. An alias mapped to a game still acts as that game's display
       name when no per-game Display Name is set, so nothing set up before this existed
       changes.
   - **User Accounts** *(admin)* — every account that has signed up: set its **role**, link it to
     the driver profile it races as, rename it, delete it, and approve or deny **pending driver
     requests**. The red badge on the Drivers nav item counts new signups + pending requests.

     Two kinds land in that queue, and this screen is the **only** place either is ever applied —
     a player-requested driver profile is never created automatically. *Claims* ("that existing
     driver is me") write the account↔driver link, and approving one auto-denies any other
     request for the same profile. *New driver* requests come from players the league has never
     seen; the row shows the name they asked for, the platform usernames they submitted, and the
     series they want to join, and approving it creates the profile **and** the roster entry in
     one click. If a driver of that name already exists the row warns you, so you can deny it and
     have them claim that profile instead — or approve and merge the two afterwards.
     The roster is listed from Firebase Auth, so a signup appears here immediately, with a
     **Status** pill saying where it stands — *Unverified* (hasn't clicked the emailed link yet)
     or *Not opened yet* (verified, but hasn't returned to the app since, so its profile document
     doesn't exist yet). Roles and driver links can be set on either; they're kept and applied
     when the player next signs in.
   - **Roster & Teams** *(admin)* — select a **Series** in the top dropdowns to manage that
     series' roster:
     - **Teams** — create teams with logos.
     - **Roster** — add a driver, assign their team, classes, car number, and (optionally) link
       them to a registered player account so their results count toward that account's profile
       stats.
     - **Drivers in several classes** — the Classes picker is a set of tick boxes, so one driver
       can race Pro *and* Am (or GT3 *and* LMP2) from a **single roster entry**. They appear in
       each of those class championships, in each class's grid when an event splits its results
       by class, and the roster's Class column lists every class they're in. Ticking nothing
       leaves them Unclassified. The first class ticked is their *primary* one — what a
       single-class field falls back to (a standings row's Class column, or a result saved
       without a class in a combined session, where the grid's own Class cell can still override
       it per row).
       Adding someone who's already on the roster never creates a second entry: their existing
       entry simply gains the classes you picked. Same when you add a driver mid-results from
       another class's grid — they join that class rather than being duplicated.
       If you already worked around this by adding a driver once per class, the roster shows a
       **Combine** button on that row: it folds those entries into one multi-class entry and
       moves every saved result across, each keeping the class it was scored in.
     - **Driver Pool** — create driver identities without assigning them to a season or series
       yet, ready to pull into any series (or into a race, mid-entry) later.
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
3. **Results entry** — everything about an event is managed from **Schedule**. Each row's
   **⏱** button opens that event's results grid and **✎** its details; both land on the same
   race edit screen, which carries **Race Info**, **Qualifying** and **Race Results** tabs
   (Heats / Consolation / Feature on a heat-racing event). Fill in the grid (one row per
   driver: finishing position, laps led, incidents, DNF/DNS status) and save — standings,
   stats, and every linked player's profile update immediately. Re-open and re-save a race
   any time to correct results; it overwrites cleanly.
   The **Status** column decides how a row is counted. **DNS** ("did not start") is not
   scored at all — no position points, no qualifying points, no bonuses — and counts toward
   no stat: not a start, not a finish to average, not a pole or grid slot, not a DNF. The
   driver stays on the grid as a record that they were entered. **DNF** and **DQ** are both
   scored on their classified finishing position, and both add one to the driver's **DNFs**
   total.
   On a race grid, three of the checkboxes fill themselves in from what you've already
   typed, so you don't have to work them out by eye: **FL** goes to the quickest Best Lap
   time (a single lap time entered is, trivially, the fastest one), **HC** to the biggest
   gain from Start to Fin — a tie going to whoever finished highest — and **MLL** to
   the highest Led count, shared on a tie. Tick or untick any of them yourself and that one
   stops moving; your choice is saved as-is. They're recorded as stats either way, and only
   affect points if the season (or that session's points structure) pays a bonus for them.
   Qualifying grids have none of these columns.
   A **Qualifying** grid instead carries **Qual Time**, **To Lead** and **Gap**, and the three
   fill each other in — enter whichever your timing screen gives you. Type lap times and both
   gap columns appear (To Lead is the gap to pole; Gap is to the car one position up); type a
   gap instead — `+0.312` — and the lap time is worked out from the pole time (To Lead) or from
   the car above (Gap), so a sheet that only publishes gaps can be typed straight in. Enter the
   gaps first and they fill in the moment the pole time lands. Pole is the reference, so its own
   two cells stay blank. Only the lap times are stored: the gaps are recalculated from them on
   every load, which is what keeps them right after a reorder or a correction.
   The **event page** shows the same gaps on its results tables — **To Lead** and **Gap** on
   qualifying, and a **Gap** column beside **Int** on a race — and because they're worked out from
   the times on the results themselves, every session already in the database has them without being
   re-entered. A race row with no elapsed time falls back to reconstructing one from the winner's
   time plus its stored interval; a lapped car or a DNF has no comparable time and reads as a dash.
   All of these columns are offered in the Share Graphic exporter too.

### Typical first-time flow

`Sign in as admin → League Setup: create Game → Series → Season → Races → Drivers ▸ Roster &
Teams: add Teams and Drivers (link accounts where possible) → Schedule: ⏱ on an event to enter
results after each race → Standings/Stats update automatically.`

## Project Layout

```
frontend/
  app/
    api/            ← Next.js API routes (all writes require a Firebase ID token)
      games/ series/ seasons/ teams/ entries/ races/ results/ standings/
      stats/ roster/ users/ upload/ car-selection/
    page.js         ← Dashboard (per selected season)
    standings/      ← Driver + team points tables
    stats/          ← Scoped driver stats (season/series/game/league), sortable
    schedule/       ← Season calendar (admin: ⏱ enter results, ✎ edit event, 🗑 delete)
    admin/          ← Admin: League Setup — build games/series/seasons/races, upload logos
    drivers/        ← Driver directory + public profiles (/drivers/[uid]), plus the admin
                      Roster & Teams and User Accounts tabs (?tab=roster / ?tab=accounts)
    races/[id]/     ← Race results view; races/[id]/edit ← admin race info + results editor
    series-info/    ← A player's series: driver linking, series sign-up, and
                      series-info/[seasonId] ← that season's car lock-in + who's racing what
    profile/        ← Edit your own profile
    login/          ← Sign in / create account
  lib/              ← Firebase admin + client init, auth guards, standings math, shared CRUD
  components/       ← AppShell, Auth/League providers, ImageUpload, AdminGate, SessionEditor,
                      RosterManager + UserAccountsManager (the Drivers page's admin tabs)
firebase/           ← Firestore + Storage security rules
backend/            ← Legacy Python backend (unused; superseded by Next.js API routes)
scripts/            ← Ops scripts: fetch-backup.mjs, upload-to-drive.mjs (see Backups below)
backups/            ← Weekly automatic backup JSON files, committed by the scheduled workflow
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
accounts and their roles span leagues. That partition map lives once, in `lib/backup.js`
(`SCOPED_COLLECTIONS` / `GLOBAL_COLLECTIONS`), and is imported by both the containment migration
and the backup engine, so adding a collection can't leave one of them behind.

Two collections are internal bookkeeping and are excluded from backups: `backup_log` (the
export/restore history shown on the Backup & Restore screen — restoring an old copy of it would
erase the record of every backup taken since) and `restore_uploads` (transient staging for a
chunked import, deleted as soon as the import finishes).

A driver's classes are listed, everywhere they appear, in the **season's own class order**
(`sort_order`, then name — the order the Class menu shows), rather than the order an admin happened
to tick them in. That order is also what resolves a result that records no class of its own: it counts toward the
driver's **primary** class — the first of theirs in that order — so one result is always in exactly
one championship, never in two at once. A result that *does* record its class (every result the grid
saves) counts only there, and the results grid can stamp a whole session's rows with one class in a
single step, which is what pins them for good.

Because a result with no class scores on the **season's** points rather than the class's, the grid
fills a blank Class cell with the class the rest of its rows are in — a driver whose roster entry
carries no class (one created inline while entering results, say) would otherwise be the single row
in a race paid a different rate per takedown than everyone around them. The filled-in class shows in
the Class column before anything is saved, and any row still without one is called out above the grid.

### Where a driver's car is configured

A car lock-in is stored on the driver's **roster entry** — the only document that already means
"this driver, in this season": `entries.selected_car` for a season-wide pick, and
`entries.selected_cars` (`{ class_id: car }`) for the classes that publish their own car list.
`selected_car` mirrors the most recent pick whichever slot it came from, exactly as
`entries.class_id` mirrors `class_ids[0]`, so anything reading a single field still resolves.

The settings behind it (`require_car_selection`, `car_options`, `car_selection_note`,
`car_selection_locked`) sit on `series`, `seasons` *and* `classes` and resolve down the same
chain the points structure uses — the rules live once in `lib/carSelection.js` and are shared by
the API routes and the screens. Players write their own pick through `POST /api/car-selection`,
which resolves the entry from the driver profile linked to the **caller's** account rather than
from anything in the request, so there is no way to name someone else's row. It also refuses a
car that isn't on the list, a locked selection, and any season marked completed.

### Who may create a driver profile

Only an admin. There is no player-facing route that writes a `drivers` document: asking for one
files a pending row in `claim_requests` (`POST /api/claim-requests`, kinds `claim` and
`new_driver`), and `PATCH /api/admin/claim-requests/[id]` — admin-gated — is the single place any
of it is applied. A player may edit exactly one field of their own profile once it exists, its
**aliases** (`PATCH /api/users/me/driver`), because keeping their platform usernames current is
their own job; name, display names and notes stay admin-only, since those decide how the whole
league sees them.

A `new_driver` request carries the season the player wanted to join, so approving it creates the
profile *and* the roster entry together. Those two steps are independent on purpose: if the season
has been marked complete, or their car number was taken while the request sat in the queue, the
profile is still created and the admin is told what didn't carry over — a stale detail never costs
them the whole approval.

**Per-game required information.** A game can insist on an alias before it will take a sign-up.
Today that's iRacing, which is invite-only at the league level: without the driver's **iRacing ID#**
the organiser can't send them an invite, so the sign-up form marks it required and refuses to
submit, and the API repeats the check. Which game that is comes from the game's *name*
(`isIracingGame` in `lib/signupRequest.js`) rather than a flag on the game document, so it works
with no extra setup for a game called "iRacing", "i-Racing" or "iRacing Oval Series".

### Car numbers on a self-service sign-up

Two drivers can't run the same number in one season. The sign-up form checks it **as you type**,
against the season roster it already holds, and `POST /api/users/me/series` checks it again before
writing — two people can have the form open at the same moment, and the first to submit takes the
number. A blank number is always allowed.

Numbers are compared as **text**, never as parsed integers, which is the same reason they're stored
as strings (`entries.number`, max 3 chars): a league that runs both a **1** and an **01** has two
different numbers, and neither blocks the other. Ordering is by value though — `compareCarNumbers`
in `lib/carSelection.js` puts 2 before 10 rather than after it, keeps `01` beside `1`, and drops
drivers with no number to the end. Every roster a player reads is sorted through it.

### Where points are configured

    series (the league default) → season → class → the session's points template

Each level overrides only what it actually sets, so a league configures its points **once** on the
series and adjusts a season or a class only where they genuinely differ. A series that sets nothing
changes nothing: the season stays the top of the chain and its blank scale still means "score 0",
exactly as before series points existed. The moment a series *does* define a structure, a season
becomes an override layer like a class — a scale it leaves blank falls through to the series rather
than zeroing the field.

A class's points structure is an **override layer**, so a scale it leaves blank falls through to the
season rather than scoring 0 (a season's blank does save as an explicit zero — there is nothing above
it to inherit). This is what stops a class ticked purely to carry a takedown rate from wiping its
drivers' finishing points, and an all-zero scale on an existing class doc is read as "inherit" for the
same reason.

**Visibility is strict, and nothing is inferred from what a scope contains.** The derby stats appear
only where the scope being *viewed* is itself labelled Demo Derby / Banger Racing — the class you
picked, the season, or the series it sits in. So a racing series with a Banger class inside it shows
no derby columns on the series' standings, none on its seasons' combined standings, and none on its
other classes: only that class's own championship carries them. The league-wide Overall and any Game
view never do, at all. A labelled series or season covers the levels beneath it, since that is what
labelling the higher level means.

The results grid follows exactly the same rule: Qualifying and Race show the derby columns, the derby
explainer and the rate bar only when the thing being entered is itself labelled — the class on a
split event, or the season/series on a shared one. An ordinary season that merely *contains* a Banger
class keeps plain grids with no derby text on them; that class records its takedowns on its own
class-scoped grid, which is what per-class results are for. Configuration is the one place that stays
wider: the points editors offer the derby rates wherever derby results will be scored, including the
season above a lone Banger class, which would otherwise have nowhere but itself to set a rate.
Storing a stat is not the same as putting a column on a table.

**Demo Derby / Banger Racing** is one boolean, settable at three levels: `series.isBangerRacing`,
`seasons.isBangerRacing` and `classes.isBangerRacing`. They add up rather than override — derby is
on for anything at or under a flagged level, so a flagged series covers all its seasons and classes,
a flagged season covers its classes (a one-off derby year in an ordinary series), and a flagged
class covers itself alone (a Banger class racing alongside ordinary ones). `isBangerScope()` in
`lib/bangerRacing.js` is the single resolver every guard calls, on the results grid as much as on the
tables; what a scope *contains* never makes it a derby. With it on,
every results row of that series' events also stores `takedowns` (a count), `survival_bonus` and
`most_lethal` (flags), and every points structure — season, class or points template — can pay a
`takedown` rate plus a `survival_bonus` / `most_lethal` value through its `bonus_points` map. Those
bonuses live in *every* structure and default to 0, so an ordinary series scores exactly as it did
before — and because every structure stores them whether or not its editor showed them, a derby
bonus of 0 in an override layer **inherits** the level above rather than cancelling it (a season
paying 2 a takedown would otherwise be silently zeroed the moment its Race session used a saved
template, or a class scored on its own points). Setting a session to **No Points** is the one
structure whose zeros are taken literally, derby included. A derby *class* can also carry just the
derby rates without overriding the season's race scale.

Because a rate set at the wrong level is indistinguishable from a broken feature, the results grid
carries the rate itself: a **Derby points** bar above the grid states what this session pays for each
derby stat — or warns, in gold, that nothing is set and the Points column will not move — and lets an
admin set it inline. It always writes to the **season**, deliberately: a rate on a class only reaches
results stamped with that class, so a class-scoped grid whose rows are left unclassified records
takedowns that a class-level rate pays nothing for. A season rate applies however the results are
classed and can't
leak into ordinary racing, since it is only ever multiplied by stats an ordinary result doesn't have.
Saved results re-score the moment it lands, so nothing needs re-entering.

Standings audits this for itself: it reports how many derby stats are on the board for the scope and
how many points they actually awarded (from the same scorer the totals come from), and says so when
stats are recorded but nothing scored — naming the class, when a class pays but the results aren't
recorded in it. An empty class championship explains itself the same way, rather than reading as
"no results yet" — and, for the usual cause (drivers who were never put in the class), offers a
one-click **Add the N unclassified drivers to <class>** action. Their existing results come with them,
since a result carrying no class of its own scores in its driver's roster class, so the championship
fills in with the season's history rather than starting from the next race.

The derby fields are likewise stored on every result (as zeros/falses), so the stats engine never
has to ask what kind of series a result came from. What the flag actually gates is **visibility**:
the results grid only grows the extra columns, the points editors only offer the extra values, and
Standings/Stats only render the aggregated totals, while the viewer is scoped to a banger series,
season or class — the resolver is forced to `false` above series level, which is why the Overall and
per-Game stats views can never show them. Every part of it (the grid
column, the stored field, the bonus value, the scoring, the aggregated stat and the standings
column) is generated from one list in `lib/bangerRacing.js`, so another derby bonus is one entry in
that list and nothing else.

**Bracket Style Racing** is the other non-standard format, and it is deliberately the *opposite*
kind of feature to Demo Derby: it adds no stats, no bonuses and no columns. It changes exactly one
thing — how a field is shaped into finishing positions.

A bracket is an elimination tournament, so drivers knocked out in the same round finished level with
each other; there is no way to separate the two semi-final losers, because they never raced. An
8-driver bracket therefore has four finishing positions, not eight:

| Position | Round | Drivers |
| --- | --- | --- |
| 1st | Winner | 1 |
| 2nd | Runner-up (lost the final) | 1 |
| 3rd | Semi-final losers | 2 |
| 4th | Quarter-final losers | 4 |

The flag is `series.isBracketRacing` and `classes.isBracketRacing`, resolved by `isBracketScope()` in
`lib/bracketRacing.js` with the same "at or under a flagged level" rule the derby flag uses: a
flagged series covers every season and class in it, and a flagged class covers itself alone — which
is how a season runs a drag-racing class alongside its ordinary racing ones.

`isBracketScope()` is the **only** rule, on the results grid and the event page alike, and what a
scope *contains* never counts. Every session that isn't itself flagged runs a strict linear 1, 2, 3,
4… order, pays the ordinary points drop-off, and still refuses to save two drivers in the same
position. That strictness is the point: a wider "anything in the field races brackets" rule turns
every shared grid in a season into an elimination ladder the moment one class is flagged, regrouping
ordinary finishes into tied positions and dropping the duplicate-position guard. A bracket class
inside an ordinary season enters its ladder on its own class-scoped grid — that is what per-class
results are for.

Two things have to be true before a grid becomes a ladder, and the second is the decisive one: the
scope must be flagged (which only decides whether the **Race Format** dropdown is offered above the
grid), *and* a ladder size must have been chosen for that specific race. Standard racing is that
dropdown's first option and its default, so a bracket-racing league can still run an ordinary
feature, and any race that became a bracket can be handed straight back to a 1..N order. Nothing is
inferred — not from the field size, not from the series flag — so no race can silently turn into a
ladder.

The ladder size lives on the **race** (`races.bracket_size`), not the season, because a league can
run an 8-car bracket one week and a 16 the next. The dropdown above the results grid saves it
immediately and the grid re-lays itself out from it — an 8 becoming a 16 turns the four 4th places
into eight 5ths without anything being re-typed — and the round legend above the grid names every
position, so an admin typing four 4th places can see that four 4th places is the correct shape rather
than finding out on Save. Qualifying is *not* part of the ladder: in drag racing it is the timed
session that seeds it, so its positions stay unique and Poles / Average Start mean what they always
meant.

**The stats engine needed no bracket-specific code**, and that is the point. Every consumer already
works one result at a time off `finish_pos`: Average Finish sums a driver's own positions over their
own starts, so a semi-final loser contributes a pure `3` — not a 3.5, and not a re-ranked 4; points
are looked up as `racePoints[finish_pos]`, so both 3rd-place drivers are paid the identical P3 value;
Wins / Podiums / Top N are per-result comparisons; and Skill Rating already scores equal positions as
a half-win each way, which is exactly right for drivers who never met. Nothing in that chain ever
assumed positions were unique. The only thing this mode had to change was the results editor's "two
drivers share the same finishing position" guard — correct for a race, wrong for a bracket — which is
now replaced, for a bracket session only, by a check against the ladder itself: every position must
be one the bracket has, and no round may hold more drivers than it eliminates.

`games (league_id)` → `series (game_id, isBangerRacing, isBracketRacing)` → `seasons (series_id, game_id, drop_weeks, points_scale,
combined_championship)` → `races (season_id, sessions[], bracket_size?)`, `classes (season_id, name, sort_order, race_points?, isBracketRacing)`
and `entries (season_id, team_id, class_id, user_id, number)` / `teams (season_id)` →
`results (race_id, season_id, entry_id, class_id, points_template_id)`. `users` holds player profiles; linking a
roster entry to a user account is what feeds their public career stats.

**Display names** live on the global driver doc: `drivers.display_name` (the overall override) and
`drivers.game_names` — `[{ game_id, name }]`, one entry per game the driver is shown differently in.
Every surface resolves a name through `lib/driverNames.js` (pure rules) and
`lib/driverNamesServer.js` (the lookups): a page scoped to one game asks for that game's name and
falls back to the overall one, while an all-games page asks only for the overall name — which is
itself `display_name` → linked account's `display_name` → the pool driver's `name`. A game-mapped
alias (`drivers.aliases[].game_id`) is still honoured as the per-game name when `game_names` has
none, so setups made before this existed keep working. Only the *overall* name is denormalized onto
roster entries (`entries.name`, cascaded on save by `lib/driverSync.js`); per-game names are applied
at read time and never rewrite stored data.

**Classes** are the optional fourth tier. A class belongs to one season; a roster entry points at
one or more of them via `class_ids` (with `class_id` mirroring the first — the primary class — so
everything written before multi-class still reads correctly; `entryClassIds()` in
`lib/classFilter.js` is the one way to ask which classes an entry is in). A driver in several
classes races each of them from that single entry. Each saved result records the class the driver
ran in *at the time*, so re-classing a driver mid-season never rewrites the class championships
they already scored in — and it's what keeps a multi-class driver's races in the right table. The
stats engine resolves a result's class as "the class stamped on the result, else the driver's
current entry class" — which is also why results saved before a season had classes still fall into
the right class once drivers are assigned. Passing `class_id` to `/api/standings` or `/api/stats`
re-scores the whole table over just that class (its own points, ranks, gaps and averages) rather
than filtering rows out of the combined table.

**Per-class schedules.** By default every class shares one season calendar. Turning on a season's
**Per-Class Schedules** lets a race be pinned to a single class via `races.class_id`; a race left
unpinned stays *shared* by every class, so a season can mix a common opener with class-specific
rounds. A class's calendar is therefore "its own rounds plus every shared round" (`raceInClass` in
`lib/classFilter.js`), which is what Schedule and the race-count/field-size metrics all
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
pole, winner and field size (`summarizeRace(..., classId)`); at "All Classes" a round several classes
ran carries a `class_summaries` list instead — one pole and winner per class, stacked in the cell —
on both a season's own calendar and the cross-season feed, since showing whichever class's P1 sorted
first would read as *the* winner; the event page groups each session's table by class; and Skill Rating exchanges are keyed by class on a split event, so a Pro driver is
never rated against an Amateur car they never shared a grid with. Since a split event has no single
outright order, an overall championship across classes just adds their points together — turn
**Enable Overall Championship** off for a pure class-championship season.

**Which class pays what.** Points resolve through the same shape of fallback the car does, most
specific last:

    series default → season → event-wide session template → the class's own structure → that class's own session template

The **class's own structure** (`classes.race_points` / `qual_points` / `bonus_points`, all unset by
default = inherit) therefore **overrides the season and the event's default points template alike**.
That placement is the point: a template assigned to a session for the whole event is a statement
about the event's field, so a class that scores on its own structure outranks it — otherwise picking
one points system for the Feature silently flattens every per-class scale back to the event's. A
template picked for ONE class of a split event is the opposite: the most specific statement there
is, so it still sits on top of that class's structure. ("No points" is the one event-wide assignment
that always wins outright — it means nobody scores.) Each level overrides only the fields it
actually sets, so a class that changes nothing but the best-lap bonus still scores the season's race
scale, and a class keeps anything the event template sets that it doesn't. `classScoresOwnPoints` / `configForClass` in
`lib/standings.js` hold that rule, `makeScorer` places each template at the level it was assigned at
(off `class_session_templates`, stamped onto every result by `decorateSessionFlags`), and it applies
everywhere points are computed —
standings, class championships, career and team profiles, venue leaderboards, the event page and the
live Points column in the results editor — so a class's structure can't reach one screen and miss
another. In the combined table each row is still scored under the class its driver raced in, which
is what keeps "All Classes" honest when the classes pay differently.

On an event whose classes run separate sessions, the per-session assignment is per class as well
(`races.session_points_by_class[class][session]`, falling back to the event-wide
`races.session_points[session]`). Assigning one re-points only that class's saved results, so
re-scoring Pro's Feature leaves Amateur's alone, and clearing it hands that class back to the
event-wide assignment rather than to nothing. A class's Qualifying is resolved the same way, so the
qualifying points folded into a race result come from *that class's* Qualifying structure.

The grid *position* those points are paid on is per class too. One roster entry can race several
classes at the same round, so "where did this driver qualify?" has one answer per class, and
`buildQualPosMap` keys on race + entry + **class** to keep them apart (`qualPosFor` in
`lib/standings.js` resolves a race result against its own class's Qualifying, falling back to the
event's single combined Qualifying when a class didn't run one). Keying on race + entry alone
silently kept whichever class was read last — invisible inside a class championship, where only that
class's Qualifying is in scope, but wrong in the combined table where all of them are, which is what
made a multi-class driver's class totals stop adding up to their overall total.

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

**A class is answerable above its own season.** A class doc belongs to exactly one season, so "GT3"
in Season 3 and "GT3" in Season 4 are different ids for the same category. The cross-season identity
is therefore the **name**, and a class *selection* (`classIdSet` in `lib/classFilter.js`) is one of:
nothing ("All Classes"), one class id, or every id that name resolves to across the seasons in scope.
Every filter — entries, results, races, championship crowns, race summaries — takes all three forms.

`/api/classes` serves whatever scope is asked for (`season_id` / `series_id` / `game_id` / none =
league), collapsing same-named docs into one row carrying every matching id in `ids`. That's what
keeps the **Class** menu populated at "All Seasons" instead of going empty, and the selection is
remembered by name — drilling from a series into one of its seasons keeps you on GT3 even though the
id underneath changes, and falls back to All Classes only when the name genuinely isn't raced there.

Scoped endpoints take `class_name` alongside `class_id` and resolve the name against **each season's
own** class docs (`classIdsInSeason`). A season that doesn't run the selected class contributes
nothing rather than silently contributing its whole field.

**Track records are per game AND per class.** A lap time only compares to another lap in the same
context, so a venue keeps several records side by side rather than one outright number: the overall
fastest lap in the scope being viewed, one per game (a GT7 lap and an iRacing lap around the same
circuit aren't the same record), and one per class (nor are a GT3 lap and an LMP2 lap — without this,
whichever class runs the faster car owns the venue outright and the slower class has no record of its
own). `lib/trackRecords.js` holds the keying rules; `lib/trackStatsServer.js` supplies the reads.

Class records key on the class **name**, not its id. A class doc belongs to one season, so "GT3" in
Season 3 and "GT3" in Season 4 are different ids for the same category, while a venue's history spans
seasons — the name is the only identity that survives that. An unclassified lap files under its game
only, so a season without classes doesn't produce an "Unclassified" row duplicating the game record.

**The Share Graphic exporter** builds its own DOM node rather than screenshotting the live page, so
an export never picks up the sidebar, edit buttons or any other UI furniture — only the headline,
branding, event metadata and data table are drawn, at a fixed 1080px for a consistent feed-friendly
output. `ShareGraphicModal` takes `columns` / `rows` plus an optional `meta` of `{ label, value, wide? }`
facts, and `ShareGraphicButton` is the header control that opens it. There are two builders in
`lib/shareGraphic.js`: `toGraphicTable` for tables whose cells are plain stat lookups (Standings,
Stats), and `specToGraphicTable` for tables whose cells are computed — a schedule's per-class
winners, a Skill Rating trend, a record's list of tied holders. `specToGraphicTable` only medals
the top three when given a `rankOf`, so a table with no ranking (a calendar, a record book) doesn't
get a meaningless gold row.

Cells sit on one line by default, which suits the numbers these tables are usually made of. A column
that carries prose instead — an event name, a track, or the Schedule's "Pro: Ana · Am: Bo" pole and
winner cells — sets `wrap: true` and gets a capped width it breaks inside; without it a long string
stretches the table past the card's fixed width and the last columns fall off the edge.

Each screen passes its **full** column list and every one of them opens ticked, so the graphic starts
out carrying all the data the screen shows; the picker switches off anything you don't want. Identity
columns (position, driver/team name) are locked on — a row isn't readable without them. Both logo
pickers start on **None**: a logo is opt-in, with the league, series and track logos (and an upload)
a click away.

Because the card is a fixed width, the table's type and padding step down as more columns are
switched on (`tableScale`), and past a dozen columns the headers wrap so the widest one stops setting
the table's width. This is measured, not guessed: a 17-column standings export overflowed the card
and clipped its last column before that rule existed. The metadata strip uses a padding-based
thirds grid rather than flex `gap` or CSS grid, both of which html2canvas renders inconsistently.

### Marking a season complete

**Mark Season Complete** on the Schedule (and the matching control in League Setup) flips
`seasons.status` to `"completed"`, which is the one switch that closes a season out. It does two
things:

- **Crowns its champions** — see Championships below.
- **Closes it to players.** No one can sign up for it any more, and nobody can change the car they
  locked in. Both are enforced in the API (`seasonAcceptsSignups` in `lib/carSelection.js`, checked
  by `POST /api/users/me/series` and `POST /api/car-selection`), not merely hidden in the UI, so a
  tab left open from before the season closed still can't write to it. The season also drops out of
  the sign-up list everywhere it's offered.

Where a player sees that depends on the screen's job. The **Dashboard**'s Series Information
section is about what's still to do, so it drops the season and lists running ones only — scoped,
like the rest of that page, to the Game/Series currently selected. **Series Information** itself
(`/series-info`) is the full record and keeps it, greyed, saying **Season over — sign-ups are
done** with the locked-in car still shown; the season's own screen leads with the same line and
turns every control below it read-only. Nothing is deleted: reopening the season restores
sign-ups, car changes and the champion's Title exactly as they were.

**Championships (Titles).** A completed season crowns champions, and each one is +1 Championship on
the winner's career, at every scope — `lib/champions.js` is the only definition, used by the driver
profile, the stats tables and team pages alike.

- A season **with no classes** crowns its points leader, exactly as before.
- A season **with classes** crowns *each class's* points leader. A class championship is a
  championship: it counts in the driver's league-wide tally at "All Games"/"All Series", not just
  inside that class's view. Previously only the outright leader was credited, so a GT3 champion who
  ran mid-pack on combined points finished the season with nothing.
- The **overall** title is awarded on top only when the season's *Enable Overall Championship*
  toggle is on. Switched off, the combined table is explicitly unofficial and no overall champion is
  awarded, displayed or counted — the class winners are that season's only champions.
- **Double crown**: winning a class *and* the overall in the same season is **one** championship,
  not two, so a tally can't be inflated by a season's worth of scoring being counted twice. Both
  crowns are still recorded, and the driver profile names them ("Season 4 — Overall + GT3").

Scope decides which crowns count: inside a class only that class's title does, while the unscoped
view counts every crown — which is what carries class championships up to the global tally.
Championships appear as a column on Stats, on the driver profile (with a Championships table listing
every season won), and as a **Most Championships** record.

**Championship tie-breakers.** Level on points, the higher-placed competitor is decided by one
chain, applied in order until someone is ahead:

1. More Wins  2. More Podiums  3. More Top 5s  4. More Top 10s  5. Better Average Finish
6. More Poles  7. Better Average Start  8. More Best Laps  9. More Laps Led

`TIE_BREAKERS` in `lib/standings.js` is the only definition, and `compareStandings` (points, then
the chain, then a name so a dead-even pair doesn't shuffle between requests) is what every ranked
table sorts with — driver standings, team standings, the stats tables, a team's driver list. Season
champions are `rows[0]` of that same order, so Titles are awarded on it too, and the client-side
column sorting falls back to the chain as well: clicking **Points** shows tied drivers in
championship order rather than in whatever order the previous sort left them.

Two details worth knowing. The averages are *lower is better* (P1 beats P2) and compare on exact
`sum ÷ count`, not the rounded value on screen — 3.334 and 3.336 both display as 3.33 but are not a
tie. And a competitor with no average at all (zero starts, never qualified) sorts *behind* anyone
who has one, rather than a missing value reading as a perfect 0.0. Team rows aggregate the
underlying totals and divide once, so a team's average finish is over every race its drivers ran
rather than an average of their averages — which would weight a one-race driver like a full-season
one.

**Race dates are calendar dates, not timestamps.** A race `date` is stored as a bare `YYYY-MM-DD`
string with no time component, and every display/comparison goes through `lib/raceDate.js`. Handing
that string to `new Date()` parses it as *UTC midnight*, which renders a day early in any western
timezone (July 20 showing as July 19) — so the helpers parse to local midnight and compare dates as
strings instead. There are no time-of-day inputs in the scheduler; the date an admin picks is the
date everyone sees, in every timezone.

**Track types** come from the shared list in `lib/trackTypes.js`, which drives the creation/edit
forms, the Tracks directory's type filter, and its section grouping. Dirt racing is split by surface
into `Dirt Oval` and `Dirt Road Course`, and non-circuit venues have their own entries (`Figure 8`,
`Drag Strip`, `Demo Derby Arena`). A track saved with a value outside the list still displays
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

## Backups & disaster recovery

The whole application can be written to — and rebuilt from — a single JSON file. That file holds
every Firestore document the app owns (leagues, games, series, seasons, classes, races, sessions,
results, drivers, teams, tracks, points templates, roster entries, user accounts and their roles),
**with the original document IDs**. Keeping the IDs is the point: an export that minted new ones
would restore the rows but shred every `season_id` / `race_id` / `driver_id` / `class_id` link
between them.

Two things are deliberately *not* in a backup, because they don't live in Firestore:

- **Sign-in credentials.** Passwords and Google/OAuth links live in Firebase Auth. The `users`
  documents — display name, role, driver link, profile — restore fine; the credential behind a uid
  is Firebase's to keep. Restoring into a brand-new project therefore restores the *profiles*, and
  people sign in again to reattach them.
- **Uploaded images.** Logos and avatars live in Cloud Storage. The backup keeps their URLs, which
  keep working as long as the bucket does.

### Manual export / import

**League Setup → Data & Recovery → Backup & Restore**, Owner-only (Admins, Moderators and
Statisticians can't see it).

- **Export** downloads one JSON file. Choose *Entire application* — accounts and every league, the
  file you want for disaster recovery — or *Only the active league*, which carries just that
  league's racing data and no accounts, so it's safe to hand to someone else or move between
  projects.
- **Import** reads a file back. The file is parsed and summarized in the browser first, so a wrong
  file is caught before a byte is uploaded, and the import only runs once you've typed `RESTORE`.
  Two modes:
  - **Merge** — every record in the file is written over the top of what's there now, and anything
    added since the backup was taken is left alone. The safe default.
  - **Replace** — as well as writing the file's records, this **deletes** everything the backup
    doesn't contain, so the database ends up matching the backup exactly. This is the real recovery
    mode after a corruption or a compromised account. A league-scoped backup only ever replaces
    within its own league — other leagues and all user accounts are untouched.

Large files are uploaded in ~400 KB pieces and staged server-side before being applied, so a backup
bigger than the host's request-body limit still imports in one go.

The screen also lists recent export and restore runs (manual and scheduled), so "when were we last
backed up?" is answerable without going to look at a drive.

### Automatic weekly backup — Saturdays, 3:00 AM Eastern

`.github/workflows/weekly-backup.yml` calls the same export endpoint every Saturday morning and
files the result in three places:

1. **This repository**, committed into [`backups/`](backups/) — the newest 12 files are kept
   (about three months), older ones pruned by the same run.
2. **A workflow artifact**, downloadable from the run page for 90 days — grab this one if you want
   a copy on a local drive.
3. **Google Drive**, if configured (see below). Skipped silently when it isn't.

GitHub schedules only in UTC and Eastern moves twice a year, so the workflow registers *two*
schedules — 07:00 UTC (3 AM EDT) and 08:00 UTC (3 AM EST) — and a guard job checks Eastern's
current UTC offset to let only the one that really is 3 AM Eastern through. It matches on which
cron fired rather than on the wall clock, so a run GitHub delays under load still counts.

**Setup — two repository secrets** (*Settings → Secrets and variables → Actions*):

| Secret | Value |
| --- | --- |
| `BACKUP_APP_URL` | Base URL of the deployed app, e.g. `https://your-app.vercel.app` |
| `BACKUP_CRON_SECRET` | Any long random string |

Then set `BACKUP_CRON_SECRET` to **the same value** in the app's environment (Vercel → Settings →
Environment Variables) and redeploy. The scheduled job has no Firebase account to sign in as, so it
presents this shared secret instead. Note the asymmetry: the secret can take a backup, but it can
**never** restore one — importing is always Owner-only, because taking a copy of the data is
harmless and overwriting the live database with one is not. Leave `BACKUP_CRON_SECRET` unset and
token access is off entirely; only a signed-in Owner can export.

Run it on demand any time from *Actions → Weekly Backup → Run workflow*.

**Optional — Google Drive.** Add two more secrets and each weekly backup is also uploaded to a
Drive folder, so a copy survives losing the repository too:

| Secret | Value |
| --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | A Google Cloud service-account key file, pasted whole |
| `GOOGLE_DRIVE_FOLDER_ID` | The folder id from its URL (`…/folders/<id>`) |

Share that Drive folder with the service account's `client_email` as **Editor**. The upload uses
the `drive.file` scope, so the script can only see and manage the files it created itself — it
cannot read the rest of the Drive it's uploading into. It keeps the newest 12 there as well.

### Saving to a local drive

The same script that powers the workflow will write anywhere you point it:

```bash
APP_URL=https://your-app.vercel.app \
BACKUP_CRON_SECRET=… \
BACKUP_DIR="/Volumes/Backups/phoenix" \
npm run backup
```

It refuses to write a file that doesn't parse as one of our backups, or that comes back with zero
records — a backup folder full of plausible-looking garbage is worse than one that's visibly
missing a week.
