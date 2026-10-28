import {
  type ApiError,
  IDEMPOTENCY_KEY_HEADER,
  type Menu,
  menuSchema,
  type OrderChanged,
  type OrderRequest,
  type OrderState,
  orderChangedSchema,
  orderStateSchema,
} from '@kiosk/shared';

export type SubmitResult =
  | { kind: 'paid'; order: Extract<OrderState, { status: 'paid' }> }
  | { kind: 'pending'; order: Extract<OrderState, { status: 'pending_payment' }> }
  | { kind: 'declined'; order: Extract<OrderState, { status: 'payment_failed' }> }
  | { kind: 'changed'; body: OrderChanged }
  | { kind: 'invalid'; body: ApiError }
  | { kind: 'conflict'; message: string }
  | { kind: 'network' }
  | { kind: 'unavailable' };

const API = '/api';

export class ApiDownError extends Error {
  constructor() {
    super('api down');
    this.name = 'ApiDownError';
  }
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text) as unknown;
}

export async function fetchMenu(signal?: AbortSignal): Promise<Menu> {
  try {
    const res = await fetch(`${API}/menu`, { signal });
    if (!res.ok) throw new ApiDownError();
    return menuSchema.parse(await parseJson(res));
  } catch (error) {
    if (error instanceof ApiDownError) throw error;
    throw new ApiDownError();
  }
}

export async function fetchHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function submitOrder(key: string, body: OrderRequest): Promise<SubmitResult> {
  let res: Response;
  try {
    res = await fetch(`${API}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [IDEMPOTENCY_KEY_HEADER]: key },
      body: JSON.stringify(body),
    });
  } catch {
    return { kind: 'network' };
  }

  if (res.status === 503) return { kind: 'unavailable' };

  const json = await parseJson(res);
  if (res.status === 201 || res.status === 200) {
    const order = orderStateSchema.parse(json);
    if (order.status === 'paid') return { kind: 'paid', order };
    if (order.status === 'payment_failed') return { kind: 'declined', order };
    return { kind: 'pending', order };
  }
  if (res.status === 202) {
    const order = orderStateSchema.parse(json);
    if (order.status === 'pending_payment') return { kind: 'pending', order };
    return { kind: 'network' };
  }
  if (res.status === 409) return { kind: 'changed', body: orderChangedSchema.parse(json) };
  if (res.status === 402) {
    const order = orderStateSchema.parse(json);
    if (order.status === 'payment_failed') return { kind: 'declined', order };
    return { kind: 'network' };
  }
  if (res.status === 422) return { kind: 'conflict', message: 'This checkout attempt was already used.' };
  if (res.status === 400) return { kind: 'invalid', body: json as ApiError };
  return { kind: 'network' };
}

export async function lookupAttempt(key: string): Promise<OrderState | null> {
  try {
    const res = await fetch(`${API}/orders?idempotencyKey=${encodeURIComponent(key)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new ApiDownError();
    return orderStateSchema.parse(await parseJson(res));
  } catch {
    throw new ApiDownError();
  }
}
