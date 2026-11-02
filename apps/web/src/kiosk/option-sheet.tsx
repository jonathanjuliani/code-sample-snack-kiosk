import { formatCents } from '@kiosk/shared';
import type { Dispatch } from 'react';
import '../styles/sheet.css';
import { type Action, itemById, type KioskState, unitPriceCents } from './machine';

export function OptionSheet({ state, dispatch }: { state: KioskState; dispatch: Dispatch<Action> }) {
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
            <div className="num">{formatCents(item.priceCents)}</div>
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
                <span className="num">{choice.deltaCents ? `+${formatCents(choice.deltaCents)}` : ''}</span>
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
            Add · <span className="num">{formatCents(price)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
