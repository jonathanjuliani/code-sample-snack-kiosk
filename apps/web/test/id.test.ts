import { idempotencyKeySchema } from '@kiosk/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newIdempotencyKey } from '../src/id';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('newIdempotencyKey', () => {
  it('uses crypto.randomUUID when available', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    vi.stubGlobal('crypto', { randomUUID: () => id });
    expect(newIdempotencyKey()).toBe(id);
  });

  it('falls back to getRandomValues when randomUUID is missing (LAN http)', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = i;
        return bytes;
      },
    });
    const key = newIdempotencyKey();
    expect(idempotencyKeySchema.safeParse(key).success).toBe(true);
  });
});
