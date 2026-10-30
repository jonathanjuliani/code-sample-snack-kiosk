import { z } from 'zod';
import { centsSchema } from './money.ts';

export const optionChoiceSchema = z.object({
  id: z.string(),
  label: z.string(),
  deltaCents: centsSchema,
});

export const optionGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  choices: z.array(optionChoiceSchema).min(1),
});

export const menuItemSchema = z.object({
  id: z.string(),
  categoryId: z.string(),
  name: z.string(),
  description: z.string().max(160).optional(),
  priceCents: centsSchema,
  available: z.boolean(),
  optionGroups: z.array(optionGroupSchema),
});

export const categorySchema = z.object({
  id: z.string(),
  label: z.string(),
});

export const venueSchema = z.object({
  name: z.string().min(1).max(48),
  accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});

export const menuSchema = z.object({
  version: z.string(),
  venue: venueSchema,
  categories: z.array(categorySchema),
  items: z.array(menuItemSchema),
});

export type OptionChoice = z.infer<typeof optionChoiceSchema>;
export type OptionGroup = z.infer<typeof optionGroupSchema>;
export type MenuItem = z.infer<typeof menuItemSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Venue = z.infer<typeof venueSchema>;
export type Menu = z.infer<typeof menuSchema>;
