import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from '../src/index.ts';

describe('shared entry', () => {
  it('exports a health schema that accepts ok and defaults payments to up', () => {
    expect(healthResponseSchema.parse({ status: 'ok' })).toEqual({ status: 'ok', payments: 'up' });
    expect(healthResponseSchema.parse({ status: 'ok', payments: 'down' })).toEqual({
      status: 'ok',
      payments: 'down',
    });
  });
});
