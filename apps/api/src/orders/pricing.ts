import type { MenuItem, OrderLineInput, PricedLine } from '@kiosk/shared';

export type PricingIssue = { path: string; message: string };

export type PricingResult =
  | { kind: 'invalid'; issues: PricingIssue[] }
  | { kind: 'priced'; lines: PricedLine[]; totalCents: number; unavailableItemIds: string[] };

/** Prices lines from the server's menu. Unknown items or options are invalid; sold-out items are reported, not rejected. */
export function priceOrder(items: MenuItem[], lines: OrderLineInput[]): PricingResult {
  const byId = new Map(items.map((item) => [item.id, item]));
  const issues: PricingIssue[] = [];
  const unavailable = new Set<string>();
  const priced: PricedLine[] = [];

  lines.forEach((line, index) => {
    const item = byId.get(line.itemId);
    if (!item) {
      issues.push({ path: `lines.${index}.itemId`, message: `Unknown item "${line.itemId}"` });
      return;
    }
    if (!item.available) unavailable.add(item.id);

    const chosen = new Set(line.choiceIds);
    let unitPriceCents = item.priceCents;
    const optionLabels: string[] = [];
    for (const group of item.optionGroups) {
      const picks = group.choices.filter((c) => chosen.has(c.id));
      if (picks.length !== 1) {
        issues.push({
          path: `lines.${index}.choiceIds`,
          message: `Choose exactly one ${group.name.toLowerCase()} for ${item.name}`,
        });
        continue;
      }
      const pick = picks[0];
      if (!pick) continue;
      chosen.delete(pick.id);
      unitPriceCents += pick.deltaCents;
      optionLabels.push(pick.label);
    }
    for (const leftover of chosen) {
      issues.push({
        path: `lines.${index}.choiceIds`,
        message: `Unknown option "${leftover}" for ${item.name}`,
      });
    }

    priced.push({
      itemId: item.id,
      name: item.name,
      choiceIds: [...line.choiceIds].sort(),
      optionLabels,
      qty: line.qty,
      unitPriceCents,
      lineTotalCents: unitPriceCents * line.qty,
    });
  });

  if (issues.length > 0) return { kind: 'invalid', issues };
  const totalCents = priced.reduce((sum, line) => sum + line.lineTotalCents, 0);
  return { kind: 'priced', lines: priced, totalCents, unavailableItemIds: [...unavailable] };
}
