import { formatCents } from '@kiosk/shared';
import '../styles/shell.css';
import type { Dispatch } from 'react';
import { WarnIcon } from '../icons';
import { monogram, primaryLabel, tileIndex, visibleCategories } from './helpers';
import {
  type Action,
  canPay,
  cartCount,
  cartTotalCents,
  inPayment,
  itemById,
  type KioskState,
  qtyOfItem,
} from './machine';
import { PayMain } from './pay-main';

export function Shell({
  state,
  dispatch,
  venueName,
  menuSlow,
  retrySeconds,
  onRetryMenu,
  onAssist,
  onPrimary,
  onPay,
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
  onPay: () => void;
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
        <div className="main-bar">
          {state.screen === 'checkout' ? (
            <button
              type="button"
              className="back"
              disabled={locked}
              onClick={() => dispatch({ type: 'edit-order' })}
            >
              Add more
            </button>
          ) : (
            <span className="main-bar-spacer" />
          )}
          <button type="button" className="assist" onClick={onAssist}>
            Staff assist
          </button>
        </div>
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
                          <span className="price num">{formatCents(item.priceCents)}</span>
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
          <PayMain
            state={state}
            dispatch={dispatch}
            locked={locked}
            canSubmit={canPay(state)}
            onPay={onPay}
          />
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
                <div className="num">{formatCents(line.qty * line.unitPriceCents)}</div>
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
              {formatCents(total)}
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
