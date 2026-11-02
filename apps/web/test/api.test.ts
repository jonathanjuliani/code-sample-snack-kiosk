import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHealth, submitOrder } from '../src/api';

const orderBody = {
  kioskId: 'front-1',
  menuVersion: 'v1',
  lines: [{ itemId: 'chips', qty: 1, choiceIds: [] }],
  payment: { method: 'tap' as const },
  clientTotalCents: 250,
};

const paidJson = {
  orderId: 'ord-1',
  status: 'paid',
  pickupNumber: 'A-001',
  totalCents: 250,
  lines: [
    {
      itemId: 'chips',
      name: 'Salted chips',
      choiceIds: [],
      optionLabels: [],
      qty: 1,
      unitPriceCents: 250,
      lineTotalCents: 250,
    },
  ],
  paymentMethod: 'tap',
  last4: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(body === null ? null : JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
}

describe('submitOrder', () => {
  it('maps 201 paid', async () => {
    stubFetch(201, paidJson);
    await expect(submitOrder('550e8400-e29b-41d4-a716-446655440000', orderBody)).resolves.toEqual({
      kind: 'paid',
      order: paidJson,
    });
  });

  it('maps 402 declined', async () => {
    stubFetch(402, {
      orderId: 'ord-1',
      status: 'payment_failed',
      error: 'payment_declined',
      message: 'Declined',
    });
    const result = await submitOrder('550e8400-e29b-41d4-a716-446655440000', orderBody);
    expect(result.kind).toBe('declined');
  });

  it('maps 409 order changed', async () => {
    stubFetch(409, {
      error: 'order_changed',
      message: 'Prices changed',
      menuVersion: 'v2',
      totalCents: 300,
      lines: paidJson.lines.map((line) => ({ ...line, unitPriceCents: 300, lineTotalCents: 300 })),
      unavailableItemIds: [],
    });
    const result = await submitOrder('550e8400-e29b-41d4-a716-446655440000', orderBody);
    expect(result.kind).toBe('changed');
  });

  it('maps 202 pending', async () => {
    stubFetch(202, { orderId: 'ord-1', status: 'pending_payment' });
    const result = await submitOrder('550e8400-e29b-41d4-a716-446655440000', orderBody);
    expect(result.kind).toBe('pending');
  });

  it('maps 422 conflict', async () => {
    stubFetch(422, { error: 'conflict' });
    const result = await submitOrder('550e8400-e29b-41d4-a716-446655440000', orderBody);
    expect(result).toEqual({
      kind: 'conflict',
      message: 'This checkout attempt was already used.',
    });
  });

  it('maps 503 unavailable', async () => {
    stubFetch(503, { error: 'unavailable' });
    await expect(submitOrder('550e8400-e29b-41d4-a716-446655440000', orderBody)).resolves.toEqual({
      kind: 'unavailable',
    });
  });

  it('maps a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network');
      }),
    );
    await expect(submitOrder('550e8400-e29b-41d4-a716-446655440000', orderBody)).resolves.toEqual({
      kind: 'network',
    });
  });
});

describe('fetchHealth', () => {
  it('reports payments-paused when payments are down', async () => {
    stubFetch(200, { status: 'ok', payments: 'down' });
    await expect(fetchHealth()).resolves.toBe('payments-paused');
  });

  it('reports up when payments are up', async () => {
    stubFetch(200, { status: 'ok', payments: 'up' });
    await expect(fetchHealth()).resolves.toBe('up');
  });
});
