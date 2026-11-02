import { describe, expect, it } from 'vitest';
import { centsSchema, formatCents } from '../src/index.ts';

describe('centsSchema', () => {
  it('accepts non-negative integers', () => {
    expect(centsSchema.parse(0)).toBe(0);
    expect(centsSchema.parse(1999)).toBe(1999);
  });

  it.each([
    ['a float', 5.5],
    ['a negative', -1],
    ['a string', '100'],
  ])('rejects %s', (_label, value) => {
    expect(centsSchema.safeParse(value).success).toBe(false);
  });
});

describe('formatCents', () => {
  it.each([
    [0, '$0.00'],
    [5, '$0.05'],
    [100, '$1.00'],
    [1999, '$19.99'],
  ])('formats %i as %s', (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });
});
