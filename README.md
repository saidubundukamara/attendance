# Attendance

QR code attendance for lecturers, written straight into each lecturer's own Google Sheet.

Lecturers sign in with Google and pick their attendance sheet. A lecturer starts a session and puts a rotating QR code on the projector. Students scan it with their phone, type the last four digits of their student ID, and are marked present. Each check-in is saved in the app's database and then written to the class tab of that lecturer's sheet.

- **Lecturers:** only Google accounts the admin has approved can sign in. Each lecturer's classes, students, sheet and Drive are their own; one lecturer never sees another's.

- **Student page:** one small HTML response (under 6 KB, no framework), built for cheap phones and slow data. It works with JavaScript off.
- **Lecturer screens:** classes, the projected QR with a live count, attendance history with manual corrections, and a per-student summary.
- **Abuse limits:** the QR changes every 60 seconds, one phone can check in one student per session, and repeated guesses are rate limited.
- **Assignment submissions:** the lecturer sets assignments, classwork and projects with deadlines. Students hand in PDF, Word or ZIP files at `/submit`; the files go to Google Drive and each class gets a `Subs of <CODE>` tab showing who submitted and when. See [Assignment submissions](#assignment-submissions).

Built with Next.js 16, Drizzle on SQLite (a local file in development, [Turso](https://turso.tech) in production) and the Google Sheets API. The full specification is in [`PRD.md`](PRD.md) and [`IMPLEMENTATION.md`](IMPLEMENTATION.md).

## Quick start

Requires Node.js 20.9 or later.

```bash
npm install
cp .env.example .env.local     # then fill it in, see below
npm run db:migrate             # creates the tables
npm run dev
```

Do the [Google setup](#google-setup) first. Then open http://localhost:3000, sign in with an `ADMIN_EMAILS` Google account, and pick your attendance sheet. Its classes and students load straight away; **Sync roster** reloads them.

## Environment variables

All of these go in `.env.local`, which is gitignored.

| Variable | What it is |
|---|---|
| `TURSO_DATABASE_URL` | Your Turso database address (`libsql://…`). Leave empty to use a local file. See [Turso setup](#turso-setup). |
| `TURSO_AUTH_TOKEN` | The token for that Turso database. |
| `DATABASE_PATH` | The local SQLite file, used only when `TURSO_DATABASE_URL` is empty. Default `./data/attendance.db`. |
| `APP_URL` | The address students' phones will open. It is encoded into every QR code, so it must be reachable from their phones. See [Testing with real phones](#testing-with-real-phones). |
| `AUTH_SECRET` | Signs the lecturer's session cookie. |
| `QR_SECRET` | Signs QR tokens and check-in passes. |
| `TOKEN_ENCRYPTION_KEY` | Encrypts the Google refresh tokens stored for each lecturer. 32 bytes, base64. |
| `ADMIN_EMAILS` | Comma-separated Google emails of the admins. Admins can always sign in, approve lecturers and manage cohorts on `/admin`. |
| `GOOGLE_OAUTH_CLIENT_ID` | The app's Google OAuth client ("Web application"). See [Google setup](#google-setup). |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Its secret. |
| `NEXT_PUBLIC_GOOGLE_API_KEY` | An API key for the Google Picker, which lecturers use to pick their sheet. |
| `NEXT_PUBLIC_GOOGLE_APP_ID` | The Google Cloud project **number** (not its ID). The Picker needs it to give the app access to the picked sheet. |
| `GOOGLE_DRIVE_FOLDER_ID` | Only when upgrading from the single-lecturer version: its submissions folder, handed to the first admin who signs in. Remove it afterwards. |
| `APP_TIMEZONE` | The time zone deadlines are entered and shown in. Default `Africa/Freetown`. |

Generate the three secrets with:

```bash
openssl rand -base64 32
```

Use a different value for each. Changing `AUTH_SECRET` signs every lecturer out; changing `QR_SECRET` invalidates any QR code currently on screen. **Never change `TOKEN_ENCRYPTION_KEY`** once lecturers have signed in: their stored Google access becomes unreadable and each of them has to reconnect.

## Google setup

Every lecturer signs in with their own Google account. The same sign-in gives the app the `drive.file` permission: it can open only the spreadsheet the lecturer picks and the files it creates itself (the submissions folder), and nothing else in their Drive. You set this up once for the whole app, in one Google Cloud project. Allow about fifteen minutes.

All of the permissions the app asks for are **non-sensitive**, so the app can be published to **Production** without Google's security review. Don't leave it in **Testing**: Google expires every refresh token after 7 days in Testing, and attendance and uploads would stop reaching lecturers' sheets and Drives until they signed in again. Who may sign in is controlled inside the app instead (see [Approving lecturers](#approving-lecturers)).

### 1. Create a project and turn on the APIs

1. Open https://console.cloud.google.com/projectcreate and create a project, e.g. `attendance`. If you're upgrading from the single-lecturer version, **use the project you already have**: its submissions folder stays reachable only from the same project.
2. Turn on these three APIs, pressing **Enable** on each:
   - https://console.cloud.google.com/apis/library/sheets.googleapis.com
   - https://console.cloud.google.com/apis/library/drive.googleapis.com
   - https://console.cloud.google.com/apis/library/picker.googleapis.com

### 2. Set up the consent screen

Open https://console.cloud.google.com/auth/overview and press **Get started**.

1. **App name**: what lecturers see, e.g. `Attendance`. **User support email**: yours.
2. **Audience**: **External** (lecturers use personal Gmail or another university's account). If every lecturer is on one Google Workspace domain, **Internal** also works and needs no publishing.
3. **Contact information**: your email. Finish.
4. Under **Data Access**, press **Add or remove scopes** and add `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` and `.../auth/drive.file`. All four are listed as non-sensitive.
5. Under **Audience**, press **Publish app** and confirm. With only non-sensitive scopes there is no review. Google may ask you to verify the app's name and logo (brand verification) before it shows them; until then sign-in still works.

### 3. Create the OAuth client

Open https://console.cloud.google.com/auth/clients and press **Create client**.

1. **Application type**: **Web application**.
2. **Authorized JavaScript origins**: your `APP_URL`, e.g. `https://attendance.example.com` and `http://localhost:3000`.
3. **Authorized redirect URIs**: `APP_URL` followed by `/auth/google/callback`, e.g. `https://attendance.example.com/auth/google/callback` and `http://localhost:3000/auth/google/callback`.
4. Press **Create**. Copy the **Client ID** into `GOOGLE_OAUTH_CLIENT_ID` and the **Client secret** into `GOOGLE_OAUTH_CLIENT_SECRET`.

### 4. Create the Picker API key

1. Open https://console.cloud.google.com/apis/credentials, press **Create credentials → API key**, and copy it into `NEXT_PUBLIC_GOOGLE_API_KEY`.
2. Edit the key: under **Application restrictions** choose **Websites** and add your `APP_URL` (with `/*`); under **API restrictions** allow only the **Google Picker API**. The key is visible in lecturers' browsers, so these restrictions matter.
3. Open https://console.cloud.google.com/home/dashboard and copy the **Project number** into `NEXT_PUBLIC_GOOGLE_APP_ID`.

### 5. Sign in and pick your sheet

Put your Google email in `ADMIN_EMAILS`, restart the app, and sign in. The setup page opens the Google Picker: choose your attendance spreadsheet. Its classes load straight away. You can pick a different sheet later from **Sheet** in the menu.

### Approving lecturers

On `/admin`, type a lecturer's Google email and press **Approve**. They can then sign in at `<APP_URL>/login` and pick their own sheet. **Remove access** stops them signing in at their next page load; their classes and records are kept.

### Cohorts

A **cohort** groups the modules a set of students takes, across lecturers, e.g. `BSEM Year 1`. The admin creates cohorts on `/admin`. Each lecturer puts each module (class tab) in a cohort under **Edit** on the class page. Students choose their cohort on the submit page, then the module. A module without a cohort can still take attendance, but students can't find it to submit work.

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
| `redirect_uri_mismatch` on Google's screen | The redirect URI on the OAuth client doesn't match `APP_URL`. | Add `APP_URL/auth/google/callback` exactly (step 3). |
| "… isn't approved yet" on the sign-in page | The email isn't approved. | Approve it on `/admin`, or add it to `ADMIN_EMAILS`. |
| `The caller does not have permission` or `Requested entity was not found` | The app can only open a sheet picked in the Picker. | Pick the sheet again from **Sheet**. Check `NEXT_PUBLIC_GOOGLE_APP_ID` is the project number. |
| `Google Sheets API has not been used in project…` | The API is not enabled. | Step 1. Allow a minute after enabling. |
| "The app can't reach your Google account" banner | The lecturer revoked access, or Google expired the token (e.g. the app was left in Testing). | Press **Reconnect Google**. Publish the app to Production (step 2). |
| `No tabs named "Attn of …" were found` | No tab name starts with `Attn of`. | Rename the class tabs. |
| `No "ID Number" header found; tab skipped.` | The header cell is spelled differently. | Rename it to `ID Number`. |
| `Student … not found in "Attn of …"` | The student was removed from the sheet after checking in. | Add them back, then press **Retry sync**. |

Attendance is never lost when the sheet cannot be reached. It is saved in the local database first, shown as "not yet in the Google Sheet", and retried automatically while a session page is open. **Retry sync** forces it.

## Assignment submissions

On a class page, under **Assignments**, press **New item** and give it a title (for example `Assignment 1` or `Classwork - Week 5`), a type and a deadline. Open an item to see who has submitted, filter to who is missing, open their files in Drive, change the deadline, or close it.

Students go to `<APP_URL>/submit`, choose their class (cohort), type the last four digits of their ID, choose the module, pick the item and upload their files. Only modules in a [cohort](#cohorts) that have at least one item are offered.

- **Files:** PDF, Word (`.docx`) or ZIP, up to 5 files of 200 MB each per submission. The files go from the student's browser straight to Google Drive, so Vercel's 4.5 MB request limit does not apply.
- **One submission per item.** Once it is in, the student cannot replace it. The page tells them this before they submit.
- **Late work** is accepted and marked `LATE`. The student is warned before uploading and told again on the confirmation. Lateness is judged by when the upload started. Moving the deadline re-checks every submission. **Close submissions** stops all further uploads.
- **In Drive** the files go to the lecturer's own Drive, as `Assignment Submissions/<CODE - module>/<item title>/<ID> - <Name> - <file name>`. The app creates the `Assignment Submissions` folder in their My Drive the first time it needs it.
- **In the sheet** each class gets a `Subs of <CODE>` tab: `ID Number`, `Name`, then one column per item, holding the time each student submitted (`24 Oct 14:05`, or `LATE 26 Oct 09:12`). The app rebuilds this tab from its database after every submission, so **don't edit it by hand**; anything typed there is overwritten. If a write fails, the class and item pages say so and **Update sheet** retries.

## Google Drive

Nothing to set up beyond the [Google setup](#google-setup): each lecturer's sign-in already lets the app create and use its folder in their Drive.

### When something goes wrong

| Message | Cause | Fix |
|---|---|---|
| "The upload did not go through" for every student | The lecturer's Google access was revoked, or their Drive is full. | The lecturer signs in and presses **Reconnect Google**, or frees space. |
| `File not found` for a folder | The lecturer deleted the `Assignment Submissions` folder or a class folder. | Restore it from the Drive trash. |

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

Restart the app, sign in, and pick your sheet (or press **Sync roster**). Classes and students are read from the Google Sheet into Turso. If they appear, the database is working.

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

The tunnel address changes each time on the free plan, so update `APP_URL` when it does. Google sign-in only returns to addresses listed on the OAuth client, so add the tunnel's origin and `/auth/google/callback` address there too (step 3 of [Google setup](#google-setup)), or sign in at `http://localhost:3000` and use the tunnel only for students' phones.

## Running it for a class

```bash
npm run build
npm start
```

Use the production build for real sessions; it is faster and has none of the dev-mode restrictions.

### Deploying to Vercel

Vercel has no disk that persists, so do the [Turso setup](#turso-setup) first.

1. Import the GitHub repository at https://vercel.com/new.
2. Add every variable from the table above under **Settings → Environment Variables**, except `DATABASE_PATH`.
3. Set `APP_URL` to the deployment's public `https://` address, add it to the OAuth client's origins and redirect URIs, then redeploy so the QR codes point at it.
4. Sign in and pick your sheet.

### Upgrading from the single-lecturer version

1. Run `npm run db:migrate`. Existing classes, students, sessions and submissions are kept and set aside for the first admin.
2. Do the [Google setup](#google-setup) in the **same** Google Cloud project as before, and set `GOOGLE_DRIVE_FOLDER_ID` to the old submissions folder.
3. Sign in with an `ADMIN_EMAILS` account. That account takes over the existing data and folder. Pick the same spreadsheet in the Picker; its tabs match the existing classes.
4. Remove `LECTURER_PASSWORD`, `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_DRIVE_MODE`, `GOOGLE_OAUTH_REFRESH_TOKEN` and `GOOGLE_DRIVE_FOLDER_ID`. The service account is no longer used.

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
app/submit/          Student assignment submission
app/api/submit/      Submission lookup, upload start and confirm
app/(lecturer)/      Classes, live session, class history, student summary,
                     sheet setup and admin
app/login/           Lecturer sign-in page
app/auth/google/     Google sign-in redirect and callback
app/api/sessions/    QR refresh and live-count polling
components/ui/       Buttons, notices, icons and other shared pieces
lib/sheets/          Google Sheets client, tab parser, roster sync, write queue
lib/checkin.ts       Check-in rules
lib/submissions.ts   Submission rules
lib/google/          Google sign-in, per-lecturer clients, Drive (resumable uploads)
lib/lecturers.ts     Who may sign in; lecturer accounts
lib/data/ownership.ts  Which lecturer owns a class, session, item or submission
lib/token.ts         Signed QR tokens and passes
lib/db/              Schema and database client
drizzle/             SQL migrations
tests/               Unit tests
```

Design decisions and tokens are recorded in [`DESIGN.md`](DESIGN.md).
