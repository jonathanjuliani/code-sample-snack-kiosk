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

Without Docker (Node 24 or 26, pnpm 11; `corepack enable` gives you the pinned pnpm):

```bash
pnpm install
pnpm dev
```

Open <http://localhost:5173>. The API listens on port 3000 and the web dev server proxies `/api` to it. `--host` is on, so a tablet on the same network can open `http://<your-ip>:5173`.

Checks:

```bash
pnpm verify   # lint, typecheck, unit and HTTP tests
pnpm test:e2e # Playwright happy path + double-tap (needs Chromium)
```

Chaos (API env, off by default):

```bash
CHAOS_LATENCY_MS=800 CHAOS_FAIL_RATE=0.3 pnpm --filter @kiosk/api dev
```

- `CHAOS_LATENCY_MS` — extra delay on every request
- `CHAOS_FAIL_RATE` — fraction of requests that return 503 (0 to 1)

Kiosk extras: `?kiosk=front-1` sets the kiosk id (defaults to `kiosk-1`). A reload mid-payment resumes via `GET /orders?idempotencyKey=…`. The last good menu is cached in `localStorage`; browsing still works when the API is down, payment is blocked.

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

How to trigger each one:

| #   | Trigger                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------- |
| H1  | Tap the reader (or Pay) twice. Or `pnpm test:e2e`.                                                            |
| H2  | Use card `4000 0000 0000 9995`, or throttle to Slow 3G and drop the tab mid-submit. Reload resumes the check. |
| H3  | Stop the API and reload. If a menu was cached, browsing still works.                                          |
| H4  | Change a price in `apps/api/seed/menu.json`, restart the API, pay with a cart built on the old menu.          |
| H5  | Card `4000 0000 0000 0002`.                                                                                   |
| H6  | Wait ~60s on the menu or ~90s on checkout. "Still there?" lasts 15s.                                          |
| H7  | Review and pay is disabled on an empty cart. The API rejects qty 0, qty 999 and unknown items with 400.       |
| H8  | Tap to pay, or card `4242 4242 4242 4242`.                                                                    |
| H9  | Every price in the seed and every total in the API is cents. `pnpm --filter @kiosk/api test` asserts it.      |
| H10 | Pay with a card, then inspect the SQLite row and the API log. The HTTP test asserts both.                     |

PCI, in one sentence: this is a fake keypad. A real deployment would tokenize through a PCI-certified terminal and never see a PAN.

What I left out is in [`docs/SKIPPED.md`](docs/SKIPPED.md). How I got here is in [`docs/PROCESS.md`](docs/PROCESS.md). The durable choices are in [`docs/DECISIONS.md`](docs/DECISIONS.md).
