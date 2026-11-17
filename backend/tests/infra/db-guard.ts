import 'dotenv/config';

/**
 * The test suite deletes every row before it runs. Pointed at a developer's
 * database (or production) by mistake, `npm test` / `npm run verify` would
 * wipe it. So the suite only runs against a database whose name contains
 * "test" (e.g. mishwark_test), unless ALLOW_TEST_DB_RESET=true is set on purpose.
 */
export function databaseName(url = process.env.DATABASE_URL ?? ''): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    return '';
  }
}

export function disposableDatabaseProblem(url = process.env.DATABASE_URL ?? ''): string | null {
  if (process.env.ALLOW_TEST_DB_RESET === 'true') return null;
  const name = databaseName(url);
  if (!url) return 'DATABASE_URL is not set.';
  if (!/test/i.test(name)) {
    return `Refusing to run: the tests wipe the database, and "${name || url}" doesn't look like a test database.\n` +
      `  Use a separate database whose name contains "test", e.g.\n` +
      `  DATABASE_URL=postgresql://user:pass@localhost:5432/mishwark_test npm test\n` +
      `  (or set ALLOW_TEST_DB_RESET=true if you really mean it).`;
  }
  return null;
}

export function assertDisposableDatabase(): void {
  const problem = disposableDatabaseProblem();
  if (problem) throw new Error(problem);
}
