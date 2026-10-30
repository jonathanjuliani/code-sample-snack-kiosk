import { IDEMPOTENCY_KEY_HEADER, opsSummarySchema } from '@kiosk/shared';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, DECLINE, KEY_A, KEY_B } from './harness.ts';

type AppHandle = ReturnType<typeof createTestApp>;

const KEY_C = '33333333-3333-4333-8333-333333333333';

let handle: AppHandle | undefined;

async function setup() {
  handle = createTestApp();
  return handle;
}

afterEach(async () => {
  if (!handle) return;
  await handle.app.close();
  handle.db.close();
  handle = undefined;
});

async function menuVersion(app: AppHandle['app']) {
  const res = await app.inject({ method: 'GET', url: '/menu' });
  expect(res.statusCode).toBe(200);
  return res.json() as { version: string };
}

function tapBody(version: string, extras: Record<string, unknown> = {}) {
  return {
    kioskId: 'front-1',
    menuVersion: version,
    lines: [{ itemId: 'chips', qty: 2, choiceIds: [] }],
    payment: { method: 'tap' },
    clientTotalCents: 500,
    ...extras,
  };
}

function postOrder(app: AppHandle['app'], body: object, key: string): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: '/orders',
    headers: { [IDEMPOTENCY_KEY_HEADER]: key },
    payload: body,
  });
}

describe('GET /ops/summary', () => {
  it('counts a replay, a reprice and a decline, and lists the paid order', async () => {
    const { app } = await setup();
    const { version } = await menuVersion(app);

    const paid = await postOrder(app, tapBody(version), KEY_A);
    expect(paid.statusCode).toBe(201);
    const replay = await postOrder(app, tapBody(version), KEY_A);
    expect(replay.statusCode).toBe(200);

    const reprice = await postOrder(app, tapBody(version, { clientTotalCents: 1 }), KEY_B);
    expect(reprice.statusCode).toBe(409);

    const declined = await postOrder(
      app,
      tapBody(version, { payment: { method: 'card', cardNumber: DECLINE } }),
      KEY_C,
    );
    expect(declined.statusCode).toBe(402);

    const summary = opsSummarySchema.parse((await app.inject({ method: 'GET', url: '/ops/summary' })).json());
    expect(summary.menuVersion).toBe(version);
    expect(summary.counters).toEqual({
      idempotentReplays: 1,
      reprices: 1,
      declines: 1,
      idleResets: 0,
    });
    expect(summary.orders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'paid',
          kioskId: 'front-1',
          totalCents: 500,
          pickupNumber: expect.stringMatching(/^[A-Z]-\d{3}$/),
        }),
      ]),
    );

    const idle = await app.inject({
      method: 'POST',
      url: '/ops/events',
      payload: { kioskId: 'front-1', kind: 'idle_reset' },
    });
    expect(idle.statusCode).toBe(204);
    const beat = await app.inject({
      method: 'POST',
      url: '/ops/events',
      payload: { kioskId: 'front-1', kind: 'heartbeat', appVersion: '1.0.0' },
    });
    expect(beat.statusCode).toBe(204);

    const assist = await app.inject({
      method: 'POST',
      url: '/kiosk/assist',
      payload: { kioskId: 'front-1' },
    });
    expect(assist.statusCode).toBe(204);

    const after = opsSummarySchema.parse((await app.inject({ method: 'GET', url: '/ops/summary' })).json());
    expect(after.counters.idleResets).toBe(1);
    expect(after.kiosks).toEqual([expect.objectContaining({ kioskId: 'front-1', appVersion: '1.0.0' })]);
    expect(after.assists).toEqual([expect.objectContaining({ kioskId: 'front-1' })]);
  });
});
