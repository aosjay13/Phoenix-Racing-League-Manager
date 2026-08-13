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
- 🛡 **Persistent teams** — teams live in a league-wide pool and keep their name, badge and record
  for good; each season gets its own driver line-up, so a driver can switch teams between seasons
  and every point stays credited to the team they actually drove for
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
- ⏱ **Time Trials & Placements** — a hub of its own for hot-lapping, time attack and division
  placement nights. Each session takes **as many laps per driver as you allow** (a Maximum Laps
  limit, or unlimited) and works out **Best Time** and **Best Average Time** from them, both
  one-click sortable; every driver's fastest lap is found from the laps themselves and shown in
  bold, and clicking a name opens the full lap list. Tick **Placement Session** and the sheet grows
  a division column you assign by hand or fill from the times, and **Complete Session** pushes the
  whole field onto the official roster in those divisions — the manual entry a placement night
  otherwise creates. **A division doesn't have to be a class**: leagues whose divisions are
  *separate series* place drivers into **series** instead, each building the roster of the season
  behind it, so one night can build several rosters at once — and you can use both together, sorting
  a driver into a series *and* into a class within it. **Export to Qualifying** copies the best laps onto a scheduled race as
  its official qualifying grid, and the race's Qualifying tab has an **Import from Time Trial**
  button for the same trip the other way. A time trial counts toward **no** racing statistic — no
  Wins, Top 5s, Average Finish or Championships — but its laps *are* eligible for the Global /
  Series / Class **Track Records**
- 📝 **Player sign-ups with admin approval** — **Sign-ups** is its own sidebar menu, written for
  the least tech-savvy player in the league: a three-step walkthrough that says up front what the
  whole process is (pick a series → fill in the short form → an admin approves you), lists every
  series open to join as a card you click anywhere on, tells you what the form will ask for
  *before* you start it, and finishes on a confirmation that says plainly that your sign-up is in
  the queue and nothing else is needed from you.
  Nothing reaches the official roster on its own — every sign-up lands in a **Pending Sign-ups**
  queue on the admin's roster screen, where **Approve** adds them with the number and car they asked
  for (creating their driver profile too, if they're new to the league) and **Deny** leaves them off.
  Admins choose per **series, season or class** what a sign-up must carry: a **car number**, a **car**
  from the league's own **Car Selection** list, or nothing at all
- 🎮 **Account requirements per game** — every sign-up in every game needs the player's **Discord
  name**, and each **Game** carries its own switches for the platform identity it actually needs:
  **Steam**, **PSN**, **Xbox Gamertag**, **iRacing Name** and **iRacing Customer ID**. The sign-up
  form reads the game the series belongs to and renders exactly those fields, pre-filled from
  anything already on the driver's profile, and **Submit** stays disabled until they're answered.
  Whatever a player types is saved back onto their driver profile, so it's asked for once and
  never again
- 🔢 **Car number changes by request** — a driver already on a roster can ask for a different
  number from their own season screen, seeing which numbers are free before they choose. It goes
  into the same approvals queue a sign-up does and changes nothing until an admin grants it, so
  two drivers can never end up sharing a number. They can withdraw it while it's still waiting;
  admins can also set or clear any number, and remove anyone from a roster, directly
- 🔔 **Approvals badge** — a red count beside the sidebar's **Approvals** link shows how many
  requests are waiting on a decision league-wide — sign-ups and number changes alike — so nobody
  sits in the queue unnoticed. Moderator and above only — the badge, the page and the API call
  behind them
- 🚗 **Car selection & lock-in** — flag a **game, a series, a season, or one class** as requiring a car
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
  sessions per race (e.g. Qualifying + Race), each scoring itself — a driver's championship total
  is the sum of the Points column on every session they ran, Qualifying included, so the standings
  can be checked by adding up what's on screen; re-submitting a race overwrites cleanly for
  corrections
- 🗓 **Global race calendar** — a month-by-month grid of **every** event in the league, past and
  future, on the day it runs. Each race is a pill carrying its series' abbreviation and the track,
  and clicking one opens that event's page (its results, once it has run). The same **Game ▸
  Series** menus as everywhere else narrow it; with **no game selected it shows every upcoming
  event in the league, from every game**. It opens on the month that actually has racing in it,
  and a **Jump to** row skips straight to any other month that does
- 📊 **Stats & Roster filtering** — Game/Series/Season dropdowns filter Stats and Roster
  everywhere, with sortable columns and per-series car numbers
- 🖼 **Custom branding** — upload game, series, season, team, and track logos
- 👑 **Admin roles** — set `ADMIN_EMAILS`; admins get results entry from the Schedule, the
  the Driver Roster menu, the User Accounts tab on Drivers, the Team Roster tab on Teams, League Setup,
  and (Moderator and above) the Approvals queue
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

### Running against the Firebase emulators

You can develop without touching a real Firebase project. Start the Auth + Firestore emulators
(`firebase emulators:start`) and add these to `frontend/.env.local`:

```
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
```

The first two are read by the Admin SDK on its own; the third is the browser half, which
`lib/firebaseClient.js` uses to point sign-in at the emulator instead of the real project. All
three are unset in every deployed environment, and with no host configured the app connects to
Firebase exactly as it always has. `FIREBASE_PRIVATE_KEY` still has to *parse*, so generate a
throwaway key (`openssl genrsa`) — the emulator never checks it.

## How to Use

### For players

1. **Sign in** (top right) with email/password or Google. This creates your public driver
   profile automatically.
2. **Profile** — edit your display name, avatar, bio, country, and car number. Ask a league
   admin to link your roster entry to your account so your race results feed your stats.
   - **Connected Accounts**, in its own card below, is the names you go by on Discord and on
     each platform. Two things use them: it's how the league gets hold of you about races, and
     it's how results imported under any of your names find their way onto your profile. A
     series sign-up fills them in and keeps them current, so this is mainly where you *correct*
     one that's gone out of date — before this the only way to change a Discord handle was to
     join another series. Leave a box empty to drop that platform; add any the list doesn't
     name with **＋ Add platform**. They're saved against your **driver profile**, not your
     account, which is why the card says so — and why it explains how to get one rather than
     showing a dead form if you haven't signed up for anything yet.
3. **Drivers** — browse every registered player; open a profile for three tabs of their record:
   - **Career Stats** — the totals, per game and combined across all games (starts, wins,
     podiums, poles, average finish, titles, etc.), plus every championship won and a by-game
     breakdown.
   - **Race History** — *every individual race they have started*, newest first, with the start
     and finish position, laps, laps led and points they scored in each. Filter it by **game** and
     by **season**, and click any race to open that event's full results — so you can go from a
     driver's profile straight to a specific race of theirs without knowing which season it was
     in. An event that ran several sessions (heats, a consolation, a feature) lists each session
     as its own row, because each is scored on its own.
   - **Per Track Stats** — the same career broken down by venue, each track linking to its own
     page.
4. **Sign-ups** — a menu of its own in the sidebar, and the one screen in the app written for
   somebody who has never used it before. Joining a series is a walkthrough, and its three steps
   are printed at the top *before* anything is asked of you: **pick a series → fill in the short
   form → an admin approves you**. The screen shows one step at a time, so there is never more
   than one thing on it to do.
   - **Pick a series.** Every season still upcoming or under way that you're not on yet is a
     full-width card you can click anywhere on. Each carries the game it's played on, how many
     drivers are already in and how many are waiting, and what its form is going to ask for
     (*Car number needed*, *Choose your car*, *2 classes*) — so two series can be told apart
     without opening either. Seasons marked complete never appear, and can't be joined.
   - **Know what you'll need before you start.** Above the form, **What this form asks you for**
     lists every question that's coming and why — your racing name, your Discord name, whichever
     platform IDs this game requires, a car number, a car. Nothing in the form is a surprise, and
     anything already saved on your profile is filled in for you.
   - **Know that it worked.** Submitting lands on a confirmation saying your sign-up is *in the
     queue* and that nothing else is needed from you — which is the question a first-timer
     otherwise answers by signing up a second time. The series then sits under **Waiting on an
     admin** until one of them approves it.
   - **Your account keeps up on its own.** A sign-up is the moment the league learns who you
     are, so the two fields your **Profile** owns and a sign-up answers — your display name and
     your car number — are filled in from it. Only ever *filled in*: if you've set either
     yourself, it's left exactly as it is, and a season that doesn't run car numbers can't blank
     the one you have. So a brand-new account stops showing "jane.doe" the moment you tell the
     league you race as J. May, and nobody's chosen name is ever overwritten.
   - **When you're let in, the Dashboard says so.** The first time you open it after an admin
     approves your sign-up, a banner across the top welcomes you to the series by name, says which
     season you're on and what number and car you're running, and points at the three things you
     need next: **your series schedule**, the **league calendar**, and the **Discord**. It clears
     on a deliberate **Got it** and never comes back — being let in used to happen in complete
     silence, which is a poor way to greet somebody who has just joined your league.
   - **If a sign-up is turned down, you're told why.** An admin denying one types a reason, and
     that reason reaches you twice: an **email to your account's address**, and a red panel at the
     very top of Sign-ups the next time you open it. The panel quotes the admin's words, and that
     series is held out of the "pick a series" list until you press **Got it — let me try again**,
     which clears it and drops you straight back into that series' form. The point is that the
     reason is read before the identical form is filled in a second time. (A denial with no reason
     says so plainly rather than leaving a blank.) Nothing is held against you — your details are
     already saved, so the second attempt is a much shorter form.
   - **Nothing is red until you've had a go at it.** A required box you haven't visited yet is
     just something still to fill in, so it's left alone and what's outstanding is named calmly
     under the button. Touch one and leave it empty and *then* it's flagged, because by then it
     is genuinely undone. Opening a form to four red-outlined boxes reads as "you've done
     something wrong" to somebody who has done nothing at all yet.
   - **Discord is mandatory**, and the screen says so before you start: a card under the three
     steps, in Discord's own colour, linking straight to the league's invite. Signing up here is
     only half of it — you also have to be in the Discord and pick the correct roles in the
     channels, or nobody knows who you are. It's repeated on the confirmation, worded as the next
     thing to do, because that's the moment it's actionable. The invite lives in one constant,
     `DISCORD_INVITE_URL` in `components/DiscordCallout.jsx` — change it there and every place it
     appears follows.
   - **The badge on the menu** counts what is waiting on **you**: series you could join, plus
     cars you still have to choose. Sign-ups already sent are deliberately not counted — those
     are waiting on somebody else, and a number that only falls when an admin acts is nagging
     rather than useful.
   - **Brand new?** Nothing has to be set up first. Pick a series, and the form asks for
     everything the league needs; an admin approving it creates your driver profile *and* your
     roster entry in one click. **Raced here before?** *I've raced in this league before — find
     my name* opens the claim panel: find yourself in the driver list, hit **That's me**, and
     your whole race history comes with you. Either way **an admin approves it** — a driver
     profile is never created or linked automatically. Sign-ups and car choices are recorded
     against a *driver*, not an account, which is why the two have to meet.
   - **The form itself.**

     **The form renders itself from what that league asked for.** A car number box and a
     **Car Selection** question — each appears only if the series, season or class you're joining
     wants it, and **Submit Sign Up** stays disabled until every required choice is made. There is
     one car question, not two: whatever the admin typed into **Car Selection** becomes one radio
     button each, drawn by the app's shared tick-box rule, and whichever one is picked is what
     shows against that driver on the roster once an admin approves them. The **car number** question is asked *only where a number is required*: a league that
     doesn't run car numbers — or a season, or a single class of it, that switches them off — shows
     no number box at all, rather than an optional field for something nobody uses. Pick a class
     that does require one and the question appears there and then.

     Alongside them: the name you race under, your class, and a **Contact & Platform Details**
     panel — the accounts this league needs to reach you and to find you in-game. Under those,
     collapsed, sits the full **Aliases / Connected Accounts** list — every platform username
     (Discord, PSN, Xbox, Steam, iRacing…) the Smart Importer matches results against, so a result
     posted under any of them lands on your profile.

     **Your Discord name is required for every sign-up**, in every game, series, season and class:
     it's how the league reaches you. On top of that, each game asks for whatever identifies you
     *there* — a Steam name, a PSN ID, an Xbox gamertag, an iRacing name and customer ID — as
     switched on by an admin in **League Setup ▸ Games**. Each one is named on the form with a
     line saying why it's being asked for, and listed again in **What this form asks you for**
     before you start.

     **You type them once.** Anything the league already knows is filled in for you and marked
     *✓ from your profile* — or *✓ from your last sign-up* if you're new and an admin hasn't
     approved you yet, because your answers are on that request until they do. So a second
     sign-up is usually read-and-submit with nothing to type at all: the name you race under
     comes back too. What you type is saved on submit, **merged** rather than replacing, so a
     Wreckfest sign-up that only asks for Discord can never wipe the Steam name an iRacing
     sign-up saved.

     The season's **roster** sits in the form, in car-number order, showing who's racing under
     which number *and* who has already asked for one (marked **pending**) — so you can see what's
     spoken for before you choose. It's collapsed on a big roster, behind a strip that leads with
     the instruction (**See which numbers are taken**, with the count under it, a **#** badge and a
     chevron that turns as it opens) rather than a caption. That matters: as a dim grey line the
     size of body text it was being missed outright, and a driver who can't find it picks a number
     blind. Type a number somebody has, or has requested, and it's rejected
     as you type with *"That number is already taken, please choose another number."*

     **Submitting doesn't put you on the roster.** It goes to the league's admins as a pending
     sign-up; you're on the official roster once one of them approves it. The form says so before
     you send it.

     **Once you're on the roster**, your season's screen carries a **Your car number** card beside
     your car pickers: it shows the number you run and lets you **request a different one**. The
     numbers already taken (and the ones other drivers have asked for) are right there, and one
     that's spoken for is rejected as you type. Like a sign-up it changes nothing on its own — it
     goes to the admins, and your number moves when one of them approves it. You can withdraw the
     request any time while it's still waiting, which frees the number for somebody else.

     **An iRacing season won't take a sign-up without your iRacing Name and iRacing ID#**, because
     iRacing leagues are invite-only and the organiser can't send you an invite without your
     customer ID — both fields are marked required and the form won't submit until they're filled.
     A game *named* iRacing carries that rule whether or not an admin has ticked its boxes.

     If the league already knows you, the form puts you straight on the roster. If you're not in
     the driver list yet, **nothing is created**: the whole form is filed as a request, and an
     admin approving it creates your driver profile *and* your roster entry in one click. The
     form says so before you send it.
   - **When a season ends.** The moment an admin marks it complete, it closes to players: nobody
     else can sign up and nobody can change the car they locked in. It also **drops out of the
     player flow entirely** — off Sign-ups, off My Series and off the Dashboard's Series
     Information card — because that flow is about what you still have to do. A series whose
     seasons have all finished disappears with them. Your results are on **Standings** and
     **Stats** as always, and the season's own page still opens from a direct link, marked
     **Season over**. Reopening the season undoes all of it.
   - **Where your sign-ups have got to.** The same screen lists **Waiting on an admin** (sent,
     nothing else for you to do) and **Series you're racing in** (approved), each row saying in
     one line what — if anything — is still wanted from you. If a series is waiting on a car,
     that's called out in its own banner at the top, since it's the one job an approved driver
     can still have.
   - **My Series** (`/series-info`, reached from that list or from the Dashboard card) is the
     other half: the seasons you're **already** on, and each season's own screen behind them.
     Nothing is signed up for here — it links back to Sign-ups for that, so a sign-up is only
     ever filled in in one place.
   - **The series roster.** Every season's own screen shows its roster — number, driver, class
     and locked-in car — to anyone who opens it, admin or not. It's ordered by car number rather
     than alphabetically, because "who has 24?" and "which numbers are free?" are what it's read
     to answer.
   - **Locking in your car.** Pick from the cars the admin listed and hit **Lock in Car**. You
     can change your mind as often as you like until an admin locks the selections. Under it,
     the full roster shows exactly which car everyone else has taken, with a tally of how
     popular each one is.
5. **Schedule** — the season's race calendar. Completed races are clickable and show full
   results. With **no single season selected** ("All Games" / "All Series") it becomes a feed of
   the league's racing in two halves, split on the calendar: **Upcoming** is everything whose day
   hasn't come yet, soonest first, and **Archive · Recent Results** is everything whose day has
   been and gone, most recent first. A round that ran but never had its results entered belongs to
   the archive — it shows there as **TBD** rather than sitting in Upcoming forever. Admins get
   **+ New Race** here; on the cross-season feed (Season set to "All
   Seasons" with a series picked) there's a **+ New Season** button too, offering every option
   League Setup does and dropping you onto the new season's empty calendar. **🖼 Share Graphic**
   exports the calendar as an image — the whole season's rounds, or (on the cross-season feed)
   Upcoming and Recent Results as separate posts. Events that have session times set (see the
   Calendar below) show a **Session Times** column right of the race date, in the reader's own
   timezone.
6. **Calendar** — every race in the league on a month-by-month grid, past and future, on the day
   it runs. Each event is a pill showing its series (abbreviated) and the track; click one to open
   that race's page. The **Game** and **Series** menus at the top narrow it to a single series —
   with **no game selected you get every upcoming event in the league, from every game**, which is
   what the page opens on. It lands on the month with racing in it rather than on today's empty
   one, and the **Jump to** row hops straight to any other month that has events. Where the
   Schedule answers *what's next and what just happened*, the Calendar answers *what does June
   look like*.

   **Session times, in every reader's own timezone.** An admin can opt any event into showing when
   it actually runs: on that race's **Race Info** tab, tick **Show session times on the Calendar**,
   pick the timezone the league's times are quoted in, and enter **Practice**, **Qualifying** and
   **Race** start times (leave any of them blank to leave it off). The event's pill then carries a
   **P · Q · R** line, and every reader sees those times converted to *their own* clock
   automatically — 7:00 PM in New York reads as midnight to somebody in London, with the date shown
   beside it when their clock puts the session on a different day. Daylight saving is handled per
   event, from the race's own date, so a March round and an August round both come out right.

   The same times appear on the **Schedule**, in a **Session Times** column immediately right of
   the race date — on a season's own table and on the cross-season Upcoming / Recent Results feed
   alike. The column only appears when something in the table actually has times set, so a league
   that hasn't used the toggle sees the schedule exactly as before. It stays out of the **🖼 Share
   Graphic** export on purpose: the times are converted to whoever is *reading* them, so baking one
   person's clock into an image everybody else looks at would be wrong.

   Underneath, this is a display of the race's date, not a change to it: the date is still the plain
   calendar date it always was, and the results screens, the standings and every other reader are
   untouched. An event with the toggle off looks exactly as it did before.

   **Subscribe it into your own calendar.** The **📆 Subscribe** button hands over a feed URL for
   whatever scope is on screen, with one-click links for Google Calendar and for Apple Calendar /
   Outlook. Subscribe once and it keeps itself in sync — new rounds, moved dates and session times
   all follow, with each session arriving as its own appointment at the right time for wherever the
   subscriber is. Races without published times arrive as all-day entries. See the `.ics` feed
   under Project Layout for the details.
7. **Standings** — driver and team championship tables for the selected season, with
   points, gaps to the leader, and per-category stats. Click any column header to sort. Level
   on points? The tie-breaker chain below decides, and every step of it is a column in the
   table so you can see why.
8. **Stats** — use the Game/Series/Season/Class menus to scope driver stats to a class, a
   season, a whole series, a whole game, or the entire league. Pick "All" at any level to
   widen the scope.
9. **Tracks** — open a venue for its own page: every race held there, a leaderboard of who has
   gone best, and its lap records. The **Class** menu scopes it too — the leaderboard, winners
   and headline record become that class's — while the per-game and per-class record breakdowns
   always stay side by side, since that's the comparison they exist to show.
10. **Records** — the record holder in each category for the current scope, plus **Avg Drivers
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
(`/drivers/<id>`, `/teams/<id>`, `/tracks/<id>`) were already direct links and are unchanged — a
team link shared before teams became league-wide documents carried its *name* instead of an id, and
still opens the right profile.

### For league admins

Admin pages appear in the sidebar once your email is in `ADMIN_EMAILS` (see setup below).

1. **League Setup** (`/admin`) — build the hierarchy top-down:
   - **Game** — name + logo (e.g. "iRacing"), plus **Account Requirements for Sign-ups**: tick
     **Requires Steam ID/Name**, **Requires PlayStation Network (PSN) ID**, **Requires Xbox
     Gamertag**, **Requires iRacing Name** and/or **Requires iRacing Customer ID** and every
     sign-up for every series in this game must answer them. Each box maps to one row of the
     driver's **Aliases / Connected Accounts**, so an answer given at sign-up is saved to their
     profile and fills itself in next time. A player's **Discord name** is required for every game
     and has no box to tick; a game *named* iRacing shows its two boxes ticked and locked, because
     that rule holds whether or not anyone sets it.
   - **Series** — name + logo under a game (e.g. "Asphalt Assault Series").
   - **Season** — name (e.g. "Season 3") under a series; set drop weeks, the points scale
     (or pick a built-in template), qualifying points, and bonus points (most laps led,
     fastest lap, etc.). There is no separate pole bonus — pole is position 1 of the qualifying
     points list, so a pole is worth whatever the first number in that list says. The Qualifying
     session **scores those points itself**, like any other session — they are their own line of the
     championship, not a bonus hidden inside a race result.
     **Enable Overall Championship** decides whether a multi-class season
     also crowns one champion across the whole field on top of the per-class titles.
     Seasons list **newest first**, ordered by the **race dates** on their schedules rather than
     by the order they were typed in — so a Season 5 entered before Seasons 2, 3 and 4 still sits
     above them in the Season dropdown and in League Setup. A season with no dated races yet
     (one being set up now) sits at the top. Use the **▲ ▼** arrows in the Seasons list to
     arrange your own order instead; **↺ Sort by race date** hands it back to the dates.
   - **Classes** *(optional)* — split the season's field into separately-scored groups
     ("Pro"/"Amateur", "GT3"/"LMP2"). Leave it empty for an ordinary single-class season —
     nothing changes. Classes created here fill the **Class** menu in the top bar, which scopes
     Standings, Stats and Records to one class at a time. Assign drivers to a class on the
     Admin ▸ Driver Roster or from the Class column in the results grid; deleting a class
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
   - **Require Car Selection / Lock-in** — offered identically on **Games**, **Series**,
     **Seasons** and **Classes**, since a league might run one car list across a whole game or a
     different one per class. Set it to **Required**, list the **Available Cars** one per line,
     and every driver on that roster is asked to lock in their car from the **Series
     Information** section of their Dashboard. **Instructions for Drivers** ("Please lock in your
     car for the upcoming season") shows above their dropdown. **Lock the selections** freezes
     every pick when the entry list is final — set it back to reopen.

     One more switch sits beside it, independent of it: **Require Car Number Selection** (no
     sign-up without a number) — a league can demand numbers without caring what anyone drives.
     Whatever you switch on is what the player's sign-up form renders and refuses to submit
     without.

     There is **one** car list. A separate *Require Car Manufacturer / Model Selection* switch with
     a second list used to sit here, and on the sign-up form it read as the same prompt asked
     twice; a spec series that only cares which make somebody runs types *Chevrolet / Ford /
     Toyota* into **Car Selection** instead. A league that had filled in only the old manufacturer
     box keeps its options: that field is read as the car list when no car list of its own was set,
     and saving the level moves the options across for good.

     **The inheritance rule, in one line: the most specific level with an opinion wins.**

         game  →  series  →  season  →  class

     A class overrides its season, a season overrides its series, a series overrides its game.
     That's why each switch is a **three-way choice**, not a checkbox — "I never touched this"
     and "I want this off *here*" are different answers:

     | Setting | What it means |
     |---|---|
     | **Inherit** (default) | Whatever the level above says. The dropdown spells out what that is right now — *"Inherit — required by the series"*. |
     | **Required** | Required at this level, whatever the level above says. |
     | **Not required** | **Not** required here, even when the level above requires it. |

     So a series can require a car number for everything in it while one class of one season opts
     out, and a game can set the league's house rule once instead of on every season. Lists follow
     the same shape — the **most specific car list wins**: a class's list beats the season's, which
     beats the series', which beats the game's. The common setup is one list on the series; a class
     that runs different machinery adds its own and its drivers pick from that instead.

     A driver is only ever asked once: their class's question if it has one, otherwise the
     season's. Picks are stored on the driver's roster entry (`entries.selected_car`), so an admin
     can correct one from the roster like any other entry field.

     Not part of this chain: the **platform identities** (Discord, Steam, PSN, Xbox, iRacing).
     Those belong to the **Game** alone and apply to every series, season and class under it,
     however many are made — nothing below overrides them. See the Games panel above.
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
   - **Approvals** *(`/approvals`, Moderator and above)* — the same queue as below, but for the
     **whole league** in one list, and the place the sidebar's red badge points at. Each row names
     the series and season being asked for, so nothing sits unnoticed just because no admin
     happened to select that season. Two kinds of row share it: a **sign-up** (approving creates
     the roster entry) and a **number change** (approving edits the entry that driver already
     has — the row is marked *number change* and reads `Car number #7 → #24`, with whatever
     reason they gave). The badge counts every `pending` request in the active league
     and refreshes on a timer, when the tab regains focus, and the instant one is resolved. It is
     Moderator-and-above throughout — the nav item, the page and `GET
     /api/admin/signup-requests/count` behind them — so a Statistician (who clears the general
     staff gate) and every ordinary player see neither the badge nor the count.
   - **Pending Approvals** *(admin, on Driver Roster)* — the selected season's slice of the
     queue above: players who submitted a sign-up from the Sign-ups menu waiting to be let in,
     plus anyone already on the roster asking for a different car number. Nothing they sent is
     live.

     A **sign-up** row shows the number and car they asked for and the platform
     usernames they gave; **Approve** puts them on the roster with exactly those choices — creating
     their driver profile too when they're new to the league. A **number change** row is marked as
     one and reads `Car number #7 → #24`, with whatever reason they gave; **Approve** moves the
     number on the entry they already have. **Deny** leaves things as they are, with an optional
     reason.

     Approval re-checks whatever could have gone stale while a request waited. If the season has
     since been marked complete it refuses and says so. If a sign-up's number was taken meanwhile
     they're seated without one rather than the approval failing outright — but a number *change*
     whose number has gone is refused instead, since granting it would either clash or silently do
     nothing, and neither is what the driver asked for.
   - **⬆ Bulk Import Drivers** *(admin, on Driver Roster)* — the season-rollover shortcut, for
     everyone who never goes near the Sign-ups menu. Pick a source — **every driver in this
     series** (across all its seasons) or **clone one past season's roster** — and they're added in
     one shot, carrying their name, car number, driver profile and linked account. Anyone already
     on the target roster is **skipped, never duplicated and never an error**, so it's safe to press
     twice or to top up a half-built roster. Team and class don't carry over: those are per-season
     records whose ids mean nothing in the new season.
   - **User Accounts** *(admin)* — every account that has signed up: set its **role**, link it to
     the driver profile it races as, rename it, delete it, and approve or deny **pending driver
     requests**. The red badge on the Drivers nav item counts new signups + pending requests.

     The **Linked Driver Profile** cell is a searchable picker listing every driver with its
     availability (unclaimed / linked here / linked to another account). It renders into `<body>`
     as a *fixed* element rather than inside the table cell, and measures its room against the
     bottom of the sticky topbar rather than the top of the window. Both matter: the table scrolls
     inside `overflow: auto`, which clipped an absolutely positioned panel and sliced its top row
     in half, and measuring to the window let a row low on the page open a full-height list that
     ran up behind the league selectors. It re-measures every animation frame while open, so it
     stays welded to its row through scrolling, a toast collapsing, or the list reloading after a
     link — flipping above or below as the room runs out, never off-screen.

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
   - **Driver Roster** *(admin — its own sidebar menu, under Admin)* — select a **Series** in the
     top dropdowns to manage that series' roster. It was a tab on Drivers ("Roster & Teams"); it
     is a menu of its own because it's a *job* rather than a view, and a job needs somewhere it
     can carry a badge. Its own URL, `/roster`, works again; `?tab=roster` redirects there.
     - **A red badge, for drivers who were added while you weren't looking.** Approving a sign-up
       is the one admin action whose result lands out of sight: the driver appears on *one*
       season's roster, which is very often not the season you're scoped to, and the queue you
       approved them from then empties — so nothing was left on screen to say it had happened, or
       where. The badge counts them, and the panel at the top of the screen names each driver, the
       roster they landed on, and their number and car, with an **Open this roster →** button that
       steers the Game / Series / Season menus straight at it. It's *news*, not a job, so it
       clears by being **read**: a deliberate **Got it**, never merely opening the page.
     - **Sign-ups waiting in other seasons** get the same treatment, at the other end of the
       process. The approve queue below is scoped to the season you're on — which is right for
       working through it, and meant a sign-up for any *other* season was invisible until you
       happened to steer the dropdowns at it. A strip at the top now names who's waiting where,
       with a **Review these →** button that takes you to that season's queue.
     - **Which season you're editing, said out loud.** Three dropdowns decide what this screen
       writes to, so the scope strip under the header names the season edits are written to
       rather than leaving you to infer it from the menus.
     - **Capping a car.** In **League Setup**, a car's line in the Car Selection list can carry a
       limit after a pipe — `Ferrari 296 GT3 | 4`. Once four drivers have it the car is greyed out
       on the sign-up form, badged **FULL · 4 of 4**, and refused by the API; the others show how
       many seats are left. What counts toward a cap is everyone on the roster **plus** everyone
       still waiting on approval, because five people all picking the last seat while nobody has
       been approved yet is the pile-up a cap exists to prevent. A line with no pipe has no limit,
       so every list saved before this works unchanged. The field shows what it parsed, car by car,
       so a limit that was mistyped is visible immediately.
     - **Teams** — add a team to this season (creating it in the league-wide pool if it's new)
       and give it a logo. Building its driver line-up happens on **Teams ▸ Team Roster**; the ✕
       here takes a team *out of this season*, never out of the league.
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
3. **Teams** — the team-side mirror of Drivers, with two tabs.
   - **Teams** — the public directory: one row per team in the league-wide pool, with how many
     seasons and drivers it has fielded. **＋ New Team** adds one to the pool (and, when the
     dropdowns are on a season, enters it there). Editing a team changes it everywhere; deleting
     it removes it from every season it raced in — drivers keep their results, they just lose the
     team tag.
   - **Team Roster** *(admin)* — who drives for each team **in one season**. Pick the season with
     the **Game ▸ Series ▸ Season** menus at the top of the page (with a series selected and "All
     Seasons" showing, it manages that series' newest season, like the Driver Roster does).
     - **＋ Add Team to Season** — search the team pool and bring a team in, or create a brand-new
       one inline. A team can be entered in as many seasons as it races.
     - **＋ Add Driver** — a searchable list of the season's roster first, then the whole global
       driver pool, so a team's line-up is built from the same driver identities everything else
       uses. A driver races for one team per season: picking someone already on another team
       *moves* them. Someone on the team but not on the season's roster is flagged, since they
       have no results to contribute.
     - Each team's card shows its **season points, wins and poles** as they stand, so the
       aggregation is visible the moment a line-up changes.
     - **Remove From Season** ends the team's entry in *this* season only. Its other seasons, its
       record and every race result are untouched.
     A team's points, wins, top 5s, poles, laps led and average finish are the combined totals of
     whoever was on its line-up that season; those seasons add up to the team's all-time record on
     its profile, in the Stats page's **Teams** tab, and in every scope in between.
4. **Results entry** — everything about an event is managed from **Schedule**. Each row's
   **⏱** button opens that event's results grid and **✎** its details; both land on the same
   race edit screen, which carries **Race Info**, **Qualifying** and **Race Results** tabs
   (Heats / Consolation / Feature on a heat-racing event). Fill in the grid (one row per
   driver: finishing position, laps led, incidents, DNF/DNS status) and save — standings,
   stats, and every linked player's profile update immediately. Re-open and re-save a race
   any time to correct results; it overwrites cleanly.
   **Previous / next round** buttons sit at the top of both the results editor and the public
   results page, so a season can be worked (or read) straight through without going back to the
   Schedule between rounds. They keep you where you are — the editor stays the editor, the viewer
   stays the viewer — and the editor also keeps the tab you're on, so entering ten Features in a row
   never touches Race Info. They follow the Schedule's own order (round number), and on a season
   running per-class calendars a class-pinned round steps through that class's calendar, skipping
   rounds it doesn't run. See `lib/raceNav.js` and `components/RaceNav.jsx`.
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

### Running a Time Trial or a placement night

**Time Trials & Placements** in the sidebar is a hub of its own, for the sessions that aren't races:
hot-lapping, time attack, and the placement night that sorts a new field into divisions.

1. **Create the session.** Name it, pick the **track** (pick it from the Tracks database rather than
   typing it, so the laps set here are eligible for that venue's track records), and choose how many
   laps a driver may submit — **Maximum Laps**, or leave it blank for an unlimited hot-lapping
   window. **Best Average Time counts…** decides what that column means: blank averages *every* lap
   a driver submits, while a number gives the classic best N-consecutive-lap average.
2. **Add drivers and type their laps.** The picker offers the season's roster and the global driver
   pool, and a name that matches nobody is still perfectly valid — a placement night is run *for*
   drivers who aren't on a roster yet. Lap times take any clock format (`1:23.456`, `83.456`,
   `1:02:03.004`). Each driver's fastest lap is found from the laps themselves and shown in **bold**;
   click their name for the full list.
3. **Sort the sheet.** **Best Time** and **Best Average Time** are one-click sortable column headers.
   The sheet holds its order while you're typing — a lap that improves someone's best time would
   otherwise fling their row up the table mid-entry — and re-ranks when you sort, hit **Re-sort now**,
   or save.
4. **Place them.** On a **Placement Session** each row carries a dropdown for each kind of division
   you picked, and **⇅ Sort into … by time** splits the ranked field evenly across them, fastest
   first (the remainder lands on the quicker divisions). It's a starting point: every row stays
   editable.
5. **Complete Session** (top right) closes the sheet and offers to **build the roster** — every
   driver on it joins a roster in the division they were placed in. It shows exactly what it will do
   before writing, and a driver already on a roster is *moved* into their new division rather than
   duplicated, so re-sorting the field and pressing it again corrects rather than doubles.

**Classes or series — whichever your league calls a division.** Some leagues split a season into
classes; others run each division as its own **series**, with its own seasons, schedule and
championship. A placement night can sort into either, and the two compose:

- Tick the **series** to place into, and give each one the **season** whose roster it builds — a
  roster belongs to a season, not to a series, so each series names one (defaulting to its newest,
  the one being raced). Completing the session then builds *every* one of those rosters in a single
  run, and the summary reports each separately.
- Tick the **classes** to place into for divisions inside a season, exactly as before.
- Use **both** and a driver is sorted into a series *and* into a class within it. The divisions a
  row can be given then come from **that driver's own series' season** — never another season's
  classes, which would stamp a roster entry with an id it can't resolve. Sorting into divisions
  splits inside each series too, so the top of the Pro Series fills Pro's first division rather than
  the whole field's fastest drivers taking every quick division everywhere.

A driver sorted into a series has been placed whether or not they also drew a class — the series is
their division. On a class-only night, a driver with no division is still left alone rather than
guessed at. And a session that places into series needs no season of its own at all: the series
carry their own destinations.

**Getting the times onto a race weekend** works from either end. **Export to Qualifying** on the
session screen picks a scheduled event and copies the best laps over as its official qualifying
results — fastest lap on pole — replacing whatever qualifying that event had. Or, from the event's
**Qualifying** tab, **⏱ Import from Time Trial** fills the grid for you to review and save, exactly
like the CSV import beside it. Either way, anyone who isn't on that season's roster is named rather
than silently dropped: a result can only be filed against a roster entry.

**What a time trial does and doesn't count for.** It counts toward **no** racing statistic — not
Wins, Top 5s, Average Finish, Poles, or Championships — because it isn't a race and its laps are
never written as results. Its laps **are** eligible for the Global / Series / Class **Track
Records**, competing with race and qualifying laps on equal terms: the venue's record card names the
session and links back to the sheet. The one route into the official statistics is the export above,
which an admin performs deliberately, on an event they name.

### Typical first-time flow

`Sign in as admin → League Setup: create Game → Series → Season → Races → Drivers ▸ Roster &
Teams: add Drivers (link accounts where possible) → Teams ▸ Team Roster: add Teams to the season
and build their line-ups → Schedule: ⏱ on an event to enter results after each race →
Standings/Stats update automatically.`

## Project Layout

```
frontend/
  app/
    api/            ← Next.js API routes (all writes require a Firebase ID token)
      games/ series/ seasons/ teams/ team-seasons/ entries/ races/ results/
      standings/ stats/ roster/ users/ upload/ car-selection/
    page.js         ← Dashboard (per selected season)
    standings/      ← Driver + team points tables
    stats/          ← Scoped driver stats (season/series/game/league), sortable
    schedule/       ← Season calendar (admin: ⏱ enter results, ✎ edit event, 🗑 delete)
    calendar/       ← Global month-by-month calendar of every event in the league,
                      filtered by Game ▸ Series (lib/calendar.js holds its arithmetic)
    admin/          ← Admin: League Setup — build games/series/seasons/races, upload logos
    drivers/        ← Driver directory + public profiles (/drivers/[uid]: career stats,
                      race history, per-track stats), plus the admin User Accounts tab
                      (?tab=accounts)
    teams/          ← Team directory + public profiles (/teams/[team]: career stats, drivers,
                      season-by-season line-ups), plus the admin Team Roster tab (?tab=roster)
    approvals/      ← League-wide pending sign-up queue (Moderator+), behind the sidebar badge
    roster/         ← Admin ▸ Driver Roster: season rosters, car numbers, classes, teams, the
                      driver pool, the season's sign-up queue, and the badge for drivers
                      approved onto a roster since the admin last looked
    races/[id]/     ← Race results view; races/[id]/edit ← admin race info + results editor
    time-trials/    ← Time Trials & Placements hub; time-trials/[id] ← one session's sheet
                      (laps, Best Time / Best Average, division placement, Complete Session,
                      Export to Qualifying)
    signups/        ← Sign-ups: the player's three-step "join a series" walkthrough, the
                      seasons open to join, and where their sent sign-ups have got to
    series-info/    ← My Series: the seasons a player is already on, plus driver claiming, and
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

### One tick box for the whole app

Every checkbox and radio in the app — League Setup's switches, a results grid's tick cells, the
class picker, a modal's options — is drawn by **one block in `app/globals.css`**, keyed off
`input[type="checkbox"]` and `input[type="radio"]`. There are no per-screen sizes, and no
`style={{ width: 18, height: 18, accentColor: … }}` on individual inputs; that is what let them
drift into different shapes and sizes screen by screen in the first place.

Two things the shared rule fixes:

- **Size.** `.field input` stretches inputs to 100% width, which a bare browser checkbox obeyed —
  hence the hand-rolled sizes on *some* of them and not others. The size now lives in one place,
  with `.field`-scoped selectors included so it wins wherever a box sits inside a field.
- **Contrast.** The native control on this dark theme drew a faint outline when off and a small
  tick when on, and at a glance the two looked alike. **Off** is a clearly drawn empty box; **on**
  is a filled cyan box with a tick (a filled ring with a dot, for a radio), with matching
  focus, hover, indeterminate and disabled states.

Two helper classes go with it, for the row a box sits in: `check-row` (box beside a label, aligned
to the label's first line — the shape used by every "switch + explanation" row) and
`check-row-center`, for a one-line label that has nothing to align to the top of. Use those rather
than re-inlining flex on the wrapper.

### The global calendar

`/calendar` reads the **same** endpoint the Schedule's cross-season feed does — `GET /api/schedule`
with no `season_id`, optionally narrowed by `game_id` / `series_id` — so an event appears on the
calendar the moment it's created, with the same series/season/game context and the same
"has results yet?" answer. There is deliberately no second query for "all races": one feed, two
presentations.

The month arithmetic lives in `lib/calendar.js`, apart from the page that draws it and covered by
`lib/__tests__/calendar.test.mjs`. Its load-bearing rule is the one from `lib/raceDate.js`: a race
date is a bare `YYYY-MM-DD`, never an instant. `buildMonthGrid()` builds each cell from **local**
date fields and hands it its own date string, so plotting an event is a map lookup rather than a
date comparison — which is what stops a race sliding into the previous day west of Greenwich.
Days from the neighbouring months pad every week whole (dimmed, so they can't be mistaken for this
month's), undated events are listed under the grid instead of being dropped, and the page opens on
`initialMonth()` — the month being lived through if it has racing in it, else the next that does,
else the last that did.

**No game selected means no narrowing.** `calendarScopeQuery()` is the one place that decides what
the calendar asks for, and it reads a single rule: with no **Game** chosen, the calendar shows every
event in the league — every game, every series, upcoming and past. A **Series** narrows it *only*
while a game is selected, because a series belongs to a game; honouring one at "All Games" would
show a single game's racing under a heading that says every game.

That isn't a hypothetical. The scope tiers settle one at a time — choosing "All Games" empties
`gameId` immediately and `LeagueProvider` clears `seriesId` in a follow-up effect — so there is a
render where the game is "all" and the series is still the previous one. Two things keep the grid
honest across it: the query rule above ignores the stale series, and the fetch carries a **sequence
guard**, so an earlier narrow response that lands late can't overwrite the wide one. The page
heading, the filter hint and the empty state all derive from the same `gameId` check, so none of
them can claim a scope the grid isn't showing.

### Subscribing the calendar (the .ics feed)

`GET /api/calendar.ics` serves the league's racing as an iCalendar feed — the **📆 Subscribe**
button on the Calendar page hands over the URL, with one-click links for Google Calendar and for
Apple Calendar / Outlook (`webcal:`). It is a *subscription*, not an export: new rounds, moved
dates and newly published session times all reach every subscriber on their client's next refresh,
with nothing to re-download.

```
/api/calendar.ics                     every game in the league
/api/calendar.ics?game_id=…           one game
/api/calendar.ics?series_id=…         one series
/api/calendar.ics?season_id=…         one season
…&league_id=…                         which league
```

The scope comes from `calendarFeedPath()` in `lib/calendar.js`, which is built on
`calendarScopeQuery()` — so the feed you copy is exactly the calendar you were looking at. The
league rides in the URL rather than the usual `X-League-Id` header for the reason the route is
public in the first place: **a calendar client can't send headers or sign in**, so a feed that
required either could not be subscribed to at all. It exposes only what the public Calendar and
Schedule pages already show any visitor — event names, tracks, dates, and the session times an
admin chose to publish. No results, no drivers, no accounts, no write path.

How a race becomes calendar entries (`lib/icsFeed.js`, covered by `lib/__tests__/icsFeed.test.mjs`):

- **Session times published** → one timed entry *per session*: Practice, Qualifying and Race each
  arrive as their own appointment, so a driver can set a reminder on qualifying alone. Each is
  written as a **UTC instant** computed from the race's own zone and its own date, which is what
  lets every subscriber's client render it in their own timezone with no `VTIMEZONE` block to keep
  in step with the world's tzdata. Practice and qualifying block out 30 minutes, a race an hour —
  or its real length when the event runs to the clock.
- **No published times** → one **all-day** entry on the date the admin picked, which is exactly
  what a bare `YYYY-MM-DD` race date means. A race whose timezone was never saved falls back to
  this rather than publishing a start that might be hours out.
- **No date at all** → nothing. There is no day to put it on; it stays on the Calendar page under
  "Date to be announced".

Every entry carries a **stable UID** (`<session>-<race id>@phoenix-racing-league-manager`). That is
the whole difference between a subscription that updates a moved race in place and one that leaves
last week's copy behind next to it.

## Data model (Firestore collections)

`leagues (name, owner_id, logo_url, created_at)` is the top-level partition. Every
hierarchy/pool collection — `games`, `series`, `seasons`, `races`, `entries`, `teams`,
`team_seasons`, `results`, `drivers`, `tracks`, `points_templates` — carries a `league_id` and is read/written
scoped to the active league (sent as an `X-League-Id` header; see `lib/serverAuth.js`
`getRequestLeagueId`/`scopeByLeague`). `users` and `claim_requests` are **not** league-scoped —
accounts and their roles span leagues. That partition map lives once, in `lib/backup.js`
(`SCOPED_COLLECTIONS` / `GLOBAL_COLLECTIONS`), and is imported by both the containment migration
and the backup engine, so adding a collection can't leave one of them behind. `signup_requests`
(players waiting to be approved onto a roster) is league-scoped like the rest.

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

### A driver's race history

`buildCareerProfile` (`lib/careerStatsServer.js`) already walked every result belonging to a
driver's entries to build their career totals and per-track breakdown; `race_history` falls out of
the same pass, so the profile costs no extra reads. One row per **race session** the driver
started, carrying the race, its date and venue, the season/series/game it belonged to, the class
they ran in, their start and finish positions, laps, laps led, status and points.

Qualifying gets a row of its own, because it scores points of its own — leaving it out would print
a history whose points don't add up to the career total above it. Its position is a grid slot, so it
reports as a start with no finish. A race row still shows what it started from: the result's own
`start_pos` where the grid recorded one, since that's what the driver actually started from after
any penalty, else their qualifying position. Rows come back newest first (by race date, then round
number), and each links to `/races/<id>` — the same event page the Schedule opens — so a driver's
profile is a way *into* every race they ran.

### The pending request queue

`signup_requests` holds everything a player has asked for and no admin has resolved. It carries
**two kinds**, told apart by `kind`:

| `kind` | The ask | Approving it |
|---|---|---|
| `signup` (or absent) | "let me onto this season's roster" | creates the roster entry |
| `number_change` | "change my car number to #12" | edits the entry they already have |

They share one collection on purpose: it's the same job — a player asked, an admin decides — so the
Approvals page, the sidebar badge and the approve/deny buttons cover both with no second set of
plumbing. Rows written before number changes existed carry no `kind` at all, which is why absent
means `signup`.

Both kinds **spend a car number** while they wait: whether somebody is asking to join on #24 or to
move to #24, offering it to the next player as free would only make work for whoever resolves them.
`claimedNumbers` in `lib/signupQueue.js` reads the roster and the whole queue together. A number
change is not another person, though, so it never adds a row to a roster view — it hangs off the
row that driver already has, as "→ #24".

A player can **withdraw** their own pending request (`DELETE /api/signup-requests/[id]`, owner-only,
never staff): the row is marked `withdrawn` rather than deleted, so "asked and changed their mind"
stays readable, and the number it was holding is free immediately.

**A car number is unique within its season, on every path that can set one.** The sign-up form
checks as you type, the queue re-checks before granting a change (the number may have gone while
the request waited), and `PATCH /api/entries/[id]` checks when an admin types one by hand — that
last one being the path most likely to be used to *fix* a clash, and the one that used to be able
to create one. Clearing a number is always allowed; racing without one is legal.

**Removing a driver from a roster** deletes their entry, and their results in that season go with
it — there is nothing left to attach them to. So `DELETE /api/entries/[id]` refuses outright when
the entry has results, answering with how many; the roster's dialog reports that number and asks
again before passing `?confirm=results`. Dropping somebody who signed up and never raced stays one
click; deleting eight races of history is never one.

`POST /api/signup-requests` only ever writes a `pending` row — there is no path from the Sign-ups
screen to the `entries` collection — and `PATCH /api/admin/signup-requests/[id]`, admin-gated, is what
creates the roster entry. The car chosen at
sign-up is written onto that entry in the same field the lock-in screen uses (`selected_car`), so
an approved sign-up needs no second trip to choose what was already chosen — and the season's
screen shows that pick on the roster grid even where no standing lock-in question is asked.

Pending rows count as **spoken for** when a later player picks a number: `numberClaimed` in
`lib/signupQueue.js` reads the roster and the queue together, so two people can't both be waiting
on #24. They're shown, marked *pending*, in the roster the sign-up form displays.

Approval re-reads everything that could have changed while a request sat in the queue — the season
closing (refused, with a message), the driver having been added by hand (no second entry), the
number being taken (seated without one, and the admin is told). A queue is exactly where stale data
comes from, so none of it is trusted at approval time.

The collection is league-scoped and included in backups: a restore that dropped it would silently
lose everyone who had signed up but not yet been approved.

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

### The sign-up requirement chain

Everything a sign-up can be made to carry — a car lock-in, a car number, and the
lock itself — is set on any of **four** levels and resolved in `lib/carSelection.js` by one rule:

    game  →  series  →  season  →  class        the most specific level with an OPINION wins

"An opinion" is the load-bearing half: a level that was never configured must not override the
level above it. Each switch is therefore stored as a three-state `<field>_mode` — `""` (inherit),
`"on"`, `"off"` — beside the original boolean, which is still written (true only for `"on"`) so
every older reader keeps working.

A document saved before modes existed has no mode, and is read through its boolean: `true` means
"required here", `false` means "never configured". That is exactly what those values meant when
they were written, so **no existing league's setup changes** — a series requiring car numbers keeps
requiring them under seasons that store a bare `false`, while an admin now has a real way to switch
one season off.

`resolveSignupRules({ game, series, season, cls })` returns the resolved answers plus
`require_number_from` / `require_car_from`, naming the level that
decided — which is what lets League Setup label a switch *"Inherit — required by the series"*
instead of leaving an admin to guess. `seasonContext` loads the game alongside the series, so no
caller can accidentally resolve a season without the top of its chain.

**Required contact & platform information.** Two rules decide what a sign-up has to carry, both in
`lib/signupRequest.js` so the form, the API and the approval step apply exactly one set:

1. **Discord, always.** Every sign-up, for every game, series, season and class, needs the player's
   Discord name. There is no toggle — it's how a league talks to its drivers.
2. **Whatever the game asks for.** A `Game` document carries `requires_steam`, `requires_psn`,
   `requires_xbox`, `requires_iracing_name` and `requires_iracing_id` (all default `false`), set
   from **League Setup ▸ Games**. `requiredAliases(game)` turns them into the labelled rows the
   form renders, and `missingRequiredAliases()` is what disables **Submit** — and what the API
   rejects on, since the form is not the security boundary.

A game *named* iRacing carries `requires_iracing_name` and `requires_iracing_id` implicitly
(`isIracingGame`), whether or not the boxes are ticked, so no league loses the invite-only rule by
upgrading to the toggles.

**The answers sync to the driver profile.** Labels match `DEFAULT_ALIAS_LABELS` in `lib/aliases.js`
exactly, so a sign-up writes to the same alias rows the admin's Driver Edit dialog does. `POST
/api/signup-requests` folds what was typed into `drivers/<id>.aliases` with `mergeAliases()` the
moment it's submitted — approval isn't waited for, because a platform username is a fact about the
person, not about the roster place. The merge is by label and case-insensitive: a new value wins, a
blank one **never** erases a saved one, and a platform this game didn't ask about is left alone.
A player with no driver profile yet carries their answers on the request; approving it writes them
onto the profile it creates, and the form reads them off the request in the meantime — see
*What a sign-up saves* below.

### What a sign-up saves, and what it refuses to overwrite

A sign-up is the one moment the app learns who somebody actually is: the name they race under,
the number they run, and the platform usernames the league reaches them on. Those are facts
about the **person**, not about the roster place, so they're written the moment the request is
filed — approval isn't waited for, and nothing here touches a roster. Three records take them,
and each takes only what it owns:

| Record | Takes | Rule |
|---|---|---|
| `signup_requests/<id>` | everything submitted | the request itself; the only home for a new player's answers until an admin approves them |
| `drivers/<id>.aliases` | the platform usernames | **merged**, never replaced |
| `users/<uid>` | `display_name`, `number` | **filled in only**, never overwritten |

**Merged, for the driver profile.** The form only asks for what the game it's for requires, so
writing its answers over the profile would drop every platform it didn't ask about — a Wreckfest
sign-up (Discord only) would wipe the Steam name an iRacing sign-up saved. `mergeAliases()` is
by label and case-insensitive: a new value wins, and a blank one never erases a saved one.

**Filled in only, for the account.** An account is created at sign-in with a display name
invented from the email (`jane.doe@example.com` → "jane.doe"), which is a placeholder nobody
chose; replacing that with the name they told us they race under is an improvement. Replacing a
name they set on their **Profile** is not. `isPlaceholderDisplayName()` is the whole distinction,
and `userAccountUpdatesFromSignup()` returns *only* the fields that should be written — an empty
object means the account is left alone entirely. The same applies to the car number: written when
the account has none, never changed, and never blanked by a season that doesn't run numbers.
Both `POST /api/signup-requests` and the approval step apply it, so a request filed before this
existed still brings the account up to date when it's approved.

**Editing it afterwards.** `GET`/`PATCH /api/users/me/driver` are the player's own door to those
aliases — the profile is resolved from the caller's account rather than taken from the request, so
there is no way to edit somebody else's. Aliases are the *only* field of a driver profile a player
may write; the name, display names and notes stay admin-only, since those decide how the whole
league sees them. `components/ConnectedAccounts.jsx` renders it on **Profile** as a card of its own
with its own Save, beside the account form rather than inside it, because the two write to
different records — saving one must never silently rewrite the other. It shares `<AliasEditor>`
with the admin's Driver Edit dialog and the sign-up form, so a driver describes themselves the same
way whoever is filling it in.

**Reading it back is what makes it worth saving.** `GET /api/users/me/series` returns
`known_aliases` and `known_name` — everything this ACCOUNT has already given, whether or not a
driver profile exists to hold it yet. This was a real bug: a first-time player signed up for one
series, opened a second sign-up ten seconds later, and was asked for their Discord name, Steam
name and iRacing customer ID all over again, because only the driver profile was being read and
theirs wouldn't exist until an admin got to the queue — the retyping the sync exists to prevent,
aimed at the one player least likely to tolerate it. `knownAliasesFor()` reads the profile when
there is one and the pending requests when there isn't (oldest first, so the newest answer wins),
and the tick beside a pre-filled box says which it came from: *✓ from your profile*, or *✓ from
your last sign-up*.

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

**The question is only asked where a number is required.** `resolveSignupRules()` answers
`require_number` down the usual game → series → season → class chain, and `<SignupForm>` renders the
number field only when it comes back true — a league that doesn't run numbers sees nothing, not an
optional box. Because a class can require what its season doesn't, picking one re-resolves the rule
mid-form: the field appears (or disappears) as the class changes. Everything about the number reads
that same answer, so the three can't disagree — the field, the as-you-type "that number is taken"
check, and what's submitted. A number typed before the question went away is cleared from the form
state *and* dropped again at submit, which is what stops a value nobody was asked for riding along
on the request — or, worse, a stale clash disabling **Submit** with nothing on screen to explain it.

### The Sign-ups screen

`app/signups` is the only screen in the app aimed at somebody who has never used it, and it's
built as a **walkthrough, not a page**: it renders exactly one of three things at a time — the
list of series, the form for the one that was chosen, or the "you're in the queue" confirmation.
The three steps are printed above whichever one is showing, with the current one lit, so nothing
about the process has to be inferred from a disabled button.

It decides nothing itself. One call to `GET /api/users/me/series` answers which seasons are open,
what each asks a sign-up to carry, and whether this account already has one waiting; every list,
count and sentence on screen is then derived by **`lib/signupFlow.js`**, which is pure and covered
by `lib/__tests__/signupFlow.test.mjs`. The rules that matter are asserted there rather than left
to a human to spot:

- a sign-up already sent never appears as something to join again (`my_pending` splits
  `joinableSeasons` from `awaitingSeasons`) — the commonest way a first-timer ends up in the queue
  twice;
- the sidebar badge counts only what is waiting on the **player** — series they could join, plus
  cars they still have to choose — so it falls when *they* act, never when an admin does;
- **What this form asks you for**, printed above the form, is derived from the same two sources
  the form renders itself from, so it can't promise a different set of questions than the one
  that follows;
- an empty list says **which** of four things happened — a sign-up already in flight, every
  season already joined, every other season finished, or a league with nothing scheduled. This
  one was caught in testing: a player who had just sent a sign-up was told "every other season
  has been marked finished", which reads as though their sign-up had gone nowhere.
  `nothingToJoinReason()` picks the reason and is asserted against all four states.

Submitting still goes through the shared `<SignupForm>` — the same component a season's own screen
opens in a dialog — so the two ways in ask for identical things, and neither can put anybody on a
roster: both file a pending request (see the approval queue above).

That payload is fetched **once for the whole app** by `components/MySignupsProvider.jsx`, mounted
inside `LeagueProvider` so a league switch re-asks. The Sign-ups screen, the sidebar badge and the
Dashboard card all read that one context — the route does a roster query and a pending-queue query
per open season, so three independent copies of it would be three times the reads for one answer,
and three answers that could disagree for a second after a sign-up. `mySignupsChanged()` refreshes
every reader at once, the moment a sign-up is sent or a car is locked in.

Joining lives here and **only** here: `/series-info` is now My Series (the seasons you're already
on) and links across rather than carrying a second copy of the form.

### Telling an admin where an approval went

Approving a sign-up is the only admin action whose *result* lands somewhere the admin isn't
looking. It creates a roster entry in one season — very often not the season the dropdowns are
on — and the queue it was approved from then empties, so nothing was left on screen to say it had
happened or where. The fix is a badge and two strips on **Admin ▸ Driver Roster**, and the rules
behind them live in **`lib/rosterAdditions.js`**, which is pure and covered by
`lib/__tests__/rosterAdditions.test.mjs`:

- **Only what's new.** `newAdditions(rows, seen)` counts approvals resolved after a "seen" stamp
  in localStorage (`lib/rosterAlerts.js`), stamped to *now* on first ever load so a new admin
  isn't greeted by the league's entire back catalogue.
- **Only people who joined.** A car-number change is in the same queue and is approved the same
  way, but nobody joined anything — announcing it as "added to a roster" sends an admin hunting
  for a driver who was already there. `isNumberChange` filters them out of both strips.
- **Grouped by the roster they landed on**, because that's the unit an admin acts on: one trip to
  a season's roster settles everyone who joined it, so there's one **Open this roster →** button
  per season rather than one per person. It calls `setGameId`/`setSeriesId`/`setSeasonId` in that
  order — parent first, so each tier's refetch keeps a selection that's valid underneath it.

**It clears by being read, not by being worked.** That's the difference from the Approvals badge
next to it: Approvals counts an outstanding *job* and falls when somebody does it, so it must not
be dismissible. This counts *news* — the work is already done — so it clears on a deliberate
**Got it** and never merely by opening the page, since an admin who glanced at the screen on
their way elsewhere hasn't read it.

**The same blind spot exists at the other end**, and `pendingElsewhere()` closes it: the approve
queue on this screen is scoped to one season (approving from a list spanning every season is how
you approve somebody onto the wrong one), which meant a sign-up for any other season was
invisible until the admin happened to steer the dropdowns at it. A second strip names who is
waiting where, with a button to that season's queue.

### Telling a player their sign-up was denied

Denying a sign-up used to be silent. The request went to `denied` with the admin's reason attached,
the approvals queue emptied, and the player was told nothing — from their side indistinguishable
from a sign-up that never arrived, so they filled in the identical form again and were denied again
for the identical reason.

The reason now reaches them **twice**, and both messages are built from one request document by
`lib/denialNotice.js` (pure, tested) so they can't tell different stories:

- **Email**, queued as a Firestore document by `lib/mailer.js` in the shape Firebase's official
  **Trigger Email from Firestore** extension consumes (`mail` collection, `{ to, message }`). No
  SMTP credentials, no new dependency, and the admin's click never waits on a mail server. **If
  that extension isn't installed nothing is delivered** — the documents simply queue up as a
  record. That's deliberate: email is the nudge, the app is the source of truth.
- **A panel at the top of Sign-ups**, which is the half that always works. It quotes the admin's
  words, and until the player presses **Got it — let me try again** (`PATCH
  /api/signup-requests/[id]`, owner-checked, stamping `player_seen_at`) that season is held out of
  their join list — so the reason is read before the same form is filled in a second time. The
  button also drops them straight into that series' form, so "fix it and retry" is one action.

The reason is free text an admin typed and it lands in an HTML email body, so `denialHtml` escapes
every human-supplied value; the plain-text half keeps it verbatim. Both are asserted.

**The same machinery carries the good news.** An approval was as quiet as a denial: the request
left the queue, a roster entry appeared, and unless the player happened to open Sign-ups and notice
their series had moved from "waiting" to "racing", nothing told them. `unreadApprovals()` drives a
welcome banner on the Dashboard (`components/WelcomeToSeries.jsx`), cleared by the same acknowledge
call. Approved **number changes** are excluded — welcoming somebody to a series they have raced for
six weeks is the kind of notification that teaches people to ignore notifications.

### Capping how many drivers may run a car

A car's line in the Car Selection list can carry a limit after a pipe — `Ferrari 296 GT3 | 4`.

The pipe is the separator because it appears in no car name anyone has typed, unlike the `x4` an
admin reaches for first (a real car could be `Cup Car x4`), and because it keeps the list a
**single text field** — so a cap inherits down the game → series → season → class chain exactly as
the list does, with no second field to resolve and no migration for lists already saved. A line
with no pipe has no cap, which is every list that existed before this. Anything after the pipe that
isn't a positive whole number means "no cap" rather than "nobody may pick this", because silently
offering a car nobody can choose is the worse failure.

**What counts toward a cap is the roster PLUS the queue.** Five people each picking the last
Ferrari, every one of them told it was free because nobody had been approved yet, is precisely the
pile-up the cap exists to prevent — the same rule car numbers already use. A driver's own current
car never counts against them, or the person holding the last seat couldn't re-save their own
choice.

It's enforced in four places, all reading `carAvailability`/`carCapacity` in `lib/carSelection.js`
so they cannot disagree: the sign-up form greys the option out and badges it **FULL**, `POST
/api/signup-requests` refuses it with a `car-full` code, `POST /api/car-selection` refuses it on the
lock-in screen, and the approval step seats a driver **without** a car (saying so in its note) when
the one they asked for filled up while they waited — the same way it already handles a car number
being taken. Being on the roster matters more than the car, which they can pick again.

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
and `entries (season_id, team_id, class_id, user_id, number)` / `teams (name, logo_url, color)` +
`team_seasons (team_id, season_id, driver_ids[])` →
`results (race_id, season_id, entry_id, class_id, points_template_id)`. `users` holds player profiles; linking a
roster entry to a user account is what feeds their public career stats.

`time_trials (league_id, name, game_id?, series_id?, season_id?, track_id, track, date, max_laps,
average_laps, is_placement, class_ids[], series_ids[], series_seasons{}, sort_key, status)` and
`time_trial_entries (time_trial_id, league_id, name, driver_id?, user_id?, entry_id?, laps[],
assigned_class_id, assigned_class_name, assigned_series_id, assigned_series_name, position)` hold
the Time Trials & Placements sessions.

**They are deliberately not `results`, and that is the whole design.** The stats engine reads
`results`; a trial's laps are never written there, so a time trial counts toward **no** standard
racing statistic — no Wins, Top 5s, Average Finish, Poles or Championships — and there is nothing to
exclude and nothing that can leak in by accident as new stats are added. Every trial is optional at
every level of the hierarchy (a placement night usually happens *before* the season it feeds exists),
which is another thing a `results` document could never be: a result belongs to a race, and a race
belongs to a season.

Laps ride on the entry as an **array of clock strings**, exactly as they were typed — one driver
submits many laps and how many is not known in advance, so they are the row rather than a row each.
Everything derived from them (each driver's fastest lap, Best Time, Best Average Time, the ranked
order, the placement split, the qualifying grid an export produces) is computed by one dependency-free
module, `lib/timeTrials.js`, covered by `lib/__tests__/timeTrials.test.mjs`; `lib/timeTrialsServer.js`
supplies the Firestore reads around it. That is why the bolded fastest lap in the grid, the Best Time
column beside it, the expanded lap list and the exported qualifying time can never disagree — they
are the same function.

**Best Average Time says which laps it averages.** `average_laps` of 0 (the default) averages *every*
lap a driver submitted — the consistency measure a placement night wants, where one scruffy lap
counts. Set it to N and the column becomes the classic best **N-consecutive-lap** average, and a run
may not jump a lap that wasn't completed. `max_laps` of 0 is an unlimited hot-lapping window.

**Two deliberate bridges out.** Time trial laps *are* eligible for the Global / Series / Class
**Track Records** — a lap is a lap, whatever session turned it — so `fetchTrackRecordLaps` hands each
driver's fastest lap to `lib/trackStatsServer.js`, which folds them through the same `keepFastest`
rules the race laps go through; a trial lap holds a venue record only by being quicker than every
race lap, and vice versa. They reach the records and nothing else: never the venue leaderboard, never
the past-winners list. The other bridge is **admin-driven and named**: `POST
/api/time-trials/{id}/export-qualifying` copies the best laps onto one scheduled race as its
Qualifying, and from that moment they are ordinary qualifying results that score qualifying points
and set poles like any other. Nothing crosses over without an admin asking for it, on a named event.

**A division is not always a class.** Some leagues run each division as its own **series**, so a
placement night can sort into `series_ids` as well as (or instead of) `class_ids`. A roster belongs
to a *season*, not to a series, so `series_seasons` maps each series to the season whose roster it
builds — `targetSeasonFor()` is the single rule that decides where a row's entry is written (its
series' season, else the trial's own), and the same rule decides which season's classes that row's
Division cell may offer, so a class stamped on an entry always exists in the season that entry lives
in. `groupByTargetSeason()` then splits the sheet per season and the roster run builds each one,
which is how a single night produces several rosters. Sorting into divisions on such a night splits
*within* each series (`autoAssignClassesWithinSeries`), so each series' own field fills its own
divisions. A trial placing only into series needs no `season_id` at all.

**Building a roster from a placement is idempotent.** `planRosterBuild` matches drivers to that
season's roster the way the rest of the app matches them — global `driver_id`, then linked account,
then lowercased name — and a driver already there is **updated** into their new division rather than
duplicated. Re-sort the field and press **Complete Session** again; it corrects, it doesn't double.
Its `requireClass` rule may be a function of the row, which is what lets a series placement stand on
its own: being sorted into the Pro Series *is* a placement, class or no class, while on a class-only
night an unplaced driver is still left alone.

**Teams are persistent, line-ups are seasonal.** A `teams` document is the team itself — league-wide,
with its own name, badge and colour, exactly like a driver in the global pool. Who drives for it is a
*separate* document, `team_seasons`, holding one `driver_ids[]` per season. That's what lets Ana race
for Phoenix Motorsports in Season 1 and for Falcon Racing in Season 2 without either team losing a
point of its history: her Season 1 results stay Phoenix's forever, and her Season 2 results are
Falcon's. `driver_ids` are **global** driver ids (`drivers/{id}` — what `entries.driver_id` points
at), so a line-up survives a rename, a new car number, or the driver being entered under a different
alias in another series.

`entries.team_id` is kept **mirrored** from the line-up, the same way `entries.class_id` mirrors
`class_ids[0]`: the line-up is the source of truth, and the mirror is what keeps every reader written
before `team_seasons` existed — a results grid, an event page, an export — showing the right team. The
sync runs both ways, so setting a driver's team on the roster puts them on that team's line-up, and
editing the line-up re-tags their entry. A driver belongs to **one team per season**; adding them to a
second team moves them, which is what makes the aggregation unambiguous.

The rules live once, in `lib/teams.js` (pure, and covered by `lib/__tests__/teams.test.mjs`) with the
Firestore reads and writes in `lib/teamsServer.js`. Every stats path — standings, the stats tables, a
team's profile, the event page, the roster — resolves a driver's team through the same index, so the
three tables can never disagree about who scored what. Teams created before this existed were one doc
*per season*, matched up by name; that shape still resolves (the canonical doc for a name is the
oldest, or any global one), and **Teams ▸ Team Roster** offers a one-click upgrade
(`POST /api/admin/teams/migrate`) that folds each name into a single permanent team and writes its
season line-ups. The migration is idempotent and re-points every roster entry *before* deleting a
duplicate, so no driver — and no result — is ever stranded.

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

    series default → season → the season's or event's heat/consolation default, or an event-wide session template → the class's own structure → the class's own heat/consolation default → that class's own session template

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
event-wide assignment rather than to nothing. A class's Qualifying is resolved the same way, so its
qualifying points are scored under *that class's* Qualifying structure.

**Heats and consolations score on a default, set once — per season, per class or per event.** A heat
weekend is the one shape where the per-session dropdown becomes a chore: eight heats and two B-Mains
means ten trips through it, every round of the season. So three levels carry a **Heat Races and
Consolation Races** tick, and each one that's ticked offers the same two pickers — a default points
template **for every Heat** (`heat_points_template_id`) and one **for every Consolation**
(`consolation_points_template_id`):

| Where | Ticked on | Covers |
| --- | --- | --- |
| **Season** (League Setup → Seasons, and the Schedule's *New Season* dialog — the tick sits with the other season switches, its two pickers inside **Points & Bonuses**, under Race Points and Qualifying Points) | `seasons.heat_format` | every heat/consolation of every event in the season |
| **Class** (League Setup → Classes) | `classes.heat_format` | every heat/consolation **that class** runs |
| **Event** (Race Info — League Setup's Races panel, the New Race dialog, the race edit screen) | `races.heat_format` | every heat/consolation of that one event |

Pick a template at whichever level is true for your league and every heat (or every consolation) in
scope scores on it, including sessions added later — nothing is copied onto the sessions themselves.
A season with the tick on also **pre-ticks heat racing on every new race** — in League Setup's Races
panel and the *New Race* dialog alike — since every round of a heat season is a heat weekend; untick
it on the odd standard-format round.
**Most specific wins:** the event's default beats the class's, which beats the season's, and a
template assigned to ONE session from its own results tab beats all three. `inheritedSessionTemplate`
in `lib/standings.js` holds that order.

Where a default sits in the class chain depends on who named it, for the same reason a session
assignment does. The **season's** and the **event's** are statements about the whole field, so they
sit *under* the class layer — a class scoring on its own points structure outranks them. A **class's**
own default sits *on top* of that class's structure, since it is a statement about that class:
otherwise a class with its own points would ignore the very heat template it was given.

The default is resolved at scoring time (`resolveTemplateId`, stamped onto each result by
`decorateSessionFlags`, which reads the season/class docs through `sessionScopeContext`) rather than
written onto saved results — which is what makes it a default: change the season's heat template and
every heat under it re-scores at once, on every screen, with no re-save. Naming a default also flips
**championship points on** for that session type, which is off by default for preliminary sessions —
the point of picking a heat scale is that the heats pay it. Stats stay off (a heat is still a
preliminary for Wins and Average Finish), and each session keeps its own points switch, so one heat
can still be excluded. The results screen's points dropdown names the default and the level it came
from ("Heat default · season — PRA Heats"), so it is always visible which of the three is scoring.
Leave the pickers on *No default* — or leave the ticks off — and heats and consolations behave exactly
as they always have. A copied race carries its own two defaults over with the rest of its scoring
setup.

**Qualifying scores itself.** Every session scores itself, off its own structure, at the position the
driver took in it: Qualifying pays the qualifying scale for the grid slot won (pole being position 1
of it), a race pays the race scale for where they finished. A driver's championship total is the sum
of those numbers and nothing else, which gives the standings a property they did not have before —
**you can add up the Points column of every session and land on the total**. `pointsFor` in
`lib/standings.js` branches on the session type; `calculateStandings` sums every session whose points
toggle is on.

Qualifying used to score nothing of its own. Its points were folded invisibly into a race result
instead, and that is what made the championship impossible to check by hand: the race row showed 385
where 350 was the win and 35 was the pole, while the Qualifying grid separately printed that same 35
in a Points column that fed nothing. Adding the two visible numbers double-counted the pole; trusting
either alone under-counted it — so the identical result could look both double-counted and missing
depending on which screen you started from.

Folding also forced a question with no good answer: when an event runs several races, which one hides
the award? The first? The first that scores points? The first the driver actually started? Each
answer broke a different setup — a session list that happens to name "Qualifying" (which this
README's own example once suggested) pointed the award at a session holding no race results at all,
and a race scored on a points template read its qualifying scale off a season scale that leagues
usually leave blank. Scoring Qualifying where it happens deletes the question: an event has one
Qualifying, so it pays once, on its own line, and nothing has to be resolved across sessions.

**Turning it off.** Qualifying carries the same championship-points switch every other session has
(`races.session_points_enabled["Qualifying"]`, on the Qualifying tab). Turn it off for a session that
sets the grid and pays nothing — it still shows on the event page and still feeds Poles and Average
Start. Setting Qualifying's points system to **No Points** does the same for one event's scale.

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

The player flow is about what a player still has to do, so a completed season leaves it
altogether — `/signups`, `/series-info` and the Dashboard card alike. That's enforced once, in
`/api/users/me/series`, which filters `my_seasons` through `seasonAcceptsSignups` before either
screen sees it, so no screen can reinstate them. A series whose seasons are all complete therefore
disappears from the flow on its own; there is no separate "series is over" flag, and none is
needed. The season's own page (`/series-info/[id]`, fed by `/api/car-selection`) still opens from a
direct link and leads with **Season over**, turning every control below it read-only — so the
record is reachable, just not in the way. Nothing is deleted: reopening the season restores
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

**Seasons are ordered by the racing, not by data entry.** A season's position is derived from the
race dates on its schedule — earliest race first, latest race as the tie-break — and every list runs
**newest at the top**. That's what stops a league that entered Season 5 before Seasons 2, 3 and 4
from being stuck reading `1, 5, 2, 3, 4` in the Season dropdown forever. The dates are never stored
on the season doc: `lib/seasonOrderServer.js` reads them from the races collection and stamps
`first_race_date` / `last_race_date` onto each season the API hands out, so adding, moving or
deleting a race reorders the menus by itself with nothing to keep in sync. A season with no dated
races falls back to when it was created, which puts one being set up right now at the top where an
upcoming season belongs.

Admins can override it: the **▲ ▼** arrows in League Setup → Seasons write a hand-set order through
`POST /api/seasons/reorder`, which stamps `sort_order` as a contiguous `0,1,2…` run down the whole
series (a position only means something relative to the rest of the list), and **↺ Sort by race
date** clears them back to null. The two live on one scale in `sortSeasons` (`lib/seasonOrder.js`):
a season with no `sort_order` of its own uses its *rank* in the date ordering as its key, so a
season created after a hand-sort still slots in by date instead of silently landing at the bottom.

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

## License

Released under the MIT License — see [LICENSE.txt](LICENSE.txt). The software is provided
"as is", without warranty of any kind, and the authors are not liable for any claim or damages
arising from its use.
