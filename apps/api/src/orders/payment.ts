import { randomUUID } from 'node:crypto';
import type { PaymentInput, PaymentSimulation } from '@kiosk/shared';

export const TEST_CARDS = {
  approve: '4242424242424242',
  decline: '4000000000000002',
  slow: '4000000000009995',
} as const;

export type PaymentResult =
  | { approved: true; reference: string }
  | { approved: false; reference: string; customerMessage: string };

export type PaymentGateway = {
  charge(payment: PaymentInput, amountCents: number): Promise<PaymentResult>;
};

export type Sleep = (ms: number) => Promise<void>;

export const sleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Deterministic fake: the card number picks the outcome, unless the simulation overrides it. */
export function createFakeGateway(options: {
  slowMs: number;
  sleep?: Sleep;
  paymentMode?: () => PaymentSimulation;
}): PaymentGateway {
  const wait = options.sleep ?? sleep;
  const paymentMode = options.paymentMode ?? (() => 'follow-card' as const);
  return {
    async charge(payment) {
      const mode = paymentMode();
      const reference = `fake_${randomUUID().slice(0, 8)}`;
      const forcedDecline = mode === 'declined' || mode === 'drop-declined';
      const cardDecline =
        mode === 'follow-card' && payment.method === 'card' && payment.cardNumber === TEST_CARDS.decline;
      if (forcedDecline || cardDecline) {
        return {
          approved: false,
          reference,
          customerMessage: 'Card not accepted. You have not been charged.',
        };
      }
      const slow =
        mode === 'follow-card' && payment.method === 'card' && payment.cardNumber === TEST_CARDS.slow;
      if (slow) await wait(options.slowMs);
      return { approved: true, reference };
    },
  };
}
