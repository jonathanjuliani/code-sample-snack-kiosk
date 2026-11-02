import type { KioskPayPhase, KioskScreen, Menu, OrderChanged, PricedLine } from '@kiosk/shared';

export const TIMEOUTS = {
  idleMs: 60_000,
  stillThereMs: 10_000,
  doneResetMs: 8_000,
  paymentCheckLimitMs: 30_000,
  unresolvedResetMs: 60_000,
  menuBackoffMs: [800, 1600, 3200, 5000],
} as const;

export const ITEMS_PER_PAGE = 6;

export type Screen = KioskScreen;
export type PayPhase = KioskPayPhase;
export type PayMode = 'tap' | 'card';
export type MenuStatus = 'loading' | 'ready' | 'unavailable';

export type CartLine = {
  key: string;
  itemId: string;
  choiceIds: string[];
  optionLabels: string[];
  qty: number;
  unitPriceCents: number;
};

export type PriceChange = {
  oldTotalCents: number;
  newTotalCents: number;
  rows: { name: string; optionLabels: string[]; qty: number; wasCents: number; nowCents: number }[];
  unavailableItemIds: string[];
  pricedLines: PricedLine[];
  menuVersion: string;
};

export type KioskDialog =
  | null
  | { kind: 'assist' }
  | { kind: 'confirmStartOver' }
  | { kind: 'stillThere'; until: number };

export type KioskState = {
  screen: Screen;
  categoryId: string;
  page: number;
  lines: CartLine[];
  sheet: { itemId: string; choiceIds: string[]; qty: number } | null;
  assistActive: boolean;
  declineCount: number;
  dialog: KioskDialog;
  dockOpen: boolean;
  payMode: PayMode;
  cardDigits: string;
  payPhase: PayPhase;
  priceChange: PriceChange | null;
  pickupNumber: string | null;
  receipt: { method: 'card' | 'tap'; last4: string | null; totalCents: number } | null;
  unresolvedCode: string | null;
  lastAdded: string | null;
  menu: Menu | null;
  menuStatus: MenuStatus;
  apiDown: boolean;
  idempotencyKey: string | null;
};

export type Action =
  | { type: 'menu/loaded'; menu: Menu }
  | { type: 'menu/failed' }
  | { type: 'menu/stale'; menu: Menu }
  | { type: 'api/up' }
  | { type: 'api/down' }
  | { type: 'start' }
  | { type: 'tab'; categoryId: string }
  | { type: 'page'; delta: number }
  | { type: 'tile'; itemId: string }
  | { type: 'sheet/choose'; groupId: string; choiceId: string }
  | { type: 'sheet/qty'; delta: number }
  | { type: 'sheet/add' }
  | { type: 'sheet/close' }
  | { type: 'line/inc'; key: string }
  | { type: 'line/dec'; key: string }
  | { type: 'dock' }
  | { type: 'review' }
  | { type: 'edit-order' }
  | { type: 'accept-price' }
  | { type: 'pay/mode'; mode: PayMode }
  | { type: 'pay/digit'; digit: string }
  | { type: 'pay/delete' }
  | { type: 'pay/clear' }
  | { type: 'pay/lock'; key: string }
  | { type: 'pay/checking' }
  | {
      type: 'pay/paid';
      pickupNumber: string;
      method?: 'card' | 'tap';
      last4?: string | null;
      totalCents?: number;
    }
  | { type: 'pay/declined' }
  | { type: 'pay/changed'; changed: OrderChanged }
  | { type: 'pay/unresolved'; code: string }
  | { type: 'pay/retry' }
  | { type: 'pay/other-card' }
  | { type: 'assist/open' }
  | { type: 'assist/wait' }
  | { type: 'start-over/ask' }
  | { type: 'start-over/confirm' }
  | { type: 'start-over/cancel' }
  | { type: 'idle/prompt'; until: number }
  | { type: 'idle/keep' }
  | { type: 'restore'; lines: CartLine[]; key: string | null };

export function createInitialState(): KioskState {
  return {
    screen: 'start',
    categoryId: 'snacks',
    page: 0,
    lines: [],
    sheet: null,
    assistActive: false,
    declineCount: 0,
    dialog: null,
    dockOpen: false,
    payMode: 'tap',
    cardDigits: '',
    payPhase: 'idle',
    priceChange: null,
    pickupNumber: null,
    receipt: null,
    unresolvedCode: null,
    lastAdded: null,
    menu: null,
    menuStatus: 'loading',
    apiDown: false,
    idempotencyKey: null,
  };
}
