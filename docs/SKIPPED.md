# Skipped, and where it would plug in

Each item is one line plus the seam. I left these out on purpose.

- **Real payments.** The fake gateway in `apps/api/src/orders/payment.ts` is the seam. A real terminal would replace `createFakeGateway` and send its own idempotency key as our order id (D5).
- **Auth.** There is none. An operator login would sit in front of `/ops` and the menu seed.
- **Admin / menu editing.** The menu is `apps/api/seed/menu.json` loaded into SQLite. An editor would write those rows; `menu.version` already changes when contents change.
- **Multi-store.** One snack bar, one menu. A store id would join `kioskId` and the menu seed.
- **i18n.** English only. Copy is in the React screens, not a dictionary.
- **Receipts.** The done screen is the receipt. Email or print would hang off the paid order row.
- **Combos.** Option groups are in (exactly one choice each). A combo is a second item type with its own line rules.
- **Tax.** Totals are the sum of line cents. Tax would be a second integer on the order, computed on the server next to `priceOrder`.
- **Deployment.** Docker Compose is the run path. No cloud, no CI deploy, no TLS.
- **Stock races and a screen recording.** Cut-line items. Two kiosks racing for the last item would decrement stock in the same transaction that inserts the order; the loser would get a 409. A recording of chaos is optional and not in the repo.
- **Portrait end-to-end test.** The layout stacks at 900px and under (category bar, two columns, order sheet). An automated 800×1280 pass was cut. The tablet suite stays at 1280×800.
- **axe smoke.** Labels, contrast tokens, and focus rings are in. `@axe-core/playwright` was cut.
- **Reload-mid-payment end-to-end test.** The resume path is still there: the attempt key is in `sessionStorage`, and `GET /orders?idempotencyKey=` brings back the outcome. A machine test covers that resume. The Playwright reload was cut.
