import { randomUUID } from 'node:crypto';
import type { HealthResponse } from '@kiosk/shared';
import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';

const REQUEST_ID_HEADER = 'x-request-id';

export type AppOptions = {
  logger?: FastifyServerOptions['logger'];
};

export function buildApp(options: AppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    requestIdHeader: REQUEST_ID_HEADER,
    genReqId: () => randomUUID(),
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

  return app;
}
