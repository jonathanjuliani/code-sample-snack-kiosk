import type { FailedOrder, OrderState, OrderStatus, PaidOrder, PricedLine } from '@kiosk/shared';
import type { Db } from '../db/database.ts';

type OrderRow = {
  id: string;
  idempotency_key: string;
  request_hash: string;
  status: OrderStatus;
  response_status: number | null;
  response_json: string | null;
};

export type StoredOrder = {
  id: string;
  requestHash: string;
  status: OrderStatus;
  response: { statusCode: number; body: PaidOrder | FailedOrder } | null;
};

export type NewPendingOrder = {
  id: string;
  idempotencyKey: string;
  requestHash: string;
  kioskId: string;
  totalCents: number;
  paymentMethod: 'card' | 'tap';
  last4: string | null;
  lines: PricedLine[];
};

const PICKUP_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PICKUP_PER_LETTER = 999;

export function formatPickupNumber(n: number): string {
  const letter = PICKUP_LETTERS[Math.floor((n - 1) / PICKUP_PER_LETTER) % PICKUP_LETTERS.length];
  const number = ((n - 1) % PICKUP_PER_LETTER) + 1;
  return `${letter}-${String(number).padStart(3, '0')}`;
}

function toStored(row: OrderRow): StoredOrder {
  return {
    id: row.id,
    requestHash: row.request_hash,
    status: row.status,
    response:
      row.response_status !== null && row.response_json !== null
        ? { statusCode: row.response_status, body: JSON.parse(row.response_json) }
        : null,
  };
}

export function toOrderState(order: StoredOrder): OrderState {
  if (order.status === 'pending_payment' || !order.response) {
    return { orderId: order.id, status: 'pending_payment' };
  }
  return order.response.body;
}

export function createOrderRepository(db: Db) {
  const selectColumns = 'id, idempotency_key, request_hash, status, response_status, response_json';
  const byKey = db.prepare(`SELECT ${selectColumns} FROM orders WHERE idempotency_key = ?`);
  const byId = db.prepare(`SELECT ${selectColumns} FROM orders WHERE id = ?`);
  const insertOrder = db.prepare(
    `INSERT INTO orders (id, idempotency_key, request_hash, kiosk_id, status, total_cents, payment_method, last4, created_at, updated_at)
     VALUES (@id, @idempotencyKey, @requestHash, @kioskId, 'pending_payment', @totalCents, @paymentMethod, @last4, @now, @now)`,
  );
  const insertLine = db.prepare(
    `INSERT INTO order_lines (order_id, line_no, item_id, name, choice_ids_json, option_labels_json, qty, unit_price_cents, line_total_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const nextPickup = db.prepare(
    `INSERT INTO pickup_counters (day, last_number) VALUES (?, 1)
     ON CONFLICT (day) DO UPDATE SET last_number = last_number + 1
     RETURNING last_number`,
  );
  const finish = db.prepare(
    `UPDATE orders SET status = @status, payment_ref = @paymentRef, pickup_day = @pickupDay, pickup_number = @pickupNumber,
       response_status = @responseStatus, response_json = @responseJson, updated_at = @now
     WHERE id = @id AND status = 'pending_payment'`,
  );

  return {
    findByKey(key: string): StoredOrder | null {
      const row = byKey.get(key) as OrderRow | undefined;
      return row ? toStored(row) : null;
    },

    findById(id: string): StoredOrder | null {
      const row = byId.get(id) as OrderRow | undefined;
      return row ? toStored(row) : null;
    },

    insertPending: db.transaction((order: NewPendingOrder) => {
      insertOrder.run({ ...order, now: new Date().toISOString() });
      order.lines.forEach((line, i) => {
        insertLine.run(
          order.id,
          i + 1,
          line.itemId,
          line.name,
          JSON.stringify(line.choiceIds),
          JSON.stringify(line.optionLabels),
          line.qty,
          line.unitPriceCents,
          line.lineTotalCents,
        );
      });
    }),

    markPaid: db.transaction(
      (input: { id: string; paymentRef: string; build: (pickupNumber: string) => PaidOrder }): PaidOrder => {
        const now = new Date();
        const pickupDay = now.toISOString().slice(0, 10);
        const { last_number } = nextPickup.get(pickupDay) as { last_number: number };
        const body = input.build(formatPickupNumber(last_number));
        finish.run({
          id: input.id,
          status: 'paid',
          paymentRef: input.paymentRef,
          pickupDay,
          pickupNumber: body.pickupNumber,
          responseStatus: 201,
          responseJson: JSON.stringify(body),
          now: now.toISOString(),
        });
        return body;
      },
    ),

    markFailed(input: { id: string; paymentRef: string; body: FailedOrder }): void {
      finish.run({
        id: input.id,
        status: 'payment_failed',
        paymentRef: input.paymentRef,
        pickupDay: null,
        pickupNumber: null,
        responseStatus: 402,
        responseJson: JSON.stringify(input.body),
        now: new Date().toISOString(),
      });
    },
  };
}

export type OrderRepository = ReturnType<typeof createOrderRepository>;
