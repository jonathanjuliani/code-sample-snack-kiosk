import { formatCents } from '@kiosk/shared';
import { type ReactNode, useEffect, useRef } from 'react';
import '../styles/dialog.css';
import { ErrorIcon, WarnIcon } from '../icons';
import { itemById, type KioskState } from './machine';

export function StatusDialog({ phase }: { phase: 'processing' | 'checking' }) {
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

export function DeclinedDialog({
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

export function TotalDialog({
  state,
  onPay,
  onEdit,
}: {
  state: KioskState;
  onPay: () => void;
  onEdit: () => void;
}) {
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
              <td className="r num old">{formatCents(row.wasCents * row.qty)}</td>
              <td className="r num">{formatCents(row.nowCents * row.qty)}</td>
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
        <span className="num">{formatCents(change.newTotalCents)}</span>
      </div>
    </Dialog>
  );
}

export function PaymentsDownDialog({
  onRetry,
  onStartOver,
}: {
  onRetry: () => void;
  onStartOver: () => void;
}) {
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

export function UnresolvedDialog({ code, onDone }: { code: string; onDone: () => void }) {
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

export function AssistDialog({ onWait }: { onWait: () => void }) {
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

export function ConfirmStartOver({ onYes, onNo }: { onYes: () => void; onNo: () => void }) {
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

export function StillThere({
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

export function Dialog({
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

export function FocusPrimary({ label, onClick }: { label: string; onClick: () => void }) {
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
