import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/database.ts';
import { readSimulation, servedMenu } from '../ops/simulation.ts';

export function registerMenuRoutes(app: FastifyInstance, db: Db): void {
  app.get('/menu', async (request, reply) => {
    if (readSimulation().menuFails) {
      return reply.status(500).send({ error: 'internal_error', requestId: request.id });
    }
    const menu = servedMenu(db);
    const etag = `"${menu.version}"`;
    reply.header('etag', etag).header('cache-control', 'no-cache');
    if (request.headers['if-none-match'] === etag) return reply.status(304).send();
    return menu;
  });
}
