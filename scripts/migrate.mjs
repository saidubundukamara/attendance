// Applies the SQL migrations in ./drizzle to the database: Turso when
// TURSO_DATABASE_URL is set, otherwise the local SQLite file.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

// Same files Next.js reads; values already set are not overridden.
for (const envFile of [".env.local", ".env"]) {
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
}

const remote = process.env.TURSO_DATABASE_URL;
const file = process.env.DATABASE_PATH ?? "./data/attendance.db";
if (!remote) fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });

const client = createClient(
  remote
    ? { url: remote, authToken: process.env.TURSO_AUTH_TOKEN }
    : { url: `file:${file}` },
);
await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
client.close();

console.log(`Migrations applied to ${remote ? new URL(remote).host : file}`);
