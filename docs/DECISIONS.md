# Decisions

Short records of choices that outlive a single change. Each says what was rejected and why, so a later reader can tell a settled tradeoff from an accident. "Accepted" means I chose it; "Proposed" means the agent recorded it and I still have to confirm it.

## D1. A calm, typographic kiosk designed before any code

**Status**: Accepted

**Decision**: We will build the kiosk to the design in [`design/mockup/`](design/mockup/DECISIONS.md): one still start screen, an order screen with the menu grid and an always-visible order panel, a single review-and-pay screen, and a done screen with a big pickup number. A state machine drives the screens, not routes, so the browser's back gesture can't skip a recovery screen.

**Options considered**

- *Kiosk-shaped, low density, high contrast* (chosen): a customer alone at arm's length, in a hurry, touch only. Type floor 20px, targets of 56px or more, primary actions 72px, no hover, no page scroll, no OS keyboard.
- *A responsive web shop* (rejected): a scrolling page with a cart drawer reads as a website and hides the total.
- *A copy of a known brand's kiosk* (rejected): borrowing a known brand's look says nothing about judgment.

**Recovery screens**: each one replaces the payment area; the order stays visible but locked.

| Case | Pattern |
| --- | --- |
| Payment outcome unknown | Warning. "Checking your payment… Please don't pay again." No buttons. Keep checking the same payment; after 30s, a code to show at the counter. A new charge is never started for an unanswered payment. |
| Total changed | Warning. Old and new totals side by side with the changed lines. "Pay $X.XX" or "Back to order". |
| Declined | Error. "Card not accepted", no blame, no bank codes. Order kept; "Try another card" or "Back to order". |
| API down | A warning strip; browsing works, Pay disabled with the reason on the button. Recovers on its own. |

**Idle**: 60s on the order screen, 90s on checkout, then a 15s "Still there?" countdown. Suspended while a payment is in progress, being checked, or unresolved. Done resets after 12s.

**Tokens**: the role-based set in the mockup (type 18 / 20 / 24 / 32 / 40 / 56, spacing 4 to 48, AA contrast minimum and AAA for totals, one light theme on purpose). The web app copies these values unchanged into `apps/web/src/styles/tokens.css`.

**Consequences**: The client is one screen machine, which makes every recovery state explicit and testable. Reopen if the kiosk ever needs deep links (it shouldn't).

## D2. A pnpm workspace with a shared contract package

**Status**: Accepted

**Decision**: We will keep the API, the kiosk and the Zod contracts in one pnpm workspace (`apps/api`, `apps/web`, `packages/shared`).

**Options considered**

- *Workspace with `packages/shared`* (chosen): two deployables really do share the order and menu schemas; a contract change fails typecheck on both sides in the same commit.
- *Two separate repos* (rejected): a reader would need to clone two things, and the contract would drift.
- *One app with the API inside Vite* (rejected): blurs the client/API boundary.

**Consequences**: One `pnpm install`, one `pnpm verify`. The shared package ships TypeScript source, no build step; Vite and Node's type stripping both read it directly.

## D3. Fastify for the API, validating with Zod by hand

**Status**: Accepted (Fastify); Proposed (no type provider)

**Decision**: We will use Fastify and call `schema.safeParse` on each request body ourselves.

**Options considered**

- *Fastify* (chosen): mature, fast `inject()` for HTTP-seam tests without opening a port, a request id and structured logger built in.
- *Hono with `@hono/zod-validator`* (rejected): lighter, but the logging and request-id baseline would be mine to assemble.
- *`fastify-type-provider-zod`* (rejected): v7 requires `@fastify/swagger` and `openapi-types` as peers, for docs I don't need. Hand parsing is three lines per route and easier to explain.

**Consequences**: Error shapes are mine to keep consistent (one helper). Reopen if the API grows enough routes to want generated OpenAPI.
