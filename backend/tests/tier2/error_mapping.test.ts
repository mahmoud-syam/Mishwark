import { describe, test, expect } from '../infra/run-all';
import { z } from 'zod';
import { errorMiddleware } from '../../src/v1/middlewares/errors.middleware';

/**
 * Status codes the error middleware sends. A database outage must read as a
 * temporary server problem (503), never as the client's fault (400).
 */
describe('Tier 2: Error mapping', () => {
  const send = (error: any) => {
    const out: { status?: number; body?: any } = {};
    const res: any = {
      status(c: number) { out.status = c; return res; },
      json(b: any) { out.body = b; return res; },
    };
    const quiet = console.error;
    console.error = () => {};
    try { errorMiddleware(error, {} as any, res, () => {}); } finally { console.error = quiet; }
    return out;
  };
  const prismaError = (code: string) => Object.assign(new Error('prisma'), { name: 'PrismaClientKnownRequestError', code });

  test('ERR-01: database unreachable (P1001) is 503, not 400', () => {
    const r = send(prismaError('P1001'));
    expect(r.status).toBe(503);
    expect(r.body.message).toContain('temporarily unavailable');
  });

  test('ERR-02: Prisma failing to start is 503', () => {
    expect(send(Object.assign(new Error('init'), { name: 'PrismaClientInitializationError' })).status).toBe(503);
  });

  test('ERR-03: request errors keep their mapping (409, 400, 404, other P2xxx 400)', () => {
    expect(send(prismaError('P2002')).status).toBe(409);
    expect(send(prismaError('P2003')).status).toBe(400);
    expect(send(prismaError('P2025')).status).toBe(404);
    expect(send(prismaError('P2034')).status).toBe(400);
  });

  test('ERR-04: validation is 422 and an unknown error is a generic 500 without internals', () => {
    const zerr = (() => { try { z.object({ a: z.string() }).parse({}); } catch (e) { return e; } })();
    expect(send(zerr).status).toBe(422);
    const r = send(new Error('secret stack /srv/app/file.ts'));
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain('/srv/app');
  });
});
