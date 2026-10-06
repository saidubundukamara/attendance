# Attendance

QR code attendance for one lecturer, written straight into a Google Sheet.

The lecturer starts a session and puts a rotating QR code on the projector. Students scan it with their phone, type the last four digits of their student ID, and are marked present. Each check-in is saved locally and then written to the class tab of the lecturer's Google Sheet.

- **Student page:** one small HTML response (under 6 KB, no framework), built for cheap phones and slow data. It works with JavaScript off.
- **Lecturer screens:** classes, the projected QR with a live count, attendance history with manual corrections, and a per-student summary.
- **Abuse limits:** the QR changes every 60 seconds, one phone can check in one student per session, and repeated guesses are rate limited.

Built with Next.js 16, Drizzle on SQLite (a local file in development, [Turso](https://turso.tech) in production) and the Google Sheets API. The full specification is in [`PRD.md`](PRD.md) and [`IMPLEMENTATION.md`](IMPLEMENTATION.md).

## Quick start

Requires Node.js 20.9 or later.

```bash
npm install
cp .env.example .env.local     # then fill it in, see below
npm run db:migrate             # creates the tables
npm run dev
```

Open http://localhost:3000, sign in with `LECTURER_PASSWORD`, and press **Sync roster** to load your classes from the sheet.

## Environment variables

All of these go in `.env.local`, which is gitignored.

| Variable | What it is |
|---|---|
| `TURSO_DATABASE_URL` | Your Turso database address (`libsql://…`). Leave empty to use a local file. See [Turso setup](#turso-setup). |
| `TURSO_AUTH_TOKEN` | The token for that Turso database. |
| `DATABASE_PATH` | The local SQLite file, used only when `TURSO_DATABASE_URL` is empty. Default `./data/attendance.db`. |
| `APP_URL` | The address students' phones will open. It is encoded into every QR code, so it must be reachable from their phones. See [Testing with real phones](#testing-with-real-phones). |
| `LECTURER_PASSWORD` | The password for the lecturer sign-in. |
| `AUTH_SECRET` | Signs the lecturer's session cookie. |
| `QR_SECRET` | Signs QR tokens and check-in passes. |
| `GOOGLE_SHEET_ID` | The spreadsheet to read the roster from and write attendance to. |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | The service account the app signs in to Google as. |
| `GOOGLE_PRIVATE_KEY` | That service account's private key. |

Generate the two secrets with:

```bash
openssl rand -base64 32
```

Use a different value for each. Changing `AUTH_SECRET` signs the lecturer out; changing `QR_SECRET` invalidates any QR code currently on screen.

## Google Sheets setup

The app does not sign in as you. It uses a **service account**: a robot Google account with its own email address. You create one, give it a key, and share your spreadsheet with it like you would with a colleague. This takes about five minutes and is free.

### 1. Create a Google Cloud project

1. Go to https://console.cloud.google.com and sign in.
2. Open the project picker at the top of the page and choose **New project**.
3. Name it (for example `attendance`) and press **Create**. Make sure it is the selected project before continuing.

### 2. Turn on the Google Sheets API

1. Go to **APIs & Services → Library**.
2. Search for **Google Sheets API**, open it, and press **Enable**.

Without this step every request fails with "Google Sheets API has not been used in project … or it is disabled".

### 3. Create the service account

1. Go to **APIs & Services → Credentials**.
2. Press **Create credentials → Service account**.
3. Give it a name (for example `attendance-app`) and press **Create and continue**.
4. Skip the optional role and user-access steps and press **Done**. The account needs no project roles; its only access will be the one spreadsheet you share with it.

It now appears in the list with an address like:

```
attendance-app@your-project-id.iam.gserviceaccount.com
```

That address is your `GOOGLE_SERVICE_ACCOUNT_EMAIL`.

### 4. Download a key

1. Click the service account, open the **Keys** tab.
2. Press **Add key → Create new key**, choose **JSON**, and press **Create**.

A `.json` file downloads. Treat it like a password: anyone who has it can edit every sheet shared with the account. Do not commit it or paste it into a chat.

> If Google says key creation is disabled, your organisation enforces the `iam.disableServiceAccountKeyCreation` policy. Use a personal Google account for the Cloud project, or ask your admin for an exception.

### 5. Share the spreadsheet with the service account

1. Open your attendance spreadsheet in Google Sheets.
2. Press **Share**, paste the service account's email address, set it to **Editor**, and send.

Editor is required because the app writes the 1s and 0s. Viewer is enough to sync the roster but every check-in will then fail to reach the sheet.

### 6. Fill in the three variables

**`GOOGLE_SHEET_ID`** is the long string in the spreadsheet's address, between `/d/` and `/edit`:

```
https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0
                                       └──────────── this part ────────────┘
```

**`GOOGLE_SERVICE_ACCOUNT_EMAIL`** is the `client_email` value in the downloaded JSON file.

**`GOOGLE_PRIVATE_KEY`** is the `private_key` value in the same file. Copy it exactly as it appears there: one long line, in double quotes, with the `\n` sequences left in.

```bash
GOOGLE_SHEET_ID=1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789
GOOGLE_SERVICE_ACCOUNT_EMAIL=attendance-app@your-project-id.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq...\n-----END PRIVATE KEY-----\n"
```

To print the key in the right form without copying by hand:

```bash
node -p "JSON.stringify(require('./your-key-file.json').private_key)"
```

Paste the output, quotes included, after `GOOGLE_PRIVATE_KEY=`.

On a hosting dashboard (Vercel, Railway and so on), paste the key **without** the surrounding quotes. The app accepts it either with real line breaks or with literal `\n`.

Restart the dev server after changing `.env.local`, then press **Sync roster** on the classes page. If your classes appear, all three values are right.

### How the spreadsheet must be laid out

The app finds everything by its label, never by a fixed cell, so you can add rows, sort students or add new class tabs without changing anything.

- **One tab per class, named `Attn of <CLASS CODE>`**, for example `Attn of BIT2101`. The class code is taken from the tab name. Other tabs are ignored.
- **A header row** containing a cell that reads `ID Number`. A `Name` column is optional but recommended.
- **Week columns** headed `WK1`, `WK2`, … (`WK 1` also works).
- **Students** in the rows below the header. A row without an ID is skipped.
- **Optional:** cells starting `MODULE NAME` and `MODULE CODE` above the header, with the value in a cell to their right.

| No. | Name | ID Number | WK1 | WK2 | WK3 | … | Total |
|---|---|---|---|---|---|---|---|
| 1 | A. Student | 905001234 | 1 | 0 | 1 | | =SUM(…) |
| 2 | B. Student | 905005678 | 1 | 1 | | | =SUM(…) |

What the app writes: `1` for present and `0` for absent, as numbers, in the student's row under that week's column. The row is looked up again by ID at the moment of writing, so sorting the sheet mid-class cannot send a mark to the wrong student. A cell that holds anything other than `1`, `0` or blank is left alone and reported, so notes such as "excused" are never overwritten. Other columns, including `Total`, are not touched.

Student IDs must be 4 to 12 digits. The check-in page assumes they are `90500` followed by four digits, so students type only the last four; change the prefix in [`lib/student-id.ts`](lib/student-id.ts) if yours differ.

### When something goes wrong

| Message | Cause | Fix |
|---|---|---|
| `Missing environment variable GOOGLE_…` | The variable is empty or the server was not restarted. | Fill it in and restart. |
| `The caller does not have permission` | The sheet is not shared with the service account, or only as Viewer. | Share it as Editor (step 5). |
| `Requested entity was not found` | `GOOGLE_SHEET_ID` is wrong. | Copy it again from the address bar. |
| `Google Sheets API has not been used in project…` | The API is not enabled. | Step 2. Allow a minute after enabling. |
| `error:1E08010C:DECODER routines::unsupported` or `invalid_grant` | The private key was mangled: missing quotes, missing `\n`, or cut short. | Paste it again using the `node -p` command above. |
| `No tabs named "Attn of …" were found` | No tab name starts with `Attn of`. | Rename the class tabs. |
| `No "ID Number" header found; tab skipped.` | The header cell is spelled differently. | Rename it to `ID Number`. |
| `Student … not found in "Attn of …"` | The student was removed from the sheet after checking in. | Add them back, then press **Retry sync**. |

Attendance is never lost when the sheet cannot be reached. It is saved in the local database first, shown as "not yet in the Google Sheet", and retried automatically while a session page is open. **Retry sync** forces it.

## Turso setup

The app stores sessions, check-ins and the queue of writes waiting to reach the sheet in a SQLite database. On your own machine that can be a plain file, and you can skip this section. On Vercel, or any host whose disk is wiped between deploys, a file would lose everything, so the database lives in [Turso](https://turso.tech), which is SQLite hosted for you. The free plan is more than enough for this app.

You need two values from Turso: the database URL and an auth token.

### 1. Create an account and a database

**In the browser:** sign up at https://turso.tech, create a database from the dashboard, give it a name (for example `attendance`), and pick the region closest to where the app will be hosted. Every query is a network call, so a nearby region keeps pages fast.

**Or with the CLI:**

```bash
brew install tursodatabase/tap/turso     # macOS; see turso.tech for other systems
turso auth signup                        # or: turso auth login
turso db create attendance
```

### 2. Get the URL and a token

**In the browser:** open the database in the dashboard. Copy its URL, which starts with `libsql://`, then create a token for it and copy that too. The token is shown once.

**Or with the CLI:**

```bash
turso db show attendance --url           # prints libsql://attendance-yourname.turso.io
turso db tokens create attendance        # prints the token
```

Treat the token like a password: anyone who has it can read and change the attendance records. A token with read and write access is required; a read-only token lets pages load but every check-in fails.

### 3. Fill in the two variables

In `.env.local`:

```bash
TURSO_DATABASE_URL=libsql://attendance-yourname.turso.io
TURSO_AUTH_TOKEN=eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9...
```

No quotes are needed. With both set, the app uses Turso everywhere, including on your own machine. Remove them (or leave them empty) to go back to the local file at `DATABASE_PATH`.

### 4. Create the tables

A new Turso database is empty. Run this once from your machine:

```bash
npm run db:migrate
```

It should print `Migrations applied to attendance-yourname.turso.io`. If it prints a file path instead, the two variables were not picked up; check they are in `.env.local` or `.env` and spelled exactly as above.

Run it again whenever you pull changes that add files to `drizzle/`. It only applies what is new, so running it twice does no harm.

### 5. Load your classes

Restart the app, sign in, and press **Sync roster**. Classes and students are read from the Google Sheet into Turso. If they appear, the database is working.

Moving to Turso does not carry over what was in a local file: the roster comes back from the sheet, but past sessions and each class's start date do not.

### Checking what is in the database

```bash
turso db shell attendance "select code, total_weeks from classes"
turso db shell attendance "select status, count(*) from sync_jobs group by status"
```

The second shows how many attendance marks are still waiting to reach the Google Sheet (`PENDING` or `FAILED`) and how many have arrived (`DONE`).

### When something goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| `no such table: classes` (or any other table) | The tables were never created in this database. | Run `npm run db:migrate` with the Turso variables set. |
| HTTP 401, or an "unauthorized" / "invalid token" error | The token is wrong, expired, or belongs to a different database. | Create a new token for this database and replace `TURSO_AUTH_TOKEN`. |
| Pages load but check-ins and edits fail with a "read-only" or "not authorized to write" error | The token is read-only. | Create a token with write access. |
| An invalid URL or unsupported scheme error at startup | `TURSO_DATABASE_URL` is not the `libsql://…` address, or has quotes or spaces around it. | Copy it again from `turso db show <name> --url`. |
| `ENOTFOUND` or a connection timeout | The host name is mistyped, or the machine has no internet access. | Check the URL and the connection. |
| It works locally but not on Vercel | The variables were added to `.env.local` only. | Add both under **Settings → Environment Variables** in Vercel and redeploy. |
| `npm run db:migrate` reports a file path | It fell back to the local file because `TURSO_DATABASE_URL` was empty. | Set the variable and run it again. |
| Every page is slow | The database region is far from the host. | Create the database in a region near the host. |

## Testing with real phones

Students' phones cannot open `localhost`, so the QR needs a public address. A tunnel is the quickest way:

```bash
ngrok http 3000
```

Set `APP_URL` to the `https://…` address ngrok prints and restart `npm run dev`. `next.config.ts` allows that host automatically; without it, pages opened through the tunnel in dev mode load but their buttons do nothing.

The tunnel address changes each time on the free plan, so update `APP_URL` when it does.

## Running it for a class

```bash
npm run build
npm start
```

Use the production build for real sessions; it is faster and has none of the dev-mode restrictions.

### Deploying to Vercel

Vercel has no disk that persists, so do the [Turso setup](#turso-setup) first.

1. Import the GitHub repository at https://vercel.com/new.
2. Add every variable from the table above under **Settings → Environment Variables**, except `DATABASE_PATH`. Paste `GOOGLE_PRIVATE_KEY` without the surrounding quotes.
3. Set `APP_URL` to the deployment's public `https://` address, then redeploy so the QR codes point at it.
4. Sign in and press **Sync roster**.

Things to know:

- **Rate limits are per server instance.** They live in memory, so on a platform that runs several instances they are looser than on a single server. The one-phone-per-session rule is enforced by the database and is not affected.
- **Use HTTPS**, and set `APP_URL` to the `https://` address so cookies are marked secure.
- **Pick a Turso region near your Vercel region.** Every query is a network call.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | Unit tests (Vitest); no network or Google account needed |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Apply migrations to Turso, or to the local file when Turso is not set |
| `npm run db:generate` | Generate a migration after editing `lib/db/schema.ts` |

## Project layout

```
app/a/               Student check-in (plain HTML route)
app/(lecturer)/      Classes, live session, class history, student summary
app/login/           Lecturer sign-in
app/api/sessions/    QR refresh and live-count polling
components/ui/       Buttons, notices, icons and other shared pieces
lib/sheets/          Google Sheets client, tab parser, roster sync, write queue
lib/checkin.ts       Check-in rules
lib/token.ts         Signed QR tokens and passes
lib/db/              Schema and database client
drizzle/             SQL migrations
tests/               Unit tests
```

Design decisions and tokens are recorded in [`DESIGN.md`](DESIGN.md).
