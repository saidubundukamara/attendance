import { defineConfig } from "drizzle-kit";

// Only used by `npm run db:generate`, which reads the schema and writes SQL
// files. Applying them is done by scripts/migrate.mjs.
export default defineConfig({
  dialect: "sqlite",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
});
