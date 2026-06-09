# Phoenix Racing League Manager

**GitHub:** [aosjay13/Phoenix-Racing-League-Manager](https://github.com/aosjay13/Phoenix-Racing-League-Manager)

Full-stack racing league manager — FastAPI + Firebase Firestore backend, Next.js dark-themed frontend with live standings, roster, schedule, and race entry.

- **Backend:** FastAPI + Firebase Firestore (Python)
- **Frontend:** Next.js 14 App Router, dark racing UI

## Project Layout

- `backend/` — Python API and league logic
- `frontend/` — Next.js web interface and dashboards
- `render.yaml` — Render Blueprint for one-click backend deployment

## Hosting

### Backend → Render

1. Go to [render.com](https://render.com) and sign in with GitHub
2. Click **New → Blueprint** and select this repo — Render reads `render.yaml` automatically
3. In the environment variables panel, add these three values from your Firebase service account JSON:
   - `FIREBASE_PROJECT_ID` — the `project_id` field
   - `FIREBASE_CLIENT_EMAIL` — the `client_email` field
   - `FIREBASE_PRIVATE_KEY` — the full `private_key` field (including `-----BEGIN PRIVATE KEY-----`)
4. Click **Apply** — Render builds and starts the API. Copy the service URL (e.g. `https://phoenix-racing-api.onrender.com`)

### Frontend → Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click **Add New → Project** and import this repo
3. Set **Root Directory** to `frontend`
4. Under **Environment Variables**, add:
   - `NEXT_PUBLIC_API_BASE_URL` = the Render service URL from the step above
5. Click **Deploy**

## Local Development

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Copy `.env.example` to `.env` and fill in your Firebase credentials and API URL.

## API Endpoints

- `GET  /api/health`
- `POST /api/drivers`
- `GET  /api/drivers?season=2026`
- `POST /api/races`
- `GET  /api/races?season=2026`
- `POST /api/results`
- `GET  /api/standings?season=2026&drop_weeks=1`

## Next Steps

1. Add auth and role permissions for commissioners and admins
2. Add result editing/deletion workflows
3. Add CSV import UI for bulk result entry
4. Add CI pipelines for linting and tests
