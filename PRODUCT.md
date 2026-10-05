# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Lecturer** (one, signed in with a password): takes attendance at the start of a class, usually with the QR on a classroom projector, and later reviews or corrects records at a desk.
- **Students**: scan the QR with their own phone, often a low-end Android on slow mobile data, and want to be done in a few seconds.

## Product Purpose

Record who attended each teaching week and write it to the lecturer's Google Sheet. Start session, show rotating QR, scan, enter student ID, mark present, sync to the sheet. Full detail in `PRD.md`.

## Operating Context

- The session screen is projected in a classroom; the count and the QR must read from the back of the room.
- The Google Sheet is the roster and the record of truth; the app's database is the working copy.
- Student IDs are `90500` followed by four digits. Students type only the last four.

## Capabilities and Constraints

- The student check-in page (`/a`) is one small HTML response: no framework, no web fonts, no images, under 6 KB, and it must work with JavaScript off.
- The QR rotates every 60 seconds; one phone can check in one student per session.
- Light theme only (confirmed 2026-10-05). The QR always sits on white.
- No new npm dependencies were wanted for the redesign.

## Brand Commitments

- Name: "Attendance". No logo or institutional colours have been supplied.
- Look confirmed by the user: clean, minimal, neutral with a single green accent meaning present / open.

## Product Principles

1. The student's path is the shortest one possible: scan, four digits, done.
2. The lecturer always knows the state: open or closed, how many in, who is missing, whether the sheet is up to date.
3. Nothing is lost quietly: failures are named with what to do next; routine waits are not dressed as warnings.
4. Corrections are easy and leave a reason.
