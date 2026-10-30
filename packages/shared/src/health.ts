import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  /** `down` pauses payments while this process stays up. Absent means up. */
  payments: z.enum(['up', 'down']).default('up'),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
