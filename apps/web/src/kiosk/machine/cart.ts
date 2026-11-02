import { MAX_QTY_PER_LINE, type Menu, type MenuItem } from '@kiosk/shared';
import type { CartLine } from './state.ts';

export function lineKey(itemId: string, choiceIds: string[]): string {
  return `${itemId}:${[...choiceIds].sort().join('.')}`;
}

export function itemById(menu: Menu | null, id: string): MenuItem | undefined {
  return menu?.items.find((item) => item.id === id);
}

export function unitPriceCents(item: MenuItem, choiceIds: string[]): number {
  const chosen = new Set(choiceIds);
  let price = item.priceCents;
  for (const group of item.optionGroups) {
    const pick = group.choices.find((choice) => chosen.has(choice.id));
    if (pick) price += pick.deltaCents;
  }
  return price;
}

export function optionLabels(item: MenuItem, choiceIds: string[]): string[] {
  const skip = new Set(['None', 'Regular', 'Plain']);
  const chosen = new Set(choiceIds);
  return item.optionGroups.flatMap((group) => {
    const pick = group.choices.find((choice) => chosen.has(choice.id));
    if (!pick || skip.has(pick.label)) return [];
    return [pick.label];
  });
}

export function defaultChoices(item: MenuItem): string[] {
  return item.optionGroups.flatMap((group) => {
    const first = group.choices[0];
    return first ? [first.id] : [];
  });
}

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.qty, 0);
}

export function cartTotalCents(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.qty * line.unitPriceCents, 0);
}

export function qtyOfItem(lines: CartLine[], itemId: string): number {
  return lines.filter((line) => line.itemId === itemId).reduce((sum, line) => sum + line.qty, 0);
}

export function addLine(lines: CartLine[], next: Omit<CartLine, 'qty'> & { qty: number }): CartLine[] {
  const existing = lines.find((line) => line.key === next.key);
  if (!existing) return [...lines, next];
  return lines.map((line) =>
    line.key === next.key ? { ...line, qty: Math.min(MAX_QTY_PER_LINE, line.qty + next.qty) } : line,
  );
}
