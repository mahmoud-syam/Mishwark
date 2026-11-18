import { Prisma } from "../../../generated/prisma";

/**
 * Serialises writers on the same thing (a car's or a driver's schedule, a
 * booking's money) for the rest of the current transaction.
 *
 * The overlap checks read the bookings, then insert: two requests for
 * overlapping times could both read "free" and both insert. A Postgres
 * advisory lock taken first makes the second one wait until the first commits,
 * and its reads then see the new booking. Released automatically at
 * commit/rollback. Keys are taken in a fixed order so two transactions can't
 * wait on each other.
 */
export async function lockKeys(tx: Prisma.TransactionClient, keys: string[]) {
  for (const key of [...new Set(keys)].sort()) {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${key}))`;
  }
}

/** Long enough to wait behind another booking of the same car (route lookup included). */
export const SCHEDULE_TX = { maxWait: 10_000, timeout: 30_000 } as const;
