import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';

describe('GET /health', () => {
  it('answers ok and echoes a request id', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('keeps a request id sent by the client', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/health', headers: { 'x-request-id': 'abc-123' } });
    expect(res.headers['x-request-id']).toBe('abc-123');
  });
});
