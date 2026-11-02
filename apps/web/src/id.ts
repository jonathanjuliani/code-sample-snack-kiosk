/** Idempotency keys must be UUID-shaped (`z.uuid()` on the API). */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  if (typeof c?.getRandomValues === "function") {
    const bytes = c.getRandomValues(new Uint8Array(16));
    const version = bytes[6] ?? 0;
    const variant = bytes[8] ?? 0;
    bytes[6] = (version & 0x0f) | 0x40;
    bytes[8] = (variant & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error("No secure random source available for an idempotency key");
}
