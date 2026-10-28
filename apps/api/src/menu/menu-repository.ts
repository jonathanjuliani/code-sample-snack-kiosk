import { createHash } from 'node:crypto';
import { type Menu, type MenuItem, optionGroupSchema } from '@kiosk/shared';
import { z } from 'zod';
import type { Db } from '../db/database.ts';

type ItemRow = {
  id: string;
  category_id: string;
  name: string;
  price_cents: number;
  available: number;
  option_groups_json: string;
};

const optionGroupsSchema = z.array(optionGroupSchema);

export function loadMenu(db: Db): Menu {
  const categories = db.prepare('SELECT id, label FROM categories ORDER BY sort').all() as Menu['categories'];
  const rows = db
    .prepare(
      'SELECT id, category_id, name, price_cents, available, option_groups_json FROM menu_items ORDER BY sort',
    )
    .all() as ItemRow[];
  const items: MenuItem[] = rows.map((row) => ({
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    priceCents: row.price_cents,
    available: row.available === 1,
    optionGroups: optionGroupsSchema.parse(JSON.parse(row.option_groups_json)),
  }));
  const version = createHash('sha256')
    .update(JSON.stringify({ categories, items }))
    .digest('hex')
    .slice(0, 12);
  return { version, categories, items };
}

export function setItemPrice(db: Db, itemId: string, priceCents: number): boolean {
  return (
    db.prepare('UPDATE menu_items SET price_cents = ? WHERE id = ?').run(priceCents, itemId).changes === 1
  );
}

export function setItemAvailable(db: Db, itemId: string, available: boolean): boolean {
  return (
    db.prepare('UPDATE menu_items SET available = ? WHERE id = ?').run(available ? 1 : 0, itemId).changes ===
    1
  );
}

export function setChoiceDelta(db: Db, itemId: string, choiceId: string, deltaCents: number): boolean {
  const item = loadMenu(db).items.find((i) => i.id === itemId);
  if (!item) return false;
  let found = false;
  const groups = item.optionGroups.map((g) => ({
    ...g,
    choices: g.choices.map((c) => {
      if (c.id !== choiceId) return c;
      found = true;
      return { ...c, deltaCents };
    }),
  }));
  if (!found) return false;
  db.prepare('UPDATE menu_items SET option_groups_json = ? WHERE id = ?').run(JSON.stringify(groups), itemId);
  return true;
}
