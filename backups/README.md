# Backups

Automatic weekly snapshots of the entire application land here.

Every **Saturday at 3:00 AM Eastern**, `.github/workflows/weekly-backup.yml`
calls `GET /api/admin/backup` on the deployed app and commits the resulting JSON
file into this folder as
`phoenix-league-backup-full-YYYY-MM-DDTHH-MM-SSZ.json`. The twelve most recent
files are kept (about three months); older ones are pruned by the same run.

Each file contains every Firestore document the app owns — leagues, games,
series, seasons, classes, races, sessions, results, drivers, teams, tracks,
points templates, roster entries, user accounts and their roles — with the
original document IDs, so importing one rebuilds the data *and* every link
between it.

It does **not** contain Firebase Auth sign-in credentials (those live in Auth,
not in the database) or uploaded images (those stay in Cloud Storage; the backup
keeps their URLs).

## Restoring one

Sign in as the Owner, go to **League Setup ▸ Backup & Restore**, pick the file,
choose **Merge** or **Replace**, and confirm. Full instructions — including the
manual export and how to set the weekly job up — are in the *Backups & Disaster
Recovery* section of the root `README.md`.
