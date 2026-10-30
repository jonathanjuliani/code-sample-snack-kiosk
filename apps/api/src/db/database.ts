import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  type Category,
  categorySchema,
  type MenuItem,
  menuItemSchema,
  type Venue,
  venueSchema,
} from '@kiosk/shared';
import Database from 'better-sqlite3';
import { z } from 'zod';

export type Db = Database.Database;

const SCHEMA_SQL = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

const seedSchema = z.object({
  venue: venueSchema,
  categories: z.array(categorySchema),
  items: z.array(menuItemSchema),
});

export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  addColumnIfMissing(db, 'menu_items', 'description', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'kiosk_seen', 'app_version', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'kiosk_seen', 'screen', 'TEXT');
  addColumnIfMissing(db, 'kiosk_seen', 'pay_phase', 'TEXT');
  addColumnIfMissing(db, 'kiosk_seen', 'item_count', 'INTEGER');
  addColumnIfMissing(db, 'kiosk_seen', 'total_cents', 'INTEGER');
  return db;
}

function addColumnIfMissing(db: Db, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function readSeed(path: string): { venue: Venue; categories: Category[]; items: MenuItem[] } {
  return seedSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/** Inserts seed rows that don't exist yet; rows edited at runtime keep their edits. */
export function seedMenu(db: Db, seed: { venue: Venue; categories: Category[]; items: MenuItem[] }): void {
  const insertCategory = db.prepare('INSERT OR IGNORE INTO categories (id, label, sort) VALUES (?, ?, ?)');
  const insertItem = db.prepare(
    `INSERT OR IGNORE INTO menu_items
       (id, category_id, name, description, price_cents, available, sort, option_groups_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertVenue = db.prepare('INSERT OR IGNORE INTO venue (id, name, accent) VALUES (1, ?, ?)');
  db.transaction(() => {
    insertVenue.run(seed.venue.name, seed.venue.accent);
    seed.categories.forEach((c, i) => {
      insertCategory.run(c.id, c.label, i);
    });
    seed.items.forEach((item, i) => {
      insertItem.run(
        item.id,
        item.categoryId,
        item.name,
        item.description ?? '',
        item.priceCents,
        item.available ? 1 : 0,
        i,
        JSON.stringify(item.optionGroups),
      );
    });
  })();
}
