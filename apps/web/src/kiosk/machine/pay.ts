import { type KioskState, type PayPhase, TIMEOUTS } from './state.ts';

export function inPayment(phase: PayPhase): boolean {
  return phase === 'processing' || phase === 'checking' || phase === 'unresolved';
}

export function canPay(state: KioskState): boolean {
  if (state.apiDown || state.payPhase !== 'idle' || state.lines.length === 0) return false;
  if (state.payMode === 'card') return state.cardDigits.length === 16;
  return true;
}

/**
 * The API has no order for this attempt's key, so the request never landed and nobody was charged.
 * Re-send the same request with the same key only when this page session can still build it. After a
 * reload only the key survived (never the card number), so go back to Pay instead (D8).
 */
export function afterNotFound(state: KioskState): 'resend' | 'back-to-pay' {
  if (state.resumed) return 'back-to-pay';
  if (state.payMode === 'tap') return 'resend';
  return state.cardDigits.length === 16 ? 'resend' : 'back-to-pay';
}

export function idleLimitMs(state: KioskState, idleMs: number = TIMEOUTS.idleMs): number | null {
  if (state.assistActive || state.dialog?.kind === 'stillThere' || inPayment(state.payPhase)) return null;
  if (state.screen === 'order' || state.screen === 'checkout') return idleMs;
  return null;
}
