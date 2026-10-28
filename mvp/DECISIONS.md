# Design decisions

The mockup in [`index.html`](index.html) implements everything below. Open it in a browser; the mock controls panel beside the kiosk forces each recovery screen and speeds up the timers.

## Direction

A focused-task kiosk for a hurried customer standing alone at arm's length, touch only, in a calm, high-contrast, typographic language. Low variance, purposeful motion, low density. Landscape 1280×800 first; portrait 800×1280 stacks the same zones.

Constraints that win over taste: AA contrast minimum (AAA for prices and totals), touch targets of 56px or more, no hover, no page scroll, no OS keyboard, colour never the only signal, a way out on every screen, and no brand identity borrowed from any restaurant chain. The total shown is the total charged; any change gets its own screen.

References were read from shipped flows only: the Square, Toast and Clover kiosks, Stripe Terminal, McDonald's, Shake Shack, the BoothIQ photo booth, and UK rail ticket machines. No concept shots.

## Structure

Four screens and one overlay, driven by a state machine rather than routes, so the browser's back gesture can't skip a recovery screen.

1. **Start**: "Tap anywhere to start" on a still screen.
2. **Order**: the menu grid (category tabs, 6 tiles per page, paging instead of scroll) with the order panel on the right. Items without options add with one tap; items with options open a sheet whose Add button shows the price. At a quantity of 1, minus becomes remove.
3. **Checkout**: review and pay on one screen. The order is read-only on the left and payment is on the right. Tap to pay is the default; "Enter card number" opens an on-screen numpad.
4. **Done**: order number, then an automatic return to Start.
- **Still there?**: a full-screen overlay on Order or Checkout, never while a payment is in progress.

Always visible on Order and Checkout: the total and item count, the primary action bottom right, Start over top left (hidden while a payment is in progress), and Help top right. Names: Order, Item, Total, Pay, Start over, Done.

In portrait the order panel becomes a bottom dock showing the count, total and Review and pay, and expands to the line items. Checkout stacks payment above the order.

## Recovery screens

Each one replaces the payment area. The order panel stays visible but locked.

| Case | Pattern | Why |
| --- | --- | --- |
| Payment outcome unknown | Warning colour. "Checking your payment… Please don't pay again." No buttons. The app keeps checking the status of the same payment, then moves to Done or Declined. After 30s: "We couldn't confirm your payment. You have not been asked to pay twice. Show this code at the counter." | A new charge is never started for an unanswered payment (Stripe Terminal's rule). Taking the Pay button away is what prevents a double charge. |
| Total changed | Checked when the customer taps Review and pay, and again when the order is submitted. Warning colour. "Prices updated" with old and new totals side by side and the changed lines. "Pay $X.XX" or "Back to order". | Nothing is charged without a fresh tap, and the customer sees the change before any card prompt. |
| Declined | Error colour and icon. "Card not accepted", with no blame and no bank codes. "Try another card" or "Back to order". The order is kept. | Discreet, offers another method (Toast's guidance). The retry uses the same payment so it can't become a second charge. |
| API down | A persistent warning strip: "Payment is unavailable right now. You can still browse." Pay is disabled with the reason written on the button. Recovers on its own. If no menu was ever loaded, Start shows "Ordering is unavailable right now." | Block payment until the connection returns (Stripe's deployment checklist); browsing still works. |

## Idle timeout

- 60s idle on Order, 90s on Checkout (typing a card number is slow).
- Then "Still there?" with a 15s countdown. "Keep ordering" is primary, "Start over" secondary, and any tap dismisses it.
- Done resets after 12s. The unresolved-payment screen stays for 60s so the code can be read.
- Timers are suspended while a payment is in progress, being checked, or unresolved. A timeout never discards a paid order.
- Every change of screen or payment state restarts the idle clock. Found while testing the mockup: without this, a customer who waited through "Checking your payment" got the idle prompt the moment the declined screen appeared, and their order was wiped.

## Tokens

Two layers: primitives, then roles. Components only use roles. One theme on purpose: the customer can't choose one on a kiosk, and a dark theme would be a swap of values.

- **Type** (system-ui, weights 500 and 700, tabular numbers on all prices):
  - label 18
  - body 20 (the floor for anything the customer acts on)
  - item 24
  - heading 32
  - total 40
  - display 56 (amount to pay, order number)
- **Spacing**: 4 / 8 / 12 / 16 / 24 / 48. At least 12px between adjacent targets.
- **Targets**:
  - minimum 56px
  - primary actions 72px
  - numpad keys 80px
  - tile 160px minimum
- **Colour roles**:
  - bg `#F5F4F0`, surface `#FFFFFF`
  - text `#14161A` (16.4:1 on bg), text-muted `#4A4F57` (8.3:1)
  - action `#14161A`, accent `#1D4ED8` (focus and selection, 6.7:1)
  - success `#1E7A3C` (5.4:1 with white)
  - warning `#8A5A00` on `#FFF4D6` (5.4:1)
  - error `#B3261E` on `#FDECEA` (5.7:1)
  - disabled text `#5C6169` on `#E4E3DE` (4.9:1, so the reason stays readable)
- **Shape and motion**:
  - radius 8 (controls), 16 (cards and sheets), pill for badges
  - motion 120ms on tap, 200ms on state changes, none under reduced motion
  - the "checking" spinner is the only thing that keeps moving

## Mockup simplifications

- Card entry takes only a 16-digit number: no expiry, no card-number check.
- The menu is hard-coded and there's no API; prices and payment outcomes are simulated in the page.
- Tiles use a category icon instead of photos.
- The order panel scrolls internally when it has many lines, the one exception to "no scroll".
