# Attendance

QR code attendance for one lecturer, written straight into a Google Sheet.

The lecturer starts a session and puts a rotating QR code on the projector. Students scan it with their phone, type the last four digits of their student ID, and are marked present. Each check-in is saved locally and then written to the class tab of the lecturer's Google Sheet.

- **Student page:** one small HTML response (under 6 KB, no framework), built for cheap phones and slow data. It works with JavaScript off.
- **Lecturer screens:** classes, the projected QR with a live count, attendance history with manual corrections, and a per-student summary.
- **Abuse limits:** the QR changes every 60 seconds, one phone can check in one student per session, and repeated guesses are rate limited.

Built with Next.js 16, SQLite (Drizzle) and the Google Sheets API. The full specification is in [`PRD.md`](PRD.md) and [`IMPLEMENTATION.md`](IMPLEMENTATION.md).

## Quick start

Requires Node.js 20.9 or later.

```bash
npm install
cp .env.example .env.local     # then fill it in, see below
npm run db:migrate             # creates ./data/attendance.db
npm run dev
```

Open http://localhost:3000, sign in with `LECTURER_PASSWORD`, and press **Sync roster** to load your classes from the sheet.

## Environment variables

All of these go in `.env.local`, which is gitignored.

| Variable | What it is |
|---|---|
| `DATABASE_PATH` | Where the SQLite file lives. Default `./data/attendance.db`. |
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

Things to know before hosting it:

- **It needs a disk that persists.** The SQLite file must survive restarts and deploys. A small VPS or a host with a persistent volume works; point `DATABASE_PATH` at the volume. Serverless platforms with a read-only or temporary filesystem will lose the data.
- **Run one instance.** Rate limits and the sheet-sync queue runner live in memory.
- **Use HTTPS**, and set `APP_URL` to the `https://` address so cookies are marked secure.
- **Run `npm run db:migrate`** after each deploy that includes new files in `drizzle/`.
- **Back up the database file.** The sheet holds the marks, but the manual-change reasons and check-in audit log exist only in SQLite.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | Unit tests (Vitest); no network or Google account needed |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Apply migrations to the SQLite file |
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
