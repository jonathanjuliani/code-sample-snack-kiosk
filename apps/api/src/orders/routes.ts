import { createHash, randomUUID } from 'node:crypto';
import {
  type FailedOrder,
  IDEMPOTENCY_KEY_HEADER,
  idempotencyKeySchema,
  type OrderChanged,
  type OrderRequest,
  orderRequestSchema,
  type PendingOrder,
} from '@kiosk/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/database.ts';
import { issuesFrom, sendInvalid } from '../http.ts';
import { loadMenu } from '../menu/menu-repository.ts';
import type { OrderRepository, StoredOrder } from './order-repository.ts';
import { toOrderState } from './order-repository.ts';
import type { PaymentGateway } from './payment.ts';
import { priceOrder } from './pricing.ts';

/** Hash of what makes two requests "the same attempt". Uses only the last 4 digits, never the card number. */
export function requestHash(body: OrderRequest): string {
  const canonical = {
    kioskId: body.kioskId,
    menuVersion: body.menuVersion,
    lines: body.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, choiceIds: [...l.choiceIds].sort() })),
    payment: {
      method: body.payment.method,
      last4: body.payment.method === 'card' ? body.payment.cardNumber.slice(-4) : null,
    },
    clientTotalCents: body.clientTotalCents,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function replay(reply: FastifyReply, order: StoredOrder): FastifyReply {
  if (!order.response) {
    const pending: PendingOrder = { orderId: order.id, status: 'pending_payment' };
    return reply.status(202).send(pending);
  }
  const statusCode = order.response.statusCode === 201 ? 200 : order.response.statusCode;
  return reply.status(statusCode).header('idempotent-replayed', 'true').send(order.response.body);
}

export function registerOrderRoutes(
  app: FastifyInstance,
  deps: { db: Db; orders: OrderRepository; payments: PaymentGateway },
): void {
  const { db, orders, payments } = deps;

  app.post('/orders', async (request, reply) => {
    const keyResult = idempotencyKeySchema.safeParse(request.headers[IDEMPOTENCY_KEY_HEADER]);
    if (!keyResult.success) {
      return sendInvalid(request, reply, [
        { path: 'headers.idempotency-key', message: 'Idempotency-Key header must be a UUID' },
      ]);
    }
    const bodyResult = orderRequestSchema.safeParse(request.body);
    if (!bodyResult.success) return sendInvalid(request, reply, issuesFrom(bodyResult.error));

    const idempotencyKey = keyResult.data;
    const body = bodyResult.data;
    const hash = requestHash(body);
    const log = request.log.child({ idempotencyKey, kioskId: body.kioskId });

    // From here to insertPending there is no await: better-sqlite3 is synchronous, so a concurrent
    // request with the same key cannot slip in between the lookup and the insert.
    const existing = orders.findByKey(idempotencyKey);
    if (existing) {
      if (existing.requestHash !== hash) {
        log.warn({ orderId: existing.id }, 'idempotency key reused with a different request');
        return reply.status(422).send({
          error: 'idempotency_key_reused',
          message: 'This checkout attempt was already used for a different order.',
          requestId: request.id,
        });
      }
      log.info({ orderId: existing.id, status: existing.status }, 'order replayed');
      return replay(reply, existing);
    }

    const menu = loadMenu(db);
    const priced = priceOrder(menu.items, body.lines);
    if (priced.kind === 'invalid') return sendInvalid(request, reply, priced.issues);

    if (priced.unavailableItemIds.length > 0 || priced.totalCents !== body.clientTotalCents) {
      const changed: OrderChanged = {
        error: 'order_changed',
        message: 'Prices or availability changed. Confirm the new total before paying.',
        menuVersion: menu.version,
        totalCents: priced.totalCents,
        lines: priced.lines,
        unavailableItemIds: priced.unavailableItemIds,
      };
      log.info(
        { clientTotalCents: body.clientTotalCents, totalCents: priced.totalCents },
        'order changed since menu load',
      );
      return reply.status(409).send(changed);
    }

    const orderId = randomUUID();
    const last4 = body.payment.method === 'card' ? body.payment.cardNumber.slice(-4) : null;
    try {
      orders.insertPending({
        id: orderId,
        idempotencyKey,
        requestHash: hash,
        kioskId: body.kioskId,
        totalCents: priced.totalCents,
        paymentMethod: body.payment.method,
        last4,
        lines: priced.lines,
      });
    } catch (error) {
      const raced = orders.findByKey(idempotencyKey);
      if (raced) {
        log.info({ orderId: raced.id, status: raced.status }, 'order replayed after insert race');
        return replay(reply, raced);
      }
      throw error;
    }

    const result = await payments.charge(body.payment, priced.totalCents);

    if (!result.approved) {
      const failed: FailedOrder = {
        orderId,
        status: 'payment_failed',
        error: 'payment_declined',
        message: result.customerMessage,
      };
      orders.markFailed({ id: orderId, paymentRef: result.reference, body: failed });
      log.info({ orderId, totalCents: priced.totalCents, status: 'payment_failed' }, 'order declined');
      return reply.status(402).send(failed);
    }

    const paid = orders.markPaid({
      id: orderId,
      paymentRef: result.reference,
      build: (pickupNumber) => ({
        orderId,
        status: 'paid',
        pickupNumber,
        totalCents: priced.totalCents,
        lines: priced.lines,
        paymentMethod: body.payment.method,
        last4,
      }),
    });
    log.info(
      { orderId, totalCents: paid.totalCents, pickupNumber: paid.pickupNumber, status: 'paid' },
      'order paid',
    );
    return reply.status(201).send(paid);
  });

  const lookupQuery = z.object({ idempotencyKey: idempotencyKeySchema });

  app.get('/orders', async (request, reply) => {
    const query = lookupQuery.safeParse(request.query);
    if (!query.success) return sendInvalid(request, reply, issuesFrom(query.error));
    const order = orders.findByKey(query.data.idempotencyKey);
    if (!order) return reply.status(404).send({ error: 'not_found', requestId: request.id });
    return toOrderState(order);
  });

  app.get<{ Params: { id: string } }>('/orders/:id', async (request, reply) => {
    const order = orders.findById(request.params.id);
    if (!order) return reply.status(404).send({ error: 'not_found', requestId: request.id });
    return toOrderState(order);
  });
}
