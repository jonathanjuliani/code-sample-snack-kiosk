import type { CartLine } from './machine';

const CART_KEY = 'kiosk.cart';
const ATTEMPT_KEY = 'kiosk.attempt';
const MENU_KEY = 'kiosk.menu';

export type StoredAttempt = {
  idempotencyKey: string;
  kioskId: string;
};

export function readKioskId(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('kiosk') ?? params.get('kioskId') ?? 'kiosk-1';
}

export function saveCart(lines: CartLine[]): void {
  sessionStorage.setItem(CART_KEY, JSON.stringify(lines));
}

export function loadCart(): CartLine[] {
  const raw = sessionStorage.getItem(CART_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as CartLine[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function clearCart(): void {
  sessionStorage.removeItem(CART_KEY);
}

export function saveAttempt(attempt: StoredAttempt): void {
  sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempt));
}

export function loadAttempt(): StoredAttempt | null {
  const raw = sessionStorage.getItem(ATTEMPT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredAttempt;
  } catch {
    return null;
  }
}

export function clearAttempt(): void {
  sessionStorage.removeItem(ATTEMPT_KEY);
}

export function cacheMenu(menu: unknown): void {
  localStorage.setItem(MENU_KEY, JSON.stringify(menu));
}

export function loadCachedMenu(): unknown | null {
  const raw = localStorage.getItem(MENU_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
