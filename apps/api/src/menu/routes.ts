import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/database.ts';
import { loadMenu } from './menu-repository.ts';

export function registerMenuRoutes(app: FastifyInstance, db: Db): void {
  app.get('/menu', async (request, reply) => {
    const menu = loadMenu(db);
    const etag = `"${menu.version}"`;
    reply.header('etag', etag).header('cache-control', 'no-cache');
    if (request.headers['if-none-match'] === etag) return reply.status(304).send();
    return menu;
  });
}
