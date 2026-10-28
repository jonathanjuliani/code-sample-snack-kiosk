import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp } from './harness.ts';

describe('GET /health', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('answers ok and echoes a request id', async () => {
    const { app, db } = createTestApp();
    close = async () => {
      await app.close();
      db.close();
    };
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('keeps a request id sent by the client', async () => {
    const { app, db } = createTestApp();
    close = async () => {
      await app.close();
      db.close();
    };
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'abc-123' },
    });
    expect(res.headers['x-request-id']).toBe('abc-123');
  });
});
