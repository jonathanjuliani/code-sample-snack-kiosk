import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type Category, categorySchema, type MenuItem, menuItemSchema } from '@kiosk/shared';
import Database from 'better-sqlite3';
import { z } from 'zod';

export type Db = Database.Database;

const SCHEMA_SQL = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

const seedSchema = z.object({
  categories: z.array(categorySchema),
  items: z.array(menuItemSchema),
});

export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

export function readSeed(path: string): { categories: Category[]; items: MenuItem[] } {
  return seedSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/** Inserts seed rows that don't exist yet; rows edited at runtime keep their edits. */
export function seedMenu(db: Db, seed: { categories: Category[]; items: MenuItem[] }): void {
  const insertCategory = db.prepare('INSERT OR IGNORE INTO categories (id, label, sort) VALUES (?, ?, ?)');
  const insertItem = db.prepare(
    `INSERT OR IGNORE INTO menu_items (id, category_id, name, price_cents, available, sort, option_groups_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    seed.categories.forEach((c, i) => {
      insertCategory.run(c.id, c.label, i);
    });
    seed.items.forEach((item, i) => {
      insertItem.run(
        item.id,
        item.categoryId,
        item.name,
        item.priceCents,
        item.available ? 1 : 0,
        i,
        JSON.stringify(item.optionGroups),
      );
    });
  })();
}
