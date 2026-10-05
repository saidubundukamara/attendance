---
name: Attendance
description: Lecturer QR attendance. Light, neutral, one green accent.
colors:
  canvas: "#f3f5f3"
  surface: "#ffffff"
  sunken: "#eaede9"
  ink: "#0d1210"
  muted: "#56605a"
  faint: "#8b948e"
  line: "rgb(13 18 16 / 0.09)"
  line-strong: "rgb(13 18 16 / 0.18)"
  accent: "#0c7a4a"
  accent-strong: "#095c38"
  accent-soft: "#e0f2e8"
  danger: "#b42318"
  danger-soft: "#fbe8e5"
  warn: "#8a5600"
  warn-soft: "#faf0d9"
typography:
  display:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  count:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "6rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.05em"
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  field: "0.75rem"
  panel: "1rem"
  card: "1.5rem"
  plate: "2.25rem"
  pill: "9999px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    height: "2.5rem"
    padding: "0 1.25rem"
  button-accent:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    height: "2.75rem"
---

## Overview

A quiet working tool. Off-white canvas, near-black ink, white surfaces, and one green that only ever means present, open or done. Tokens live in `app/globals.css` (`@theme`); shared pieces live in `components/ui/`. The student page (`lib/checkin-page.ts`) is standalone HTML and repeats the same colours and easing by hand.

## Colors

Neutrals lean slightly toward the accent so nothing reads as plain grey. Green is never decoration. Red is for absent and destructive actions, amber for things that need the lecturer's attention. Hairlines are low-alpha ink (`line`), not a grey.

## Typography

Geist throughout the lecturer app; the system font on the student page. Headings are semibold with tight tracking. All counts, IDs and times use tabular numerals. Monospace appears only in the student ID field, where character alignment matters.

## Layout

Content sits directly on the canvas; surfaces are used for things that are objects (a class, a table, the QR), never nested. List pages are a 48rem column; the session and class pages use the full 72rem. The session screen is two columns on wide screens (QR, then count) and one on phones.

## Elevation & Depth

Two shadows: `shadow-soft` for surfaces, `shadow-plate` for the QR. The QR is the only double-bezel element: a white plate seated in a tinted tray.

## Shapes

Buttons and chips are full pills. Status marks are circles. Radii grow with the object: field 0.75rem, panel 1rem, card 1.5rem, QR tray 2.25rem.

## Components

- `Button` / `buttonClass`: pill; primary, accent, secondary, danger, destructive, ghost. `arrow` adds the trailing arrow in its own circle; `block` makes it full width.
- `ConfirmButton`: asks in place before a destructive action. No browser dialogs.
- `Notice`: the only banner. Warn, ok, danger.
- `status.tsx`: present / absent / no-record marks and the live dot.
- `icons.tsx`: one 16px grid, 1.4 stroke. No unicode glyphs or emoji as icons.

Motion: easing is `ease-out-expo` for entrances and `ease-spring` for presses and toggles. Content rises in once on load (`animate-rise`, `.stagger`). Each screen has one live moment: the count ticking and names arriving on the session screen, the check drawing on the student's success page. Everything collapses under `prefers-reduced-motion`.

## Do's and Don'ts

- Do keep green for present / open / done only.
- Do name the next step in every error.
- Don't add eyebrow labels, gradient text, nested cards or decorative blur.
- Don't show a warning for a routine wait; warn when something is stuck.
- Don't add scripts, fonts or images to the student page beyond its inline script.
