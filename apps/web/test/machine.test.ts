import { describe, expect, it } from 'vitest';
import {
  canPay,
  cartTotalCents,
  createInitialState,
  inPayment,
  type KioskState,
  reduce,
} from '../src/machine';

const menu = {
  version: 'v1',
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
});
