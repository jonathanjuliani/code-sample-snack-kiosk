import type { Dispatch } from 'react';
import '../styles/pay.css';
import { ArrowIcon, DeleteIcon } from '../icons';
import { maskDigits } from './helpers';
import type { Action, KioskState } from './machine';

export function PayMain({
  state,
  dispatch,
  locked,
  canSubmit,
  onPay,
}: {
  state: KioskState;
  dispatch: Dispatch<Action>;
  locked: boolean;
  canSubmit: boolean;
  onPay: () => void;
}) {
  const digits = state.cardDigits;
  return (
    <>
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
        <button type="button" className="tapzone" disabled={locked || !canSubmit} onClick={onPay}>
          <span className="tapzone-copy">
            <span className="tapzone-big">Tap your card or phone on the reader</span>
            <span className="tapzone-small">The reader is below this screen.</span>
            <span className="tapzone-mock">Mock: tap here to simulate the reader.</span>
          </span>
          <ArrowIcon size={56} className="tapzone-arrow" />
        </button>
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
