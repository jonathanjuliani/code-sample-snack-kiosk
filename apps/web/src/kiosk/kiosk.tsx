import { menuSchema, type OrderRequest } from '@kiosk/shared';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  fetchHealth,
  fetchMenu,
  lookupAttempt,
  postAssist,
  postOpsEvent,
  type SubmitResult,
  submitOrder,
} from '../api';
import { applyVenueAccent } from '../contrast';
import { newIdempotencyKey } from '../id';
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
} from '../storage';
import { APP_VERSION } from '../version';
import { Attract } from './attract';
import {
  AssistDialog,
  ConfirmStartOver,
  DeclinedDialog,
  PaymentsDownDialog,
  StatusDialog,
  StillThere,
  TotalDialog,
  UnresolvedDialog,
} from './dialogs';
import { DoneScreen } from './done-screen';
import {
  afterNotFound,
  canPay,
  cartCount,
  cartTotalCents,
  createInitialState,
  idleLimitMs,
  reduce,
  TIMEOUTS,
} from './machine';
import { OptionSheet } from './option-sheet';
import { Shell } from './shell';

const kioskId = typeof window === 'undefined' ? 'counter-1' : readKioskId();
const idleMs = typeof window === 'undefined' ? TIMEOUTS.idleMs : readIdleMs(TIMEOUTS.idleMs);

export function Kiosk() {
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-send heartbeat when screen/cart change
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset idle clock on screen/pay transitions
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

  const stillThereUntil = state.dialog?.kind === 'stillThere' ? state.dialog.until : null;

  useEffect(() => {
    if (stillThereUntil === null) idleReported.current = false;
  }, [stillThereUntil]);

  useEffect(() => {
    if (stillThereUntil && now >= stillThereUntil) {
      resetFromIdle();
      return;
    }
    const limit = idleLimitMs(state, idleMs);
    if (limit && !stillThereUntil && now - lastActivity.current > limit) {
      dispatch({ type: 'idle/prompt', until: now + TIMEOUTS.stillThereMs });
    }
  }, [now, state, stillThereUntil, resetFromIdle]);

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
    const key = current.idempotencyKey ?? newIdempotencyKey();
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
    // Start the 30s clock here, not only in applyResult: after a reload the kiosk enters checking from restore.
    checkingSince.current ??= Date.now();
    const pollAgain = () => {
      window.setTimeout(() => {
        void poll();
      }, 1500);
    };
    const poll = async () => {
      if (cancelled) return;
      if (checkingSince.current && Date.now() - checkingSince.current > TIMEOUTS.paymentCheckLimitMs) {
        dispatch({ type: 'pay/unresolved', code: `K${key.slice(0, 4).toUpperCase()}` });
        checkingSince.current = null;
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
          const body = afterNotFound(stateRef.current) === 'resend' ? buildRequest() : null;
          if (!body) {
            checkingSince.current = null;
            payLock.current = false;
            clearAttempt();
            dispatch({ type: 'pay/not-found' });
            return;
          }
          const result = await submitOrder(key, body);
          if (cancelled) return;
          applyResult(result, key);
          // Still no final answer: keep asking, or the 30s limit is never checked again.
          if (result.kind === 'pending' || result.kind === 'network' || result.kind === 'unavailable')
            pollAgain();
          return;
        }
      } catch {
        dispatch({ type: 'api/down' });
      }
      pollAgain();
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

  const stillSeconds = stillThereUntil ? Math.max(0, Math.ceil((stillThereUntil - now) / 1000)) : 0;
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
          onPay={() => {
            void pay();
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
      {state.dialog?.kind === 'assist' ? (
        <AssistDialog hasOrder={state.lines.length > 0} onWait={() => dispatch({ type: 'assist/wait' })} />
      ) : null}
      {state.dialog?.kind === 'confirmStartOver' ? (
        <ConfirmStartOver onYes={startOver} onNo={() => dispatch({ type: 'start-over/cancel' })} />
      ) : null}
      {state.dialog?.kind === 'stillThere' ? (
        <StillThere
          seconds={stillSeconds}
          onKeep={() => dispatch({ type: 'idle/keep' })}
          onReset={resetFromIdle}
        />
      ) : null}
    </div>
  );
}
