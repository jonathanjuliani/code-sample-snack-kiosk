import { z } from 'zod';
import { centsSchema } from './money.ts';
import { MAX_LINES, MAX_QTY_PER_LINE, orderRequestSchema, orderStatusSchema } from './order.ts';

export const kioskScreenSchema = z.enum(['start', 'order', 'checkout', 'done']);
export const kioskPayPhaseSchema = z.enum([
  'idle',
  'processing',
  'checking',
  'declined',
  'totalChanged',
  'unresolved',
]);

export const opsEventSchema = z.object({
  kioskId: orderRequestSchema.shape.kioskId,
  kind: z.enum(['heartbeat', 'idle_reset']),
  appVersion: z.string().min(1).max(32).optional(),
  screen: kioskScreenSchema.optional(),
  payPhase: kioskPayPhaseSchema.optional(),
  itemCount: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_LINES * MAX_QTY_PER_LINE)
    .optional(),
  totalCents: centsSchema.optional(),
});

export const paymentSimulationSchema = z.enum([
  'follow-card',
  'approved',
  'declined',
  'drop-approved',
  'drop-declined',
  'unresolved',
]);

const simulationItemIdSchema = z.object({
  itemId: z.string().min(1).max(64),
});

export const simulationSchema = z.object({
  payment: paymentSimulationSchema,
  paymentsPaused: z.boolean(),
  menuFails: z.boolean(),
  priceBump: simulationItemIdSchema.nullable(),
  soldOut: simulationItemIdSchema.nullable(),
});

export const simulationResponseSchema = simulationSchema.extend({
  items: z.array(z.object({ id: z.string(), name: z.string() })),
});

export const defaultSimulation: Simulation = {
  payment: 'follow-card',
  paymentsPaused: false,
  menuFails: false,
  priceBump: null,
  soldOut: null,
};

export const assistRequestSchema = z.object({
  kioskId: orderRequestSchema.shape.kioskId,
});

export const opsCountersSchema = z.object({
  idempotentReplays: z.number().int().nonnegative(),
  reprices: z.number().int().nonnegative(),
  declines: z.number().int().nonnegative(),
  idleResets: z.number().int().nonnegative(),
});

export const opsOrderSchema = z.object({
  orderId: z.string(),
  status: orderStatusSchema,
  kioskId: z.string(),
  totalCents: centsSchema,
  createdAt: z.string(),
  pickupNumber: z.string().nullable(),
});

export const opsKioskSchema = z.object({
  kioskId: z.string(),
  lastSeenAt: z.string(),
  appVersion: z.string(),
  screen: kioskScreenSchema.nullable(),
  payPhase: kioskPayPhaseSchema.nullable(),
  itemCount: z.number().int().nonnegative().nullable(),
  totalCents: centsSchema.nullable(),
});

export const opsAssistSchema = z.object({
  id: z.string(),
  kioskId: z.string(),
  openedAt: z.string(),
});

export const opsSummarySchema = z.object({
  menuVersion: z.string(),
  counters: opsCountersSchema,
  kiosks: z.array(opsKioskSchema),
  assists: z.array(opsAssistSchema).max(20),
  orders: z.array(opsOrderSchema).max(20),
});

export type OpsEvent = z.infer<typeof opsEventSchema>;
export type OpsCounters = z.infer<typeof opsCountersSchema>;
export type OpsOrder = z.infer<typeof opsOrderSchema>;
export type OpsKiosk = z.infer<typeof opsKioskSchema>;
export type OpsAssist = z.infer<typeof opsAssistSchema>;
export type AssistRequest = z.infer<typeof assistRequestSchema>;
export type OpsSummary = z.infer<typeof opsSummarySchema>;
export type PaymentSimulation = z.infer<typeof paymentSimulationSchema>;
export type Simulation = z.infer<typeof simulationSchema>;
export type SimulationResponse = z.infer<typeof simulationResponseSchema>;
