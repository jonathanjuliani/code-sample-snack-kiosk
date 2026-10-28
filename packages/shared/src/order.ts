import { z } from 'zod';
import { centsSchema } from './money.ts';

export const MAX_QTY_PER_LINE = 10;
export const MAX_LINES = 20;
export const CARD_NUMBER_DIGITS = 16;
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

export const idempotencyKeySchema = z.uuid();

export const orderLineInputSchema = z.object({
  itemId: z.string().min(1).max(64),
  qty: z.number().int().min(1).max(MAX_QTY_PER_LINE),
  choiceIds: z.array(z.string().min(1).max(64)).max(10).default([]),
});

export const paymentInputSchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('card'),
    cardNumber: z.string().regex(new RegExp(`^\\d{${CARD_NUMBER_DIGITS}}$`), 'Card number must be 16 digits'),
  }),
  z.object({ method: z.literal('tap') }),
]);

export const orderRequestSchema = z.object({
  kioskId: z.string().regex(/^[a-z0-9-]{1,40}$/i, 'kioskId must be letters, digits or dashes'),
  menuVersion: z.string().min(1).max(64),
  lines: z.array(orderLineInputSchema).min(1).max(MAX_LINES),
  payment: paymentInputSchema,
  clientTotalCents: centsSchema,
});

export const pricedLineSchema = z.object({
  itemId: z.string(),
  name: z.string(),
  choiceIds: z.array(z.string()),
  optionLabels: z.array(z.string()),
  qty: z.number().int(),
  unitPriceCents: centsSchema,
  lineTotalCents: centsSchema,
});

export const orderStatusSchema = z.enum(['pending_payment', 'paid', 'payment_failed']);

export const paidOrderSchema = z.object({
  orderId: z.string(),
  status: z.literal('paid'),
  pickupNumber: z.string(),
  totalCents: centsSchema,
  lines: z.array(pricedLineSchema),
  paymentMethod: z.enum(['card', 'tap']),
  last4: z.string().nullable(),
});

export const pendingOrderSchema = z.object({
  orderId: z.string(),
  status: z.literal('pending_payment'),
});

export const failedOrderSchema = z.object({
  orderId: z.string(),
  status: z.literal('payment_failed'),
  error: z.literal('payment_declined'),
  message: z.string(),
});

export const orderStateSchema = z.discriminatedUnion('status', [
  paidOrderSchema,
  pendingOrderSchema,
  failedOrderSchema,
]);

export const orderChangedSchema = z.object({
  error: z.literal('order_changed'),
  message: z.string(),
  menuVersion: z.string(),
  totalCents: centsSchema,
  lines: z.array(pricedLineSchema),
  unavailableItemIds: z.array(z.string()),
});

export const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  requestId: z.string().optional(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

export type OrderLineInput = z.infer<typeof orderLineInputSchema>;
export type PaymentInput = z.infer<typeof paymentInputSchema>;
export type OrderRequest = z.infer<typeof orderRequestSchema>;
export type PricedLine = z.infer<typeof pricedLineSchema>;
export type OrderStatus = z.infer<typeof orderStatusSchema>;
export type PaidOrder = z.infer<typeof paidOrderSchema>;
export type PendingOrder = z.infer<typeof pendingOrderSchema>;
export type FailedOrder = z.infer<typeof failedOrderSchema>;
export type OrderState = z.infer<typeof orderStateSchema>;
export type OrderChanged = z.infer<typeof orderChangedSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
