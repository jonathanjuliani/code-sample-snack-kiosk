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
pnpm test:e2e # Playwright at 1280×800, happy path and the failure paths (needs Chromium)
```

Chaos (API env, off by default):

```bash
CHAOS_LATENCY_MS=800 CHAOS_FAIL_RATE=0.3 pnpm --filter @kiosk/api dev
```

- `CHAOS_LATENCY_MS` — extra delay on every request
- `CHAOS_FAIL_RATE` — fraction of `POST /orders` responses dropped after the order is saved (0 to 1). Menu and health stay up. Retrying the same checkout returns that order.

Kiosk extras: `?kiosk=front-1` sets the kiosk id (defaults to `counter-1`). `?idle=5` shortens the idle wait to 5 seconds. A reload mid-payment resumes via `GET /orders?idempotencyKey=…`. The last good menu is cached in `localStorage`; browsing still works when the API is down, and Pay stays paused until `/health` recovers (the kiosk checks every 10 seconds). Staff assist, on the menu and on pay, posts to the counter. After a second decline, that button is also the way to ask for help.

Counter view: open `/ops` (for example <http://localhost:5173/ops>). It is unauthenticated on purpose. It shows the last 20 orders, how many duplicate submits, reprices, declines and idle resets the API has seen, the menu version, when each kiosk last checked in (and its app version; stale after 2 minutes), and open staff-assist requests. The simulation rail on the right is the demo harness: it sets the next payment result (including a declined tap, a dropped response, and a payment that never resolves), pauses payments, fails menu loads, raises one item by $0.50, or marks one item sold out. Those flags live in memory. Reset simulations, or restarting the API, clears them. A chosen payment result does not also roll `CHAOS_FAIL_RATE`. The rail does not press Pay or reset the customer screen. A real deployment would put this behind staff sign-in.

## API

Schemas live in [`packages/shared`](packages/shared/src); both apps import them. Money is always integer cents.

| Endpoint                            | Purpose                                                                                                                                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                       | Readiness, used by compose. Stays `200` with `payments: "down"` when the simulation pauses payments.                                                                                    |
| `GET /menu`                         | Categories, items (`priceCents`, `description`, `available`, `optionGroups`), `venue` (`name`, `accent`) and `version`. Sends an `ETag`; `If-None-Match` gets `304`.                    |
| `POST /orders`                      | Header `Idempotency-Key: <uuid>`. Body `{ kioskId, menuVersion, lines: [{ itemId, qty, choiceIds }], payment: { method: "card", cardNumber } \| { method: "tap" }, clientTotalCents }`. |
| `GET /orders?idempotencyKey=<uuid>` | What happened to a checkout attempt (used to resume after a reload).                                                                                                                    |
| `GET /orders/:id`                   | The state of one order.                                                                                                                                                                 |
| `GET /ops/summary`                  | Last 20 orders, reliability counters, menu version, kiosk last-seen, app version, and the last reported screen. No auth.                                                                |
| `GET /ops/simulation`               | The simulation flags and the menu items the rail can target. No auth.                                                                                                                   |
| `PUT /ops/simulation`               | Replace the flags. Unknown item ids are `400`. No auth.                                                                                                                                 |
| `POST /ops/events`                  | `{ kioskId, kind: "heartbeat" \| "idle_reset", appVersion?, screen?, payPhase?, itemCount?, totalCents? }`. The kiosk reports these. Answers `204`.                                     |
| `POST /kiosk/assist`                | `{ kioskId }`. Records an open staff-assist request. Answers `204`.                                                                                                                     |

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
| H6  | The customer walks away                                  | "Are you still there?" countdown, then back to the attract screen with an empty cart.                              |
| H7  | Empty cart, bad quantities, unknown item, malformed body | Schema validation and per-line limits; Pay is disabled on an empty cart.                                           |
| H8  | Finished                                                 | A big pickup number, then an automatic reset.                                                                      |
| H9  | Money                                                    | Integer cents everywhere; the server computes the total.                                                           |
| H10 | Card data                                                | Never stored or logged. Only the last 4 digits and a fake payment reference.                                       |

How to trigger each one:

| #   | Trigger                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------- |
| H1  | Tap the reader (or Pay) twice. Or `pnpm test:e2e`.                                                                    |
| H2  | Use card `4000 0000 0000 9995`, or throttle to Slow 3G and drop the tab mid-submit. Reload resumes the check.         |
| H3  | Stop the API and reload. If a menu was cached, browsing still works.                                                  |
| H4  | Change a price in `apps/api/seed/menu.json`, restart the API, pay with a cart built on the old menu.                  |
| H5  | Card `4000 0000 0000 0002`.                                                                                           |
| H6  | Wait 60s on the menu or at pay, or open `?idle=5`. "Are you still there?" lasts 10s. "I'm still here" keeps the cart. |
| H7  | Review and pay is disabled on an empty cart. The API rejects qty 0, qty 999 and unknown items with 400.               |
| H8  | Tap to pay, or card `4242 4242 4242 4242`.                                                                            |
| H9  | Every price in the seed and every total in the API is cents. `pnpm --filter @kiosk/api test` asserts it.              |
| H10 | Pay with a card, then inspect the SQLite row and the API log. The HTTP test asserts both.                             |

PCI, in one sentence: this is a fake keypad. A real deployment would tokenize through a PCI-certified terminal and never see a PAN.

What I left out is in [`docs/SKIPPED.md`](docs/SKIPPED.md). How I got here is in [`docs/PROCESS.md`](docs/PROCESS.md). The durable choices are in [`docs/DECISIONS.md`](docs/DECISIONS.md).
