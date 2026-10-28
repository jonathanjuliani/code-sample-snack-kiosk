import { randomUUID } from 'node:crypto';
import type { PaymentInput } from '@kiosk/shared';

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

/** Deterministic fake: the card number picks the outcome. Nothing real is charged. */
export function createFakeGateway(options: { slowMs: number; sleep?: Sleep }): PaymentGateway {
  const wait = options.sleep ?? sleep;
  return {
    async charge(payment) {
      const reference = `fake_${randomUUID().slice(0, 8)}`;
      if (payment.method === 'card' && payment.cardNumber === TEST_CARDS.decline) {
        return {
          approved: false,
          reference,
          customerMessage: 'Card not accepted. You have not been charged.',
        };
      }
      if (payment.method === 'card' && payment.cardNumber === TEST_CARDS.slow) {
        await wait(options.slowMs);
      }
      return { approved: true, reference };
    },
  };
}
