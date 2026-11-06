import { migrate } from "drizzle-orm/libsql/migrator";
import { openDatabase } from "@/lib/db/client";
import { lecturers } from "@/lib/db/schema";

// The lecturer that test data belongs to unless a test says otherwise.
export const LECTURER = 1;

// Fresh in-memory database with the real migrations applied and one
// lecturer (id LECTURER) to own test data.
export async function createTestDb() {
  const db = openDatabase(":memory:");
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db
    .insert(lecturers)
    .values({ id: LECTURER, email: "lecturer@example.com", createdAt: 0 })
    .run();
  return db;
}
