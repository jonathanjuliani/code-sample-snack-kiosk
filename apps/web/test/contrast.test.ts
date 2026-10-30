import { describe, expect, it } from 'vitest';
import { accentAcceptsWhiteText, whiteOnHexRatio } from '../src/contrast';

describe('venue accent contrast', () => {
  it('accepts the snack-bar orange and rejects a light tint', () => {
    expect(whiteOnHexRatio('#C2410C')).toBeGreaterThanOrEqual(4.5);
    expect(accentAcceptsWhiteText('#C2410C')).toBe(true);
    expect(accentAcceptsWhiteText('#FDBA74')).toBe(false);
    expect(accentAcceptsWhiteText('orange')).toBe(false);
  });
});
