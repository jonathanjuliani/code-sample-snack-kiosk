import { CARD_NUMBER_DIGITS, menuSchema, type OrderRequest } from '@kiosk/shared';
import { type Dispatch, useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { fetchHealth, fetchMenu, lookupAttempt, type SubmitResult, submitOrder } from './api';
import { ArrowIcon, CategoryGlyph, ErrorIcon, OkIcon, TrashIcon, WarnIcon } from './icons';
import {
  canPay,
  cartCount,
  cartTotalCents,
  createInitialState,
  ITEMS_PER_PAGE,
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
import {
  cacheMenu,
  clearAttempt,
  clearCart,
  loadAttempt,
  loadCachedMenu,
  loadCart,
  readKioskId,
  saveAttempt,
  saveCart,
} from './storage';
import './styles/kiosk.css';

const kioskId = typeof window === 'undefined' ? 'kiosk-1' : readKioskId();

export function App() {
  const [state, dispatch] = useReducer(reduce, undefined, createInitialState);
  const [now, setNow] = useState(() => Date.now());
  const lastActivity = useRef(Date.now());
  const payLock = useRef(false);
  const checkingSince = useRef<number | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const bumpActivity = useCallback(() => {
    lastActivity.current = Date.now();
  }, []);

  useEffect(() => {
    const cached = loadCachedMenu();
    const parsed = cached ? menuSchema.safeParse(cached) : null;
    if (parsed?.success) dispatch({ type: 'menu/stale', menu: parsed.data });

    const attempt = loadAttempt();
    const cart = loadCart();
    if (attempt || cart.length > 0) {
      dispatch({ type: 'restore', lines: cart, key: attempt?.idempotencyKey ?? null });
    }

    let cancelled = false;
    let attemptNo = 0;
    const load = async () => {
      try {
        const menu = await fetchMenu();
        if (cancelled) return;
        cacheMenu(menu);
        dispatch({ type: 'menu/loaded', menu });
        attemptNo = 0;
      } catch {
        if (cancelled) return;
        dispatch({ type: 'menu/failed' });
        const wait = TIMEOUTS.menuBackoffMs[Math.min(attemptNo, TIMEOUTS.menuBackoffMs.length - 1)] ?? 5000;
        attemptNo += 1;
        window.setTimeout(() => {
          if (!cancelled) void load();
        }, wait);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

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

  useEffect(() => {
    if (state.stillThereUntil && now >= state.stillThereUntil) {
      dispatch({ type: 'start-over/confirm' });
      clearCart();
      clearAttempt();
      payLock.current = false;
      return;
    }
    const limit = idleLimitMs(state);
    if (limit && !state.stillThereUntil && now - lastActivity.current > limit) {
      dispatch({ type: 'idle/prompt', until: now + TIMEOUTS.stillThereMs });
    }
  }, [now, state]);

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
      dispatch({ type: 'pay/paid', pickupNumber: result.order.pickupNumber });
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

  useEffect(() => {
    if (!state.apiDown) return;
    const id = window.setInterval(async () => {
      if (await fetchHealth()) {
        dispatch({ type: 'api/up' });
        try {
          const menu = await fetchMenu();
          cacheMenu(menu);
          dispatch({ type: 'menu/loaded', menu });
        } catch {
          dispatch({ type: 'menu/failed' });
        }
      }
    }, 3000);
    return () => window.clearInterval(id);
  }, [state.apiDown]);

  const stillSeconds = state.stillThereUntil
    ? Math.max(0, Math.ceil((state.stillThereUntil - now) / 1000))
    : 0;

  return (
    <div className="kiosk" aria-live="polite">
      {state.screen === 'start' && (
        <StartScreen status={state.menuStatus} onStart={() => dispatch({ type: 'start' })} />
      )}
      {state.screen === 'order' && (
        <OrderScreen state={state} dispatch={dispatch} onPay={() => dispatch({ type: 'review' })} />
      )}
      {state.screen === 'checkout' && (
        <CheckoutScreen state={state} dispatch={dispatch} onPay={() => void pay()} />
      )}
      {state.screen === 'done' && (
        <DoneScreen
          pickupNumber={state.pickupNumber ?? ''}
          onDone={() => {
            dispatch({ type: 'start-over/confirm' });
            payLock.current = false;
          }}
        />
      )}
      {state.sheet && <OptionSheet state={state} dispatch={dispatch} />}
      {state.help && <HelpDialog onClose={() => dispatch({ type: 'help/close' })} />}
      {state.confirmStartOver && (
        <ConfirmStartOver
          onYes={() => {
            dispatch({ type: 'start-over/confirm' });
            clearCart();
            clearAttempt();
            payLock.current = false;
          }}
          onNo={() => dispatch({ type: 'start-over/cancel' })}
        />
      )}
      {state.stillThereUntil && (
        <StillThere
          seconds={stillSeconds}
          onKeep={() => dispatch({ type: 'idle/keep' })}
          onReset={() => {
            dispatch({ type: 'start-over/confirm' });
            clearCart();
            clearAttempt();
            payLock.current = false;
          }}
        />
      )}
    </div>
  );
}

function Header({
  title,
  canLeave,
  apiDown,
  dispatch,
}: {
  title: string;
  canLeave: boolean;
  apiDown: boolean;
  dispatch: Dispatch<Parameters<typeof reduce>[1]>;
}) {
  return (
    <>
      <header className="hdr">
        <div className="slot">
          {canLeave ? (
            <button type="button" className="k k-quiet" onClick={() => dispatch({ type: 'start-over/ask' })}>
              Start over
            </button>
          ) : null}
        </div>
        <div className="title">{title}</div>
        <div className="slot r">
          <button type="button" className="k k-quiet" onClick={() => dispatch({ type: 'help/open' })}>
            Help
          </button>
        </div>
      </header>
      {apiDown ? (
        <div className="strip" role="status">
          <WarnIcon size={28} />
          <span>Payment is unavailable right now. You can still browse.</span>
        </div>
      ) : null}
    </>
  );
}

function StartScreen({ status, onStart }: { status: KioskState['menuStatus']; onStart: () => void }) {
  if (status === 'unavailable') {
    return (
      <div className="screen start" role="status">
        <div className="brand">Snack Bar</div>
        <div className="unavailable">
          <div className="cta" style={{ fontSize: 'var(--text-heading)' }}>
            Ordering is unavailable right now
          </div>
          <p className="sub">We are trying to reconnect. Please check back in a minute.</p>
        </div>
      </div>
    );
  }
  if (status === 'loading') {
    return (
      <div className="screen start" role="status">
        <div className="brand">Snack Bar</div>
        <div className="cta">
          Tap anywhere
          <br />
          to start
        </div>
        <div className="sub">Loading the menu…</div>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="screen start"
      onClick={onStart}
      style={{ border: 0, background: 'transparent' }}
    >
      <div className="brand">Snack Bar</div>
      <div className="cta">
        Tap anywhere
        <br />
        to start
      </div>
      <div className="sub">Order and pay here. Pick up at the counter.</div>
    </button>
  );
}

function OrderLines({
  state,
  editable,
  dispatch,
}: {
  state: KioskState;
  editable: boolean;
  dispatch: Dispatch<Parameters<typeof reduce>[1]>;
}) {
  if (state.lines.length === 0) return <div className="empty">Tap an item to add it.</div>;
  return (
    <>
      {state.lines.map((line) => {
        const item = itemById(state.menu, line.itemId);
        const name = item?.name ?? line.itemId;
        return (
          <div className="line" key={line.key}>
            <div>
              <div className="ln">
                {editable ? '' : `${line.qty} × `}
                {name}
              </div>
              {line.optionLabels.length > 0 ? <div className="lo">{line.optionLabels.join(', ')}</div> : null}
            </div>
            <div className="lp num">{money(line.qty * line.unitPriceCents)}</div>
            {editable ? (
              <div className="stepper">
                <button
                  type="button"
                  className="k k-quiet"
                  aria-label={line.qty === 1 ? `Remove ${name}` : `Remove one ${name}`}
                  onClick={() => dispatch({ type: 'line/dec', key: line.key })}
                >
                  {line.qty === 1 ? <TrashIcon /> : <span aria-hidden="true">−</span>}
                </button>
                <span className="q num">{line.qty}</span>
                <button
                  type="button"
                  className="k k-quiet"
                  aria-label={`Add one ${name}`}
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
    </>
  );
}

function OrderScreen({
  state,
  dispatch,
  onPay,
}: {
  state: KioskState;
  dispatch: Dispatch<Parameters<typeof reduce>[1]>;
  onPay: () => void;
}) {
  const items = (state.menu?.items ?? []).filter((item) => item.categoryId === state.categoryId);
  const pages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
  const page = Math.min(state.page, pages - 1);
  const pageItems = items.slice(page * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE + ITEMS_PER_PAGE);
  const n = cartCount(state.lines);
  const total = cartTotalCents(state.lines);
  const category = state.menu?.categories.find((c) => c.id === state.categoryId);

  return (
    <div className="screen">
      <Header
        title="Snack Bar"
        canLeave={!inPayment(state.payPhase)}
        apiDown={state.apiDown}
        dispatch={dispatch}
      />
      <div className="body">
        <section className="menu" aria-label="Menu">
          <div className="tabs" role="tablist">
            {(state.menu?.categories ?? []).map((c) => (
              <button
                key={c.id}
                type="button"
                className="k tab"
                role="tab"
                aria-selected={c.id === state.categoryId}
                onClick={() => dispatch({ type: 'tab', categoryId: c.id })}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="grid">
            {pageItems.map((item) => {
              const q = qtyOfItem(state.lines, item.id);
              if (!item.available) {
                return (
                  <button key={item.id} type="button" className="tile soldout" disabled>
                    <div className="glyph">
                      <CategoryGlyph categoryId={item.categoryId} />
                    </div>
                    <div className="name">{item.name}</div>
                    <div className="meta">
                      <span className="tag">Sold out</span>
                      <span className="price num">{money(item.priceCents)}</span>
                    </div>
                  </button>
                );
              }
              return (
                <button
                  key={item.id}
                  type="button"
                  className="tile"
                  aria-label={`${item.name}, ${money(item.priceCents)}${item.optionGroups.length ? ', has options' : ''}`}
                  onClick={() => dispatch({ type: 'tile', itemId: item.id })}
                >
                  {q ? (
                    <span className="badge num" role="status">
                      {q}
                    </span>
                  ) : null}
                  <div className="glyph">
                    <CategoryGlyph categoryId={item.categoryId} />
                  </div>
                  <div className="name">{item.name}</div>
                  <div className="meta">
                    <span className="opt">{item.optionGroups.length ? 'Choose options' : 'Tap to add'}</span>
                    <span className="price num">{money(item.priceCents)}</span>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="pager">
            {pages > 1 ? (
              <>
                <button
                  type="button"
                  className="k k-secondary"
                  disabled={page === 0}
                  onClick={() => dispatch({ type: 'page', delta: -1 })}
                >
                  Previous
                </button>
                <span className="where num">
                  Page {page + 1} of {pages}
                </span>
                <button
                  type="button"
                  className="k k-secondary"
                  disabled={page >= pages - 1}
                  onClick={() => dispatch({ type: 'page', delta: 1 })}
                >
                  More {category?.label.toLowerCase() ?? ''}
                </button>
              </>
            ) : (
              <span />
            )}
          </div>
        </section>
        <aside className={`panel${state.dockOpen ? ' open' : ''}`} aria-label="Your order">
          <h2>Your order</h2>
          <div className="lines">
            <OrderLines state={state} editable dispatch={dispatch} />
          </div>
          <div className="foot">
            <div className="totalrow">
              <button
                type="button"
                className="k k-quiet dock-toggle"
                onClick={() => dispatch({ type: 'dock' })}
              >
                {state.dockOpen ? 'Hide order' : `View order (${n})`}
              </button>
              <span className="cnt num">
                {n} item{n === 1 ? '' : 's'}
              </span>
              <span className="tot num" role="status">
                {money(total)}
              </span>
            </div>
            <button type="button" className="k k-primary" disabled={n === 0} onClick={onPay}>
              Review and pay
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function CheckoutScreen({
  state,
  dispatch,
  onPay,
}: {
  state: KioskState;
  dispatch: Dispatch<Parameters<typeof reduce>[1]>;
  onPay: () => void;
}) {
  const locked = inPayment(state.payPhase);
  const total = cartTotalCents(state.lines);
  return (
    <div className="screen">
      <Header title="Review and pay" canLeave={!locked} apiDown={state.apiDown} dispatch={dispatch} />
      <div className="body co-body">
        <section className="co-order" aria-label="Your order">
          <h2>Your order</h2>
          <div className="lines">
            <OrderLines state={state} editable={false} dispatch={dispatch} />
          </div>
          <div className="foot">
            <div className="totalrow">
              <span className="cnt num">{cartCount(state.lines)} items</span>
              <span className="tot num">{money(total)}</span>
            </div>
            {locked ? null : (
              <button
                type="button"
                className="k k-secondary"
                onClick={() => dispatch({ type: 'edit-order' })}
              >
                Edit order
              </button>
            )}
          </div>
        </section>
        <section className="co-pay" aria-label="Payment">
          <PayArea state={state} dispatch={dispatch} onPay={onPay} />
        </section>
      </div>
    </div>
  );
}

function PayArea({
  state,
  dispatch,
  onPay,
}: {
  state: KioskState;
  dispatch: Dispatch<Parameters<typeof reduce>[1]>;
  onPay: () => void;
}) {
  const total = cartTotalCents(state.lines);
  const p = state.payPhase;
  if (p === 'totalChanged' && state.priceChange) {
    const c = state.priceChange;
    return (
      <div className="state warn" role="alert">
        <div className="head">
          <WarnIcon />
          <h3>Prices updated</h3>
        </div>
        <p style={{ margin: 0 }}>
          Some prices changed since you started. Check the new total before you pay.
        </p>
        <table className="cmp">
          <thead>
            <tr>
              <th>Item</th>
              <th className="r">Was</th>
              <th className="r">Now</th>
            </tr>
          </thead>
          <tbody>
            {c.rows.map((row) => (
              <tr key={`${row.name}-${row.wasCents}`}>
                <td>
                  {row.qty} × {row.name}
                  {row.optionLabels.length ? ` (${row.optionLabels.join(', ')})` : ''}
                </td>
                <td className="r num old">{money(row.wasCents * row.qty)}</td>
                <td className="r num">
                  <strong>{money(row.nowCents * row.qty)}</strong>
                </td>
              </tr>
            ))}
            {c.unavailableItemIds.length > 0 ? (
              <tr>
                <td colSpan={3}>Some items are no longer available.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <div className="totals-cmp">
          <div className="was">
            Old total <span className="v num">{money(c.oldTotalCents)}</span>
          </div>
          <div className="now">
            New total <span className="v num">{money(c.newTotalCents)}</span>
          </div>
        </div>
        <div className="grow" />
        <div className="actions">
          <button type="button" className="k k-secondary" onClick={() => dispatch({ type: 'edit-order' })}>
            Back to order
          </button>
          <button type="button" className="k k-primary" onClick={() => dispatch({ type: 'accept-price' })}>
            Pay {money(c.newTotalCents)}
          </button>
        </div>
      </div>
    );
  }
  if (p === 'processing') {
    return (
      <div className="state neutral" role="status">
        <div className="head">
          <div className="spinner" />
          <h3>Processing payment…</h3>
        </div>
        <p style={{ margin: 0 }}>Keep your card on the reader until this screen changes.</p>
        <div className="amount num">{money(total)}</div>
      </div>
    );
  }
  if (p === 'checking') {
    return (
      <div className="state warn" role="alert">
        <div className="head">
          <div className="spinner" style={{ color: 'var(--color-warning)' }} />
          <h3>Checking your payment</h3>
        </div>
        <p style={{ margin: 0, fontSize: 'var(--text-item)', fontWeight: 'var(--weight-strong)' }}>
          Please don&apos;t pay again.
        </p>
        <p style={{ margin: 0 }}>We&apos;re confirming with the bank. This can take up to 30 seconds.</p>
      </div>
    );
  }
  if (p === 'unresolved') {
    return (
      <div className="state warn" role="alert">
        <div className="head">
          <WarnIcon />
          <h3>We couldn&apos;t confirm your payment</h3>
        </div>
        <p style={{ margin: 0 }}>
          You have not been asked to pay twice. If your card was charged, show this code at the counter and
          we&apos;ll sort it out.
        </p>
        <div className="code num">{state.unresolvedCode}</div>
        <div className="grow" />
        <div className="actions">
          <button
            type="button"
            className="k k-primary"
            onClick={() => dispatch({ type: 'start-over/confirm' })}
          >
            Start a new order
          </button>
        </div>
      </div>
    );
  }
  if (p === 'declined') {
    return (
      <div className="state err" role="alert">
        <div className="head">
          <ErrorIcon />
          <h3>Card not accepted</h3>
        </div>
        <p style={{ margin: 0 }}>
          You have not been charged. Your order is saved. Try another card or phone.
        </p>
        <div className="grow" />
        <div className="actions">
          <button type="button" className="k k-secondary" onClick={() => dispatch({ type: 'edit-order' })}>
            Back to order
          </button>
          <button type="button" className="k k-primary" onClick={() => dispatch({ type: 'pay/retry' })}>
            Try another card
          </button>
        </div>
      </div>
    );
  }
  if (state.apiDown) {
    return (
      <>
        <div>
          <div className="amount-label">Amount to pay</div>
          <div className="amount num">{money(total)}</div>
        </div>
        <div className="state neutral">
          <div className="head">
            <WarnIcon />
            <h3>Payment is unavailable right now</h3>
          </div>
          <p style={{ margin: 0 }}>
            Your order is saved. Payment will come back on its own. You can keep this screen open or edit your
            order.
          </p>
        </div>
        <div className="pay-actions">
          <span />
          <button type="button" className="k k-primary" disabled>
            Payment unavailable
          </button>
        </div>
      </>
    );
  }
  if (state.payMode === 'card') {
    const d = state.cardDigits;
    const grouped = d.replace(/(.{4})/g, '$1 ').trim();
    return (
      <>
        <div>
          <div className="amount-label">Amount to pay</div>
          <div className="amount num">{money(total)}</div>
        </div>
        <div className="numpad-wrap">
          <div className="numpad-left">
            <div className="cardfield num" role="status">
              {d ? grouped : <span className="ph">Card number, 16 digits</span>}
            </div>
            <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
              {CARD_NUMBER_DIGITS - d.length
                ? `${CARD_NUMBER_DIGITS - d.length} digits to go`
                : 'Ready to pay'}
            </p>
          </div>
          <div className="numpad">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => (
              <button
                key={k}
                type="button"
                className="k num"
                onClick={() => dispatch({ type: 'pay/digit', digit: String(k) })}
              >
                {k}
              </button>
            ))}
            <span />
            <button
              type="button"
              className="k num"
              onClick={() => dispatch({ type: 'pay/digit', digit: '0' })}
            >
              0
            </button>
            <button
              type="button"
              className="k del"
              aria-label="Delete last digit"
              onClick={() => dispatch({ type: 'pay/delete' })}
            >
              Delete
            </button>
          </div>
        </div>
        <div className="pay-actions">
          <button
            type="button"
            className="k k-secondary"
            onClick={() => dispatch({ type: 'pay/mode', mode: 'tap' })}
          >
            Tap card instead
          </button>
          <button type="button" className="k k-primary" disabled={!canPay(state)} onClick={onPay}>
            Pay {money(total)}
          </button>
        </div>
      </>
    );
  }
  return (
    <>
      <div>
        <div className="amount-label">Amount to pay</div>
        <div className="amount num">{money(total)}</div>
      </div>
      <button type="button" className="tapzone" onClick={onPay}>
        <div>
          <div className="big">
            Tap your card or phone
            <br />
            on the reader
          </div>
          <div className="small">The reader is to the right of this screen.</div>
        </div>
        <span className="arrow">
          <ArrowIcon />
        </span>
      </button>
      <div className="pay-actions">
        <button
          type="button"
          className="k k-secondary"
          onClick={() => dispatch({ type: 'pay/mode', mode: 'card' })}
        >
          Enter card number instead
        </button>
        <span />
      </div>
    </>
  );
}

function DoneScreen({ pickupNumber, onDone }: { pickupNumber: string; onDone: () => void }) {
  return (
    <div className="screen done" role="status">
      <div className="ok">
        <OkIcon />
      </div>
      <h1>Paid. Thank you!</h1>
      <div>
        <div className="sub">Your order number</div>
        <div className="ordno num">{pickupNumber}</div>
      </div>
      <div className="sub">Pick it up at the counter when your number is called.</div>
      <button type="button" className="k k-primary" style={{ minWidth: 280 }} onClick={onDone}>
        Done
      </button>
    </div>
  );
}

function OptionSheet({
  state,
  dispatch,
}: {
  state: KioskState;
  dispatch: Dispatch<Parameters<typeof reduce>[1]>;
}) {
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
            <div className="num" style={{ color: 'var(--color-text-muted)' }}>
              From {money(item.priceCents)}
            </div>
          </div>
          <button type="button" className="k k-quiet" onClick={() => dispatch({ type: 'sheet/close' })}>
            Cancel
          </button>
        </div>
        {item.optionGroups.map((group) => (
          <div className="group" key={group.id}>
            <div className="gl">{group.name}</div>
            <div className="choices">
              {group.choices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  className="k choice"
                  aria-pressed={sheet.choiceIds.includes(choice.id)}
                  onClick={() => dispatch({ type: 'sheet/choose', groupId: group.id, choiceId: choice.id })}
                >
                  <span>{choice.label}</span>
                  <span className="num">{choice.deltaCents ? `+${money(choice.deltaCents)}` : ''}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="bottom">
          <div className="stepper" style={{ gridColumn: 'auto' }}>
            <button
              type="button"
              className="k k-quiet"
              disabled={sheet.qty <= 1}
              aria-label="One less"
              onClick={() => dispatch({ type: 'sheet/qty', delta: -1 })}
            >
              −
            </button>
            <span className="q num">{sheet.qty}</span>
            <button
              type="button"
              className="k k-quiet"
              disabled={sheet.qty >= 10}
              aria-label="One more"
              onClick={() => dispatch({ type: 'sheet/qty', delta: 1 })}
            >
              +
            </button>
          </div>
          <button type="button" className="k k-primary" onClick={() => dispatch({ type: 'sheet/add' })}>
            Add · <span className="num">{money(price)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="scrim center">
      <div className="dialog" role="dialog" aria-label="Help">
        <h2>How this works</h2>
        <ol>
          <li>
            <strong>Order:</strong> tap items to add them. Your order and total stay on the right.
          </li>
          <li>
            <strong>Pay:</strong> tap your card or phone on the reader, or type your card number.
          </li>
          <li>
            <strong>If a payment fails:</strong> you&apos;re never charged twice. The screen tells you what to
            do next.
          </li>
        </ol>
        <div className="actions">
          <button type="button" className="k k-primary" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmStartOver({ onYes, onNo }: { onYes: () => void; onNo: () => void }) {
  return (
    <div className="scrim center">
      <div className="dialog" role="alertdialog" aria-label="Start over">
        <h2>Start over?</h2>
        <p style={{ margin: 0 }}>Your order will be cleared.</p>
        <div className="actions">
          <button type="button" className="k k-secondary" onClick={onYes}>
            Start over
          </button>
          <button type="button" className="k k-primary" onClick={onNo}>
            Keep ordering
          </button>
        </div>
      </div>
    </div>
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
    <div className="scrim center">
      <div className="dialog" role="alertdialog" aria-label="Are you still there?">
        <h2>Still there?</h2>
        <p style={{ margin: 0 }}>Your order will be cleared in</p>
        <div className="count num">{seconds}s</div>
        <div className="actions">
          <button type="button" className="k k-secondary" onClick={onReset}>
            Start over
          </button>
          <button type="button" className="k k-primary" onClick={onKeep}>
            Keep ordering
          </button>
        </div>
      </div>
    </div>
  );
}
