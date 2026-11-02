import { type KioskState, type PayPhase, TIMEOUTS } from './state.ts';

export function inPayment(phase: PayPhase): boolean {
  return phase === 'processing' || phase === 'checking' || phase === 'unresolved';
}

export function canPay(state: KioskState): boolean {
  if (state.apiDown || state.payPhase !== 'idle' || state.lines.length === 0) return false;
  if (state.payMode === 'card') return state.cardDigits.length === 16;
  return true;
}

export function idleLimitMs(state: KioskState, idleMs: number = TIMEOUTS.idleMs): number | null {
  if (state.assistActive || state.dialog?.kind === 'stillThere' || inPayment(state.payPhase)) return null;
  if (state.screen === 'order' || state.screen === 'checkout') return idleMs;
  return null;
}
