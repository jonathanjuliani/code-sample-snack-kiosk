import { CARD_NUMBER_DIGITS, type Menu, menuSchema, type OrderRequest } from '@kiosk/shared';
import { type Dispatch, type ReactNode, useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  fetchHealth,
  fetchMenu,
  lookupAttempt,
  postAssist,
  postOpsEvent,
  type SubmitResult,
  submitOrder,
} from './api';
import { applyVenueAccent } from './contrast';
import { DeleteIcon, ErrorIcon, HandIcon, OkIcon, ReaderIcon, WarnIcon } from './icons';
import {
  type Action,
  canPay,
  cartCount,
  cartTotalCents,
  createInitialState,
  idleLimitMs,
  inPayment,
  itemById,
  type KioskState,
  money,
  qtyOfItem,
  reduce,
  TIMEOUTS,
  unitPriceCents,
} from './machine';
import { OpsPage } from './ops';
import {
  cacheMenu,
  clearAttempt,
  clearCart,
  loadAttempt,
  loadCachedMenu,
  loadCart,
  readIdleMs,
  readKioskId,
  saveAttempt,
  saveCart,
} from './storage';
import { APP_VERSION } from './version';
import './styles/kiosk.css';

const kioskId = typeof window === 'undefined' ? 'counter-1' : readKioskId();
const idleMs = typeof window === 'undefined' ? TIMEOUTS.idleMs : readIdleMs(TIMEOUTS.idleMs);
const showingOps = typeof window !== 'undefined' && window.location.pathname === '/ops';
if (showingOps) document.documentElement.dataset.surface = 'ops';

export function App() {
  if (showingOps) return <OpsPage />;
  return <Kiosk />;
}

function Kiosk() {
  const [state, dispatch] = useReducer(reduce, undefined, createInitialState);
  const [now, setNow] = useState(() => Date.now());
  const [menuSlow, setMenuSlow] = useState(false);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [payArmed, setPayArmed] = useState(false);
  const lastActivity = useRef(Date.now());
  const payLock = useRef(false);
  const checkingSince = useRef<number | null>(null);
  const idleReported = useRef(false);
  const assistSent = useRef(false);
  const doneUntil = useRef<number | null>(null);
  const reloadMenu = useRef<() => void>(() => {});
  const stateRef = useRef(state);
  stateRef.current = state;

  const bumpActivity = useCallback(() => {
    lastActivity.current = Date.now();
  }, []);

  useEffect(() => {
    const cached = loadCachedMenu();
    const parsed = cached ? menuSchema.safeParse(cached) : null;
    if (parsed?.success) {
      applyVenueAccent(parsed.data.venue.accent);
      dispatch({ type: 'menu/stale', menu: parsed.data });
    }

    const attempt = loadAttempt();
    const cart = loadCart();
    if (attempt || cart.length > 0) {
      dispatch({ type: 'restore', lines: cart, key: attempt?.idempotencyKey ?? null });
    }

    let cancelled = false;
    let attemptNo = 0;
    let timer = 0;
    const slowTimer = window.setTimeout(() => {
      if (!cancelled) setMenuSlow(true);
    }, 1500);

    const load = async () => {
      window.clearTimeout(timer);
      try {
        const menu = await fetchMenu();
        if (cancelled) return;
        cacheMenu(menu);
        applyVenueAccent(menu.venue.accent);
        setRetryAt(null);
        setMenuSlow(false);
        dispatch({ type: 'menu/loaded', menu });
        attemptNo = 0;
      } catch {
        if (cancelled) return;
        dispatch({ type: 'menu/failed' });
        const wait = TIMEOUTS.menuBackoffMs[Math.min(attemptNo, TIMEOUTS.menuBackoffMs.length - 1)] ?? 5000;
        attemptNo += 1;
        setRetryAt(Date.now() + wait);
        timer = window.setTimeout(() => {
          if (!cancelled) void load();
        }, wait);
      }
    };

    reloadMenu.current = () => {
      attemptNo = 0;
      void load();
    };
    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(slowTimer);
    };
  }, []);

  useEffect(() => {
    const send = () => {
      const current = stateRef.current;
      void postOpsEvent({
        kioskId,
        kind: 'heartbeat',
        appVersion: APP_VERSION,
        screen: current.screen,
        payPhase: current.payPhase,
        itemCount: cartCount(current.lines),
        totalCents: cartTotalCents(current.lines),
      });
    };
    send();
    const id = window.setInterval(send, 30_000);
    return () => window.clearInterval(id);
  }, [state.screen, state.payPhase, state.lines]);

  useEffect(() => {
    if (!state.menu) return;
    let cancelled = false;
    const tick = async () => {
      const health = await fetchHealth();
      if (cancelled) return;
      if (health === 'up' && stateRef.current.apiDown) {
        dispatch({ type: 'api/up' });
        try {
          const menu = await fetchMenu();
          if (cancelled) return;
          cacheMenu(menu);
          applyVenueAccent(menu.venue.accent);
          dispatch({ type: 'menu/loaded', menu });
        } catch {
          if (!cancelled) dispatch({ type: 'menu/failed' });
        }
        return;
      }
      if (health !== 'up' && !stateRef.current.apiDown) dispatch({ type: 'api/down' });
    };
    void tick();
    const id = window.setInterval(() => void tick(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [state.menu]);

  useEffect(() => {
    if (state.screen === 'done' || state.lines.length === 0) {
      if (state.screen === 'done') {
        clearCart();
        clearAttempt();
      }
      return;
    }
    saveCart(state.lines);
  }, [state.lines, state.screen]);

  useEffect(() => {
    if (!state.assistActive) assistSent.current = false;
  }, [state.assistActive]);

  useEffect(() => {
    const onPointer = () => bumpActivity();
    window.addEventListener('pointerdown', onPointer, true);
    return () => window.removeEventListener('pointerdown', onPointer, true);
  }, [bumpActivity]);

  useEffect(() => {
    lastActivity.current = Date.now();
  }, [state.screen, state.payPhase]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const resetFromIdle = useCallback(() => {
    if (idleReported.current) return;
    idleReported.current = true;
    dispatch({ type: 'start-over/confirm' });
    clearCart();
    clearAttempt();
    payLock.current = false;
    void postOpsEvent({ kioskId, kind: 'idle_reset' });
  }, []);

  useEffect(() => {
    if (state.stillThereUntil === null) idleReported.current = false;
  }, [state.stillThereUntil]);

  useEffect(() => {
    if (state.stillThereUntil && now >= state.stillThereUntil) {
      resetFromIdle();
      return;
    }
    const limit = idleLimitMs(state, idleMs);
    if (limit && !state.stillThereUntil && now - lastActivity.current > limit) {
      dispatch({ type: 'idle/prompt', until: now + TIMEOUTS.stillThereMs });
    }
  }, [now, state, resetFromIdle]);

  useEffect(() => {
    if (state.screen !== 'done' || !state.pickupNumber) return;
    const t = window.setTimeout(() => {
      dispatch({ type: 'start-over/confirm' });
      payLock.current = false;
    }, TIMEOUTS.doneResetMs);
    return () => window.clearTimeout(t);
  }, [state.screen, state.pickupNumber]);

  useEffect(() => {
    if (state.payPhase !== 'unresolved') return;
    const t = window.setTimeout(() => {
      dispatch({ type: 'start-over/confirm' });
      clearCart();
      clearAttempt();
      payLock.current = false;
    }, TIMEOUTS.unresolvedResetMs);
    return () => window.clearTimeout(t);
  }, [state.payPhase]);

  const applyResult = useCallback((result: SubmitResult, key: string) => {
    if (result.kind === 'paid') {
      payLock.current = false;
      checkingSince.current = null;
      clearAttempt();
      dispatch({
        type: 'pay/paid',
        pickupNumber: result.order.pickupNumber,
        method: result.order.paymentMethod,
        last4: result.order.last4,
        totalCents: result.order.totalCents,
      });
      return;
    }
    if (result.kind === 'declined') {
      payLock.current = false;
      checkingSince.current = null;
      clearAttempt();
      dispatch({ type: 'pay/declined' });
      return;
    }
    if (result.kind === 'changed') {
      payLock.current = false;
      checkingSince.current = null;
      clearAttempt();
      dispatch({ type: 'pay/changed', changed: result.body });
      return;
    }
    if (result.kind === 'pending' || result.kind === 'network' || result.kind === 'unavailable') {
      dispatch({ type: 'pay/checking' });
      if (result.kind === 'unavailable') dispatch({ type: 'api/down' });
      checkingSince.current ??= Date.now();
      saveAttempt({ idempotencyKey: key, kioskId });
      return;
    }
    payLock.current = false;
    checkingSince.current = null;
    clearAttempt();
    dispatch({ type: 'pay/retry' });
  }, []);

  const buildRequest = useCallback((): OrderRequest | null => {
    const current = stateRef.current;
    if (!current.menu) return null;
    return {
      kioskId,
      menuVersion: current.menu.version,
      lines: current.lines.map((line) => ({
        itemId: line.itemId,
        qty: line.qty,
        choiceIds: line.choiceIds,
      })),
      payment:
        current.payMode === 'card' ? { method: 'card', cardNumber: current.cardDigits } : { method: 'tap' },
      clientTotalCents: cartTotalCents(current.lines),
    };
  }, []);

  const pay = useCallback(async () => {
    const current = stateRef.current;
    if (payLock.current || !canPay(current)) return;
    const body = buildRequest();
    if (!body) return;
    const key = current.idempotencyKey ?? crypto.randomUUID();
    payLock.current = true;
    dispatch({ type: 'pay/lock', key });
    saveAttempt({ idempotencyKey: key, kioskId });
    saveCart(current.lines);
    const result = await submitOrder(key, body);
    applyResult(result, key);
  }, [applyResult, buildRequest]);

  useEffect(() => {
    if (!payArmed) return;
    setPayArmed(false);
    void pay();
  }, [payArmed, pay]);

  useEffect(() => {
    if (state.payPhase !== 'checking' || !state.idempotencyKey) return;
    let cancelled = false;
    const key = state.idempotencyKey;
    const poll = async () => {
      if (cancelled) return;
      if (checkingSince.current && Date.now() - checkingSince.current > TIMEOUTS.paymentCheckLimitMs) {
        dispatch({ type: 'pay/unresolved', code: `K${key.slice(0, 4).toUpperCase()}` });
        payLock.current = false;
        return;
      }
      try {
        const found = await lookupAttempt(key);
        if (cancelled) return;
        if (found?.status === 'paid') {
          applyResult({ kind: 'paid', order: found }, key);
          return;
        }
        if (found?.status === 'payment_failed') {
          applyResult({ kind: 'declined', order: found }, key);
          return;
        }
        if (!found) {
          const body = buildRequest();
          if (body?.payment.method === 'card' && body.payment.cardNumber.length === CARD_NUMBER_DIGITS) {
            const result = await submitOrder(key, body);
            if (!cancelled) applyResult(result, key);
            return;
          }
          if (body?.payment.method === 'tap') {
            const result = await submitOrder(key, body);
            if (!cancelled) applyResult(result, key);
            return;
          }
        }
      } catch {
        dispatch({ type: 'api/down' });
      }
      window.setTimeout(() => {
        void poll();
      }, 1500);
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [state.payPhase, state.idempotencyKey, applyResult, buildRequest]);

  const requestAssist = useCallback(() => {
    dispatch({ type: 'assist/open' });
    if (assistSent.current) return;
    assistSent.current = true;
    void postAssist(kioskId);
  }, []);

  const startOver = useCallback(() => {
    dispatch({ type: 'start-over/confirm' });
    clearCart();
    clearAttempt();
    payLock.current = false;
  }, []);

  const retryPayments = useCallback(async () => {
    if ((await fetchHealth()) === 'up') {
      dispatch({ type: 'api/up' });
      try {
        const menu = await fetchMenu();
        cacheMenu(menu);
        applyVenueAccent(menu.venue.accent);
        dispatch({ type: 'menu/loaded', menu });
      } catch {
        dispatch({ type: 'menu/failed' });
      }
    }
  }, []);

  if (state.screen === 'done' && doneUntil.current === null) {
    doneUntil.current = Date.now() + TIMEOUTS.doneResetMs;
  }
  if (state.screen !== 'done') doneUntil.current = null;

  const stillSeconds = state.stillThereUntil
    ? Math.max(0, Math.ceil((state.stillThereUntil - now) / 1000))
    : 0;
  const doneSeconds = doneUntil.current ? Math.max(0, Math.ceil((doneUntil.current - now) / 1000)) : 0;
  const retrySeconds = retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0;
  const venueName = state.menu?.venue.name ?? 'Snack Bar';
  const showShell = state.screen === 'order' || state.screen === 'checkout';
  const paymentsDown = state.screen === 'checkout' && state.apiDown && state.payPhase === 'idle';

  return (
    <div className="kiosk">
      {state.screen === 'start' ? (
        <Attract name={venueName} onStart={() => dispatch({ type: 'start' })} />
      ) : null}
      {state.screen === 'done' ? (
        <DoneScreen
          state={state}
          seconds={doneSeconds}
          onDone={() => {
            dispatch({ type: 'start-over/confirm' });
            payLock.current = false;
          }}
        />
      ) : null}
      {showShell ? (
        <Shell
          state={state}
          dispatch={dispatch}
          venueName={venueName}
          menuSlow={menuSlow}
          retrySeconds={retrySeconds}
          onRetryMenu={() => reloadMenu.current()}
          onAssist={requestAssist}
          onPrimary={() => {
            if (state.screen === 'order') dispatch({ type: 'review' });
            else void pay();
          }}
          onStartOver={() => dispatch({ type: 'start-over/ask' })}
        />
      ) : null}
      {state.sheet ? <OptionSheet state={state} dispatch={dispatch} /> : null}
      {state.payPhase === 'processing' || state.payPhase === 'checking' ? (
        <StatusDialog phase={state.payPhase} />
      ) : null}
      {state.payPhase === 'declined' ? (
        <DeclinedDialog
          second={state.declineCount >= 2}
          onRetry={() => dispatch({ type: 'pay/retry' })}
          onOther={() => dispatch({ type: 'pay/other-card' })}
          onAssist={requestAssist}
        />
      ) : null}
      {state.payPhase === 'totalChanged' && state.priceChange ? (
        <TotalDialog
          state={state}
          onPay={() => {
            dispatch({ type: 'accept-price' });
            setPayArmed(true);
          }}
          onEdit={() => dispatch({ type: 'edit-order' })}
        />
      ) : null}
      {paymentsDown ? (
        <PaymentsDownDialog onRetry={() => void retryPayments()} onStartOver={startOver} />
      ) : null}
      {state.payPhase === 'unresolved' ? (
        <UnresolvedDialog code={state.unresolvedCode ?? ''} onDone={startOver} />
      ) : null}
      {state.assistDialog ? <AssistDialog onWait={() => dispatch({ type: 'assist/wait' })} /> : null}
      {state.confirmStartOver ? (
        <ConfirmStartOver onYes={startOver} onNo={() => dispatch({ type: 'start-over/cancel' })} />
      ) : null}
      {state.stillThereUntil ? (
        <StillThere
          seconds={stillSeconds}
          onKeep={() => dispatch({ type: 'idle/keep' })}
          onReset={resetFromIdle}
        />
      ) : null}
    </div>
  );
}

function Attract({ name, onStart }: { name: string; onStart: () => void }) {
  return (
    <button type="button" className="attract" onClick={onStart}>
      <p className="brand">{name}</p>
      <h1>Order here.</h1>
      <p className="sub">Pick, pay, and grab it at the counter.</p>
      <span className="pill">
        <HandIcon /> Tap to start
      </span>
    </button>
  );
}

function Shell({
  state,
  dispatch,
  venueName,
  menuSlow,
  retrySeconds,
  onRetryMenu,
  onAssist,
  onPrimary,
  onStartOver,
}: {
  state: KioskState;
  dispatch: Dispatch<Action>;
  venueName: string;
  menuSlow: boolean;
  retrySeconds: number;
  onRetryMenu: () => void;
  onAssist: () => void;
  onPrimary: () => void;
  onStartOver: () => void;
}) {
  const categories = visibleCategories(state.menu);
  const category = categories.find((item) => item.id === state.categoryId) ?? categories[0];
  const items = state.menu?.items.filter((item) => item.categoryId === category?.id) ?? [];
  const locked = inPayment(state.payPhase);
  const total = cartTotalCents(state.lines);
  const count = cartCount(state.lines);
  const busy = state.payPhase === 'processing' || state.payPhase === 'checking';
  const label = primaryLabel(state);
  const disabled =
    state.apiDown || busy || (state.screen === 'order' ? count === 0 || !state.menu : !canPay(state));

  return (
    <div className="shell">
      <aside className="rail">
        <p className="rail-brand">{venueName}</p>
        <div className="cats">
          {categories.map((item) => (
            <button
              key={item.id}
              type="button"
              className="cat"
              aria-pressed={item.id === category?.id}
              onClick={() => dispatch({ type: 'tab', categoryId: item.id })}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="rail-spacer" />
        {locked ? null : (
          <button type="button" className="start-over" onClick={onStartOver}>
            Start over
          </button>
        )}
      </aside>
      <div className="main">
        <button type="button" className="assist" onClick={onAssist}>
          Staff assist
        </button>
        {state.apiDown && state.menu ? (
          <div className="banner" role="status">
            <WarnIcon size={28} />
            <span>We can't take payments right now. You can keep browsing.</span>
          </div>
        ) : null}
        {state.screen === 'order' ? (
          <>
            <div className="main-head">
              <h1>{category?.label ?? 'Menu'}</h1>
              {menuSlow && state.menuStatus === 'loading' ? <p className="hint">Loading the menu…</p> : null}
            </div>
            {state.menuStatus === 'unavailable' && !state.menu ? (
              <div className="menu-fail" role="status">
                <WarnIcon />
                <h2>We're having trouble loading the menu</h2>
                <p>{retrySeconds > 0 ? `Trying again in ${retrySeconds}s…` : 'Trying again…'}</p>
                <button type="button" className="try-now" onClick={onRetryMenu}>
                  Try now
                </button>
              </div>
            ) : null}
            {state.menuStatus === 'loading' && !state.menu ? (
              <div className="grid" aria-hidden="true">
                {['a', 'b', 'c', 'd', 'e', 'f'].map((key) => (
                  <div className="skeleton" key={key}>
                    <div className="sk-tile" />
                    <div className="sk-bar" />
                    <div className="sk-bar short" />
                  </div>
                ))}
              </div>
            ) : null}
            {state.menu ? (
              <div className="grid">
                {items.map((item) => {
                  const qty = qtyOfItem(state.lines, item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="item"
                      disabled={!item.available}
                      onClick={() => dispatch({ type: 'tile', itemId: item.id })}
                    >
                      <span className={`tile tile-${tileIndex(item.id)}`}>
                        {monogram(item.name)}
                        {!item.available ? <span className="sold">Sold out</span> : null}
                        {qty > 0 ? (
                          <span className="badge bump num" key={qty}>
                            ×{qty}
                          </span>
                        ) : null}
                      </span>
                      <span className="item-body">
                        <span className="item-name">{item.name}</span>
                        {item.description ? <span className="item-desc">{item.description}</span> : null}
                        <span className="item-row">
                          <span className="price num">{money(item.priceCents)}</span>
                          <span className="plus" aria-hidden="true">
                            +
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </>
        ) : (
          <PayMain state={state} dispatch={dispatch} locked={locked} />
        )}
      </div>
      <aside className="cart" aria-label="Your order">
        <div className="cart-head">
          <h2>Your order</h2>
          <span className="num">{count === 1 ? '1 item' : `${count} items`}</span>
        </div>
        {count === 0 ? <p className="empty">Tap anything on the menu to add it here.</p> : null}
        <div className="lines">
          {state.lines.map((line) => {
            const item = itemById(state.menu, line.itemId);
            return (
              <div className={line.key === state.lastAdded ? 'line in' : 'line'} key={line.key}>
                <div className="line-name">{item?.name ?? 'Item'}</div>
                <div className="num">{money(line.qty * line.unitPriceCents)}</div>
                {line.optionLabels.length > 0 ? (
                  <div className="line-opt">{line.optionLabels.join(', ')}</div>
                ) : null}
                {state.screen === 'order' && !locked ? (
                  <div className="stepper">
                    <button
                      type="button"
                      aria-label="One less"
                      onClick={() => dispatch({ type: 'line/dec', key: line.key })}
                    >
                      −
                    </button>
                    <span className="q num">{line.qty}</span>
                    <button
                      type="button"
                      aria-label="One more"
                      disabled={line.qty >= 10}
                      onClick={() => dispatch({ type: 'line/inc', key: line.key })}
                    >
                      +
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="foot">
          <div className="totalrow">
            <span>Total</span>
            <span className="num" role="status" aria-live="polite" aria-atomic="true">
              {money(total)}
            </span>
          </div>
          <button type="button" className="primary" disabled={disabled} aria-busy={busy} onClick={onPrimary}>
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            {label}
          </button>
        </div>
      </aside>
    </div>
  );
}

function PayMain({
  state,
  dispatch,
  locked,
}: {
  state: KioskState;
  dispatch: Dispatch<Action>;
  locked: boolean;
}) {
  const digits = state.cardDigits;
  return (
    <>
      <button
        type="button"
        className="back"
        disabled={locked}
        onClick={() => dispatch({ type: 'edit-order' })}
      >
        Add more
      </button>
      <div className="main-head">
        <h1>How would you like to pay?</h1>
      </div>
      <div className="pay-choices">
        <button
          type="button"
          className="choice"
          aria-pressed={state.payMode === 'tap'}
          disabled={locked}
          onClick={() => dispatch({ type: 'pay/mode', mode: 'tap' })}
        >
          Tap card or phone
        </button>
        <button
          type="button"
          className="choice"
          aria-pressed={state.payMode === 'card'}
          disabled={locked}
          onClick={() => dispatch({ type: 'pay/mode', mode: 'card' })}
        >
          Enter card number
        </button>
      </div>
      {state.payMode === 'tap' ? (
        <div className="tap-panel">
          <ReaderIcon />
          <h2>Ready when you are</h2>
          <p>
            Press Pay, then follow the card reader below the screen. If you insert a card, keep it in until
            this screen says you're done.
          </p>
        </div>
      ) : (
        <>
          <div className="card-mask num" role="status" aria-live="polite" aria-atomic="true">
            {maskDigits(digits)}
          </div>
          <p className="digits">Digits {digits.length} of 16</p>
          <div className="numpad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button
                key={digit}
                type="button"
                className="num"
                disabled={locked || digits.length >= 16}
                onClick={() => dispatch({ type: 'pay/digit', digit })}
              >
                {digit}
              </button>
            ))}
            <button
              type="button"
              className="texty"
              disabled={locked}
              onClick={() => dispatch({ type: 'pay/clear' })}
            >
              Clear
            </button>
            <button
              type="button"
              className="num"
              disabled={locked || digits.length >= 16}
              onClick={() => dispatch({ type: 'pay/digit', digit: '0' })}
            >
              0
            </button>
            <button
              type="button"
              aria-label="Delete last digit"
              disabled={locked}
              onClick={() => dispatch({ type: 'pay/delete' })}
            >
              <DeleteIcon />
            </button>
          </div>
        </>
      )}
    </>
  );
}

function OptionSheet({ state, dispatch }: { state: KioskState; dispatch: Dispatch<Action> }) {
  const sheet = state.sheet;
  if (!sheet) return null;
  const item = itemById(state.menu, sheet.itemId);
  if (!item) return null;
  const price = unitPriceCents(item, sheet.choiceIds) * sheet.qty;
  return (
    <div className="scrim">
      <div className="sheet" role="dialog" aria-label={item.name}>
        <div className="top">
          <div>
            <h2>{item.name}</h2>
            <div className="num">{money(item.priceCents)}</div>
          </div>
          <button type="button" className="secondary" onClick={() => dispatch({ type: 'sheet/close' })}>
            Cancel
          </button>
        </div>
        {item.optionGroups.map((group) => (
          <div className="group" key={group.id}>
            <div className="gl">{group.name}</div>
            {group.choices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                className="opt"
                aria-pressed={sheet.choiceIds.includes(choice.id)}
                onClick={() => dispatch({ type: 'sheet/choose', groupId: group.id, choiceId: choice.id })}
              >
                <span>{choice.label}</span>
                <span className="num">{choice.deltaCents ? `+${money(choice.deltaCents)}` : ''}</span>
              </button>
            ))}
          </div>
        ))}
        <div className="bottom">
          <div className="stepper">
            <button
              type="button"
              aria-label="One less"
              disabled={sheet.qty <= 1}
              onClick={() => dispatch({ type: 'sheet/qty', delta: -1 })}
            >
              −
            </button>
            <span className="q num">{sheet.qty}</span>
            <button
              type="button"
              aria-label="One more"
              disabled={sheet.qty >= 10}
              onClick={() => dispatch({ type: 'sheet/qty', delta: 1 })}
            >
              +
            </button>
          </div>
          <button type="button" className="primary" onClick={() => dispatch({ type: 'sheet/add' })}>
            Add · <span className="num">{money(price)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusDialog({ phase }: { phase: 'processing' | 'checking' }) {
  return (
    <div className="scrim">
      <div className="dialog" role="status">
        <span className="spinner wait" aria-hidden="true" />
        <h2>{phase === 'checking' ? 'Checking your payment…' : 'Processing payment…'}</h2>
        <p>Please don't pay again. This takes a few seconds.</p>
      </div>
    </div>
  );
}

function DeclinedDialog({
  second,
  onRetry,
  onOther,
  onAssist,
}: {
  second: boolean;
  onRetry: () => void;
  onOther: () => void;
  onAssist: () => void;
}) {
  return (
    <Dialog
      tone="err"
      title="Payment declined"
      primary="Try again"
      onPrimary={onRetry}
      secondary={second ? 'Get staff help' : 'Use another card'}
      onSecondary={second ? onAssist : onOther}
    >
      <p>Your card was not charged. Your order is saved, so you can try again or use another card.</p>
    </Dialog>
  );
}

function TotalDialog({ state, onPay, onEdit }: { state: KioskState; onPay: () => void; onEdit: () => void }) {
  const change = state.priceChange;
  if (!change) return null;
  return (
    <Dialog
      tone="warn"
      title="Your total changed"
      primary="Pay new total"
      onPrimary={onPay}
      secondary="Edit order"
      onSecondary={onEdit}
    >
      <p>A price changed since you started. Nothing has been charged yet. Please check the new total.</p>
      <table className="changes">
        <tbody>
          {change.rows.map((row) => (
            <tr key={`${row.name}-${row.wasCents}`}>
              <td>
                {row.qty} × {row.name}
              </td>
              <td className="r num old">{money(row.wasCents * row.qty)}</td>
              <td className="r num">{money(row.nowCents * row.qty)}</td>
            </tr>
          ))}
          {change.unavailableItemIds.map((id) => (
            <tr key={id}>
              <td colSpan={3}>{itemById(state.menu, id)?.name ?? 'An item'} is sold out</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="new-total">
        <span>New total</span>
        <span className="num">{money(change.newTotalCents)}</span>
      </div>
    </Dialog>
  );
}

function PaymentsDownDialog({ onRetry, onStartOver }: { onRetry: () => void; onStartOver: () => void }) {
  return (
    <Dialog
      tone="warn"
      title="We can't take payments right now"
      primary="Try again"
      onPrimary={onRetry}
      secondary="Start over"
      onSecondary={onStartOver}
    >
      <p>Your order is still here. Please try again in a moment.</p>
    </Dialog>
  );
}

function UnresolvedDialog({ code, onDone }: { code: string; onDone: () => void }) {
  return (
    <Dialog
      tone="warn"
      title="We couldn't confirm your payment"
      primary="Start a new order"
      onPrimary={onDone}
    >
      <p>
        You have not been asked to pay twice. If your card was charged, show this code at the counter and
        we'll sort it out.
      </p>
      <div className="code num">{code}</div>
    </Dialog>
  );
}

function AssistDialog({ onWait }: { onWait: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="scrim">
      <div className="dialog" role="dialog" aria-labelledby="assist-title">
        <h2 id="assist-title">Help is on the way</h2>
        <p>A team member has been notified and will come to this screen. Your order is saved.</p>
        <div className="actions">
          <button ref={ref} type="button" className="primary" onClick={onWait}>
            OK, I'll wait
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmStartOver({ onYes, onNo }: { onYes: () => void; onNo: () => void }) {
  return (
    <Dialog
      tone="warn"
      title="Start over?"
      primary="Keep ordering"
      onPrimary={onNo}
      secondary="Start over"
      onSecondary={onYes}
    >
      <p>Your order will be cleared.</p>
    </Dialog>
  );
}

function StillThere({
  seconds,
  onKeep,
  onReset,
}: {
  seconds: number;
  onKeep: () => void;
  onReset: () => void;
}) {
  return (
    <div className="scrim idle">
      <div className="dialog" role="alertdialog" aria-labelledby="idle-title">
        <div className="ring" style={{ ['--p' as string]: String(seconds / 10) }}>
          <span className="num" aria-live="polite">
            {seconds}
          </span>
        </div>
        <h2 id="idle-title">Are you still there?</h2>
        <p>We'll clear this order for the next person if nobody taps.</p>
        <div className="actions">
          <button type="button" className="secondary" onClick={onReset}>
            Start over
          </button>
          <FocusPrimary label="I'm still here" onClick={onKeep} />
        </div>
      </div>
    </div>
  );
}

function DoneScreen({ state, seconds, onDone }: { state: KioskState; seconds: number; onDone: () => void }) {
  const receipt = state.receipt;
  const detail =
    receipt?.method === 'card' && receipt.last4
      ? `Card ending ${receipt.last4} · ${money(receipt.totalCents)}`
      : `Paid by tap · ${money(receipt?.totalCents ?? 0)}`;
  return (
    <div className="done" role="status">
      <div className="check">
        <OkIcon size={48} />
      </div>
      <h1>Paid. Your order number is</h1>
      <p className="ordno num">{state.pickupNumber}</p>
      <p className="sub">We'll call it at the counter. {detail}</p>
      <button type="button" className="secondary" onClick={onDone}>
        <span className="num" aria-live="polite">
          Done · next order in {seconds}s
        </span>
      </button>
    </div>
  );
}

function Dialog({
  tone,
  title,
  primary,
  onPrimary,
  secondary,
  onSecondary,
  children,
}: {
  tone: 'warn' | 'err';
  title: string;
  primary: string;
  onPrimary: () => void;
  secondary?: string;
  onSecondary?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="scrim">
      <div className="dialog" role="alertdialog" aria-labelledby="dialog-title">
        <div className={`icon ${tone}`}>
          {tone === 'err' ? <ErrorIcon size={34} /> : <WarnIcon size={34} />}
        </div>
        <h2 id="dialog-title">{title}</h2>
        {children}
        <div className="actions">
          {secondary && onSecondary ? (
            <button type="button" className="secondary" onClick={onSecondary}>
              {secondary}
            </button>
          ) : null}
          <FocusPrimary label={primary} onClick={onPrimary} />
        </div>
      </div>
    </div>
  );
}

function FocusPrimary({ label, onClick }: { label: string; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <button ref={ref} type="button" className="primary" onClick={onClick}>
      {label}
    </button>
  );
}

function primaryLabel(state: KioskState): string {
  if (state.payPhase === 'processing' || state.payPhase === 'checking') return 'Processing…';
  if (state.apiDown) return 'Payments paused';
  if (state.screen === 'checkout') return `Pay ${money(cartTotalCents(state.lines))}`;
  return 'Review and pay';
}

function visibleCategories(menu: Menu | null) {
  if (!menu) return [];
  return menu.categories.filter((category) =>
    menu.items.some((item) => item.categoryId === category.id && item.available),
  );
}

function monogram(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const second = parts[1]?.[0] ?? parts[0]?.[1] ?? '';
  return `${first}${second}`.toUpperCase();
}

function tileIndex(id: string): number {
  let total = 0;
  for (const char of id) total += char.charCodeAt(0);
  return total % 6;
}

function maskDigits(digits: string): string {
  const padded = `${digits}${'•'.repeat(CARD_NUMBER_DIGITS)}`.slice(0, CARD_NUMBER_DIGITS);
  return `${padded.slice(0, 4)} ${padded.slice(4, 8)} ${padded.slice(8, 12)} ${padded.slice(12)}`;
}
