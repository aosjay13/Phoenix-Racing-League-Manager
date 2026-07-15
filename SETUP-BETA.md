# Beta Launch Checklist

Everything you need to take Phoenix Racing League Manager live, hosted straight from this
GitHub repo via Vercel (free tier is fine for beta). Budget ~20 minutes.

> **Why not GitHub Pages?** Pages only serves static files. This app needs a server for its
> API routes and Firestore access. Vercel imports your GitHub repo and redeploys on every
> push to `main` — same "hosted from my repo" workflow, but it actually runs.

## 1. Firebase project (~10 min)

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project**
   (Analytics optional).
2. **Authentication → Get started → Sign-in method**: enable **Email/Password** and **Google**.
3. **Firestore Database → Create database** → production mode → pick a region.
4. **Storage → Get started** (this is where logos/avatars live). Note the bucket name
   (usually `<project-id>.appspot.com` or `<project-id>.firebasestorage.app`).
5. Apply the security rules: paste the contents of `firebase/firestore.rules` into
   Firestore → Rules, and `firebase/storage.rules` into Storage → Rules. (Everything goes
   through the server API, so clients are locked out of the database directly.)
6. **Project settings → Service accounts → Generate new private key** — download the JSON.
7. **Project settings → General → Your apps → Web app (</> icon)** — register an app and
   copy the `apiKey`, `authDomain`, `projectId` from the config snippet.

## 2. Vercel (~5 min)

1. [vercel.com](https://vercel.com) → sign in with GitHub → **Add New → Project** → import
   `Phoenix-Racing-League-Manager`.
2. Set **Root Directory** to `frontend`.
3. Add Environment Variables (see `.env.example`):

   | Variable | Value |
   |---|---|
   | `FIREBASE_PROJECT_ID` | service account `project_id` |
   | `FIREBASE_CLIENT_EMAIL` | service account `client_email` |
   | `FIREBASE_PRIVATE_KEY` | service account `private_key` (full BEGIN/END block) |
   | `FIREBASE_STORAGE_BUCKET` | your Storage bucket name |
   | `ADMIN_EMAILS` | your email (comma-separate to add more admins) |
   | `NEXT_PUBLIC_FIREBASE_API_KEY` | web app `apiKey` |
   | `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | web app `authDomain` |
   | `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | web app `projectId` |

4. **Deploy.** Then in Firebase **Authentication → Settings → Authorized domains**, add your
   Vercel domain (e.g. `your-app.vercel.app`) so Google sign-in works.

## 3. First-run league setup (~5 min)

1. Open the site, **Sign In → Create an account** with the email you put in `ADMIN_EMAILS`
   — the Admin section appears in the sidebar.
2. **League Setup**: add your Game (e.g. iRacing) with its logo → Series → Season (set drop
   weeks) → Races (name, track, round, date, track logo).
3. **Roster & Teams**: create teams (with logos), add drivers, and link each driver to their
   registered player account so their profile stats populate.
4. **Race Entry**: after each race, pick the race, fill the grid, save. Standings and every
   linked player profile update instantly. Re-save a race any time to correct results.

## Beta notes

- **Adding admins later**: append their email to `ADMIN_EMAILS` in Vercel and redeploy, or
  set `role: "admin"` on their doc in the `users` collection.
- **Subscriptions later**: the auth layer is in place; when you're ready, add Stripe
  Checkout + a `plan` field on `users` and gate admin/league creation on it.
- **Backups**: Firebase console → Firestore → Import/Export, or enable scheduled exports.
- **Costs**: Firebase Spark (free) + Vercel Hobby cover a beta comfortably. Note: Vercel's
  Hobby tier is for non-commercial use — once you charge subscriptions, upgrade to Pro.
