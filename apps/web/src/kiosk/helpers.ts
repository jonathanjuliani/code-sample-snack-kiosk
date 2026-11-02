import { CARD_NUMBER_DIGITS, formatCents, type Menu } from '@kiosk/shared';
import { cartTotalCents, type KioskState } from './machine';

export function primaryLabel(state: KioskState): string {
  if (state.payPhase === 'processing' || state.payPhase === 'checking') return 'Processing…';
  if (state.apiDown) return 'Payments paused';
  if (state.screen === 'checkout') return `Pay ${formatCents(cartTotalCents(state.lines))}`;
  return 'Review and pay';
}

export function visibleCategories(menu: Menu | null) {
  if (!menu) return [];
  return menu.categories.filter((category) =>
    menu.items.some((item) => item.categoryId === category.id && item.available),
  );
}

export function monogram(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const second = parts[1]?.[0] ?? parts[0]?.[1] ?? '';
  return `${first}${second}`.toUpperCase();
}

export function tileIndex(id: string): number {
  let total = 0;
  for (const char of id) total += char.charCodeAt(0);
  return total % 6;
}

export function maskDigits(digits: string): string {
  const padded = `${digits}${'•'.repeat(CARD_NUMBER_DIGITS)}`.slice(0, CARD_NUMBER_DIGITS);
  return `${padded.slice(0, 4)} ${padded.slice(4, 8)} ${padded.slice(8, 12)} ${padded.slice(12)}`;
}
