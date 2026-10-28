# Snack Bar Kiosk

A self-service checkout for a snack bar. A customer walks up to a tablet on the counter, browses the menu, builds an order, pays, and leaves. Nobody is behind the counter to help, so the app has to behave when things go wrong.

What it covers:

- A client app shows the menu fetched from an API, lets someone build an order, take a (fake) payment, and submit it.
- The API serves the menu and accepts the order. Orders persist; payment does not need to be real.
- Everything else (data shape, endpoints, UX, failure handling) is mine to decide.
- The person at the screen is alone, in a hurry, and will do things I didn't plan for.

## What happens when…

These are the requirements I set myself before writing code.

| # | Situation | What the kiosk does |
| --- | --- | --- |
| H1 | Double tap, or Pay pressed again | One order. The button locks, and the API dedupes on the `Idempotency-Key`. |
| H2 | The network drops during payment | The client retries with the same key and shows "Checking your payment, please don't pay again", never a raw error. |
| H3 | The menu fails to load | A friendly retry with backoff, never a blank page. |
| H4 | A price changed or an item sold out | The server prices the order and answers 409 with the difference; the customer confirms the new total. |
| H5 | Payment declined | A clear message, the cart is kept, try another card or tap. |
| H6 | The customer walks away | "Still there?" countdown, then back to start with an empty cart. |
| H7 | Empty cart, bad quantities, unknown item, malformed body | Schema validation and per-line limits; Pay is disabled on an empty cart. |
| H8 | Finished | A big pickup number, then an automatic reset. |
| H9 | Money | Integer cents everywhere; the server computes the total. |
| H10 | Card data | Never stored or logged. Only the last 4 digits and a fake payment reference. |
