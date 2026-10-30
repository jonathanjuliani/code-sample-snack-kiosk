import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { buildApp, loggerRedact, loggerSerializers } from '../src/app.ts';
import { type Db, openDatabase, readSeed, seedMenu } from '../src/db/database.ts';
import { resetSimulation } from '../src/ops/simulation.ts';
import type { PaymentGateway } from '../src/orders/payment.ts';

const SEED_PATH = fileURLToPath(new URL('../seed/menu.json', import.meta.url));

export function openTestDb(): Db {
  const db = openDatabase(':memory:');
  seedMenu(db, readSeed(SEED_PATH));
  return db;
}

export function captureLog() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  return {
    lines,
    logger: {
      level: 'info' as const,
      stream,
      redact: loggerRedact,
      serializers: loggerSerializers,
    },
  };
}

export function createTestApp(
  options: { payments?: PaymentGateway; captureLogs?: boolean; failRate?: number } = {},
) {
  resetSimulation();
  const db = openTestDb();
  const captured = options.captureLogs ? captureLog() : null;
  const app = buildApp({
    db,
    config: { CHAOS_LATENCY_MS: 0, CHAOS_FAIL_RATE: options.failRate ?? 0, PAYMENT_SLOW_MS: 40 },
    payments: options.payments,
    logger: captured?.logger ?? false,
  });
  if (captured) {
    app.addHook('preHandler', async (request) => {
      request.log.info({ body: request.body }, 'incoming body');
    });
  }
  return { app, db, logs: captured?.lines ?? [] };
}

export const APPROVE = '4242424242424242';
export const DECLINE = '4000000000000002';
export const SLOW = '4000000000009995';
export const KEY_A = '11111111-1111-4111-8111-111111111111';
export const KEY_B = '22222222-2222-4222-8222-222222222222';
