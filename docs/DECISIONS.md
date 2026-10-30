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

**Idle**: 60s on the order screen, 90s on checkout, then a 15s "Still there?" countdown. Suspended while a payment is in progress, being checked, or unresolved. Done resets after 12s. Superseded by D15.

**Tokens**: the role-based set in the mockup (type 18 / 20 / 24 / 32 / 40 / 56, spacing 4 to 48, AA contrast minimum and AAA for totals, one light theme on purpose). The first client copied these values. D10 replaces them with the enhancement-pass set in `apps/web/src/styles/tokens.css`.

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

## D9. The counter page is unauthenticated

**Status**: Accepted

**Decision**: We will serve a read-only `/ops` page and `GET /ops/summary` with no login. The kiosk posts a heartbeat and an idle reset to `POST /ops/events`. Replays, 409s and declines are counted inside the order route.

**Options considered**

- _Same app, no auth_ (chosen): one page you can open after a double-tap and see the counter move. A second app, or a login, is more to run on clone than the page is worth.
- _Staff auth now_ (rejected): there are no accounts, and a fake login would pretend this is a back office.
- _Leave it written in Skipped_ (rejected for this pass): the reliability story was already in the API, and the page is the two-minute demo of it.

**Consequences**: Anyone who can reach the API can read recent orders (status, kiosk, total, pickup number, no card data) and open staff-assist requests. Say so in the README. A real counter sits behind staff sign-in, in front of these routes. D16 lets the same page write simulation flags. The summary of orders, counters, kiosks, and assists stays a read.

The summary keeps the counter names from the first `/ops` pass (`idempotentReplays`, `reprices`, `declines`, `idleResets`). Renaming them to match a later sketch would churn the tests for no change in what the page shows. The heartbeat stays `POST /ops/events` and now carries `appVersion`. A kiosk last seen more than two minutes ago is marked Stale, in words, not by color alone.

## D10. The customer screen follows the enhancement mockup

**Status**: Accepted

**Decision**: We will restyle the kiosk to the enhancement-pass spec: Archivo and Inter, the snack-bar orange, a 220px category rail, a 3-column menu, a 380px order panel, and the screen copy in that spec. D1's system font, dark buttons, and paged grid are the earlier mockup. This pass replaces that look. Option groups stay (D7).

**Options considered**

- _Restyle in place_ (chosen): the behavior was already right. The look was the gap.
- _Keep D1's look_ (rejected): the enhancement mockup was my newer and fuller design of the same screen. D1's look was the first draft.

**Consequences**: Tokens live in `apps/web/src/styles/tokens.css`. Components do not carry their own hex colors. If checking a payment never gets a terminal answer, the 30-second counter code stays. The spec assumes the poll resolves; a customer whose request never comes back still needs something to show at the counter.

## D11. Fonts are self-hosted

**Status**: Accepted

**Decision**: We will ship Archivo (600/700/800) and Inter (400–700), Latin only, from `@fontsource/archivo` and `@fontsource/inter`, with `font-display: swap`.

**Options considered**

- _Self-hosted files_ (chosen): a kiosk that cannot render without a third-party CDN is not a kiosk.
- _Google Fonts_ (rejected): the clone-and-run path has to work offline.
- _System fonts_ (rejected): that was D1. The enhancement mockup names Archivo and Inter.

**Consequences**: Two font packages, and only the weights the screens use.

## D12. The accent belongs to the venue

**Status**: Accepted

**Decision**: `GET /menu` returns `venue: { name, accent }`. The client sets `--accent` only when white text on that color is at least 4.5:1. Otherwise it keeps `#C2410C` and logs a warning. The screen shows the venue name. It never shows the name or logo of whoever made the software.

**Options considered**

- _Per-venue accent, contrast-checked_ (chosen): these kiosks run under the venue's brand, and a failed contrast check would make the primary button unreadable.
- _One hard-coded orange_ (rejected): the brand line would be ours, not the operator's.

**Consequences**: Tints and the accent ink are derived with `color-mix` from `--accent`. The seed venue is Snack Bar / `#C2410C`.

## D13. Chaos drops the order response after it is saved

**Status**: Accepted

**Decision**: `CHAOS_FAIL_RATE` applies only to `POST /orders`, and only after the paid or declined row is committed. The socket is destroyed, so the kiosk sees a network drop. The same idempotency key then replays the stored order. `CHAOS_LATENCY_MS` still delays every request.

**Options considered**

- _Drop after commit_ (chosen): that is the double-charge case. The server succeeded and the client did not see it.
- _503 before the handler_ (rejected; it is what the first pass did): the order was never saved, so a retry is a new charge, not a replay.

**Consequences**: Menu, health, and `/ops` stay up when the fail rate is 1. A replay is not dropped, or the kiosk could never recover.

## D14. Staff assist is a real request

**Status**: Accepted

**Decision**: "Staff assist" posts `POST /kiosk/assist { kioskId }`. The open request shows on `/ops`. Idle does not fire while that request is active. After a second decline, the secondary button is "Get staff help" instead of "Use another card".

**Options considered**

- _A stored request_ (chosen): the counter can see that someone is waiting.
- _A local help dialog_ (rejected): it told the customer how the kiosk works and told nobody else.

**Consequences**: The request stays open for the demo. There is no "staff arrived" button. Idle stays paused until the order is cleared.

## D15. Idle is one minute, then ten seconds

**Status**: Accepted

**Decision**: Idle is 60 seconds on the menu and on pay, then a 10-second "Are you still there?" countdown. `?idle=` overrides the first wait, in seconds, for demos. The done screen returns to the attract screen after 8 seconds. Each tap restarts the clock. Payment in progress, checking, and an open staff-assist request do not.

**Options considered**

- _60s / 10s, with `?idle=`_ (chosen): one number to explain, and a query param so a demo does not wait a minute.
- _60s on the menu and 90s at checkout_ (rejected; it is what D1 recorded): typing a card already restarts the clock on each key, so the extra 30 seconds was not buying much.

**Consequences**: D1's idle paragraph is the earlier rule. This one wins.

## D16. The counter can force the recovery cases

**Status**: Accepted

**Decision**: We will let `/ops` write an in-memory simulation: the next payment result, paused payments, a failing menu, a fifty-cent price bump, and one sold-out item. The kiosk keeps reacting to the menu, to health, and to `POST /orders`. The counter will not tap, reset, or resize the customer screen.

**Options considered**

- _Server flags the kiosk already understands_ (chosen): one laptop on `/ops` and one tablet on the kiosk. The flags are not written into the menu rows, so a restart restores the seed.
- _Mutate the kiosk from the same page, as the mockup sidebar does_ (rejected): `/ops` and the kiosk are different routes, and a portrait toggle cannot resize the tablet.
- _Remote commands for tap and reset_ (rejected): that is a channel from the counter into the cart. D9 kept the counter from driving the customer.
- _Persist the flags in SQLite_ (rejected): a crash would leave a bumped price in the seed. Memory plus Reset is enough for a demo.

**Consequences**: Anyone who can reach the API can pause payments or force a decline. That is the same trust as D9, and a real counter still wants staff sign-in. `CHAOS_FAIL_RATE` still applies when the payment select is "Follow the card"; a chosen result does not also roll that dice. "No response, never resolves" leaves a `pending_payment` row. The heartbeat may carry the screen, the pay phase, the item count, and the total. It still carries no card number. Reopen if the counter gets sign-in, or if a demo needs to drive the customer's screen.
