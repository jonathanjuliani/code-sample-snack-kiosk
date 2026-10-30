import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../src/app.tsx';

describe('web entry', () => {
  it('renders the start screen', () => {
    expect(renderToString(<App />)).toContain('Order here.');
  });
});
