# AGENTS.md

A self-service snack-bar kiosk: `apps/api` (Fastify + SQLite), `apps/web` (Vite + React), `packages/shared` (Zod contracts both import). Vocabulary is in [CONTEXT.md](CONTEXT.md).

## Before you finish a change

```bash
pnpm verify   # biome check, tsc in every package, vitest in every package
```

CI runs the same command and `pnpm test:e2e` on every pull request, so a change that fails here fails there. The pre-commit hook refuses unformatted staged files; fix with `pnpm format`, never with `--no-verify`.

## When adding or changing a field on an order, a line or a menu item

- Change the Zod schema in `packages/shared` first and infer the type from it. Never hand-write a type the schema already describes.
- Money is an integer number of cents (`...Cents`) everywhere: schema, database column, client state. Never a float, never a formatted string, until the moment it is rendered.

## When pricing anything

The server prices the order from its own menu. The client's `clientTotalCents` is only compared with the server total; a mismatch is a 409 with the changed lines, never a silent charge at the new price.

## When touching payment data

No card number is stored, logged or echoed back. Persist only `last4` and the fake payment reference. The logger redacts `payment.cardNumber`; keep any new payment field out of logs the same way, and keep the test that asserts the stored row and the log output.

## When submitting an order

Every `POST /orders` carries an `Idempotency-Key` generated once per checkout attempt and reused for every retry of that attempt. The API dedupes on a unique index. Do not generate a new key on retry; that is how a customer gets charged twice.

## When running the code

- Node runs the API's TypeScript directly (type stripping), so source must stay erasable: no `enum`, no `namespace`, no parameter properties. Relative imports keep their `.ts` extension.
- `better-sqlite3` loads its bundled prebuilt binary. `allowBuilds: false` in `pnpm-workspace.yaml` is deliberate: approving the build makes pnpm compile it with node-gyp, which fails in a slim container.
