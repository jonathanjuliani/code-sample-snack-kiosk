import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from '../src/index.ts';

describe('shared entry', () => {
  it('exports a health schema that accepts ok', () => {
    expect(healthResponseSchema.parse({ status: 'ok' })).toEqual({ status: 'ok' });
  });
});
