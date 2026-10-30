import {
  formatCents,
  MAX_QTY_PER_LINE,
  type Menu,
  type MenuItem,
  type OrderChanged,
  type PricedLine,
} from '@kiosk/shared';

export const TIMEOUTS = {
  idleMs: 60_000,
  stillThereMs: 10_000,
  doneResetMs: 8_000,
  paymentCheckLimitMs: 30_000,
  unresolvedResetMs: 60_000,
  menuBackoffMs: [800, 1600, 3200, 5000],
} as const;

export const ITEMS_PER_PAGE = 6;

export type Screen = 'start' | 'order' | 'checkout' | 'done';
export type PayPhase = 'idle' | 'processing' | 'checking' | 'declined' | 'totalChanged' | 'unresolved';
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

export type KioskState = {
  screen: Screen;
  categoryId: string;
  page: number;
  lines: CartLine[];
  sheet: { itemId: string; choiceIds: string[]; qty: number } | null;
  assistActive: boolean;
  assistDialog: boolean;
  declineCount: number;
  confirmStartOver: boolean;
  stillThereUntil: number | null;
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

export function lineKey(itemId: string, choiceIds: string[]): string {
  return `${itemId}:${[...choiceIds].sort().join('.')}`;
}

export function itemById(menu: Menu | null, id: string): MenuItem | undefined {
  return menu?.items.find((item) => item.id === id);
}

export function unitPriceCents(item: MenuItem, choiceIds: string[]): number {
  const chosen = new Set(choiceIds);
  let price = item.priceCents;
  for (const group of item.optionGroups) {
    const pick = group.choices.find((choice) => chosen.has(choice.id));
    if (pick) price += pick.deltaCents;
  }
  return price;
}

export function optionLabels(item: MenuItem, choiceIds: string[]): string[] {
  const skip = new Set(['None', 'Regular', 'Plain']);
  const chosen = new Set(choiceIds);
  return item.optionGroups.flatMap((group) => {
    const pick = group.choices.find((choice) => chosen.has(choice.id));
    if (!pick || skip.has(pick.label)) return [];
    return [pick.label];
  });
}

export function defaultChoices(item: MenuItem): string[] {
  return item.optionGroups.flatMap((group) => {
    const first = group.choices[0];
    return first ? [first.id] : [];
  });
}

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.qty, 0);
}

export function cartTotalCents(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.qty * line.unitPriceCents, 0);
}

export function qtyOfItem(lines: CartLine[], itemId: string): number {
  return lines.filter((line) => line.itemId === itemId).reduce((sum, line) => sum + line.qty, 0);
}

export function inPayment(phase: PayPhase): boolean {
  return phase === 'processing' || phase === 'checking' || phase === 'unresolved';
}

export function canPay(state: KioskState): boolean {
  if (state.apiDown || state.payPhase !== 'idle' || state.lines.length === 0) return false;
  if (state.payMode === 'card') return state.cardDigits.length === 16;
  return true;
}

export function idleLimitMs(state: KioskState, idleMs: number = TIMEOUTS.idleMs): number | null {
  if (state.assistActive || state.stillThereUntil || inPayment(state.payPhase)) return null;
  if (state.screen === 'order' || state.screen === 'checkout') return idleMs;
  return null;
}

function addLine(lines: CartLine[], next: Omit<CartLine, 'qty'> & { qty: number }): CartLine[] {
  const existing = lines.find((line) => line.key === next.key);
  if (!existing) return [...lines, next];
  return lines.map((line) =>
    line.key === next.key ? { ...line, qty: Math.min(MAX_QTY_PER_LINE, line.qty + next.qty) } : line,
  );
}

export function createInitialState(): KioskState {
  return {
    screen: 'start',
    categoryId: 'snacks',
    page: 0,
    lines: [],
    sheet: null,
    assistActive: false,
    assistDialog: false,
    declineCount: 0,
    confirmStartOver: false,
    stillThereUntil: null,
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

export function reduce(state: KioskState, action: Action): KioskState {
  switch (action.type) {
    case 'menu/loaded':
      return {
        ...state,
        menu: action.menu,
        menuStatus: 'ready',
        apiDown: false,
        categoryId: state.menu ? state.categoryId : (action.menu.categories[0]?.id ?? 'snacks'),
      };
    case 'menu/stale':
      return { ...state, menu: action.menu, menuStatus: 'ready', apiDown: true };
    case 'menu/failed':
      return { ...state, menuStatus: state.menu ? 'ready' : 'unavailable', apiDown: true };
    case 'api/up':
      return { ...state, apiDown: false };
    case 'api/down':
      return { ...state, apiDown: true };
    case 'start':
      return { ...state, screen: 'order', stillThereUntil: null };
    case 'tab':
      return { ...state, categoryId: action.categoryId, page: 0 };
    case 'page':
      return { ...state, page: Math.max(0, state.page + action.delta) };
    case 'tile': {
      const item = itemById(state.menu, action.itemId);
      if (!item?.available) return state;
      if (item.optionGroups.length > 0) {
        return { ...state, sheet: { itemId: item.id, choiceIds: defaultChoices(item), qty: 1 } };
      }
      const key = lineKey(item.id, []);
      return {
        ...state,
        lines: addLine(state.lines, {
          key,
          itemId: item.id,
          choiceIds: [],
          optionLabels: [],
          qty: 1,
          unitPriceCents: item.priceCents,
        }),
        lastAdded: key,
      };
    }
    case 'sheet/choose': {
      if (!state.sheet || !state.menu) return state;
      const item = itemById(state.menu, state.sheet.itemId);
      if (!item) return state;
      const group = item.optionGroups.find((g) => g.id === action.groupId);
      if (!group) return state;
      const withoutGroup = state.sheet.choiceIds.filter((id) => !group.choices.some((c) => c.id === id));
      return { ...state, sheet: { ...state.sheet, choiceIds: [...withoutGroup, action.choiceId] } };
    }
    case 'sheet/qty':
      if (!state.sheet) return state;
      return {
        ...state,
        sheet: {
          ...state.sheet,
          qty: Math.min(MAX_QTY_PER_LINE, Math.max(1, state.sheet.qty + action.delta)),
        },
      };
    case 'sheet/add': {
      if (!state.sheet || !state.menu) return state;
      const item = itemById(state.menu, state.sheet.itemId);
      if (!item) return state;
      const key = lineKey(item.id, state.sheet.choiceIds);
      return {
        ...state,
        sheet: null,
        lastAdded: key,
        lines: addLine(state.lines, {
          key,
          itemId: item.id,
          choiceIds: state.sheet.choiceIds,
          optionLabels: optionLabels(item, state.sheet.choiceIds),
          qty: state.sheet.qty,
          unitPriceCents: unitPriceCents(item, state.sheet.choiceIds),
        }),
      };
    }
    case 'sheet/close':
      return { ...state, sheet: null };
    case 'line/inc':
      return {
        ...state,
        lastAdded: null,
        lines: state.lines.map((line) =>
          line.key === action.key ? { ...line, qty: Math.min(MAX_QTY_PER_LINE, line.qty + 1) } : line,
        ),
      };
    case 'line/dec':
      return {
        ...state,
        lastAdded: null,
        lines: state.lines.flatMap((line) => {
          if (line.key !== action.key) return [line];
          if (line.qty <= 1) return [];
          return [{ ...line, qty: line.qty - 1 }];
        }),
      };
    case 'dock':
      return { ...state, dockOpen: !state.dockOpen };
    case 'review':
      if (state.lines.length === 0) return state;
      return {
        ...state,
        screen: 'checkout',
        payMode: 'tap',
        cardDigits: '',
        payPhase: 'idle',
        priceChange: null,
        stillThereUntil: null,
      };
    case 'edit-order':
      return { ...state, screen: 'order', payPhase: 'idle', priceChange: null };
    case 'accept-price': {
      if (!state.priceChange || !state.menu) return state;
      const priced = state.priceChange.pricedLines;
      const unavailable = new Set(state.priceChange.unavailableItemIds);
      const next = state.lines.flatMap((line) => {
        if (unavailable.has(line.itemId)) return [];
        const match = priced.find((p) => lineKey(p.itemId, p.choiceIds) === line.key);
        return [{ ...line, unitPriceCents: match?.unitPriceCents ?? line.unitPriceCents }];
      });
      return {
        ...state,
        lines: next,
        payPhase: 'idle',
        priceChange: null,
        lastAdded: null,
        menu: { ...state.menu, version: state.priceChange.menuVersion },
      };
    }
    case 'pay/mode':
      return { ...state, payMode: action.mode, cardDigits: '' };
    case 'pay/digit':
      if (state.cardDigits.length >= 16) return state;
      return { ...state, cardDigits: state.cardDigits + action.digit };
    case 'pay/delete':
      return { ...state, cardDigits: state.cardDigits.slice(0, -1) };
    case 'pay/clear':
      return { ...state, cardDigits: '' };
    case 'pay/lock':
      return { ...state, payPhase: 'processing', idempotencyKey: action.key, stillThereUntil: null };
    case 'pay/checking':
      return { ...state, payPhase: 'checking' };
    case 'pay/paid':
      return {
        ...state,
        screen: 'done',
        payPhase: 'idle',
        pickupNumber: action.pickupNumber,
        cardDigits: '',
        idempotencyKey: null,
        declineCount: 0,
        assistDialog: false,
        assistActive: false,
        receipt: {
          method: action.method ?? 'tap',
          last4: action.last4 ?? null,
          totalCents: action.totalCents ?? cartTotalCents(state.lines),
        },
      };
    case 'pay/declined':
      return { ...state, payPhase: 'declined', declineCount: state.declineCount + 1, cardDigits: '' };
    case 'pay/changed': {
      const oldTotalCents = cartTotalCents(state.lines);
      const rows = action.changed.lines
        .map((priced) => {
          const key = lineKey(priced.itemId, priced.choiceIds);
          const previous = state.lines.find((line) => line.key === key);
          if (!previous || previous.unitPriceCents === priced.unitPriceCents) return null;
          return {
            name: priced.name,
            optionLabels: priced.optionLabels,
            qty: priced.qty,
            wasCents: previous.unitPriceCents,
            nowCents: priced.unitPriceCents,
          };
        })
        .filter((row) => row !== null);
      return {
        ...state,
        payPhase: 'totalChanged',
        priceChange: {
          oldTotalCents,
          newTotalCents: action.changed.totalCents,
          rows,
          unavailableItemIds: action.changed.unavailableItemIds,
          pricedLines: action.changed.lines,
          menuVersion: action.changed.menuVersion,
        },
        menu: state.menu ? { ...state.menu, version: action.changed.menuVersion } : state.menu,
      };
    }
    case 'pay/unresolved':
      return { ...state, payPhase: 'unresolved', unresolvedCode: action.code };
    case 'pay/retry':
      return {
        ...state,
        cardDigits: '',
        payPhase: 'idle',
        priceChange: null,
        idempotencyKey: null,
      };
    case 'pay/other-card':
      return {
        ...state,
        payMode: 'card',
        cardDigits: '',
        payPhase: 'idle',
        priceChange: null,
        idempotencyKey: null,
      };
    case 'assist/open':
      return { ...state, assistActive: true, assistDialog: true, stillThereUntil: null };
    case 'assist/wait':
      return { ...state, assistDialog: false };
    case 'start-over/ask':
      if (inPayment(state.payPhase)) return state;
      if (state.lines.length === 0) return createInitialStateFrom(state);
      return { ...state, confirmStartOver: true };
    case 'start-over/confirm':
      return createInitialStateFrom(state);
    case 'start-over/cancel':
      return { ...state, confirmStartOver: false };
    case 'idle/prompt':
      if (inPayment(state.payPhase) || state.assistActive) return state;
      return {
        ...state,
        stillThereUntil: action.until,
        sheet: null,
        assistDialog: false,
        confirmStartOver: false,
      };
    case 'idle/keep':
      return { ...state, stillThereUntil: null };
    case 'restore':
      return {
        ...state,
        lines: action.lines,
        idempotencyKey: action.key,
        screen: action.key ? 'checkout' : state.screen,
        payPhase: action.key ? 'checking' : state.payPhase,
      };
    default:
      return state;
  }
}

function createInitialStateFrom(state: KioskState): KioskState {
  return {
    ...createInitialState(),
    menu: state.menu,
    menuStatus: state.menuStatus,
    apiDown: state.apiDown,
    categoryId: state.menu?.categories[0]?.id ?? 'snacks',
  };
}

export function money(cents: number): string {
  return formatCents(cents);
}
