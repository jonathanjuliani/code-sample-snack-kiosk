# Skipped, and where it would plug in

Each item is one line plus the seam. I left these out on purpose.

- **Real payments.** The fake gateway in `apps/api/src/orders/payment.ts` is the seam. A real terminal would replace `createFakeGateway` and send its own idempotency key as our order id (D5).
- **Auth.** There is none. An operator login would sit in front of any future `/ops` page and the menu seed.
- **Admin / menu editing.** The menu is `apps/api/seed/menu.json` loaded into SQLite. An editor would write those rows; `menu.version` already changes when contents change.
- **Multi-store.** One snack bar, one menu. A store id would join `kioskId` and the menu seed.
- **i18n.** English only. Copy is in the React screens, not a dictionary.
- **Receipts.** The done screen is the receipt. Email or print would hang off the paid order row.
- **Combos.** Option groups are in (exactly one choice each). A combo is a second item type with its own line rules.
- **Tax.** Totals are the sum of line cents. Tax would be a second integer on the order, computed on the server next to `priceOrder`.
- **Deployment.** Docker Compose is the run path. No cloud, no CI deploy, no TLS.
- **`/ops`, stock races, a screen recording.** Cut-line items from the plan. `/ops` would read `orders` and a few counters; stock would decrement in the same transaction that inserts the order.
