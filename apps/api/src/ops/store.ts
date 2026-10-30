import { randomUUID } from 'node:crypto';
import {
  kioskPayPhaseSchema,
  kioskScreenSchema,
  type OpsAssist,
  type OpsCounters,
  type OpsEvent,
  type OpsKiosk,
  type OpsOrder,
  orderStatusSchema,
} from '@kiosk/shared';
import type { z } from 'zod';
import type { Db } from '../db/database.ts';

const COUNTER_NAMES = {
  idempotentReplays: 'idempotent_replays',
  reprices: 'reprices',
  declines: 'declines',
  idleResets: 'idle_resets',
} as const;

export type CounterName = keyof typeof COUNTER_NAMES;

export function bumpCounter(db: Db, name: CounterName): void {
  db.prepare(
    `INSERT INTO ops_counters (name, value) VALUES (?, 1)
     ON CONFLICT(name) DO UPDATE SET value = value + 1`,
  ).run(COUNTER_NAMES[name]);
}

export function readCounters(db: Db): OpsCounters {
  const rows = db.prepare('SELECT name, value FROM ops_counters').all() as { name: string; value: number }[];
  const value = (column: string) => rows.find((row) => row.name === column)?.value ?? 0;
  return {
    idempotentReplays: value(COUNTER_NAMES.idempotentReplays),
    reprices: value(COUNTER_NAMES.reprices),
    declines: value(COUNTER_NAMES.declines),
    idleResets: value(COUNTER_NAMES.idleResets),
  };
}

export type KioskReport = {
  appVersion?: string;
  screen?: OpsEvent['screen'];
  payPhase?: OpsEvent['payPhase'];
  itemCount?: number;
  totalCents?: number;
};

export function touchKiosk(db: Db, kioskId: string, at: string, report: KioskReport = {}): void {
  db.prepare(
    `INSERT INTO kiosk_seen
       (kiosk_id, last_seen_at, app_version, screen, pay_phase, item_count, total_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(kiosk_id) DO UPDATE SET
       last_seen_at = excluded.last_seen_at,
       app_version = CASE
         WHEN excluded.app_version = '' THEN kiosk_seen.app_version
         ELSE excluded.app_version
       END,
       screen = COALESCE(excluded.screen, kiosk_seen.screen),
       pay_phase = COALESCE(excluded.pay_phase, kiosk_seen.pay_phase),
       item_count = COALESCE(excluded.item_count, kiosk_seen.item_count),
       total_cents = COALESCE(excluded.total_cents, kiosk_seen.total_cents)`,
  ).run(
    kioskId,
    at,
    report.appVersion ?? '',
    report.screen ?? null,
    report.payPhase ?? null,
    report.itemCount ?? null,
    report.totalCents ?? null,
  );
}

type KioskRow = {
  kiosk_id: string;
  last_seen_at: string;
  app_version: string;
  screen: string | null;
  pay_phase: string | null;
  item_count: number | null;
  total_cents: number | null;
};

function enumOrNull<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function listKiosks(db: Db): OpsKiosk[] {
  const rows = db
    .prepare(
      `SELECT kiosk_id, last_seen_at, app_version, screen, pay_phase, item_count, total_cents
       FROM kiosk_seen ORDER BY last_seen_at DESC`,
    )
    .all() as KioskRow[];
  return rows.map((row) => ({
    kioskId: row.kiosk_id,
    lastSeenAt: row.last_seen_at,
    appVersion: row.app_version,
    screen: enumOrNull(kioskScreenSchema, row.screen),
    payPhase: enumOrNull(kioskPayPhaseSchema, row.pay_phase),
    itemCount: row.item_count,
    totalCents: row.total_cents,
  }));
}

export function openAssist(db: Db, kioskId: string, at: string): void {
  db.prepare('INSERT INTO assist_requests (id, kiosk_id, opened_at) VALUES (?, ?, ?)').run(
    randomUUID(),
    kioskId,
    at,
  );
}

export function listAssists(db: Db): OpsAssist[] {
  const rows = db
    .prepare('SELECT id, kiosk_id, opened_at FROM assist_requests ORDER BY opened_at DESC LIMIT 20')
    .all() as { id: string; kiosk_id: string; opened_at: string }[];
  return rows.map((row) => ({ id: row.id, kioskId: row.kiosk_id, openedAt: row.opened_at }));
}

type OrderListRow = {
  id: string;
  status: string;
  kiosk_id: string;
  total_cents: number;
  created_at: string;
  pickup_number: string | null;
};

export function listRecentOrders(db: Db): OpsOrder[] {
  const rows = db
    .prepare(
      `SELECT id, status, kiosk_id, total_cents, created_at, pickup_number
       FROM orders ORDER BY created_at DESC LIMIT 20`,
    )
    .all() as OrderListRow[];
  return rows.map((row) => ({
    orderId: row.id,
    status: orderStatusSchema.parse(row.status),
    kioskId: row.kiosk_id,
    totalCents: row.total_cents,
    createdAt: row.created_at,
    pickupNumber: row.pickup_number,
  }));
}
