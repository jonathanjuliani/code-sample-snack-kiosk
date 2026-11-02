import { describe, expect, it } from 'vitest';
import { menuSchema } from '../src/index.ts';

const valid = {
  version: 'v1',
  venue: { name: 'Snack Bar', accent: '#C2410C' },
  categories: [{ id: 'snacks', label: 'Snacks' }],
  items: [
    {
      id: 'chips',
      categoryId: 'snacks',
      name: 'Salted chips',
      priceCents: 250,
      available: true,
      optionGroups: [
        {
          id: 'size',
          name: 'Size',
          choices: [{ id: 'regular', label: 'Regular', deltaCents: 0 }],
        },
      ],
    },
  ],
};

describe('menuSchema', () => {
  it('accepts a valid menu', () => {
    expect(menuSchema.parse(valid).version).toBe('v1');
  });

  it('rejects a bad accent', () => {
    expect(
      menuSchema.safeParse({
        ...valid,
        venue: { name: 'Snack Bar', accent: 'orange' },
      }).success,
    ).toBe(false);
  });

  it('rejects an empty choice group', () => {
    expect(
      menuSchema.safeParse({
        ...valid,
        items: [
          {
            ...valid.items[0],
            optionGroups: [{ id: 'size', name: 'Size', choices: [] }],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects a negative deltaCents', () => {
    expect(
      menuSchema.safeParse({
        ...valid,
        items: [
          {
            ...valid.items[0],
            optionGroups: [
              {
                id: 'size',
                name: 'Size',
                choices: [{ id: 'regular', label: 'Regular', deltaCents: -1 }],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
