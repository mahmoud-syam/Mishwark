import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { Client } from 'pg';
import { describe, test, expect } from '../infra/run-all';
import { isDatabaseConnected } from '../infra/db-setup';
import { createApiClient } from '../infra/api-client';
import { migrate, listMigrations } from '../../prisma/migrate';

/**
 * The permanent server (deploy/): tracked migrations, the health check the
 * deploy waits on. The first-start script (prisma/seed/production.ts) and the
 * Docker stack run for real in the "Server" GitHub workflow.
 */
describe('Tier 2: production server', () => {
  const base = process.env.DATABASE_URL || '';
  const scratchName = 'mishwark_migrate_check';
  const scratch = base.replace(/\/[^/?]+(\?|$)/, `/${scratchName}$1`);
  const quiet = () => {};

  const freshDb = async () => {
    const admin = new Client({ connectionString: base });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${scratchName}`);
    await admin.end();
  };
  const q = async (sql: string) => {
    const c = new Client({ connectionString: scratch });
    await c.connect();
    try { return (await c.query(sql)).rows; } finally { await c.end(); }
  };
  const dirWith = (files: Record<string, string>) => {
    const d = mkdtempSync(path.join(tmpdir(), 'mig-'));
    for (const [name, sql] of Object.entries(files)) {
      mkdirSync(path.join(d, name));
      writeFileSync(path.join(d, name, 'migration.sql'), sql);
    }
    return d;
  };

  test('PROD-01: every repo migration applies once, in order, and a second run does nothing', async () => {
    if (!(await isDatabaseConnected())) return;
    await freshDb();
    const all = listMigrations();
    const first = await migrate(scratch, { log: quiet });
    expect(first.applied.length).toBe(all.length);
    expect(first.applied.join()).toBe(all.map((m) => m.name).join());
    expect((await migrate(scratch, { log: quiet })).applied.length).toBe(0);
    expect(Number((await q('SELECT count(*) AS n FROM "_app_migrations"'))[0].n)).toBe(all.length);
    expect((await q(`SELECT to_regclass('public."Users"') AS t`))[0].t).toBe('"Users"');
  });

  test('PROD-02: a failing migration is rolled back whole; edited history is refused', async () => {
    if (!(await isDatabaseConnected())) return;
    await freshDb();
    const dir = dirWith({ '001_a': 'CREATE TABLE a (id int);', '002_b': 'CREATE TABLE b (id int); SELECT * FROM missing_table;' });
    let err = '';
    try { await migrate(scratch, { dir, log: quiet }); } catch (e) { err = (e as Error).message; }
    expect(/002_b failed and was rolled back/.test(err)).toBe(true);
    // 001 stays applied, nothing of 002 is left behind.
    expect((await q(`SELECT to_regclass('public.a') AS t`))[0].t).toBe('a');
    expect((await q(`SELECT to_regclass('public.b') AS t`))[0].t).toBe(null);
    expect((await q('SELECT name FROM "_app_migrations"')).map((r: any) => r.name).join()).toBe('001_a');
    // Fixed file: the next run carries on from 002.
    writeFileSync(path.join(dir, '002_b', 'migration.sql'), 'CREATE TABLE b (id int);');
    expect((await migrate(scratch, { dir, log: quiet })).applied.join()).toBe('002_b');
    // Editing an applied migration stops the run.
    writeFileSync(path.join(dir, '001_a', 'migration.sql'), 'CREATE TABLE a (id bigint);');
    err = '';
    try { await migrate(scratch, { dir, log: quiet }); } catch (e) { err = (e as Error).message; }
    expect(/edited afterwards: 001_a/.test(err)).toBe(true);
  });

  test('PROD-03: baseline records a hand-built database without running anything', async () => {
    if (!(await isDatabaseConnected())) return;
    await freshDb();
    const dir = dirWith({ '001_a': 'CREATE TABLE a (id int);' });
    await migrate(scratch, { dir, baseline: true, log: quiet });
    expect((await q(`SELECT to_regclass('public.a') AS t`))[0].t).toBe(null);
    expect((await migrate(scratch, { dir, log: quiet })).applied.length).toBe(0);
    const admin = new Client({ connectionString: base });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`);
    await admin.end();
  });

  test('PROD-04: the health check reports the database and the running version', async () => {
    if (!(await isDatabaseConnected())) return;
    const r = await createApiClient().get('/health');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(typeof r.body.version).toBe('string');
  });
});
