import type { Dispatch } from 'react';
import '../styles/pay.css';
import { DeleteIcon, ReaderIcon } from '../icons';
import { maskDigits } from './helpers';
import type { Action, KioskState } from './machine';

export function PayMain({
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
