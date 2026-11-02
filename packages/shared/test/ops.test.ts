import { describe, expect, it } from 'vitest';
import { defaultSimulation, opsEventSchema, opsSummarySchema, simulationSchema } from '../src/index.ts';

describe('opsEventSchema', () => {
  it('accepts a heartbeat with screen and payPhase', () => {
    const parsed = opsEventSchema.parse({
      kioskId: 'front-1',
      kind: 'heartbeat',
      screen: 'order',
      payPhase: 'idle',
      itemCount: 2,
      totalCents: 500,
    });
    expect(parsed.screen).toBe('order');
  });

  it('rejects an unknown screen', () => {
    expect(
      opsEventSchema.safeParse({
        kioskId: 'front-1',
        kind: 'heartbeat',
        screen: 'attract',
      }).success,
    ).toBe(false);
  });

  it('rejects a negative itemCount', () => {
    expect(
      opsEventSchema.safeParse({
        kioskId: 'front-1',
        kind: 'heartbeat',
        itemCount: -1,
      }).success,
    ).toBe(false);
  });
});

describe('simulationSchema', () => {
  it('accepts the default simulation', () => {
    expect(simulationSchema.parse(defaultSimulation)).toEqual(defaultSimulation);
  });

  it('rejects an unknown payment mode', () => {
    expect(
      simulationSchema.safeParse({
        ...defaultSimulation,
        payment: 'always-win',
      }).success,
    ).toBe(false);
  });
});

describe('opsSummarySchema', () => {
  it('accepts a minimal summary shape', () => {
    const summary = {
      menuVersion: 'v1',
      counters: {
        idempotentReplays: 0,
        reprices: 0,
        declines: 0,
        idleResets: 0,
      },
      kiosks: [],
      assists: [],
      orders: [],
    };
    expect(opsSummarySchema.parse(summary).menuVersion).toBe('v1');
  });
});

describe('defaultSimulation', () => {
  it('starts with follow-card and no chaos overlays', () => {
    expect(defaultSimulation).toEqual({
      payment: 'follow-card',
      paymentsPaused: false,
      menuFails: false,
      priceBump: null,
      soldOut: null,
    });
  });
});
