import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { classes, sessions } from "@/lib/db/schema";
import { closeSession, openSession } from "@/lib/sessions";
import { createTestDb } from "./helpers/db";

let db: Db;
let classA: number;
let classB: number;

beforeEach(async () => {
  db = await createTestDb();
  [classA, classB] = await Promise.all(
    ["TEST101", "TEST202"].map(
      async (code) =>
        (
          await db
            .insert(classes)
            .values({ code, sheetTab: `Attn of ${code}`, totalWeeks: 15 })
            .returning()
            .get()
        ).id,
    ),
  );
});

async function open(classId: number, week: number, now = 1000) {
  const result = await openSession(db, classId, week, now);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

describe("openSession", () => {
  it("creates an active session", async () => {
    const result = await open(classA, 5);
    expect(result.reopened).toBe(false);
    expect(await db.select().from(sessions).get()).toMatchObject({
      id: result.sessionId,
      classId: classA,
      week: 5,
      status: "ACTIVE",
      startedAt: 1000,
      endedAt: null,
    });
  });

  it("returns the same session when the week is already active", async () => {
    const first = await open(classA, 5);
    const again = await open(classA, 5);
    expect(again.sessionId).toBe(first.sessionId);
    expect(await db.select().from(sessions).all()).toHaveLength(1);
  });

  it("refuses a second active session for the class", async () => {
    const first = await open(classA, 5);
    expect(await openSession(db, classA, 6)).toEqual({
      ok: false,
      reason: "ACTIVE_EXISTS",
      sessionId: first.sessionId,
      week: 5,
    });
  });

  it("allows two classes to be active at once", async () => {
    await open(classA, 5);
    await open(classB, 5);
    expect(await db.select().from(sessions).all()).toHaveLength(2);
  });

  it("reopens a closed week, keeping its id and start time", async () => {
    const first = await open(classA, 5, 1000);
    await closeSession(db, first.sessionId, 2000);
    const again = await open(classA, 5, 3000);
    expect(again).toEqual({
      ok: true,
      sessionId: first.sessionId,
      reopened: true,
    });
    expect(await db.select().from(sessions).get()).toMatchObject({
      status: "ACTIVE",
      startedAt: 1000,
      endedAt: null,
    });
  });

  it("starts another week once the first is closed", async () => {
    await closeSession(db, (await open(classA, 5)).sessionId);
    await open(classA, 6);
    expect(await db.select().from(sessions).all()).toHaveLength(2);
  });

  it("rejects unknown classes and weeks outside the range", async () => {
    expect(await openSession(db, 999, 1)).toEqual({
      ok: false,
      reason: "CLASS_NOT_FOUND",
    });
    for (const week of [0, 16, 1.5, -1]) {
      expect(await openSession(db, classA, week)).toEqual({
        ok: false,
        reason: "BAD_WEEK",
      });
    }
  });
});

describe("closeSession", () => {
  it("closes an active session once", async () => {
    const { sessionId } = await open(classA, 5);
    expect(await closeSession(db, sessionId, 2000)).toBe(true);
    expect(
      await db.select().from(sessions).where(eq(sessions.id, sessionId)).get(),
    ).toMatchObject({ status: "CLOSED", endedAt: 2000 });
    expect(await closeSession(db, sessionId, 3000)).toBe(false);
    expect((await db.select().from(sessions).get())?.endedAt).toBe(2000);
  });

  it("returns false for an unknown session", async () => {
    expect(await closeSession(db, "missing")).toBe(false);
  });
});
