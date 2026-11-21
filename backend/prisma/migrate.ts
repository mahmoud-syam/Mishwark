/**
 * Applies the SQL migrations in prisma/migrations, in order, each once.
 *
 * The migrations are hand-written SQL (the same files CI and the preview load
 * with psql), so this runner keeps its own record in "_app_migrations":
 * name, checksum and when it ran. Each migration runs in its own transaction
 * and is recorded in that same transaction, so a failure leaves nothing half
 * applied and the next run starts again from it.
 *
 *   npx tsx prisma/migrate.ts            apply what is missing
 *   npx tsx prisma/migrate.ts --status   list applied / pending, change nothing
 *   npx tsx prisma/migrate.ts --baseline record every migration as applied
 *                                        without running it (a database that
 *                                        was built by hand from the same files)
 *
 * A migration that was already applied and whose file changed afterwards is
 * reported and stops the run: edit history with a new migration instead.
 */
import "dotenv/config";
import { createHash } from "crypto";
import { readFileSync, readdirSync, existsSync } from "fs";
import path from "path";
import { Client } from "pg";

const DIR = path.join(__dirname, "migrations");
const TABLE = '"_app_migrations"';

export type Migration = { name: string; sql: string; checksum: string };

export const listMigrations = (dir = DIR): Migration[] =>
  readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(dir, d.name, "migration.sql")))
    .map((d) => d.name)
    .sort()
    .map((name) => {
      const sql = readFileSync(path.join(dir, name, "migration.sql"), "utf8");
      return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    });

export async function migrate(connectionString: string, opts: { status?: boolean; baseline?: boolean; dir?: string; log?: (s: string) => void } = {}) {
  const log = opts.log ?? ((s: string) => console.log(s));
  const client = new Client({ connectionString });
  await client.connect();
  try {
    // One runner at a time (two containers starting together).
    await client.query("SELECT pg_advisory_lock(hashtext('app-migrations'))");
    await client.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const done = new Map<string, string>(
      (await client.query<{ name: string; checksum: string }>(`SELECT name, checksum FROM ${TABLE}`)).rows.map((r) => [r.name, r.checksum])
    );
    const all = listMigrations(opts.dir);

    const changed = all.filter((m) => done.has(m.name) && done.get(m.name) !== m.checksum);
    if (changed.length) {
      throw new Error(`Already-applied migrations were edited afterwards: ${changed.map((m) => m.name).join(", ")}. Put the change in a new migration.`);
    }
    const pending = all.filter((m) => !done.has(m.name));

    if (opts.status) {
      for (const m of all) log(`${done.has(m.name) ? "applied " : "PENDING "} ${m.name}`);
      return { applied: [] as string[], pending: pending.map((m) => m.name) };
    }
    if (!pending.length) {
      log(`Database is up to date (${all.length} migrations).`);
      return { applied: [], pending: [] };
    }
    if (opts.baseline) {
      for (const m of pending) await client.query(`INSERT INTO ${TABLE} (name, checksum) VALUES ($1, $2)`, [m.name, m.checksum]);
      log(`Recorded ${pending.length} migrations as applied (baseline, nothing run).`);
      return { applied: pending.map((m) => m.name), pending: [] };
    }
    const applied: string[] = [];
    for (const m of pending) {
      log(`Applying ${m.name} ...`);
      await client.query("BEGIN");
      try {
        await client.query(m.sql);
        await client.query(`INSERT INTO ${TABLE} (name, checksum) VALUES ($1, $2)`, [m.name, m.checksum]);
        await client.query("COMMIT");
        applied.push(m.name);
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw new Error(`Migration ${m.name} failed and was rolled back: ${(e as Error).message}`);
      }
    }
    log(`Applied ${applied.length} migration(s).`);
    return { applied, pending: [] };
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('app-migrations'))").catch(() => {});
    await client.end();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  migrate(url, { status: process.argv.includes("--status"), baseline: process.argv.includes("--baseline") })
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
