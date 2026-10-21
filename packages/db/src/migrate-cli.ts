import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrate";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
await runMigrations(url, fileURLToPath(new URL("../drizzle", import.meta.url)));
console.log("migrations applied");
