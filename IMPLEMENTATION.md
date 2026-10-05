# Implementation Plan — Lecturer QR Attendance System

Companion to [`PRD.md`](./PRD.md). This document turns the PRD into a phased build for this repo (Next.js 16.3.8, React 19, Tailwind 4, TypeScript).

---

## 1. Decisions

| Topic | Decision |
|---|---|
| Roster | Students are added **manually in the Google Sheet**. The app never creates students. An ID that is not in the class's sheet tab is rejected. |
| Spreadsheet | **Google Sheets**, accessed with a service account. The local `.xlsx` was only a sample of the layout; nothing in the app reads it. |
| Database | **SQLite inside the project** (`./data/attendance.db`). SQLite is the source of truth for sessions and attendance; the sheet is the roster input and the attendance output. |
| Attendance values | The sheet uses **`1` / `0`**, and its Total column is `=SUM(...)`. The app writes `1` and `0`, not "Present"/"Absent". |
| Statuses | Present and absent only. |
| Device rule | **One check-in per phone per session.** A second Student ID from the same phone is blocked. |
| Lecturer auth | One lecturer, one password from an environment variable. |
| Hosting | Deferred. The only requirement the build imposes is a persistent disk for the SQLite file (see §12). |

### Deliberate deviations from the PRD

1. **`1`/`0` instead of `Present`/`Absent`** (PRD §7) — matches the existing sheet and keeps its Total formula working.
2. **No QR token table** (PRD §27) — tokens are stateless and signed; the nonce is stored on the attendance and attempt rows instead.
3. **One rejection message** for "ID not in this class" (PRD §14 and §15 merged) — simpler, and reveals nothing about other classes.
4. **Device blocking is in the MVP** (PRD §37 lists it as optional flagging).
5. **Classes are discovered from the sheet tabs**, not created in the app (PRD §38 item 2 becomes "sync and configure classes").

---

## 2. Spreadsheet contract

The Google Sheet is expected to follow the layout of the sample workbook.

**Tabs**

| Tab | Purpose | App access |
|---|---|---|
| `<CLASS>` e.g. `BSEM1201` | Grades | **Never read, never written** |
| `Attn of <CLASS>` e.g. `Attn of BSEM1201` | Attendance | Read roster, write week cells |

**Attendance tab layout**

| Area | Location in sample | How the app finds it |
|---|---|---|
| Module name / code | Rows 2–7, label in `E`, value in `G` | Scan the rows above the header for cells starting `MODULE NAME` / `MODULE CODE`; take the next non-empty cell to the right |
| Header row | Row 10 | First row containing a cell equal to `ID Number` (trimmed, case-insensitive) |
| No. / Name / ID | `B` / `C` / `D` | Columns of the `Name` and `ID Number` headers |
| Weeks | `E`–`S` = `WK1`–`WK15` | Headers matching `/^WK\s*(\d+)$/i` → week number → column |
| Total | `T`, `=SUM(E:S)` | Not touched |
| Reason | `U` | Not touched in the MVP |
| Students | Row 11 downward | Rows below the header with a non-empty ID cell |

**Rules**

- The class code is taken from the **tab name** (`Attn of BSEM1201` → `BSEM1201`). The "Class:" cell inside the tab is ignored; in the sample it is inconsistent.
- Student IDs are stored in the sheet as numbers (e.g. `905005069`). Read with `valueRenderOption: UNFORMATTED_VALUE`, convert to a string, trim, and strip any trailing `.0`. IDs are compared as strings everywhere.
- Rows with a number in `No.` but no ID are skipped (the sample has pre-numbered empty rows).
- Nothing is located by fixed cell address. Adding students, inserting rows, sorting, or adding a new `Attn of …` tab needs no code change.
- When writing, the student's row is **looked up again by ID** at write time, so a row inserted or sorted since the last sync cannot cause a write to the wrong student.
- A cell holding anything other than `1`, `0` or blank is left alone and reported as a sync warning.

**One-time sheet setup**

1. Confirm the uploaded file is a native Google Sheet. If its name still ends in `.xlsx` in Drive, use *File → Save as Google Sheets*; the Sheets API does not work on an `.xlsx` file.
2. Create a Google Cloud project, enable the Google Sheets API, create a service account and a JSON key.
3. Share the spreadsheet with the service account's email as **Editor**. Share nothing else with it.
4. Copy the spreadsheet ID from the URL into `GOOGLE_SHEET_ID`.

---

## 3. Architecture

```
Lecturer browser ──► Next.js (App Router) ──► SQLite (source of truth)
Student phone   ──►   server actions /    ──► Google Sheets API
                      route handlers          (roster in, 1/0 out)
```

**Request flow for a check-in**

1. Phone scans QR → `GET /a?t=<signed QR token>`.
2. Server verifies the token and the session, sets a `device_id` cookie if absent, and renders the form with a signed **check-in pass** (valid ~3 minutes) in a hidden field.
3. Student submits Student ID → server action verifies the pass, the session, the enrollment and the device rule, inserts the attendance row, and responds.
4. After the response is sent, the server writes `1` to the sheet. If that fails, the job stays queued and is retried.

The pass exists because a QR token lives ~90 seconds: without it, a student who scans in time but types slowly on a slow connection would be rejected at submit.

### Dependencies to add

| Package | Use |
|---|---|
| `better-sqlite3`, `drizzle-orm` (+ dev: `drizzle-kit`, `@types/better-sqlite3`) | Database |
| `googleapis` | Sheets API with service-account auth |
| `qrcode` (+ dev: `@types/qrcode`) | QR as SVG, generated on the server |
| `zod` | Input validation |
| dev: `vitest` | Unit tests |

Tokens, cookies and password comparison use `node:crypto` (HMAC-SHA256, `timingSafeEqual`, `randomUUID`); no JWT or auth library is needed for one lecturer.

### Environment variables (`.env.local`, already gitignored)

```
DATABASE_PATH=./data/attendance.db
APP_URL=http://localhost:3000          # base URL encoded into the QR
LECTURER_PASSWORD=...
AUTH_SECRET=...                        # signs the lecturer session cookie
QR_SECRET=...                          # signs QR tokens and check-in passes
GOOGLE_SHEET_ID=...
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Add `/data` to `.gitignore`. Commit a `.env.example` with empty values.

### Next.js 16 notes (verified against `node_modules/next/dist/docs/`)

`AGENTS.md` requires reading the bundled docs before writing code. Points that matter here:

- **`proxy.ts`, not `middleware.ts`.** Middleware is deprecated and renamed (`03-api-reference/03-file-conventions/proxy.md`). Export a function named `proxy`. It runs on the Node.js runtime, and the docs warn against relying on shared modules or globals in it — so the proxy only verifies the cookie signature and redirects; it does not open the database.
- **`params`, `searchParams` and `cookies()` are async** — `const { id } = await params`, `const jar = await cookies()`.
- **Call `await connection()` before synchronous DB reads** (`04-functions/connection.md`). `better-sqlite3` queries otherwise complete during prerendering and the page is served stale.
- **`better-sqlite3` is already on Next's default `serverExternalPackages` list**, so no config change is needed for it.
- **`after()` from `next/server`** schedules work after the response is sent; used for the sheet write.
- Leave `cacheComponents` off; nothing in this app benefits from caching.

### Folder structure

```
app/
  (lecturer)/
    layout.tsx
    dashboard/page.tsx
    classes/[classId]/page.tsx            # history grid + settings
    sessions/[sessionId]/page.tsx         # projector view: QR + live list
    students/[studentId]/page.tsx
  login/page.tsx
  a/route.ts                              # student check-in: plain HTML from a route handler (short path keeps the QR simple)
  api/sessions/[sessionId]/qr/route.ts    # current QR as SVG
  api/sessions/[sessionId]/live/route.ts  # counts + list for polling
lib/
  db/{index.ts, schema.ts}
  sheets/{client.ts, parse.ts, roster.ts, write.ts}
  auth.ts  session.ts  token.ts  qr.ts  week.ts  ratelimit.ts
  sessions.ts                             # open / close rules, no HTTP
  checkin.ts                              # validation + insert, no HTTP
  checkin-page.ts                         # HTML for the student page
  actions/{auth.ts, classes.ts, sessions.ts, attendance.ts}
proxy.ts
drizzle/                                  # generated migrations
tests/
```

---

## 4. Data model (SQLite via Drizzle)

Timestamps are integer Unix milliseconds. Booleans are 0/1.

**`classes`**

| Column | Notes |
|---|---|
| `id` | PK |
| `code` | Unique. From the tab name, e.g. `BSEM1201` |
| `sheet_tab` | Unique. Full tab title, e.g. `Attn of BSEM1201` |
| `module_name`, `module_code` | From the info block; nullable |
| `start_date` | ISO date, nullable until the lecturer sets it |
| `total_weeks` | Number of `WKn` columns found (15 in the sample) |
| `last_synced_at` | |

**`students`** — `id` PK, `student_id` (unique string), `name`.

**`enrollments`** — `id`, `class_id`, `student_id` (FK to `students.id`), `active` (0 when the ID disappears from the sheet), unique `(class_id, student_id)`.

**`sessions`**

| Column | Notes |
|---|---|
| `id` | PK, random UUID (appears in tokens) |
| `class_id`, `week` | Unique `(class_id, week)` — one session per class per week |
| `status` | `ACTIVE` or `CLOSED` |
| `started_at`, `ended_at` | |

Partial unique index on `(class_id) WHERE status = 'ACTIVE'` — one active session per class.

**`attendance`**

| Column | Notes |
|---|---|
| `id` | PK |
| `session_id`, `student_id` | Unique `(session_id, student_id)` — duplicates are impossible at the database level |
| `status` | `PRESENT` or `ABSENT` |
| `source` | `QR` or `MANUAL` |
| `check_in_at` | |
| `device_id`, `ip`, `user_agent`, `nonce` | Audit fields; null for manual |
| `flagged` | 1 when the abuse heuristics fire |

Partial unique index on `(session_id, device_id) WHERE source = 'QR'` — this is the device rule.

**`checkin_attempts`** — every submit, successful or not: `session_id`, `student_id_entered`, `device_id`, `ip`, `user_agent`, `nonce`, `result`, `created_at`. This is PRD §18 Layer 6.

**`manual_changes`** — `session_id`, `student_id`, `previous_status`, `new_status`, `reason`, `created_at` (PRD §22).

**`sync_jobs`** — outbox for sheet writes: `id`, `class_id`, `student_id` (string ID), `week`, `value` (0/1), `status` (`PENDING`/`DONE`/`FAILED`), `attempts`, `last_error`, `created_at`, `done_at`.

---

## 5. Phases

Each phase ends in something runnable. Do them in order; each lists what to build and how to confirm it works.

### Phase 0 — Foundations

**Build**
- Install the dependencies in §3. Add `/data` to `.gitignore`, add `.env.example`.
- `lib/db/schema.ts` with the tables in §4; `lib/db/index.ts` opening `DATABASE_PATH` (create the folder if missing), with `journal_mode = WAL` and `foreign_keys = ON`. Keep one connection on `globalThis` so dev hot-reload does not open a new one per edit.
- `drizzle.config.ts`; scripts `db:generate`, `db:migrate`, `test`.
- Replace the scaffold `app/page.tsx` with a redirect to `/dashboard`.
- Read the Next docs listed in §3 before writing the first route.

**Done when**
- `npm run db:migrate` creates `data/attendance.db` with all tables and indexes.
- `npm run build` and `npm run lint` pass.

### Phase 1 — Google Sheets and roster sync

**Build**
- `lib/sheets/client.ts` — authenticated Sheets client from the three `GOOGLE_*` variables (replace literal `\n` in the private key). Scope: `https://www.googleapis.com/auth/spreadsheets`.
- `lib/sheets/parse.ts` — pure function `parseAttendanceTab(values: unknown[][])` returning `{ moduleName, moduleCode, headerRow, idCol, nameCol, weekCols: Map<number, number>, students: {studentId, name, row}[], warnings }`, following §2. No network access, so it is fully unit-testable.
- `lib/sheets/roster.ts` — `syncRoster()`:
  1. List tabs; keep those whose title starts with `Attn of ` (case-insensitive).
  2. Fetch each tab's values in one `batchGet`.
  3. Parse, then in one transaction: upsert the class, upsert students (update the name if it changed), upsert enrollments as active, mark enrollments missing from the sheet as inactive.
  4. Return a report per class: students found, added, deactivated, and warnings (duplicate ID within a tab, non-numeric ID, missing name, tab with no `ID Number` header).
- A temporary script or route to run `syncRoster()` and print the report.

**Tests** (`tests/parse.test.ts`, synthetic fixtures with made-up names)
- Sample layout parses to the right columns and students.
- Header row on a different row; extra columns before `WK1`; weeks out of order.
- Numeric ID `905005069` and `905005069.0` both become `"905005069"`.
- Numbered rows with no ID are skipped; duplicate IDs produce a warning and are imported once.
- A tab without `ID Number` yields a warning, not an exception.

**Done when**
- Running the sync against the real sheet lists each `Attn of …` tab with the correct student count, and the grade tabs do not appear.
- Adding a student row in the sheet and re-running adds exactly one enrollment; deleting a row deactivates one.

### Phase 2 — Lecturer login, dashboard, class settings

**Build**
- `lib/auth.ts` — `verifyPassword` (hash both sides, `timingSafeEqual`), `createSessionCookie` / `readSession` (HMAC-signed value with expiry; cookie is `httpOnly`, `sameSite=lax`, `secure` in production, 12-hour life), and `requireLecturer()` which redirects to `/login` when there is no valid session.
- `app/login/page.tsx` + `lib/actions/auth.ts` (`login`, `logout`). Limit login attempts per IP (5 per 10 minutes) using `lib/ratelimit.ts`.
- `proxy.ts` — matcher covering `/dashboard`, `/classes`, `/sessions`, `/students` and `/api/sessions`; redirects to `/login` when the cookie signature is invalid. **Every server action and route handler also calls `requireLecturer()`**; the proxy is a convenience, not the security boundary.
- `/dashboard` — one card per class: code, module name, active student count, suggested week, last session, **Start Attendance**, plus a **Sync roster** button showing the Phase 1 report. A class with no start date shows "Set start date" instead of a week.
- `/classes/[classId]` — settings form for `start_date` and `total_weeks`.
- `lib/week.ts` — `suggestWeek(startDate, today, totalWeeks)` = `floor(daysSince / 7) + 1`, clamped to `1..totalWeeks`; returns `null` when no start date.

**Tests** — `week.test.ts` (day 0 → 1, day 7 → 2, before start → 1, past the end → `totalWeeks`); cookie signing round-trip, tampered cookie rejected, expired cookie rejected.

**Done when**
- Every lecturer page redirects to `/login` when signed out; a wrong password is refused.
- The dashboard shows the classes from the sheet with correct counts and week suggestions.

### Phase 3 — Sessions and the rotating QR

**Build**
- `lib/token.ts`
  - `signQrToken(sessionId)` → `base64url(payload).base64url(hmac)`, payload `{ s: sessionId, iat, exp: iat + 90s, n: nonce }`.
  - `verifyQrToken(token)` → payload, or a typed error: `MALFORMED`, `BAD_SIGNATURE`, `EXPIRED`.
  - `signPass` / `verifyPass` with the same construction, payload `{ s, d: deviceId, n, exp: now + 180s }` and a different HMAC context prefix so a QR token can never be used as a pass.
- `lib/actions/sessions.ts`
  - `startSession(classId, week)` — runs `syncRoster()` first (so students added that morning are included; if the sheet is unreachable, continue with the existing roster and show a warning). If a session exists for that class and week, set it back to `ACTIVE` (reopen); otherwise insert. The partial unique index rejects a second active session for the class.
  - `endSession(sessionId)` — completed in Phase 6.
- Start flow on the dashboard: confirm dialog showing class, suggested week in a dropdown (override per PRD §31), student count.
- `/sessions/[sessionId]` — projector view: class, "Week N Attendance", large QR, checked-in count, status, **End Attendance**.
- `GET /api/sessions/[sessionId]/qr` — lecturer-only; returns `{ svg, expiresAt }` where the QR encodes `${APP_URL}/a?t=<token>`. Returns 409 if the session is closed.
- A small client component that fetches a new QR every 60 seconds and, if a fetch fails, shows "Reconnecting…" over the QR rather than leaving a stale code on screen.

**Tests** — `token.test.ts`: round-trip; changing any character fails; expired token fails; a pass is rejected as a QR token and the reverse.

**Done when**
- Starting attendance shows a QR that changes every minute.
- Decoding the QR gives a URL on `APP_URL`; a token older than 90 seconds no longer verifies.
- Starting a second session for a class that already has an active one is refused with a link to the active session.

### Phase 4 — Student check-in

**Build**
- The `device_id` cookie (random UUID, `httpOnly`, `sameSite=lax`, one-year life) is read and set inside the route handler.
- `app/a/route.ts` — a route handler returning a plain HTML string (built in `lib/checkin-page.ts`), not a page. This sends no framework JavaScript, keeps the form at about 2 KB, and lets the handler set the device cookie itself. `GET`:
  - Verify the QR token → on failure render the "QR expired" screen (PRD §16).
  - Load the session → if `CLOSED`, render "Attendance Closed" (PRD §17).
  - If this device already checked in for this session, render the "already recorded" screen straight away.
  - Otherwise render class, week, a numeric Student ID input (`inputmode="numeric"`, `autocomplete="off"`), the pass in a hidden field, and **Check In**.
- `lib/checkin.ts` — `checkIn({ pass, studentIdRaw, deviceId, ip, userAgent })`, a pure-ish function returning a result code. Order of checks:

  | # | Check | Result on failure |
  |---|---|---|
  | 1 | Pass present, signature valid, not expired, device matches | `EXPIRED` — "scan the QR again" |
  | 2 | Session exists and is `ACTIVE` | `CLOSED` |
  | 3 | Rate limit for this device and IP not exceeded | `RATE_LIMITED` |
  | 4 | Student ID is 4–12 digits after trimming | `INVALID_ID` |
  | 5 | ID has an **active enrollment in this session's class** | `NOT_FOUND` — "Student ID not found for this class" |
  | 6 | This student has no attendance row for the session | `ALREADY` |
  | 7 | This device has no QR attendance row for the session | `DEVICE_USED` — "This phone has already been used to check in. See your lecturer." |
  | 8 | Insert `PRESENT` / `QR` with audit fields | `OK` |

  Steps 6–8 run in one transaction and the unique indexes are the final guard: a constraint error on `(session_id, student_id)` maps to `ALREADY`, on `(session_id, device_id)` to `DEVICE_USED`. Every call writes a `checkin_attempts` row with its result.
- `POST /a` in the same route handler wraps `checkIn`, reading IP from `x-forwarded-for` (first hop) and the user agent from headers. Cross-site posts are harmless: the device cookie is `SameSite=Lax`, so it is not sent and the pass fails its device check. The class and week come **only** from the session inside the pass; the form posts nothing but the pass and the Student ID (PRD §28).
- Result screens per PRD §12–17, returned directly by the `POST` response. The success screen names the student so a mistyped ID is noticed.
- `lib/ratelimit.ts` — in-memory sliding window: 8 submissions per device per session, 120 per IP per minute (a whole class on campus Wi-Fi usually shares one public IP, so a lower IP limit would block real students). In-memory is enough for a single server process; note this in the code.
- Flagging: set `flagged = 1` when the same IP **and** user agent already has a check-in for the session under a different `device_id`. This catches the cookie being cleared between two check-ins. It is a flag, not a block, because phones on the same campus network can share an IP.

**Page weight** — no images, no web fonts, no client components on `/a`. Target under 15 KB transferred for the form page.

**Tests** (`checkin.test.ts`, against a temporary SQLite file)
- Happy path creates one row.
- Same student twice → `ALREADY`, still one row.
- Second student from the same device → `DEVICE_USED`.
- ID from another class → `NOT_FOUND`; inactive enrollment → `NOT_FOUND`.
- Closed session → `CLOSED`; expired pass → `EXPIRED`; pass issued for another device → `EXPIRED`.
- Two concurrent submits for the same student produce exactly one row.

**Done when**
- A phone on the network scans, enters a valid ID and sees the confirmation in well under 15 seconds.
- Each failure case above shows its own screen, and the page works with JavaScript disabled.

**Known limit of the device rule** — it relies on a cookie. A student who opens a private window or clears site data gets a new device ID. The flag above and the lecturer's head count (PRD §18 Layer 7) are the backstop. Closing this gap fully needs something outside the MVP, such as per-student accounts.

### Phase 5 — Writing attendance back to the sheet

**Build**
- `lib/sheets/write.ts` — `processSyncJobs(classId?)`:
  1. Load `PENDING` and `FAILED` jobs (attempts < 10), grouped by class.
  2. For each class, read the tab's header row and ID column once, build `studentId → row` and `week → column`.
  3. Send all cell writes for the class in one `values.batchUpdate` with `valueInputOption: RAW` and numeric values `1` / `0`.
  4. Mark jobs `DONE`; on error increment `attempts`, store `last_error`, mark `FAILED`.
  5. A job whose student ID or week column is no longer in the sheet fails with a clear message and does not block the others.
- Enqueue a job inside the same transaction as the attendance insert (Phase 4) so a recorded check-in always has a matching job.
- Trigger processing with `after(() => processSyncJobs(classId))` in the check-in action. A module-level lock per class prevents two overlapping runs; a run that finds the lock taken sets a "run again" marker instead of starting.
- Also run `processSyncJobs` when a session ends and when the lecturer clicks **Retry sync**.
- Dashboard and session view show "Sheet sync: N pending" with **Retry sync** and the last error when N > 0.

**Why batching matters** — the Sheets API allows roughly 60 write requests per minute per user. Forty students checking in within a minute would hit that with one request each; batching per class per run stays far below it.

**Tests** — row/column resolution from a parsed tab; a job for a missing student fails alone; jobs are idempotent (running twice writes the same value).

**Done when**
- A check-in puts `1` in the right student's `WKn` cell within a few seconds, and the Total column updates.
- With the network to Google blocked, check-ins still succeed, jobs accumulate as pending, and **Retry sync** clears them once the network returns.
- Sorting the sheet by name between two check-ins still writes to the right rows.

### Phase 6 — Live view, ending a session, manual corrections

**Build**
- `GET /api/sessions/[sessionId]/live` — `{ status, present, total, students: [{ studentId, name, status, time, source, flagged }], pendingSync }`.
- Live list on `/sessions/[sessionId]`: "31 / 43 Checked In", table of students (present first, most recent at the top), a ⚠ marker on flagged rows, polled every 3 seconds while the session is active. A "View students" toggle hides the list when the QR is projected.
- `endSession(sessionId)` behind a confirm dialog (PRD §21): set `CLOSED` and `ended_at`; insert `ABSENT` / `MANUAL` rows for active enrollments with no row; enqueue `0` jobs for them; run the sync. Because QR tokens and passes are checked against the session status, they all stop working immediately.
- `lib/actions/attendance.ts` — `setAttendance(sessionId, studentId, status, reason?)`: upsert the row with `source = MANUAL`, insert a `manual_changes` row with the previous and new status, enqueue a `1` or `0` job. Works on active and closed sessions (PRD §30).
- Per-row **Mark present** / **Mark absent** buttons in the live list and in the history view, with an optional reason.

**Done when**
- The count and list update within a few seconds of a check-in without a page reload.
- Ending a session writes `0` for everyone who did not check in, and an old QR then shows "Attendance Closed".
- Marking a student present by hand changes the sheet cell to `1` and leaves an entry in `manual_changes`.

### Phase 7 — History and student summary

**Build**
- `/classes/[classId]` — grid of students × weeks from the database (✓ / ✗ / blank for weeks with no session), and per-week totals: present, absent, percentage, session date, start and end time (PRD §23). Clicking a cell opens the manual correction control from Phase 6. A week with no session can be opened as a closed session so past weeks can be filled in by hand. Doing so marks nobody and queues nothing for the sheet; only students the lecturer then marks are written, so values already typed into the sheet for that week are not overwritten wholesale.
- `/students/[studentId]` — name, ID, per class: present, absent, percentage, week-by-week list (PRD §24). Percentages count only weeks that have a session.
- Links from the live list and the grid to the student page.

**Done when**
- Totals in the grid equal the Total column in the sheet for a class where all changes went through the app.
- A student's percentage matches a hand count.

### Phase 8 — Hardening and release

**Build**
- `zod` schemas on every server action and route handler input.
- `error.tsx` and `not-found.tsx` for the lecturer area; a plain-text fallback for `/a` that tells the student to see the lecturer.
- Startup check that fails loudly with a readable message when a required environment variable is missing.
- Security review against PRD §36: secrets only read in server files; no service-account data reaches the client bundle (`grep` the build output for the service account email); cookies `httpOnly` + `secure`; no student data on `/a` beyond the class and week.
- `README.md` — setup (env, sheet sharing, migrate, run), the semester-start routine (set start dates, sync roster), and the in-lecture routine.
- Full manual run-through with two phones (see §11).

**Done when**
- `npm run lint`, `npm run test` and `npm run build` pass.
- The run-through in §11 passes end to end against the real sheet.

---

## 6. Student-facing messages

| Code | Screen |
|---|---|
| `OK` | ✓ Attendance Recorded — *Module*, Week N. |
| `ALREADY` | Attendance Already Recorded — Your attendance for Week N has already been recorded. |
| `NOT_FOUND` / `INVALID_ID` | Student ID not found for this class. Please check your Student ID and try again. *(form stays on screen)* |
| `DEVICE_USED` | This phone has already been used to check in for this class. Please see your lecturer. |
| `EXPIRED` | This QR code has expired. Please scan the QR currently displayed in the classroom. |
| `CLOSED` | Attendance Closed — Attendance for this session is no longer being accepted. |
| `RATE_LIMITED` | Too many attempts. Please see your lecturer. |

---

## 7. Lecturer routines

**Start of semester**
1. Fill in the `Attn of …` tabs in the Google Sheet (name and ID per row).
2. In the app: **Sync roster**, check the counts, set each class's start date.

**Each lecture**
1. Dashboard → **Start Attendance** → confirm the week.
2. Project the QR. Watch the count.
3. Mark anyone with a dead phone present by hand.
4. **End Attendance**. Absentees get `0`.

**Adding a student mid-semester** — add the row in the sheet, then **Sync roster** (or simply start the next session, which syncs first). Until the sync runs, that ID is rejected.

---

## 8. Edge cases and how they are handled

| Case | Behaviour |
|---|---|
| Student added to the sheet during an active session | Lecturer clicks **Sync roster**; the student can then check in |
| Student removed from the sheet | Enrollment becomes inactive; past attendance is kept in the database; future check-ins are rejected |
| Same ID appears twice in one tab | Imported once, warning shown in the sync report |
| Same student in two classes | Supported; one `students` row, two enrollments |
| Lecturer edits a week cell by hand in the sheet | The sheet keeps the edit, but the database does not see it. Corrections should be made in the app. A later app write to the same cell overwrites it |
| Sheet unreachable when starting a session | Session starts with the last synced roster and a visible warning |
| Sheet unreachable during check-ins | Check-ins succeed; writes queue and retry |
| `WKn` column deleted or renamed | Sync job fails with "Week N column not found in *tab*"; attendance remains safe in the database |
| Server restarts mid-session | Session, attendance and queued writes are in SQLite and survive. Rate-limit counters reset, which is acceptable |
| Two classes active at once | Allowed; the limit is one active session per class |
| Lecturer starts the wrong week | End the session, then use manual corrections, or reopen the correct week. Rows already written stay under the week they were recorded for and must be corrected by hand |

---

## 9. PRD §38 MVP checklist

| # | Requirement | Phase |
|---|---|---|
| 1 | Lecturer login | 2 |
| 2 | Create/manage classes | 1 (from sheet tabs) + 2 (settings) |
| 3 | Import/preload student IDs | 1 |
| 4 | Configure class start date and teaching weeks | 2 |
| 5 | Start attendance session | 3 |
| 6 | Automatically suggest current week | 2, 3 |
| 7 | Generate QR code | 3 |
| 8 | Rotate QR token | 3 |
| 9 | Student ID check-in | 4 |
| 10 | Validate class enrollment | 4 |
| 11 | Prevent duplicate attendance | 4 |
| 12 | Record attendance | 4 |
| 13 | Synchronize attendance with Google Sheets | 5 |
| 14 | Show live attendance count | 6 |
| 15 | End attendance session | 6 |
| 16 | View attendance history | 7 |
| 17 | Manually modify attendance | 6 |

---

## 10. Out of scope for this build

Everything in PRD §4 and §39, plus: writing to the `REASON` column, importing attendance already typed into the sheet, multiple sessions per class per week, CSV/PDF export, and multiple lecturers.

---

## 11. End-to-end acceptance run

Use the real sheet with a test class tab, and two phones.

1. Sync roster → counts match the sheet.
2. Start Week 1 for the test class → QR appears and rotates after 60 seconds.
3. Phone A: scan, enter a valid ID → confirmation; sheet shows `1`; live count is 1.
4. Phone A: scan again, same ID → "already recorded".
5. Phone A: scan again, a different valid ID → "phone already used".
6. Phone B: enter an ID from another class → "not found for this class".
7. Phone B: scan, wait three and a half minutes, submit → "QR expired".
8. Photograph the QR, wait two minutes, open the photo's link → "QR expired".
9. Turn off the server's internet access, check in on Phone B → confirmation; dashboard shows 1 pending. Restore access, **Retry sync** → sheet updated.
10. Mark a third student present by hand → sheet shows `1`, change is logged.
11. End Attendance → remaining students show `0`; scanning the last QR shows "Attendance Closed".
12. History grid totals equal the sheet's Total column; a student page shows the right percentage.
13. Check the grade tabs are unchanged.

---

## 12. Hosting note (to decide later)

The app needs to be reachable from students' phones over HTTPS and needs a **persistent disk** for `data/attendance.db`.

- A small VPS, Fly.io, Railway or Render instance with a volume works as built.
- Vercel and similar serverless platforms have no persistent local disk, so the SQLite file would be lost between invocations. Deploying there means replacing the file with a hosted SQLite service (for example Turso), which is a contained change in `lib/db/index.ts` plus making the queries async.
- Running on the lecturer's laptop with students on the same Wi-Fi also works, with `APP_URL` set to the laptop's LAN address. That setup is plain HTTP, so the `secure` cookie flag must be tied to `APP_URL` starting with `https://` rather than to production mode, or the login and device cookies will not be stored.

Whichever is chosen, set `APP_URL` to the public address, because it is encoded into every QR.
