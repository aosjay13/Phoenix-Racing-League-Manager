# Racing League Manager

Full-stack starter for a racing league manager built in GitHub Codespaces.

- Backend: FastAPI + Pandas + Firebase Firestore
- Frontend: Next.js (App Router) with a custom visual theme

## Project Layout

- `backend/` Python API and league logic
- `frontend/` web interface and dashboards

## Backend Features Implemented

- Driver, race, and result API endpoints
- Firestore connection setup
- Standings calculation with:
  - points scale
  - tie-breakers (wins, Top 5, average finish)
  - drop-week support
- Utility scripts:
  - `database_setup.py`
  - `calculations.py`
  - `importer.py`

## Frontend Features Implemented

- Branded application shell and sidebar navigation
- Pages for:
  - Dashboard
  - Roster Management
  - Schedule and Calendar
  - Race Entry
  - Standings Table
- Standings page fetches backend standings endpoint
- Responsive styling and light-motion reveal effects

## Environment Setup

1. Copy `.env.example` to `.env`.
2. Fill in Firebase values.
3. Set `NEXT_PUBLIC_API_BASE_URL` to your backend URL.

## Run Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Run Frontend

```bash
cd frontend
npm install
npm run dev
```

## API Endpoints

- `GET /api/health`
- `POST /api/drivers`
- `GET /api/drivers?season=2026`
- `POST /api/races`
- `GET /api/races?season=2026`
- `POST /api/results`
- `GET /api/standings?season=2026&drop_weeks=1`

## Utility Script Examples

```bash
cd backend
python importer.py --service-account ./service-account.json --csv ./results.csv --season 2026
```

## Next Implementation Steps

1. Add auth and role permissions for commissioners and admins.
2. Add backend tests for tie-breaker and drop-week edge cases.
3. Add result editing/deletion workflows and API endpoints.
4. Add CSV import UI and upload status reporting in the frontend.
5. Add CI pipelines for linting, tests, and production builds.
