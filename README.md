# Nodig

Nodig connects Belgian organizations — shelters, food banks, schools running
fundraisers — with donors who want to help. Organizations post their real,
current needs (items or volunteer slots); donors browse, claim, and message the
organization directly with questions.

This is the real, shared-backend version of the original single-file prototype.
Every screen and flow from the prototype is preserved — the storage layer was
swapped from `localStorage` to a real Express + SQLite backend so all users see
the same data from any device.

## Stack

- **Backend:** Node.js + Express
- **Database:** SQLite (via `better-sqlite3`) — a single file under `data/`
- **Auth:** bcrypt password hashing + signed JWT session cookies (httpOnly)
- **Frontend:** the prototype's HTML/CSS with vanilla JS calling the API
- **Realtime chat:** short polling (every 4s) — the fallback the handoff allows

No external accounts or cloud services are required to run it.

## Run locally

```bash
npm install
npm start
```

Then open <http://localhost:3000>.

On first run the database is created and seeded with the same demo
organizations and needs as the prototype. Seed organizations are pre-approved.

**Demo logins** (all use password `demo123`):

- `contact@foyerstjean.be` — Foyer Saint-Jean (Brussels)
- `contact@abriwaterloo.be` — Abri de Nuit Waterloo (Waterloo)
- `contact@leuvenkitchen.be` — Leuven Community Kitchen (Leuven)

You can also create a new donor or organization account from the sign-in screen.

## How it maps to the prototype

| Prototype feature | Where it lives now |
| --- | --- |
| Public browse + filters (city / type / urgency) | `GET /api/needs`, `GET /api/cities` — filters applied client-side, exactly as before |
| Org vs donor accounts (one auth screen, toggle) | `POST /api/auth/signup`, `POST /api/auth/login`, roles stored server-side |
| Org dashboard: post / edit / delete own needs | `GET /api/my/needs`, `POST/PUT/DELETE /api/needs/:id` (owner-checked) |
| Donor claim / release (claimed hidden from others) | `POST /api/needs/:id/claim` and `/release` — claiming is atomic so two donors can't claim the same need |
| Per-need chat | `GET/POST /api/needs/:id/messages`, polled live |
| Toast notifications | unchanged |

## Manual organization approval

New organization signups default to **`approved = false`**. Their needs are
saved but do **not** appear on the public browse and can't be claimed until a
human approves the account. This is the main safeguard against fake orgs.

Two ways to approve:

1. **Admin page** — open <http://localhost:3000/admin.html>, sign in with
   `ADMIN_PASSWORD` (default `nodig-admin`, change it), and toggle approval per
   organization.
2. **CLI**
   ```bash
   npm run approve                          # list all orgs + status
   npm run approve -- new@org.be            # approve
   npm run approve -- new@org.be off        # revoke approval
   ```

An unapproved organization can still log in and prepare needs; the dashboard
shows a "pending approval" banner until an admin flags them approved.

## Configuration

Copy `.env.example` to `.env` and set values (or set them in your host's
dashboard). In production you **must** set `JWT_SECRET` and should change
`ADMIN_PASSWORD`. See `.env.example` for all options.

## Data model

- `organizations` — id, name, city, email, password_hash, initials, role, **approved**, created_at
- `donors` — id, name, email, password_hash, role, created_at
- `needs` — id, org_id → organizations, title, type (item/volunteer), urgency, description, claimed_by → donors (nullable), created_at
- `messages` — id, need_id → needs, sender_role (org/donor), sender_id, text, created_at

## Deployment

The app is a single long-running Node process that needs a small persistent
disk for the SQLite file. Serverless platforms (Vercel/Netlify functions) don't
keep a writable disk between invocations, so they'd need a hosted Postgres
instead; the query layer is small and isolated in `server/` if you later want
to swap SQLite for Postgres.

A `Dockerfile` and `fly.toml` are included for **Fly.io**, which supports a
small persistent volume that keeps the SQLite data across restarts.

> **Heads up (per the handoff's "flag anything needing a paid tier"):** Fly.io
> now requires a payment method on file even for tiny apps. Actual usage for
> this app (one shared-cpu-1x machine that scales to zero + a 1 GB volume) is
> minimal, but it is no longer strictly card-free. If you want zero-card, a
> Render free web service also works, but its disk is ephemeral — the SQLite
> DB resets on each redeploy/restart, which is fine for a throwaway demo but
> not for keeping pilot data.

### Deploy to Fly.io

From the repo root (the `Dockerfile` and `fly.toml` are already here):

```bash
# 1. Install flyctl and sign in (creates the account if you don't have one)
curl -L https://fly.io/install.sh | sh
fly auth login          # or: fly auth signup

# 2. Create the app (accept the existing Dockerfile; keep the region as cdg/Paris).
#    Fly may pick a unique name — let it write that name back into fly.toml.
fly launch --no-deploy --copy-config

# 3. Create the persistent volume for the SQLite file (same region as the app)
fly volumes create nodig_data --size 1 --region cdg

# 4. Set secrets (do NOT commit these)
fly secrets set JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
fly secrets set ADMIN_PASSWORD="choose-a-strong-admin-password"

# 5. Deploy and open
fly deploy
fly open                # prints and opens your public https URL
```

`NODE_ENV=production`, `PORT`, and `DATABASE_PATH=/data/nodig.db` are already
set in `fly.toml`'s `[env]`, and the volume mounts at `/data`, so the database
persists across deploys. On first boot it seeds the demo orgs/needs; approve new
orgs via `https://<your-app>.fly.dev/admin.html` (password = the `ADMIN_PASSWORD`
secret you set).

### Deploy anywhere else

Any host that runs a Node process with a writable disk works. Set
`NODE_ENV=production`, a long random `JWT_SECRET`, and a strong `ADMIN_PASSWORD`;
point `DATABASE_PATH` at a persistent path; start with `npm start`.

## Notes / things to confirm with the team

- **Chat visibility follows the prototype:** a need's thread is shared per-need
  (the org and interested donors), and is readable by anyone viewing the need,
  matching the prototype's behavior. If you'd prefer each donor↔org
  conversation to be private, that's a small change — flag it and we'll scope
  threads per donor.
- No payments, no accounts for the people shelters serve, no multi-language —
  all still out of scope, per the handoff.
