# API

Schemas live in [`packages/shared`](../packages/shared/src); both apps import them. Money is always integer cents. Why each response looks the way it does is in [DECISIONS](DECISIONS.md) (D5, D6, D8, D9, D16).

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

| Outcome                                           | Status | Body                                                                                       |
| ------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| Paid                                              | `201`  | `{ orderId, status: "paid", pickupNumber, totalCents, lines, paymentMethod, last4 }`       |
| Same key, same request, already paid              | `200`  | the original body, with `Idempotent-Replayed: true`                                        |
| Same key, same request, already declined          | `402`  | the original body, with `Idempotent-Replayed: true`                                        |
| Same key, same request, still paying              | `202`  | `{ orderId, status: "pending_payment" }`                                                   |
| Same key, different request                       | `422`  | `{ error: "idempotency_key_reused" }`                                                      |
| Price changed or item unavailable                 | `409`  | `{ error: "order_changed", totalCents, lines, unavailableItemIds, menuVersion }`           |
| Payment declined                                  | `402`  | `{ orderId, status: "payment_failed", error: "payment_declined", message }` (safe to show) |
| Invalid body, unknown item or option, missing key | `400`  | `{ error: "invalid_request", issues: [{ path, message }] }`                                |

PCI in one sentence: this is a fake keypad. A real deployment would tokenize through a PCI-certified terminal and never see a card number.
