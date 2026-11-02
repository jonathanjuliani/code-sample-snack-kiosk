import { describe, expect, it } from 'vitest';
import {
  apiErrorSchema,
  idempotencyKeySchema,
  orderChangedSchema,
  orderRequestSchema,
  orderStateSchema,
} from '../src/index.ts';

const valid = {
  kioskId: 'front-1',
  menuVersion: 'abc123',
  lines: [{ itemId: 'chips', qty: 2 }],
  payment: { method: 'tap' },
  clientTotalCents: 500,
};

describe('orderRequestSchema', () => {
  it('accepts a minimal tap order and defaults choiceIds', () => {
    const parsed = orderRequestSchema.parse(valid);
    expect(parsed.lines[0]?.choiceIds).toEqual([]);
  });

  it.each([
    ['an empty cart', { ...valid, lines: [] }],
    ['qty 0', { ...valid, lines: [{ itemId: 'chips', qty: 0 }] }],
    ['qty 999', { ...valid, lines: [{ itemId: 'chips', qty: 999 }] }],
    ['a fractional qty', { ...valid, lines: [{ itemId: 'chips', qty: 1.5 }] }],
    ['a float total', { ...valid, clientTotalCents: 5.5 }],
    ['a negative total', { ...valid, clientTotalCents: -1 }],
    ['a short card number', { ...valid, payment: { method: 'card', cardNumber: '4242' } }],
    ['an unknown payment method', { ...valid, payment: { method: 'cash' } }],
    ['a kioskId with spaces', { ...valid, kioskId: 'front 1' }],
  ])('rejects %s', (_label, body) => {
    expect(orderRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('idempotencyKeySchema', () => {
  it('accepts a UUID', () => {
    expect(idempotencyKeySchema.parse('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    );
  });

  it('rejects a non-UUID', () => {
    expect(idempotencyKeySchema.safeParse('not-a-uuid').success).toBe(false);
  });
});

describe('orderStateSchema', () => {
  it('accepts paid', () => {
    const paid = orderStateSchema.parse({
      orderId: 'ord-1',
      status: 'paid',
      pickupNumber: 'A-001',
      totalCents: 500,
      lines: [
        {
          itemId: 'chips',
          name: 'Salted chips',
          choiceIds: [],
          optionLabels: [],
          qty: 2,
          unitPriceCents: 250,
          lineTotalCents: 500,
        },
      ],
      paymentMethod: 'tap',
      last4: null,
    });
    expect(paid.status).toBe('paid');
  });

  it('accepts pending_payment', () => {
    expect(
      orderStateSchema.parse({
        orderId: 'ord-1',
        status: 'pending_payment',
      }).status,
    ).toBe('pending_payment');
  });

  it('accepts payment_failed', () => {
    expect(
      orderStateSchema.parse({
        orderId: 'ord-1',
        status: 'payment_failed',
        error: 'payment_declined',
        message: 'Declined',
      }).status,
    ).toBe('payment_failed');
  });
});

describe('orderChangedSchema', () => {
  it('accepts a reprice payload', () => {
    const changed = orderChangedSchema.parse({
      error: 'order_changed',
      message: 'Prices changed',
      menuVersion: 'v2',
      totalCents: 300,
      lines: [
        {
          itemId: 'chips',
          name: 'Salted chips',
          choiceIds: [],
          optionLabels: [],
          qty: 1,
          unitPriceCents: 300,
          lineTotalCents: 300,
        },
      ],
      unavailableItemIds: [],
    });
    expect(changed.totalCents).toBe(300);
  });
});

describe('apiErrorSchema', () => {
  it('accepts a minimal error', () => {
    expect(apiErrorSchema.parse({ error: 'unavailable' }).error).toBe('unavailable');
  });
});
