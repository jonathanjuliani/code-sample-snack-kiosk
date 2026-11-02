# Approach

How I went at this, in order. Status per item is in [COVERAGE](COVERAGE.md), the choices are in [DECISIONS](DECISIONS.md), and the tool-by-tool log is in [PROCESS](PROCESS.md).

## 1. Understanding the problem

The idea with the approach was to think of it working like a tablet on a snack-bar counter, with nobody behind it and a hurried customer who has never used it. They'll tap twice, walk off halfway, reload, and use the card that gets declined. Nobody is there to explain, so the screen has to.

Before any code I asked three questions:

- In this situation, what can we try to avoid on the screen?
- What can we try to avoid between the screen and the server?
- What are the priorities that we must avoid?

The answer to the last one was short: a double charge, a lost order, someone else's order on screen, a card number on disk.

The rest hangs off these ideas:

- **Idempotency per checkout attempt.** One key, reused on every retry. The database refuses a second order for it ([D5](DECISIONS.md#d5-the-idempotency-record-lives-on-the-order-and-the-order-is-written-before-the-payment-call)).
- **The server sets the price.** The client's total is compared, never trusted ([D6](DECISIONS.md#d6-the-server-prices-every-order-a-changed-total-is-a-409-not-a-silent-charge)).
- **Integer cents**, from schema to column to client state ([H9](COVERAGE.md#must-handle-h)).
- **An unknown payment outcome is its own state.** "Checking your payment…" is neither error nor success, and it never offers a button that could charge again ([H2](COVERAGE.md#must-handle-h)).
- **The idle reset is a privacy feature** ([K4](COVERAGE.md#kiosk-specific-problems-k)).
- **Card data stays out of scope.** Not having a card number beats protecting one ([H10](COVERAGE.md#must-handle-h)).

## 2. Looking at how real kiosks do it

I read shipped flows, not concept shots: restaurant ordering kiosks and the POS products behind them, a card terminal's integration guide, a photo booth, rail ticket machines ([PROCESS Phase 2](PROCESS.md#phase-2-design-research)). I looked at what they do on a timeout, a decline, a dropped connection, and when someone needs a person.

What it changed:

- An attract screen, and an idle reset that asks before it clears.
- Three fixed zones, with the order and its total always visible.
- An on-screen numpad instead of the OS keyboard.
- A "Staff assist" button that reaches the counter ([K9](COVERAGE.md#kiosk-specific-problems-k)).
- Payment copy that says what's happening and what not to do: "Please don't pay again".
- Theming per venue. These kiosks run under the operator's brand, not the software maker's, so the name and the contrast-checked accent come from the venue ([K10](COVERAGE.md#kiosk-specific-problems-k)).

Then design before code: a clickable mockup of every screen and recovery state ([`docs/design/mockup/`](design/mockup/DECISIONS.md)), then tokens, then the build. The recovery screens existed before the happy path did.

## 3. Cataloguing the problems

Before building I wrote the requirements down as a table, and I kept adding to it:

- what a lone customer will do ([H](COVERAGE.md#must-handle-h))
- what makes it usable and checkable ([S](COVERAGE.md#should-handle-s))
- what's specific to an unattended counter ([K](COVERAGE.md#kiosk-specific-problems-k))
- the usual traps of a checkout like this ([T](COVERAGE.md#traps-to-avoid-t))

I also wrote down the questions that only matter at scale, without solving them here:

- A card terminal that times out after charging.
- Two kiosks racing for the last item.
- An offline period.
- Rolling a menu out to a fleet.
- Growing from one counter to many stores.

## 4. Deciding what to build and what not to

I ranked items by value to the person at the screen, against effort and risk:

1. Anything that could charge twice, lose an order or leak card data.
2. What a customer notices in the first minute.
3. What only an operator notices.

The cut lines:

- **Item options stayed in.** About two hours, because a snack bar without "Large" looks like a toy ([D7](DECISIONS.md#d7-item-options-are-in-scope)).
- **Stock counts went out** ([D19](DECISIONS.md#d19-stock-races-are-deferred)).
- **Offline payments went out** ([D18](DECISIONS.md#d18-a-cached-menu-but-no-offline-payments)).
- **Three extra test suites went out:** portrait, axe and a browser reload. The features stayed.

Real payments, auth, menu editing, multi-store, tax and receipts were never in. Each one is listed in [Skipped](../README.md#skipped-and-why) with where it would plug in.

Solving everything was never the goal. Deciding what to leave out, and saying so, is part of the design.

## 5. Proving it

The tests aim at the paths that can hurt someone, not at a coverage number: double submit, a response dropped after the order was saved, decline then another card, a changed price, a sold-out line, a menu that won't load, payments going down, idle both ways, a payment that never answers. That's 108 unit and HTTP tests and 18 browser tests ([S6](COVERAGE.md#should-handle-s)).

To see the failures without reading tests there are test cards, two chaos flags, and a simulation rail on `/ops` that forces each recovery screen on a real tablet ([D16](DECISIONS.md#d16-the-counter-can-force-the-recovery-cases)).

In the last pass I ran everything from a fresh clone and wrote down what failed: one lint error (since fixed, and now gated in CI and a pre-commit hook), and two README instructions that didn't do what they said ([Known gaps](COVERAGE.md#known-gaps)).

## 6. Where it would go next

For size: a fleet doing tens of millions of transactions a month averages about 15 a second. The peaks are local (a few stadiums at halftime), so checkout should never wait on a central service ([D20](DECISIONS.md#d20-the-kiosk-waits-only-on-the-venues-own-api)).

- **A terminal that times out after charging.**
  - Changes: the gateway in `apps/api/src/orders/payment.ts` asks the provider about our order id before answering, and a job reconciles `pending_payment` rows.
  - Stays: the screen. "Checking your payment…" exists for this.
- **Two kiosks, the last item.**
  - Changes: a `stock` column and a conditional decrement in the insert transaction.
  - Stays: the 409 contract.
- **Offline.**
  - Changes: a local journal with client-made ids and an idempotent upload.
  - Stays: payments wait for authorization.
- **A menu for the fleet.**
  - Changes: a versioned menu per store, pulled with the existing `ETag`, rolled out in stages and back by version.
  - Stays: the client.
- **Many stores.**
  - Changes: a store id beside `kioskId`, and SQLite per venue syncing to a central database for reporting.
  - Stays: `packages/shared` as the contract.
