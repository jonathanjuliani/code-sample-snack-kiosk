import { formatCents } from '@kiosk/shared';
import '../styles/done.css';
import { OkIcon } from '../icons';
import type { KioskState } from './machine';

export function DoneScreen({
  state,
  seconds,
  onDone,
}: {
  state: KioskState;
  seconds: number;
  onDone: () => void;
}) {
  const receipt = state.receipt;
  const detail =
    receipt?.method === 'card' && receipt.last4
      ? `Card ending ${receipt.last4} · ${formatCents(receipt.totalCents)}`
      : `Paid by tap · ${formatCents(receipt?.totalCents ?? 0)}`;
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
