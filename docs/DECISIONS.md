# Decisions

Short records of choices that outlive a single change. Each says what was rejected and why, so a later reader can tell a settled tradeoff from an accident. "Accepted" means I chose it; "Proposed" means the agent recorded it and I still have to confirm it.

## D1. A calm, typographic kiosk designed before any code

**Status**: Accepted

**Decision**: We will build the kiosk to the design in [`design/mockup/`](design/mockup/DECISIONS.md): one still start screen, an order screen with the menu grid and an always-visible order panel, a single review-and-pay screen, and a done screen with a big pickup number. A state machine drives the screens, not routes, so the browser's back gesture can't skip a recovery screen.

**Options considered**

- _Kiosk-shaped, low density, high contrast_ (chosen): a customer alone at arm's length, in a hurry, touch only. Type floor 20px, targets of 56px or more, primary actions 72px, no hover, no page scroll, no OS keyboard.
- _A responsive web shop_ (rejected): a scrolling page with a cart drawer reads as a website and hides the total.
- _A copy of a known brand's kiosk_ (rejected): borrowing a known brand's look says nothing about judgment.

**Recovery screens**: each one replaces the payment area; the order stays visible but locked.

| Case                    | Pattern                                                                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payment outcome unknown | Warning. "Checking your payment… Please don't pay again." No buttons. Keep checking the same payment; after 30s, a code to show at the counter. A new charge is never started for an unanswered payment. |
| Total changed           | Warning. Old and new totals side by side with the changed lines. "Pay $X.XX" or "Back to order".                                                                                                         |
| Declined                | Error. "Card not accepted", no blame, no bank codes. Order kept; "Try another card" or "Back to order".                                                                                                  |
| API down                | A warning strip; browsing works, Pay disabled with the reason on the button. Recovers on its own.                                                                                                        |

**Idle**: 60s on the order screen, 90s on checkout, then a 15s "Still there?" countdown. Suspended while a payment is in progress, being checked, or unresolved. Done resets after 12s.

**Tokens**: the role-based set in the mockup (type 18 / 20 / 24 / 32 / 40 / 56, spacing 4 to 48, AA contrast minimum and AAA for totals, one light theme on purpose). The web app copies these values unchanged into `apps/web/src/styles/tokens.css`.

**Consequences**: The client is one screen machine, which makes every recovery state explicit and testable. Reopen if the kiosk ever needs deep links (it shouldn't).

## D2. A pnpm workspace with a shared contract package

**Status**: Accepted

**Decision**: We will keep the API, the kiosk and the Zod contracts in one pnpm workspace (`apps/api`, `apps/web`, `packages/shared`).

**Options considered**

- _Workspace with `packages/shared`_ (chosen): two deployables really do share the order and menu schemas; a contract change fails typecheck on both sides in the same commit.
- _Two separate repos_ (rejected): a reader would need to clone two things, and the contract would drift.
- _One app with the API inside Vite_ (rejected): blurs the client/API boundary.

**Consequences**: One `pnpm install`, one `pnpm verify`. The shared package ships TypeScript source, no build step; Vite and Node's type stripping both read it directly.

## D3. Fastify for the API, validating with Zod by hand

**Status**: Accepted (Fastify); Proposed (no type provider)

**Decision**: We will use Fastify and call `schema.safeParse` on each request body ourselves.

**Options considered**

- _Fastify_ (chosen): mature, fast `inject()` for HTTP-seam tests without opening a port, a request id and structured logger built in.
- _Hono with `@hono/zod-validator`_ (rejected): lighter, but the logging and request-id baseline would be mine to assemble.
- _`fastify-type-provider-zod`_ (rejected): v7 requires `@fastify/swagger` and `openapi-types` as peers, for docs I don't need. Hand parsing is three lines per route and easier to explain.

**Consequences**: Error shapes are mine to keep consistent (one helper). Reopen if the API grows enough routes to want generated OpenAPI.

## D4. SQLite through better-sqlite3

**Status**: Accepted

**Decision**: We will persist the menu and orders in one SQLite file through `better-sqlite3`.

**Options considered**

- _SQLite with `better-sqlite3`_ (chosen): one file, real transactions, a unique index that makes idempotency a database guarantee rather than an `if`. Synchronous calls mean a check-then-insert has no `await` in the middle for a second request to slip into.
- _A JSON file_ (rejected): no transactions and no unique index; two quick requests can both read "no order yet" and both write one.
- _Node's built-in `node:sqlite`_ (rejected): no dependency at all, but still experimental on Node 22 and prints a warning on every start.
- _Postgres in compose_ (rejected): a second container and a migration tool for a single-counter kiosk.

**Consequences**: No ORM; the SQL is a few prepared statements in one file. `better-sqlite3` 13 bundles prebuilt binaries, and the workspace denies its build script so pnpm never tries to compile it. Reopen when there's more than one API process writing (SQLite serialises writers).

## D5. The idempotency record lives on the order, and the order is written before the payment call

**Status**: Accepted

**Decision**: We will store the idempotency key, a hash of the request, and the final response on the `orders` row (unique index on the key). The order is inserted as `pending_payment` in one transaction, the fake payment runs, and the result (status, pickup number, stored response) is written in a second transaction.

**Options considered**

- _Key, hash and response on `orders`; pending row first_ (chosen): a retry that arrives while the first request is still paying finds the pending row and gets `202`, never a second charge. If the process dies mid-payment, a `pending_payment` row is left for staff to reconcile, rather than a charge with no order at all.
- _One transaction around order and payment_ (rejected; it's what my plan first said): a transaction can't span the payment call, and with nothing written until the payment returns, an in-flight retry would see no order and charge again.
- _A separate `idempotency_keys` table_ (rejected): the key is one-to-one with an order here, so a second table only adds a join.

**What a reused key does**: same key and same request returns the stored response (`200` for a paid order, `402` for a declined one, `202` while pending). Same key with a different request is `422`. The request hash covers kiosk, lines, choices, payment method, the last 4 digits and the client total; it never includes the full card number.

**Consequences**: A declined attempt is final for its key; "Try another card" starts a new checkout attempt with a new key. Reopen if payments become real: the payment provider's own idempotency key should then be our order id.

## D6. The server prices every order; a changed total is a 409, not a silent charge

**Status**: Accepted

**Decision**: We will compute the total on the server from its own menu. If it differs from `clientTotalCents`, or an item is no longer available, the API answers `409` with every line re-priced, the new total, the unavailable item ids and the current menu version, and charges nothing.

**Options considered**

- _409 with the repriced order_ (chosen): the customer sees the new total before anything is charged; the client diffs the lines against what it showed and builds the "Prices updated" screen.
- _Charge the new price silently_ (rejected): the total on screen would not be the total charged.
- _Trust the client's prices_ (rejected): any client bug, or anyone with dev tools, sets the price.
- _Reject when `menuVersion` differs at all_ (rejected): a change to an item not in the cart would block a correct order.

**Consequences**: The client compares totals, not versions, before showing the change. The 409 lists all lines instead of only the changed ones, because the server doesn't know what the client displayed; the client does that diff.

## D7. Item options are in scope

**Status**: Accepted

**Decision**: We will support option groups (exactly one choice per group, each choice with a `deltaCents`), as designed in the mockup. Order lines carry `choiceIds`; the server validates and prices them.

**Options considered**

- _Options in_ (chosen): the mockup's option sheet is already designed, and a food kiosk without "Large" or "Oat milk" looks like a toy. Cost: about 1.5 to 2 hours.
- _Flat items only_ (rejected): simpler contract, but the option sheet in the mockup would have nothing to drive.
- _Option groups and choices as their own tables_ (rejected after drafting the data model): they're only read with their item, never queried alone, so they live as a JSON column on `menu_items`, validated by the shared Zod schema at seed time.

**Consequences**: Combos and multi-select groups ("extra toppings") stay out; see Skipped.

## D8. Resuming after a reload looks the attempt up by its idempotency key

**Status**: Accepted

**Decision**: We will add `GET /orders?idempotencyKey=…`. After a reload mid-payment, the kiosk reads the key from `sessionStorage` and asks the API what happened to that attempt.

**Options considered**

- _Lookup by key_ (chosen): the key is the only thing the client is guaranteed to have, because it's created before the request is sent. `404` means the request never landed, so the customer was not charged and goes back to Pay with the cart intact.
- _`GET /orders/:id` only_ (rejected as the reload path): if the response was lost, the client never learned the order id.
- _Re-send the original `POST`_ (rejected): the card number can't be kept in `sessionStorage`, so the retried body would differ and get `422`.

**Consequences**: `GET /orders/:id` stays for staff and debugging. Within one page session, a network drop still retries the original `POST` with the same key (the card number is in memory).
