import { describe, expect, it } from 'vitest';
import { formatPickupNumber } from '../src/orders/order-repository.ts';

describe('formatPickupNumber', () => {
  it('uses a letter and three digits', () => {
    expect(formatPickupNumber(1)).toBe('A-001');
    expect(formatPickupNumber(42)).toBe('A-042');
    expect(formatPickupNumber(999)).toBe('A-999');
    expect(formatPickupNumber(1000)).toBe('B-001');
  });
});
