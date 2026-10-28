import { z } from 'zod';

export const centsSchema = z.number().int().nonnegative();
export type Cents = z.infer<typeof centsSchema>;

export function formatCents(cents: Cents): string {
  const dollars = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, '0');
  return `$${dollars}.${rest}`;
}
