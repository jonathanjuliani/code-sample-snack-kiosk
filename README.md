# Snack Bar Kiosk

A self-service checkout for a snack bar. A customer walks up to a tablet on the counter, browses the menu, builds an order, pays, and leaves. Nobody is behind the counter to help, so the app has to behave when things go wrong.

What it covers:

- A client app shows the menu fetched from an API, lets someone build an order, take a (fake) payment, and submit it.
- The API serves the menu and accepts the order. Orders persist; payment does not need to be real.
- Everything else (data shape, endpoints, UX, failure handling) is mine to decide.
- The person at the screen is alone, in a hurry, and will do things I didn't plan for.

## Run it

With Docker:

```bash
docker compose up --build
```

Open <http://localhost:8800>. If that port is taken: `WEB_PORT=8900 docker compose up --build`.

Without Docker (Node 22.18 or newer, pnpm 11; `corepack enable` gives you the pinned pnpm):

```bash
pnpm install
pnpm dev
```

Open <http://localhost:5173>. The API listens on port 3000 and the web dev server proxies `/api` to it. `--host` is on, so a tablet on the same network can open `http://<your-ip>:5173`.

Checks:

```bash
pnpm verify   # lint, typecheck, unit and HTTP tests
```

## API

Schemas live in [`packages/shared`](packages/shared/src); both apps import them. Money is always integer cents.

| Endpoint                            | Purpose                                                                                                                                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                       | Readiness, used by compose.                                                                                                                                                             |
| `GET /menu`                         | Categories, items (`priceCents`, `available`, `optionGroups`) and `version`. Sends an `ETag`; `If-None-Match` gets `304`.                                                               |
| `POST /orders`                      | Header `Idempotency-Key: <uuid>`. Body `{ kioskId, menuVersion, lines: [{ itemId, qty, choiceIds }], payment: { method: "card", cardNumber } \| { method: "tap" }, clientTotalCents }`. |
| `GET /orders?idempotencyKey=<uuid>` | What happened to a checkout attempt (used to resume after a reload).                                                                                                                    |
| `GET /orders/:id`                   | The state of one order.                                                                                                                                                                 |

What `POST /orders` answers:

| Outcome                                           | Status              | Body                                                                                       |
| ------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------ |
| Paid                                              | `201`               | `{ orderId, status: "paid", pickupNumber, totalCents, lines, paymentMethod, last4 }`       |
| Same key, same request, already finished          | the original status | the original body, with `Idempotent-Replayed: true`                                        |
| Same key, same request, still paying              | `202`               | `{ orderId, status: "pending_payment" }`                                                   |
| Same key, different request                       | `422`               | `{ error: "idempotency_key_reused" }`                                                      |
| Price changed or item unavailable                 | `409`               | `{ error: "order_changed", totalCents, lines, unavailableItemIds, menuVersion }`           |
| Payment declined                                  | `402`               | `{ orderId, status: "payment_failed", error: "payment_declined", message }` (safe to show) |
| Invalid body, unknown item or option, missing key | `400`               | `{ error: "invalid_request", issues: [{ path, message }] }`                                |

Test cards (payment is fake and deterministic):

| Card number           | Result                                                       |
| --------------------- | ------------------------------------------------------------ |
| `4242 4242 4242 4242` | Approved                                                     |
| `4000 0000 0000 0002` | Declined                                                     |
| `4000 0000 0000 9995` | Slow: approves after 15 seconds, longer than the kiosk waits |
| Tap                   | Approved                                                     |

Any other 16-digit number is approved.

## What happens when…

These are the requirements I set myself before writing code.

| #   | Situation                                                | What the kiosk does                                                                                                |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| H1  | Double tap, or Pay pressed again                         | One order. The button locks, and the API dedupes on the `Idempotency-Key`.                                         |
| H2  | The network drops during payment                         | The client retries with the same key and shows "Checking your payment, please don't pay again", never a raw error. |
| H3  | The menu fails to load                                   | A friendly retry with backoff, never a blank page.                                                                 |
| H4  | A price changed or an item sold out                      | The server prices the order and answers 409 with the difference; the customer confirms the new total.              |
| H5  | Payment declined                                         | A clear message, the cart is kept, try another card or tap.                                                        |
| H6  | The customer walks away                                  | "Still there?" countdown, then back to start with an empty cart.                                                   |
| H7  | Empty cart, bad quantities, unknown item, malformed body | Schema validation and per-line limits; Pay is disabled on an empty cart.                                           |
| H8  | Finished                                                 | A big pickup number, then an automatic reset.                                                                      |
| H9  | Money                                                    | Integer cents everywhere; the server computes the total.                                                           |
| H10 | Card data                                                | Never stored or logged. Only the last 4 digits and a fake payment reference.                                       |
