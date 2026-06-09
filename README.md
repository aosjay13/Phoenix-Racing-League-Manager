# Phoenix Racing League Manager

**GitHub:** [aosjay13/Phoenix-Racing-League-Manager](https://github.com/aosjay13/Phoenix-Racing-League-Manager)

Full-stack racing league manager with live standings, roster management, schedule, and race entry. Runs entirely on Next.js — deploy for free on Vercel with no separate backend needed.

- **Frontend + API:** Next.js 14 App Router (API routes replace the Python backend)
- **Database:** Firebase Firestore

## Deploy to Vercel (free)

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click **Add New → Project** and import `Phoenix-Racing-League-Manager`
3. Set **Root Directory** to `frontend`
4. Under **Environment Variables**, add these three values from your `service-account.json`:
   - `FIREBASE_PROJECT_ID` → the `project_id` field
   - `FIREBASE_CLIENT_EMAIL` → the `client_email` field
   - `FIREBASE_PRIVATE_KEY` → the full `private_key` field (include the `-----BEGIN...END-----` lines)
5. Click **Deploy** — your app is live in about a minute

## Local Development

```bash
cd frontend
npm install
npm run dev
```

Create a `frontend/.env.local` file (copy `.env.example` and fill in your Firebase credentials).

## Project Layout

```
frontend/
  app/
    api/          ← Next.js API routes (drivers, races, results, standings)
    page.js       ← Dashboard
    roster/       ← Roster management
    schedule/     ← Season schedule
    race-entry/   ← Submit race results
    standings/    ← Live points table
  lib/
    firebase.js   ← Firebase Admin initialization
    standings.js  ← Points + drop-week calculation
  components/
    AppShell.jsx  ← Sidebar navigation
    StandingsTable.jsx
```

## API Endpoints

All served by Next.js under `/api/`:

- `GET  /api/health`
- `GET  /api/drivers?season=2026` · `POST /api/drivers`
- `PUT  /api/drivers/[uid]` · `DELETE /api/drivers/[uid]`
- `GET  /api/races?season=2026` · `POST /api/races`
- `POST /api/results`
- `GET  /api/standings?season=2026&drop_weeks=1`

## Next Steps

1. Add auth and role permissions for commissioners and admins
2. Add result editing/deletion
3. Add CSV import UI for bulk result entry
4. Add CI pipelines for linting and tests
