# Phoenix Racing League Manager

**GitHub:** [aosjay13/Phoenix-Racing-League-Manager](https://github.com/aosjay13/Phoenix-Racing-League-Manager)

Multi-game racing league manager built to replace the league spreadsheet. Anyone can sign up
for a driver account; league admins build out the full hierarchy with custom names and logos:

**Game** (e.g. iRacing) → **Series** (e.g. Asphalt Assault Series) → **Season** (Season 1, 2, 3…) → **Race** (Race 1, 2, 3…)

## Features

- 🔐 **Login for everyone** — email/password or Google sign-in (Firebase Auth)
- 🧑‍✈️ **Player profiles** — public profile pages with editable picture, number, bio; career
  stats auto-aggregated across all games with a per-game dropdown filter
- 🏆 **Live standings** — driver *and* team championships with configurable points scale
  and drop weeks per season
- ⏱ **Fast race entry** — one grid per race, pre-filled with the roster; re-submitting a
  race overwrites cleanly for corrections
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

## Project Layout

```
frontend/
  app/
    api/            ← Next.js API routes (all writes require a Firebase ID token)
      games/ series/ seasons/ teams/ entries/ races/ results/ standings/ users/ upload/
    page.js         ← Dashboard (per selected season)
    standings/      ← Driver + team points tables
    schedule/       ← Season calendar
    race-entry/     ← Admin: submit/edit race results
    roster/         ← Admin: season roster + teams
    admin/          ← Admin: build games/series/seasons/races, upload logos
    drivers/        ← Player directory + public profiles (/drivers/[uid])
    profile/        ← Edit your own profile
    login/          ← Sign in / create account
  lib/              ← Firebase admin + client init, auth guards, standings math
  components/       ← AppShell, Auth/League providers, ImageUpload, AdminGate
firebase/           ← Firestore + Storage security rules
backend/            ← Legacy Python backend (unused; superseded by Next.js API routes)
```

## Data model (Firestore collections)

`games` → `series (game_id)` → `seasons (series_id, game_id, drop_weeks, points_scale)` →
`races (season_id)` and `entries (season_id, team_id, user_id)` / `teams (season_id)` →
`results (race_id, season_id, entry_id)`. `users` holds player profiles; linking a roster
entry to a user account is what feeds their public career stats.
