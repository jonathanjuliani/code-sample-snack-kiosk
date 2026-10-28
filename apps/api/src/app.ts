import { randomUUID } from 'node:crypto';
import type { HealthResponse } from '@kiosk/shared';
import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import type { Config } from './config.ts';
import type { Db } from './db/database.ts';
import { registerMenuRoutes } from './menu/routes.ts';
import { createOrderRepository } from './orders/order-repository.ts';
import { createFakeGateway, type PaymentGateway, sleep } from './orders/payment.ts';
import { registerOrderRoutes } from './orders/routes.ts';

const REQUEST_ID_HEADER = 'x-request-id';

const CARD_REDACT_PATHS = ['req.body.payment.cardNumber', 'body.payment.cardNumber', '*.cardNumber'];

export const loggerRedact = {
  paths: CARD_REDACT_PATHS,
  censor: '[redacted]',
} as const;

export const loggerSerializers = {
  req: (request: { method?: string; url?: string; id?: string }) => ({
    method: request.method,
    url: request.url,
    requestId: request.id,
  }),
  res: (reply: { statusCode?: number }) => ({ statusCode: reply.statusCode }),
};

export type AppOptions = {
  db: Db;
  config?: Pick<Config, 'CHAOS_LATENCY_MS' | 'CHAOS_FAIL_RATE' | 'PAYMENT_SLOW_MS'>;
  payments?: PaymentGateway;
  logger?: FastifyServerOptions['logger'];
};

export function buildApp(options: AppOptions) {
  const chaos = {
    latencyMs: options.config?.CHAOS_LATENCY_MS ?? 0,
    failRate: options.config?.CHAOS_FAIL_RATE ?? 0,
  };
  const payments =
    options.payments ?? createFakeGateway({ slowMs: options.config?.PAYMENT_SLOW_MS ?? 15_000 });
  const orders = createOrderRepository(options.db);

  const app = Fastify({
    logger: options.logger ?? false,
    requestIdHeader: REQUEST_ID_HEADER,
    genReqId: () => randomUUID(),
  });

  app.addHook('onRequest', async (request, reply) => {
    if (chaos.failRate > 0 && Math.random() < chaos.failRate) {
      return reply.status(503).send({
        error: 'unavailable',
        message: 'The kiosk is temporarily unavailable. Please try again.',
        requestId: request.id,
      });
    }
    if (chaos.latencyMs > 0) await sleep(chaos.latencyMs);
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'request failed');
      return reply.status(500).send({ error: 'internal_error', requestId: request.id });
    }
    return reply
      .status(statusCode)
      .send({ error: 'bad_request', message: error.message, requestId: request.id });
  });

  app.get('/health', async (): Promise<HealthResponse> => ({ status: 'ok' }));
  registerMenuRoutes(app, options.db);
  registerOrderRoutes(app, { db: options.db, orders, payments });

  return app;
}
