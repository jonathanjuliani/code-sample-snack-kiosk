import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearAttempt,
  clearCart,
  loadAttempt,
  loadCart,
  readIdleMs,
  saveAttempt,
  saveCart,
} from '../src/storage';

const line = {
  key: 'chips:',
  itemId: 'chips',
  choiceIds: [] as string[],
  optionLabels: [] as string[],
  qty: 1,
  unitPriceCents: 250,
};

function memoryStore(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? (map.get(key) ?? null) : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'sessionStorage', { value: memoryStore(), configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStore(), configurable: true });
  Object.defineProperty(globalThis, 'window', {
    value: {
      location: { search: '' },
      history: {
        replaceState(_data: unknown, _title: string, url: string) {
          const parsed = new URL(url, 'http://localhost/');
          (window as { location: { search: string } }).location = { search: parsed.search };
        },
      },
    },
    configurable: true,
  });
});

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe('cart storage', () => {
  it('round-trips cart lines', () => {
    saveCart([line]);
    expect(loadCart()).toEqual([line]);
    clearCart();
    expect(loadCart()).toEqual([]);
  });

  it('returns an empty cart when JSON is corrupt', () => {
    sessionStorage.setItem('kiosk.cart', '{not-json');
    expect(loadCart()).toEqual([]);
  });
});

describe('attempt storage', () => {
  it('round-trips an attempt', () => {
    const attempt = {
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
      kioskId: 'front-1',
    };
    saveAttempt(attempt);
    expect(loadAttempt()).toEqual(attempt);
    clearAttempt();
    expect(loadAttempt()).toBeNull();
  });

  it('returns null when JSON is corrupt', () => {
    sessionStorage.setItem('kiosk.attempt', '{not-json');
    expect(loadAttempt()).toBeNull();
  });

  it('never stores card digits in session keys', () => {
    saveCart([line]);
    saveAttempt({
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
      kioskId: 'front-1',
    });
    const blob = `${sessionStorage.getItem('kiosk.cart')}${sessionStorage.getItem('kiosk.attempt')}`;
    expect(blob).not.toMatch(/4242|cardNumber|cardDigits/);
  });
});

describe('readIdleMs', () => {
  it('clamps out-of-range values to the fallback', () => {
    window.history.replaceState({}, '', '/?idle=0');
    expect(readIdleMs(60_000)).toBe(60_000);
    window.history.replaceState({}, '', '/?idle=9999');
    expect(readIdleMs(60_000)).toBe(60_000);
  });

  it('accepts a value in range as milliseconds', () => {
    window.history.replaceState({}, '', '/?idle=2');
    expect(readIdleMs(60_000)).toBe(2_000);
  });
});
