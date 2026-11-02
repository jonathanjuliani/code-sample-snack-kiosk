# Vocabulary

- **Kiosk**: one tablet at the counter, identified by `kioskId` (from the URL, `?kiosk=front-1`).
- **Menu**: the categories and items the API serves. **Menu version** is a hash of its contents; the client sends the version it priced against.
- **Item**: something on the menu, with a base price in cents and an `available` flag.
- **Option group** and **option choice**: a choice the customer makes on an item (Size: Regular or Large). Each group needs exactly one choice; a choice can add `deltaCents` to the price.
- **Order**: what the customer pays for. States: `pending_payment`, `paid`, `payment_failed`.
- **Line**: one item, its chosen options and a quantity. Two lines with the same item and choices are merged in the client.
- **Idempotency key**: a UUID generated once per checkout attempt. Retrying the same attempt reuses it; the API returns the original result instead of creating a second order.
- **Pickup number**: short and human (`A-042`), unique per day, shown big on the done screen.
- **Checkout attempt**: from the first Pay tap until the order is paid, declined, or abandoned.
- **Needs attention**: any screen that replaces the payment area when reality didn't cooperate: payment unknown, total changed, declined, API down.
- **Venue**: the name and accent returned with the menu. The kiosk shows that name. The accent is used only when white text on it stays readable.
- **Staff assist**: a request from the kiosk (`POST /kiosk/assist`) that shows up on the counter page. Idle waits while one is open.
- **Checking**: the pay phase after a submit whose outcome the kiosk doesn't know (a dropped response, a `202`, or a reload mid-payment). The kiosk asks `GET /orders?idempotencyKey=` and never starts a new charge.
- **Unresolved**: checking ran for 30 seconds without an answer. The customer gets a code (`K` + the first 4 characters of the key) to show at the counter. The order stays `pending_payment`.
- **Simulation rail**: the right-hand panel on `/ops` that sets in-memory flags (next payment result, payments paused, menu fails, a price bump, a sold-out item) so each recovery screen can be forced. Not a staff tool.
