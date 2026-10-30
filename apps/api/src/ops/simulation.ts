import { defaultSimulation, type Menu, type Simulation } from '@kiosk/shared';
import type { Db } from '../db/database.ts';
import { loadMenu, overlayMenu } from '../menu/menu-repository.ts';

/** Added on top of the stored price. Not written to SQLite. */
export const PRICE_BUMP_CENTS = 50;

let current: Simulation = { ...defaultSimulation };

export function readSimulation(): Simulation {
  return {
    ...current,
    priceBump: current.priceBump ? { ...current.priceBump } : null,
    soldOut: current.soldOut ? { ...current.soldOut } : null,
  };
}

export function writeSimulation(next: Simulation): Simulation {
  current = {
    payment: next.payment,
    paymentsPaused: next.paymentsPaused,
    menuFails: next.menuFails,
    priceBump: next.priceBump ? { itemId: next.priceBump.itemId } : null,
    soldOut: next.soldOut ? { itemId: next.soldOut.itemId } : null,
  };
  return readSimulation();
}

export function resetSimulation(): void {
  current = { ...defaultSimulation };
}

/** The menu a kiosk would load, including the in-memory price and sold-out overlays. */
export function servedMenu(db: Db): Menu {
  const sim = readSimulation();
  return overlayMenu(loadMenu(db), {
    priceBump: sim.priceBump ? { itemId: sim.priceBump.itemId, deltaCents: PRICE_BUMP_CENTS } : null,
    soldOut: sim.soldOut,
  });
}
