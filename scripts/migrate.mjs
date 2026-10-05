// Applies the SQL migrations in ./drizzle to the SQLite file.
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

// Same files Next.js reads; values already set are not overridden.
for (const envFile of [".env.local", ".env"]) {
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
}

const file = process.env.DATABASE_PATH ?? "./data/attendance.db";
fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });

const sqlite = new Database(file);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
sqlite.close();

console.log(`Migrations applied to ${file}`);
