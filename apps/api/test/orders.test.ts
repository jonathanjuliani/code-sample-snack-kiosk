import { IDEMPOTENCY_KEY_HEADER } from '@kiosk/shared';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMenu, setChoiceDelta, setItemAvailable, setItemPrice } from '../src/menu/menu-repository.ts';
import type { PaymentGateway } from '../src/orders/payment.ts';
import { APPROVE, createTestApp, DECLINE, KEY_A, KEY_B } from './harness.ts';

type AppHandle = ReturnType<typeof createTestApp>;

let handle: AppHandle | undefined;

async function setup(options?: Parameters<typeof createTestApp>[0]) {
  handle = createTestApp(options);
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
  return res.json() as { version: string; items: { id: string; priceCents: number }[] };
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

describe('GET /menu', () => {
  it('returns categories, integer prices and an ETag', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/menu' });
    expect(res.statusCode).toBe(200);
    const menu = res.json();
    expect(menu.categories.length).toBeGreaterThan(0);
    expect(menu.items.every((item: { priceCents: number }) => Number.isInteger(item.priceCents))).toBe(true);
    expect(res.headers.etag).toBe(`"${menu.version}"`);

    const cached = await app.inject({
      method: 'GET',
      url: '/menu',
      headers: { 'if-none-match': res.headers.etag as string },
    });
    expect(cached.statusCode).toBe(304);
  });
});

describe('POST /orders', () => {
  it('creates a paid order and replays the same key with the same body', async () => {
    const { app, db } = await setup();
    const { version } = await menuVersion(app);
    const first = await postOrder(app, tapBody(version), KEY_A);
    expect(first.statusCode).toBe(201);
    const paid = first.json();
    expect(paid.status).toBe('paid');
    expect(paid.pickupNumber).toMatch(/^[A-Z]-\d{3}$/);
    expect(paid.totalCents).toBe(500);
    expect(Number.isInteger(paid.totalCents)).toBe(true);

    const second = await postOrder(app, tapBody(version), KEY_A);
    expect(second.statusCode).toBe(200);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json()).toEqual(paid);

    const count = db.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('rejects the same key with a different body', async () => {
    const { app } = await setup();
    const { version } = await menuVersion(app);
    expect((await postOrder(app, tapBody(version), KEY_A)).statusCode).toBe(201);
    const other = await postOrder(app, tapBody(version, { lines: [{ itemId: 'chips', qty: 1 }] }), KEY_A);
    expect(other.statusCode).toBe(422);
    expect(other.json().error).toBe('idempotency_key_reused');
  });

  it('returns 409 with repriced lines when the client total is wrong', async () => {
    const { app } = await setup();
    const { version } = await menuVersion(app);
    const res = await postOrder(app, tapBody(version, { clientTotalCents: 1 }), KEY_A);
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe('order_changed');
    expect(body.totalCents).toBe(500);
    expect(body.lines[0].unitPriceCents).toBe(250);
  });

  it('returns 409 when an item is no longer available', async () => {
    const { app, db } = await setup();
    const { version } = await menuVersion(app);
    expect(setItemAvailable(db, 'chips', false)).toBe(true);
    const res = await postOrder(app, tapBody(version), KEY_A);
    expect(res.statusCode).toBe(409);
    expect(res.json().unavailableItemIds).toContain('chips');
  });

  it('returns 409 when an option delta changes', async () => {
    const { app, db } = await setup();
    const { version } = await menuVersion(app);
    const body = {
      kioskId: 'front-1',
      menuVersion: version,
      lines: [{ itemId: 'popcorn', qty: 1, choiceIds: ['size-large'] }],
      payment: { method: 'tap' },
      clientTotalCents: 550,
    };
    expect((await postOrder(app, body, KEY_A)).statusCode).toBe(201);

    expect(setChoiceDelta(db, 'popcorn', 'size-large', 300)).toBe(true);
    const res = await postOrder(app, { ...body, clientTotalCents: 550 }, KEY_B);
    expect(res.statusCode).toBe(409);
    expect(res.json().totalCents).toBe(700);
  });

  it('declines a card, keeps one failed order, and replays the decline', async () => {
    const { app, db } = await setup();
    const { version } = await menuVersion(app);
    const body = tapBody(version, { payment: { method: 'card', cardNumber: DECLINE } });
    const first = await postOrder(app, body, KEY_A);
    expect(first.statusCode).toBe(402);
    expect(first.json()).toMatchObject({
      status: 'payment_failed',
      error: 'payment_declined',
    });

    const second = await postOrder(app, body, KEY_A);
    expect(second.statusCode).toBe(402);
    expect(second.json()).toEqual(first.json());

    const row = db.prepare('SELECT status, last4, payment_ref, response_json FROM orders').get() as {
      status: string;
      last4: string;
      payment_ref: string;
      response_json: string;
    };
    expect(row.status).toBe('payment_failed');
    expect(row.last4).toBe('0002');
    expect(row.payment_ref.startsWith('fake_')).toBe(true);
    expect(row.response_json).not.toContain(DECLINE);
    expect(db.prepare('SELECT COUNT(*) AS n FROM orders').get()).toEqual({ n: 1 });
  });

  it('rejects a bad body, qty 0, qty 999 and an unknown item', async () => {
    const { app } = await setup();
    const { version } = await menuVersion(app);
    const cases = [
      tapBody(version, { lines: [] }),
      tapBody(version, { lines: [{ itemId: 'chips', qty: 0 }] }),
      tapBody(version, { lines: [{ itemId: 'chips', qty: 999 }] }),
      tapBody(version, { lines: [{ itemId: 'no-such-item', qty: 1 }] }),
    ];
    for (const body of cases) {
      const res = await postOrder(app, body, KEY_A);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('invalid_request');
    }
  });

  it('rejects a missing or unknown option choice', async () => {
    const { app } = await setup();
    const { version } = await menuVersion(app);
    const missing = await postOrder(
      app,
      tapBody(version, { lines: [{ itemId: 'popcorn', qty: 1, choiceIds: [] }] }),
      KEY_A,
    );
    expect(missing.statusCode).toBe(400);
    const unknown = await postOrder(
      app,
      tapBody(version, { lines: [{ itemId: 'popcorn', qty: 1, choiceIds: ['size-huge'] }] }),
      KEY_B,
    );
    expect(unknown.statusCode).toBe(400);
  });

  it('returns 202 while a payment is still running, then the paid response', async () => {
    let release!: (value: { approved: true; reference: string }) => void;
    const held = new Promise<{ approved: true; reference: string }>((resolve) => {
      release = resolve;
    });
    const payments: PaymentGateway = {
      charge: () => held,
    };
    const { app } = await setup({ payments });
    const { version } = await menuVersion(app);
    const body = tapBody(version);

    const firstPromise = postOrder(app, body, KEY_A);
    await new Promise((r) => setTimeout(r, 10));
    const inflight = await postOrder(app, body, KEY_A);
    expect(inflight.statusCode).toBe(202);
    expect(inflight.json()).toMatchObject({ status: 'pending_payment' });

    release({ approved: true, reference: 'fake_held' });
    const first = await firstPromise;
    expect(first.statusCode).toBe(201);

    const replayed = await postOrder(app, body, KEY_A);
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json().orderId).toBe(first.json().orderId);
  });

  it('never stores or logs a card number', async () => {
    const { app, db, logs } = await setup({ captureLogs: true });
    const { version } = await menuVersion(app);
    const body = tapBody(version, { payment: { method: 'card', cardNumber: APPROVE } });
    const res = await postOrder(app, body, KEY_A);
    expect(res.statusCode).toBe(201);
    expect(res.json().last4).toBe('4242');
    expect(JSON.stringify(res.json())).not.toContain(APPROVE);

    const row = db.prepare('SELECT last4, payment_ref, response_json FROM orders').get() as {
      last4: string;
      payment_ref: string;
      response_json: string;
    };
    expect(row.last4).toBe('4242');
    expect(row.payment_ref).not.toContain(APPROVE);
    expect(row.response_json).not.toContain(APPROVE);
    expect(JSON.stringify(row)).not.toContain(APPROVE);
    expect(logs.join('')).not.toContain(APPROVE);
    expect(logs.join('')).not.toContain('4242424242424242');
  });

  it('looks an attempt up by idempotency key', async () => {
    const { app } = await setup();
    const { version } = await menuVersion(app);
    const created = await postOrder(app, tapBody(version), KEY_A);
    const lookup = await app.inject({
      method: 'GET',
      url: `/orders?idempotencyKey=${KEY_A}`,
    });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json().orderId).toBe(created.json().orderId);
    expect(lookup.json().status).toBe('paid');

    const byId = await app.inject({ method: 'GET', url: `/orders/${created.json().orderId}` });
    expect(byId.json()).toEqual(lookup.json());
  });

  it('prices from the server menu even if the client sent an old unit price', async () => {
    const { app, db } = await setup();
    const { version } = await menuVersion(app);
    expect(setItemPrice(db, 'chips', 275)).toBe(true);
    const res = await postOrder(app, tapBody(version, { clientTotalCents: 500 }), KEY_A);
    expect(res.statusCode).toBe(409);
    expect(res.json().totalCents).toBe(550);
    expect(loadMenu(db).items.find((i) => i.id === 'chips')?.priceCents).toBe(275);
  });
});

describe('pickup numbers', () => {
  it('issues unique human numbers in one day', async () => {
    const { app } = await setup();
    const { version } = await menuVersion(app);
    const first = await postOrder(app, tapBody(version), KEY_A);
    const second = await postOrder(app, tapBody(version), KEY_B);
    expect(first.json().pickupNumber).toBe('A-001');
    expect(second.json().pickupNumber).toBe('A-002');
  });
});
