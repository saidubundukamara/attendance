# PRD — Lecturer QR Attendance System

## 1. Product Overview

A lightweight attendance system for physical university lectures.

The lecturer starts an attendance session for a class/week and displays a temporary QR code in the classroom. Students scan the QR code, enter their Student ID, and check in. The system validates the attendance session and records the student as **Present** in Google Sheets.

The system is intended for one lecturer managing approximately four classes and should remain simple, fast, and reliable even where student internet connections are slow.

---

## 2. Problem

Manual attendance is slow and takes time away from lectures.

A normal Google Form or static QR code is also easy to abuse because:

- Students can share the attendance URL.
- An absent student can check in remotely.
- Screenshots of a static QR code can be reused.
- Students may submit attendance multiple times.
- The lecturer has to manually organize attendance by class and week.

The system should make attendance quick while making remote or fraudulent check-ins significantly harder.

---

## 3. Goals

The system should:

1. Allow the lecturer to start attendance in seconds.
2. Generate a temporary QR code for the current lecture.
3. Rotate or refresh the QR code periodically.
4. Allow students to check in using their Student ID.
5. Automatically identify the correct class and week.
6. Validate that the Student ID belongs to the selected class.
7. Prevent duplicate attendance.
8. Automatically update Google Sheets.
9. Allow the lecturer to see attendance as students check in.
10. Allow the lecturer to manually mark or correct attendance.
11. Keep the student experience extremely simple.
12. Reduce opportunities for remote attendance.

---

## 4. Non-Goals

The MVP will NOT include:

- Student accounts/passwords
- Facial recognition
- Fingerprint/biometric attendance
- Mandatory GPS/location verification
- Campus Wi-Fi restrictions
- A student mobile application
- Absence excuses/workflows
- Grading
- Full university-wide administration
- Complex analytics

These can be considered later.

---

## 5. Users

### Lecturer / Administrator

The lecturer can:

- View classes
- Start an attendance session
- Select the class
- Select/confirm the teaching week
- Display the QR code
- View live attendance
- End attendance
- View previous attendance
- Manually mark students present/absent
- Correct attendance records

### Student

The student can:

- Scan the displayed QR code
- Enter their Student ID
- Submit attendance
- Receive confirmation that attendance was recorded

Students do not need accounts for the MVP.

---

## 6. Class Structure

The lecturer teaches multiple classes.

Each class contains:

- Class ID
- Class name
- Module/course name
- Student list
- Student IDs
- Start date
- Number of teaching weeks
- Current week
- Attendance history

Students are preloaded into the appropriate class.

A Student ID must be unique within the system.

---

## 7. Google Sheets Structure

Google Sheets acts as the attendance datastore/reporting layer.

A single spreadsheet can contain multiple worksheets/tabs.

Example:

- Class A
- Class B
- Class C
- Class D

Each class sheet is pre-populated with students.

Example:

| Student ID | Student Name | Week 1 | Week 2 | Week 3 | Week 4 |
|---|---|---|---|---|---|
| 2026001 | Student One | Present | Present | | |
| 2026002 | Student Two | Present | Absent | | |
| 2026003 | Student Three | Absent | Present | | |

The application determines the correct week column automatically.

The system should preferably store additional attendance metadata internally even if the main Sheet only displays `Present`/`Absent`.

---

## 8. Lecturer Workflow

### 8.1 Dashboard

The lecturer opens the dashboard and sees their classes.

Each class card should show:

- Class name
- Module
- Number of students
- Current teaching week
- Last attendance session
- Start Attendance button

### 8.2 Start Attendance

Lecturer selects:

**Start Attendance**

The system determines the current week from the class schedule.

Example:

> E-Commerce Systems  
> Week 5  
> 43 Students

The lecturer confirms:

**Start Week 5 Attendance**

### 8.3 Attendance Session Created

The backend creates an attendance session containing:

- Session ID
- Class ID
- Week
- Start time
- End time
- Status
- Secret/session key

Status:

`ACTIVE`

### 8.4 QR Display

The lecturer dashboard displays a large QR code suitable for projection.

The page should show:

> E-Commerce Systems  
> Week 5 Attendance  
> Scan to Check In

It should also show:

- Number checked in
- Number remaining
- Session status
- End Attendance button

---

## 9. QR Code Security

A static QR code should NOT be used.

The QR code should contain a temporary signed URL.

Example conceptual URL:

`/attendance/check-in?token=SIGNED_TOKEN`

The token should contain or reference:

- Attendance session
- QR issue time
- Expiry time
- Random nonce

The token must be cryptographically signed by the server.

Students must not be able to modify the token to change:

- Class
- Week
- Session
- Expiration

### QR Rotation

While an attendance session is active, the displayed QR code should refresh approximately every 60 seconds.

A QR token should expire shortly after being generated.

For example:

- QR generated at 10:05
- QR expires at 10:06
- New QR generated automatically

A screenshot of an old QR therefore becomes useless quickly.

The attendance **session** may remain open longer than an individual QR token.

---

## 10. Student Check-In Flow

Student scans QR.

They are taken to a lightweight mobile page.

Example:

> **Week 5 Attendance**
>
> E-Commerce Systems
>
> Student ID  
> [____________]
>
> **Check In**

The student should NOT manually select:

- Class
- Week
- Lecturer
- Date

These are determined by the QR/session.

The student enters only their Student ID.

---

## 11. Attendance Validation

When the student presses **Check In**, validation happens on the SERVER.

The server checks:

1. QR token exists.
2. Signature is valid.
3. QR token has not expired.
4. Attendance session exists.
5. Attendance session is ACTIVE.
6. Student ID exists.
7. Student belongs to this class.
8. Student has not already checked in for this session/week.

If everything is valid:

`Attendance = PRESENT`

The corresponding Google Sheet record is updated.

---

## 12. Successful Check-In

Student receives:

> ✓ Attendance Recorded
>
> E-Commerce Systems  
> Week 5
>
> Your attendance has been successfully recorded.

No further action is required.

---

## 13. Duplicate Check-In

If the student tries again:

> Attendance Already Recorded
>
> Your attendance for Week 5 has already been recorded.

The existing attendance record should NOT be duplicated.

---

## 14. Invalid Student ID

If the ID does not exist:

> Student ID Not Found
>
> Please check your Student ID and try again.

---

## 15. Wrong Class

If the ID exists but the student is not enrolled in the class:

> You are not registered for this class.

Do not reveal unnecessary information about other classes.

---

## 16. Expired QR

If a student opens an old QR:

> This QR code has expired.
>
> Please scan the QR currently displayed in the classroom.

---

## 17. Closed Attendance

If the lecturer has ended the session:

> Attendance Closed
>
> Attendance for this session is no longer being accepted.

---

## 18. Preventing Remote Check-Ins

No QR-only system can completely prove physical presence because a student could send the currently displayed QR to another student.

The MVP therefore uses several layers of deterrence.

### Layer 1 — Rotating QR

QR changes approximately every 60 seconds.

### Layer 2 — Short QR Expiration

Old screenshots stop working quickly.

### Layer 3 — Lecturer-Controlled Session

Check-in works only while the lecturer has an active attendance session.

### Layer 4 — Student/Class Validation

Only Student IDs registered for the class can check in.

### Layer 5 — One Attendance Per Student

Duplicate attendance is rejected.

### Layer 6 — Audit Metadata

The backend should record:

- Student ID
- Class
- Week
- Session ID
- Check-in timestamp
- IP address
- User agent/device information
- QR token/nonce identifier
- Result

This information is useful for identifying suspicious patterns.

### Layer 7 — Lecturer Spot Checks

The lecturer can occasionally compare the attendance count with the physical room.

GPS will NOT be mandatory in the MVP because device permissions, browser support, accuracy, mobile data, and connection issues could prevent legitimate students from checking in.

---

## 19. Slow Internet Considerations

The student check-in page must be extremely lightweight.

Avoid:

- Large images
- Heavy animation
- Large JavaScript dependencies
- Unnecessary API calls

The page should work well on low-end Android phones and slow mobile connections.

The QR should encode a URL rather than large amounts of data.

The server should provide immediate feedback after submission.

---

## 20. Lecturer Live Attendance View

During attendance, the lecturer should see:

> Week 5 Attendance  
> ACTIVE
>
> 31 / 43 Checked In

The list can show:

| Student | ID | Status | Time |
|---|---|---|---|
| Student One | 2026001 | Present | 10:04 |
| Student Two | 2026002 | Present | 10:05 |

The count should refresh automatically.

---

## 21. Ending Attendance

Lecturer clicks:

**End Attendance**

Confirmation:

> End attendance for Week 5?
>
> Students will no longer be able to check in.

After confirmation:

`Session status = CLOSED`

All unused QR tokens become invalid.

Students who did not check in can be treated as absent.

---

## 22. Manual Attendance

The lecturer must be able to manually modify attendance.

This handles situations such as:

- Student's phone is dead
- Student has no mobile data
- Network failure
- QR scanning problem
- Incorrect Student ID
- Lecturer correction

From the dashboard:

`Class → Week → Student → Mark Present`

Manual changes should ideally store:

- Changed by
- Previous status
- New status
- Timestamp
- Optional reason

---

## 23. Attendance History

For each class, lecturer can view:

- Week 1
- Week 2
- Week 3
- Week 4
- etc.

Each week should show:

- Total students
- Present
- Absent
- Attendance percentage
- Session date
- Session start/end time

---

## 24. Student Attendance Summary

The lecturer should be able to view a student's attendance history.

Example:

> Student: Jane Doe  
> ID: 2026001
>
> Present: 6  
> Absent: 2  
> Attendance: 75%

This can be calculated from the weekly attendance records.

---

## 25. Authentication

Only the lecturer/admin dashboard requires authentication.

For the MVP, use a simple secure authentication implementation.

Students do not create accounts.

They authenticate their attendance using:

- Valid attendance QR/token
- Valid Student ID

---

## 26. Suggested Technical Stack

### Frontend

- Next.js
- TypeScript
- Tailwind CSS

### Backend

Use Next.js Server Actions/API Route Handlers for the MVP.

A separate NestJS backend is unnecessary unless the project grows substantially.

### Storage

Primary operational data can use a lightweight database, while Google Sheets acts as the lecturer-facing attendance sheet.

Recommended simple database:

- PostgreSQL

Alternative for an extremely small deployment:

- SQLite

### Google Integration

Google Sheets API.

Use a Google service account with access only to the attendance spreadsheet.

### QR Generation

Any maintained QR-generation package compatible with Next.js.

### Authentication

NextAuth/Auth.js or another simple secure authentication solution.

---

## 27. Recommended Data Model

### Class

```text
id
name
moduleCode
startDate
totalWeeks
googleSheetName
createdAt
updatedAt
```

### Student

```text
id
studentId
name
createdAt
updatedAt
```

### Enrollment

```text
id
studentId
classId
createdAt
```

### AttendanceSession

```text
id
classId
weekNumber
status
startedAt
endedAt
createdAt
```

Status values:

```text
ACTIVE
CLOSED
```

### Attendance

```text
id
sessionId
studentId
classId
weekNumber
status
checkInTime
source
ipAddress
userAgent
createdAt
updatedAt
```

Source values:

```text
QR
MANUAL
```

### QR Token / Nonce

```text
id
sessionId
nonce
issuedAt
expiresAt
```

---

## 28. Important Backend Rule

**Never trust information coming from the browser.**

The frontend must not be allowed to send:

```text
studentId
classId
week = 5
status = PRESENT
```

and have the server blindly accept it.

Instead, the server derives the class, week, and attendance session from the signed QR/session token.

The student should effectively submit:

```text
token
studentId
```

The backend determines everything else.

---

## 29. Google Sheets Synchronization

When attendance succeeds:

1. Find the class's configured Google Sheet/tab.
2. Find the row containing the Student ID.
3. Determine the current week column.
4. Write `Present`.
5. Optionally write/check-in metadata elsewhere.

Example:

```text
Student ID: 2026001
Week: 5
Result: Present
```

If Google Sheets temporarily fails, the database should remain the source of truth and synchronization should be retried.

Attendance should NOT be lost simply because the Google Sheets API is temporarily unavailable.

---

## 30. Attendance Session Rules

Only one active attendance session should normally exist for the same class at the same time.

A session belongs to exactly:

```text
ONE CLASS
+
ONE WEEK
```

Example:

```text
E-Commerce Systems
Week 5
```

Once closed, that session cannot accept further QR check-ins.

The lecturer may still make manual corrections.

---

## 31. Week Calculation

Each class has:

- Start date
- Total number of teaching weeks

The system can calculate the current teaching week.

However, the lecturer should be able to override the automatically selected week before starting attendance.

This handles:

- Public holidays
- Cancelled lectures
- Rescheduled classes
- University calendar changes

The system might suggest:

> Based on the course start date, this is Week 5.

Then allow:

`Week 5 ▼`

before starting attendance.

---

## 32. Basic Pages

### Lecturer

```text
/login
/dashboard
/classes
/classes/[classId]
/classes/[classId]/attendance
/sessions/[sessionId]
/students/[studentId]
/settings
```

### Student

```text
/attendance/check-in
/attendance/success
```

---

## 33. Dashboard Example

```text
Good morning

My Classes

--------------------------------
E-Commerce Systems
Week 5
43 Students

[ Start Attendance ]
--------------------------------

--------------------------------
Research Methodology
Week 5
38 Students

[ Start Attendance ]
--------------------------------
```

---

## 34. Active Session Example

```text
E-Commerce Systems

WEEK 5 ATTENDANCE

        [ QR CODE ]

Scan the QR code to check in.

QR refreshes automatically.

31 / 43 students checked in

Attendance Session: ACTIVE

[ View Students ]

[ End Attendance ]
```

---

## 35. Student Experience

The entire student experience should ideally take less than 15 seconds.

```text
SCAN
  ↓
OPEN PAGE
  ↓
ENTER STUDENT ID
  ↓
CHECK IN
  ↓
ATTENDANCE RECORDED
```

Do not add unnecessary registration or login steps.

---

## 36. Security Requirements

The application must:

- Generate QR tokens server-side.
- Sign tokens securely.
- Keep signing secrets server-side.
- Reject expired tokens.
- Reject modified tokens.
- Validate enrollment server-side.
- Prevent duplicate attendance.
- Rate-limit repeated check-in attempts.
- Protect lecturer routes with authentication.
- Never expose Google service-account credentials.
- Validate and sanitize all submitted data.
- Use HTTPS in production.

---

## 37. Optional Abuse Detection

The system may flag suspicious activity without automatically blocking legitimate students.

Examples:

- Many Student IDs submitted from the same IP/device in seconds.
- Multiple IDs checked in from one browser.
- Unusually rapid sequential submissions.
- Attendance submitted very close to QR expiration repeatedly.

Flagged records can show:

`⚠ Suspicious`

The lecturer decides whether action is necessary.

This should be considered an enhancement rather than a hard dependency for the MVP.

---

## 38. MVP Requirements

The first working version MUST support:

1. Lecturer login
2. Create/manage classes
3. Import/preload student IDs
4. Configure class start date and teaching weeks
5. Start attendance session
6. Automatically suggest current week
7. Generate QR code
8. Rotate QR token
9. Student ID check-in
10. Validate class enrollment
11. Prevent duplicate attendance
12. Record attendance
13. Synchronize attendance with Google Sheets
14. Show live attendance count
15. End attendance session
16. View attendance history
17. Manually modify attendance

Everything else is secondary.

---

## 39. Future Enhancements

Possible future versions could add:

- University email verification
- Student portal
- GPS verification
- Campus Wi-Fi verification
- Lecturer mobile app
- NFC attendance
- Bluetooth proximity
- Device fingerprinting
- Multiple lecturers
- Department administration
- Attendance warnings
- Automated reports
- CSV/PDF exports
- Student attendance notifications
- LMS integration

---

## 40. Success Criteria

The MVP is successful if:

- The lecturer can start attendance in under 10 seconds.
- A student can check in in approximately 15 seconds or less.
- Attendance automatically maps to the correct class/week.
- Duplicate attendance is prevented.
- Expired QR codes cannot be used.
- Attendance appears correctly in Google Sheets.
- Lecturer can manually correct records.
- The system remains usable on slow mobile internet.
- No manual attendance sheet is required during normal lectures.

---

## 41. Core Product Principle

The system should remain:

**Simple for students, fast for the lecturer, and difficult enough to abuse that remote attendance is inconvenient.**

Do not sacrifice classroom usability by attempting to create perfect anti-cheating protection.

The MVP flow is:

**Start Session → Display Rotating QR → Scan → Enter Student ID → Validate → Mark Present → Sync to Google Sheets.**
