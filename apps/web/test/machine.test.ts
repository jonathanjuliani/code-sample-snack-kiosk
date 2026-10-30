import { describe, expect, it } from 'vitest';
import {
  canPay,
  cartTotalCents,
  createInitialState,
  idleLimitMs,
  inPayment,
  type KioskState,
  reduce,
} from '../src/machine';

const menu = {
  version: 'v1',
  venue: { name: 'Snack Bar', accent: '#C2410C' },
  categories: [{ id: 'snacks', label: 'Snacks' }],
  items: [
    {
      id: 'chips',
      categoryId: 'snacks',
      name: 'Salted chips',
      priceCents: 250,
      available: true,
      optionGroups: [],
    },
    {
      id: 'popcorn',
      categoryId: 'snacks',
      name: 'Popcorn',
      priceCents: 400,
      available: true,
      optionGroups: [
        {
          id: 'size',
          name: 'Size',
          choices: [
            { id: 'size-regular', label: 'Regular', deltaCents: 0 },
            { id: 'size-large', label: 'Large', deltaCents: 150 },
          ],
        },
      ],
    },
  ],
};

function ready(): KioskState {
  return reduce(createInitialState(), { type: 'menu/loaded', menu });
}

describe('kiosk machine', () => {
  it('adds a flat item and disables pay on an empty cart', () => {
    let state = ready();
    expect(canPay({ ...state, screen: 'checkout' })).toBe(false);
    state = reduce(state, { type: 'start' });
    state = reduce(state, { type: 'tile', itemId: 'chips' });
    state = reduce(state, { type: 'tile', itemId: 'chips' });
    expect(state.lines).toHaveLength(1);
    expect(state.lines[0]?.qty).toBe(2);
    expect(cartTotalCents(state.lines)).toBe(500);
    state = reduce(state, { type: 'review' });
    expect(canPay(state)).toBe(true);
  });

  it('opens a sheet for options and prices the delta', () => {
    let state = ready();
    state = reduce(state, { type: 'tile', itemId: 'popcorn' });
    expect(state.sheet?.choiceIds).toEqual(['size-regular']);
    state = reduce(state, { type: 'sheet/choose', groupId: 'size', choiceId: 'size-large' });
    state = reduce(state, { type: 'sheet/add' });
    expect(state.lines[0]?.unitPriceCents).toBe(550);
    expect(state.lines[0]?.optionLabels).toEqual(['Large']);
  });

  it('locks pay while a payment is in flight', () => {
    let state = ready();
    state = reduce(state, { type: 'tile', itemId: 'chips' });
    state = reduce(state, { type: 'review' });
    state = reduce(state, { type: 'pay/lock', key: '11111111-1111-4111-8111-111111111111' });
    expect(inPayment(state.payPhase)).toBe(true);
    expect(canPay(state)).toBe(false);
    state = reduce(state, { type: 'pay/paid', pickupNumber: 'A-001' });
    expect(state.screen).toBe('done');
    expect(state.pickupNumber).toBe('A-001');
  });

  it('keeps the cart after a decline', () => {
    let state = ready();
    state = reduce(state, { type: 'tile', itemId: 'chips' });
    state = reduce(state, { type: 'review' });
    state = reduce(state, { type: 'pay/lock', key: '11111111-1111-4111-8111-111111111111' });
    state = reduce(state, { type: 'pay/declined' });
    expect(state.lines).toHaveLength(1);
    expect(state.payPhase).toBe('declined');
  });

  it('opens the order screen when the menu never loads so the retry is visible', () => {
    let state = reduce(createInitialState(), { type: 'menu/failed' });
    expect(state.screen).toBe('start');
    expect(state.menuStatus).toBe('unavailable');
    state = reduce(state, { type: 'start' });
    expect(state.screen).toBe('order');
    expect(state.menu).toBeNull();
  });

  it('asks to confirm a new total and then applies it', () => {
    let state = ready();
    state = reduce(state, { type: 'start' });
    state = reduce(state, { type: 'tile', itemId: 'chips' });
    state = reduce(state, { type: 'review' });
    state = reduce(state, {
      type: 'pay/changed',
      changed: {
        error: 'order_changed',
        message: 'Prices or availability changed. Confirm the new total before paying.',
        menuVersion: 'v2',
        totalCents: 300,
        lines: [
          {
            itemId: 'chips',
            name: 'Salted chips',
            choiceIds: [],
            optionLabels: [],
            qty: 1,
            unitPriceCents: 300,
            lineTotalCents: 300,
          },
        ],
        unavailableItemIds: [],
      },
    });
    expect(state.payPhase).toBe('totalChanged');
    expect(state.priceChange?.newTotalCents).toBe(300);
    state = reduce(state, { type: 'accept-price' });
    expect(state.payPhase).toBe('idle');
    expect(state.lines[0]?.unitPriceCents).toBe(300);
    expect(cartTotalCents(state.lines)).toBe(300);
    expect(state.menu?.version).toBe('v2');
  });

  it('clears the cart when the idle countdown ends', () => {
    let state = ready();
    state = reduce(state, { type: 'start' });
    state = reduce(state, { type: 'tile', itemId: 'chips' });
    state = reduce(state, { type: 'idle/prompt', until: 1_000 });
    expect(state.stillThereUntil).toBe(1_000);
    expect(state.screen).toBe('order');
    state = reduce(state, { type: 'start-over/confirm' });
    expect(state.screen).toBe('start');
    expect(state.lines).toHaveLength(0);
  });

  it('counts a second decline and pauses idle while staff are coming', () => {
    let state = ready();
    state = reduce(state, { type: 'start' });
    state = reduce(state, { type: 'tile', itemId: 'chips' });
    expect(idleLimitMs(state)).toBe(60_000);
    state = reduce(state, { type: 'review' });
    state = reduce(state, { type: 'pay/declined' });
    expect(state.declineCount).toBe(1);
    state = reduce(state, { type: 'pay/retry' });
    state = reduce(state, { type: 'pay/declined' });
    expect(state.declineCount).toBe(2);
    state = reduce(state, { type: 'assist/open' });
    expect(state.assistActive).toBe(true);
    expect(idleLimitMs(state)).toBeNull();
  });

  it('resumes a saved attempt on the checking screen', () => {
    const state = reduce(ready(), {
      type: 'restore',
      lines: [
        {
          key: 'chips:',
          itemId: 'chips',
          choiceIds: [],
          optionLabels: [],
          qty: 1,
          unitPriceCents: 250,
        },
      ],
      key: '11111111-1111-4111-8111-111111111111',
    });
    expect(state.screen).toBe('checkout');
    expect(state.payPhase).toBe('checking');
    expect(state.lines).toHaveLength(1);
  });

  it('disables pay while the API is down', () => {
    let state = ready();
    state = reduce(state, { type: 'tile', itemId: 'chips' });
    state = reduce(state, { type: 'review' });
    expect(canPay(state)).toBe(true);
    state = reduce(state, { type: 'api/down' });
    expect(state.apiDown).toBe(true);
    expect(canPay(state)).toBe(false);
  });
});
