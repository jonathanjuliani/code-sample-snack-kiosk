import { describe, expect, it } from 'vitest';
import {
  afterNotFound,
  canPay,
  cartTotalCents,
  createInitialState,
  idleLimitMs,
  inPayment,
  type KioskState,
  reduce,
} from '../src/kiosk/machine';

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
    expect(state.dialog).toEqual({ kind: 'stillThere', until: 1_000 });
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

  it('goes back to Pay when a resumed attempt never reached the API', () => {
    let state = reduce(ready(), { type: 'tile', itemId: 'chips' });
    state = reduce(state, {
      type: 'restore',
      lines: state.lines,
      key: '11111111-1111-4111-8111-111111111111',
    });
    expect(state.resumed).toBe(true);
    // A card attempt restored after a reload: payMode is back to its default, and no digits survived.
    expect(state.payMode).toBe('tap');
    expect(afterNotFound(state)).toBe('back-to-pay');

    state = reduce(state, { type: 'pay/not-found' });
    expect(state.payPhase).toBe('idle');
    expect(state.idempotencyKey).toBeNull();
    expect(state.resumed).toBe(false);
    expect(state.screen).toBe('checkout');
    expect(state.lines).toHaveLength(1);
  });

  it('re-sends a lost request only while this page session can still build it', () => {
    let state = reduce(ready(), { type: 'tile', itemId: 'chips' });
    state = reduce(state, { type: 'review' });
    expect(afterNotFound(state)).toBe('resend');

    state = reduce(state, { type: 'pay/mode', mode: 'card' });
    expect(afterNotFound(state)).toBe('back-to-pay');
    for (const digit of '4242424242424242') state = reduce(state, { type: 'pay/digit', digit });
    state = reduce(state, { type: 'pay/lock', key: '22222222-2222-4222-8222-222222222222' });
    expect(state.resumed).toBe(false);
    expect(afterNotFound(state)).toBe('resend');
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

  it('opens assist dialog and clears only the dialog on wait', () => {
    let state = ready();
    state = reduce(state, { type: 'assist/open' });
    expect(state.dialog).toEqual({ kind: 'assist' });
    expect(state.assistActive).toBe(true);
    state = reduce(state, { type: 'assist/wait' });
    expect(state.dialog).toBeNull();
    expect(state.assistActive).toBe(true);
  });

  it('asks to confirm start-over when the cart has lines', () => {
    let state = ready();
    state = reduce(state, { type: 'start' });
    state = reduce(state, { type: 'tile', itemId: 'chips' });
    state = reduce(state, { type: 'start-over/ask' });
    expect(state.dialog).toEqual({ kind: 'confirmStartOver' });
    state = reduce(state, { type: 'start-over/cancel' });
    expect(state.dialog).toBeNull();
    expect(state.lines).toHaveLength(1);
  });

  it('resets immediately when start-over is asked on an empty cart', () => {
    let state = ready();
    state = reduce(state, { type: 'start' });
    state = reduce(state, { type: 'start-over/ask' });
    expect(state.screen).toBe('start');
    expect(state.dialog).toBeNull();
  });

  it('blocks start-over while a payment is in flight', () => {
    let state = ready();
    state = reduce(state, { type: 'tile', itemId: 'chips' });
    state = reduce(state, { type: 'review' });
    state = reduce(state, { type: 'pay/lock', key: '11111111-1111-4111-8111-111111111111' });
    state = reduce(state, { type: 'start-over/ask' });
    expect(state.dialog).toBeNull();
    expect(state.payPhase).toBe('processing');
  });

  it('moves through checking, other-card, unresolved, and idle/keep', () => {
    let state = ready();
    state = reduce(state, { type: 'tile', itemId: 'chips' });
    state = reduce(state, { type: 'review' });
    state = reduce(state, { type: 'pay/lock', key: '11111111-1111-4111-8111-111111111111' });
    state = reduce(state, { type: 'pay/checking' });
    expect(state.payPhase).toBe('checking');
    state = reduce(state, { type: 'pay/other-card' });
    expect(state.payMode).toBe('card');
    expect(state.payPhase).toBe('idle');
    state = reduce(state, { type: 'pay/unresolved', code: 'AB12' });
    expect(state.payPhase).toBe('unresolved');
    expect(state.unresolvedCode).toBe('AB12');
    state = reduce(state, { type: 'idle/prompt', until: 5_000 });
    expect(state.dialog).toBeNull();
    state = reduce(state, { type: 'pay/retry' });
    state = reduce(state, { type: 'idle/prompt', until: 5_000 });
    expect(state.dialog).toEqual({ kind: 'stillThere', until: 5_000 });
    state = reduce(state, { type: 'idle/keep' });
    expect(state.dialog).toBeNull();
  });

  it('drops unavailable lines when accepting a price change', () => {
    let state = ready();
    state = reduce(state, { type: 'start' });
    state = reduce(state, { type: 'tile', itemId: 'chips' });
    state = reduce(state, { type: 'tile', itemId: 'popcorn' });
    state = reduce(state, { type: 'sheet/add' });
    state = reduce(state, { type: 'review' });
    state = reduce(state, {
      type: 'pay/changed',
      changed: {
        error: 'order_changed',
        message: 'Prices or availability changed.',
        menuVersion: 'v2',
        totalCents: 250,
        lines: [
          {
            itemId: 'chips',
            name: 'Salted chips',
            choiceIds: [],
            optionLabels: [],
            qty: 1,
            unitPriceCents: 250,
            lineTotalCents: 250,
          },
        ],
        unavailableItemIds: ['popcorn'],
      },
    });
    state = reduce(state, { type: 'accept-price' });
    expect(state.lines.map((line) => line.itemId)).toEqual(['chips']);
  });

  it('caps line quantity and preserves cart on a stale menu', () => {
    let state = ready();
    state = reduce(state, { type: 'start' });
    state = reduce(state, { type: 'tile', itemId: 'chips' });
    const key = state.lines[0]?.key ?? '';
    for (let i = 0; i < 20; i += 1) state = reduce(state, { type: 'line/inc', key });
    expect(state.lines[0]?.qty).toBe(10);
    state = reduce(state, { type: 'menu/stale', menu: { ...menu, version: 'v2' } });
    expect(state.lines).toHaveLength(1);
    expect(state.apiDown).toBe(true);
    expect(state.menu?.version).toBe('v2');
  });
});
