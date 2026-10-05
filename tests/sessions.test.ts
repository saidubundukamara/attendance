import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { classes, sessions } from "@/lib/db/schema";
import { closeSession, openSession } from "@/lib/sessions";
import { createTestDb } from "./helpers/db";

let db: Db;
let classA: number;
let classB: number;

beforeEach(() => {
  db = createTestDb();
  [classA, classB] = ["TEST101", "TEST202"].map(
    (code) =>
      db
        .insert(classes)
        .values({ code, sheetTab: `Attn of ${code}`, totalWeeks: 15 })
        .returning()
        .get().id,
  );
});

function open(classId: number, week: number, now = 1000) {
  const result = openSession(db, classId, week, now);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

describe("openSession", () => {
  it("creates an active session", () => {
    const result = open(classA, 5);
    expect(result.reopened).toBe(false);
    expect(db.select().from(sessions).get()).toMatchObject({
      id: result.sessionId,
      classId: classA,
      week: 5,
      status: "ACTIVE",
      startedAt: 1000,
      endedAt: null,
    });
  });

  it("returns the same session when the week is already active", () => {
    const first = open(classA, 5);
    const again = open(classA, 5);
    expect(again.sessionId).toBe(first.sessionId);
    expect(db.select().from(sessions).all()).toHaveLength(1);
  });

  it("refuses a second active session for the class", () => {
    const first = open(classA, 5);
    expect(openSession(db, classA, 6)).toEqual({
      ok: false,
      reason: "ACTIVE_EXISTS",
      sessionId: first.sessionId,
      week: 5,
    });
  });

  it("allows two classes to be active at once", () => {
    open(classA, 5);
    open(classB, 5);
    expect(db.select().from(sessions).all()).toHaveLength(2);
  });

  it("reopens a closed week, keeping its id and start time", () => {
    const first = open(classA, 5, 1000);
    closeSession(db, first.sessionId, 2000);
    const again = open(classA, 5, 3000);
    expect(again).toEqual({ ok: true, sessionId: first.sessionId, reopened: true });
    expect(db.select().from(sessions).get()).toMatchObject({
      status: "ACTIVE",
      startedAt: 1000,
      endedAt: null,
    });
  });

  it("starts another week once the first is closed", () => {
    closeSession(db, open(classA, 5).sessionId);
    open(classA, 6);
    expect(db.select().from(sessions).all()).toHaveLength(2);
  });

  it("rejects unknown classes and weeks outside the range", () => {
    expect(openSession(db, 999, 1)).toEqual({ ok: false, reason: "CLASS_NOT_FOUND" });
    for (const week of [0, 16, 1.5, -1]) {
      expect(openSession(db, classA, week)).toEqual({ ok: false, reason: "BAD_WEEK" });
    }
  });
});

describe("closeSession", () => {
  it("closes an active session once", () => {
    const { sessionId } = open(classA, 5);
    expect(closeSession(db, sessionId, 2000)).toBe(true);
    expect(
      db.select().from(sessions).where(eq(sessions.id, sessionId)).get(),
    ).toMatchObject({ status: "CLOSED", endedAt: 2000 });
    expect(closeSession(db, sessionId, 3000)).toBe(false);
    expect(db.select().from(sessions).get()?.endedAt).toBe(2000);
  });

  it("returns false for an unknown session", () => {
    expect(closeSession(db, "missing")).toBe(false);
  });
});
