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
