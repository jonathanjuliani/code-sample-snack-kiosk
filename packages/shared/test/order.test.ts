import { describe, expect, it } from 'vitest';
import { formatCents, orderRequestSchema } from '../src/index.ts';

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

describe('formatCents', () => {
  it('formats integer cents without floating point', () => {
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(1999)).toBe('$19.99');
  });
});
