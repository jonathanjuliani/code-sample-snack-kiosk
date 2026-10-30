import {
  assistRequestSchema,
  type OpsSummary,
  opsEventSchema,
  type SimulationResponse,
  simulationSchema,
} from '@kiosk/shared';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/database.ts';
import { issuesFrom, sendInvalid } from '../http.ts';
import { loadMenu } from '../menu/menu-repository.ts';
import { readSimulation, servedMenu, writeSimulation } from './simulation.ts';
import {
  bumpCounter,
  listAssists,
  listKiosks,
  listRecentOrders,
  openAssist,
  readCounters,
  touchKiosk,
} from './store.ts';

function simulationView(db: Db): SimulationResponse {
  const menu = loadMenu(db);
  return {
    ...readSimulation(),
    items: menu.items.map((item) => ({ id: item.id, name: item.name })),
  };
}

export function registerOpsRoutes(app: FastifyInstance, db: Db): void {
  app.get('/ops/summary', async (): Promise<OpsSummary> => {
    return {
      menuVersion: servedMenu(db).version,
      counters: readCounters(db),
      kiosks: listKiosks(db),
      assists: listAssists(db),
      orders: listRecentOrders(db),
    };
  });

  app.get('/ops/simulation', async (): Promise<SimulationResponse> => simulationView(db));

  app.put('/ops/simulation', async (request, reply) => {
    const parsed = simulationSchema.safeParse(request.body);
    if (!parsed.success) return sendInvalid(request, reply, issuesFrom(parsed.error));
    const ids = new Set(loadMenu(db).items.map((item) => item.id));
    const issues: { path: string; message: string }[] = [];
    if (parsed.data.priceBump && !ids.has(parsed.data.priceBump.itemId)) {
      issues.push({ path: 'priceBump.itemId', message: 'Unknown item.' });
    }
    if (parsed.data.soldOut && !ids.has(parsed.data.soldOut.itemId)) {
      issues.push({ path: 'soldOut.itemId', message: 'Unknown item.' });
    }
    if (issues.length > 0) return sendInvalid(request, reply, issues);
    const saved = writeSimulation(parsed.data);
    request.log.info(
      {
        payment: saved.payment,
        paymentsPaused: saved.paymentsPaused,
        menuFails: saved.menuFails,
        priceBump: saved.priceBump?.itemId ?? null,
        soldOut: saved.soldOut?.itemId ?? null,
      },
      'simulation updated',
    );
    return simulationView(db);
  });

  app.post('/ops/events', async (request, reply) => {
    const parsed = opsEventSchema.safeParse(request.body);
    if (!parsed.success) return sendInvalid(request, reply, issuesFrom(parsed.error));
    if (parsed.data.kind === 'heartbeat') {
      touchKiosk(db, parsed.data.kioskId, new Date().toISOString(), {
        appVersion: parsed.data.appVersion,
        screen: parsed.data.screen,
        payPhase: parsed.data.payPhase,
        itemCount: parsed.data.itemCount,
        totalCents: parsed.data.totalCents,
      });
    } else {
      bumpCounter(db, 'idleResets');
    }
    return reply.status(204).send();
  });

  app.post('/kiosk/assist', async (request, reply) => {
    const parsed = assistRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendInvalid(request, reply, issuesFrom(parsed.error));
    openAssist(db, parsed.data.kioskId, new Date().toISOString());
    return reply.status(204).send();
  });
}
