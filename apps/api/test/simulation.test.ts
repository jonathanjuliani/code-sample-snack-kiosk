import {
  defaultSimulation,
  IDEMPOTENCY_KEY_HEADER,
  opsSummarySchema,
  simulationResponseSchema,
} from '@kiosk/shared';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { APPROVE, createTestApp, DECLINE, KEY_A, KEY_B } from './harness.ts';

type AppHandle = ReturnType<typeof createTestApp>;

const KEY_C = '33333333-3333-4333-8333-333333333333';

let handle: AppHandle | undefined;

async function setup(failRate = 0) {
  handle = createTestApp({ failRate });
  return handle;
}

afterEach(async () => {
  if (!handle) return;
  await handle.app.close();
  handle.db.close();
  handle = undefined;
});

async function menu(app: AppHandle['app']) {
  const res = await app.inject({ method: 'GET', url: '/menu' });
  const body = res.json() as {
    version: string;
    items: { id: string; priceCents: number; available: boolean }[];
  };
  return { status: res.statusCode, body };
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

async function putSim(app: AppHandle['app'], patch: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'PUT',
    url: '/ops/simulation',
    payload: { ...defaultSimulation, ...patch },
  });
  expect(res.statusCode).toBe(200);
  return simulationResponseSchema.parse(res.json());
}

async function expectDropped(app: AppHandle['app'], body: object, key: string) {
  let dropped = false;
  try {
    const first = await postOrder(app, body, key);
    dropped = first.statusCode !== 201 && first.statusCode !== 200 && first.statusCode !== 402;
  } catch {
    dropped = true;
  }
  expect(dropped).toBe(true);
}

describe('ops simulation', () => {
  it('lists the menu items and starts on follow-the-card', async () => {
    const { app } = await setup();
    const view = simulationResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/ops/simulation' })).json(),
    );
    expect(view.payment).toBe('follow-card');
    expect(view.paymentsPaused).toBe(false);
    expect(view.items).toEqual(expect.arrayContaining([{ id: 'chips', name: 'Salted chips' }]));
  });

  it('rejects an unknown item and an unknown payment result', async () => {
    const { app } = await setup();
    const unknown = await app.inject({
      method: 'PUT',
      url: '/ops/simulation',
      payload: { ...defaultSimulation, priceBump: { itemId: 'no-such' } },
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'priceBump.itemId' })]),
    );
    const bad = await app.inject({
      method: 'PUT',
      url: '/ops/simulation',
      payload: { ...defaultSimulation, payment: 'nope' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('declines a tap, then follow-the-card approves one', async () => {
    const { app, db } = await setup();
    const { body } = await menu(app);
    await putSim(app, { payment: 'declined' });
    const declined = await postOrder(app, tapBody(body.version), KEY_A);
    expect(declined.statusCode).toBe(402);
    const row = db.prepare('SELECT status, last4, payment_method FROM orders').get() as {
      status: string;
      last4: string | null;
      payment_method: string;
    };
    expect(row).toEqual({ status: 'payment_failed', last4: null, payment_method: 'tap' });

    await putSim(app, { payment: 'follow-card' });
    const paid = await postOrder(app, tapBody(body.version), KEY_B);
    expect(paid.statusCode).toBe(201);
  });

  it('approves the decline card when the simulation says approved', async () => {
    const { app } = await setup();
    const { body } = await menu(app);
    await putSim(app, { payment: 'approved' });
    const res = await postOrder(
      app,
      tapBody(body.version, { payment: { method: 'card', cardNumber: DECLINE } }),
      KEY_A,
    );
    expect(res.statusCode).toBe(201);
    expect(res.json().last4).toBe('0002');
    expect(JSON.stringify(res.json())).not.toContain(DECLINE);
  });

  it('does not roll the fail rate when a payment result is chosen', async () => {
    const { app } = await setup(1);
    const { body } = await menu(app);
    await putSim(app, { payment: 'approved' });
    const res = await postOrder(
      app,
      tapBody(body.version, { payment: { method: 'card', cardNumber: APPROVE } }),
      KEY_A,
    );
    expect(res.statusCode).toBe(201);
  });

  it('drops a paid response, then the same key replays that order', async () => {
    const { app, db } = await setup();
    const { body } = await menu(app);
    await putSim(app, { payment: 'drop-approved' });
    const order = tapBody(body.version);
    await expectDropped(app, order, KEY_A);
    const row = db.prepare('SELECT status FROM orders').get() as { status: string };
    expect(row.status).toBe('paid');
    const replay = await postOrder(app, order, KEY_A);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().status).toBe('paid');
  });

  it('drops a declined response, then the same key replays the decline', async () => {
    const { app, db } = await setup();
    const { body } = await menu(app);
    await putSim(app, { payment: 'drop-declined' });
    const order = tapBody(body.version);
    await expectDropped(app, order, KEY_A);
    const row = db.prepare('SELECT status FROM orders').get() as { status: string };
    expect(row.status).toBe('payment_failed');
    const replay = await postOrder(app, order, KEY_A);
    expect(replay.statusCode).toBe(402);
    expect(replay.json().status).toBe('payment_failed');
  });

  it('leaves a pending order when the payment never resolves', async () => {
    const { app, db } = await setup();
    const { body } = await menu(app);
    await putSim(app, { payment: 'unresolved' });
    const order = tapBody(body.version);
    await expectDropped(app, order, KEY_A);
    const row = db.prepare('SELECT status, payment_ref FROM orders').get() as {
      status: string;
      payment_ref: string | null;
    };
    expect(row).toEqual({ status: 'pending_payment', payment_ref: null });
    const lookup = await app.inject({ method: 'GET', url: `/orders?idempotencyKey=${KEY_A}` });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json().status).toBe('pending_payment');
    const replay = await postOrder(app, order, KEY_A);
    expect(replay.statusCode).toBe(202);
    const count = db.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('pauses payments without failing health or the menu', async () => {
    const { app } = await setup();
    await putSim(app, { paymentsPaused: true });
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok', payments: 'down' });
    const served = await menu(app);
    expect(served.status).toBe(200);
  });

  it('fails menu loads and still answers health and the simulation', async () => {
    const { app } = await setup();
    await putSim(app, { menuFails: true });
    const served = await app.inject({ method: 'GET', url: '/menu' });
    expect(served.statusCode).toBe(500);
    expect(served.json().error).toBe('internal_error');
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json().payments).toBe('up');
    const sim = await app.inject({ method: 'GET', url: '/ops/simulation' });
    expect(sim.statusCode).toBe(200);
    expect(simulationResponseSchema.parse(sim.json()).items.length).toBeGreaterThan(0);
  });

  it('raises a price in the served menu without writing SQLite, and a sold-out flag does the same', async () => {
    const { app, db } = await setup();
    const before = await menu(app);
    await putSim(app, { priceBump: { itemId: 'chips' } });
    const raised = await menu(app);
    expect(raised.status).toBe(200);
    expect(raised.body.version).not.toBe(before.body.version);
    expect(raised.body.items.find((item) => item.id === 'chips')?.priceCents).toBe(300);
    const stored = db.prepare('SELECT price_cents, available FROM menu_items WHERE id = ?').get('chips') as {
      price_cents: number;
      available: number;
    };
    expect(stored).toEqual({ price_cents: 250, available: 1 });
    const changed = await postOrder(app, tapBody(before.body.version), KEY_A);
    expect(changed.statusCode).toBe(409);
    expect(changed.json().totalCents).toBe(600);

    await putSim(app, { priceBump: null, soldOut: { itemId: 'chips' } });
    const hidden = await menu(app);
    expect(hidden.body.items.find((item) => item.id === 'chips')?.available).toBe(false);
    const still = db.prepare('SELECT price_cents, available FROM menu_items WHERE id = ?').get('chips') as {
      price_cents: number;
      available: number;
    };
    expect(still).toEqual({ price_cents: 250, available: 1 });
    const blocked = await postOrder(app, tapBody(before.body.version), KEY_C);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().unavailableItemIds).toContain('chips');

    await putSim(app);
    const restored = await menu(app);
    expect(restored.body.version).toBe(before.body.version);
    expect(restored.body.items.find((item) => item.id === 'chips')?.priceCents).toBe(250);
  });

  it('shows the screen a kiosk reported on its heartbeat', async () => {
    const { app } = await setup();
    const beat = await app.inject({
      method: 'POST',
      url: '/ops/events',
      payload: {
        kioskId: 'front-1',
        kind: 'heartbeat',
        appVersion: '1.0.0',
        screen: 'checkout',
        payPhase: 'idle',
        itemCount: 2,
        totalCents: 500,
      },
    });
    expect(beat.statusCode).toBe(204);
    const summary = opsSummarySchema.parse((await app.inject({ method: 'GET', url: '/ops/summary' })).json());
    expect(summary.kiosks[0]).toMatchObject({
      kioskId: 'front-1',
      appVersion: '1.0.0',
      screen: 'checkout',
      payPhase: 'idle',
      itemCount: 2,
      totalCents: 500,
    });
  });
});
