# Process

How this went from an empty folder to a finished kiosk, one entry per phase, written as I went. The agent drafted each entry from what actually happened in the session; I review and edit every line.

**After the phases.** The runtime floor moved from Node 22 to Node 24 (26 still allowed). Docker, `.nvmrc`, `engines`, and `@types/node` all match 24. Phase 1 below still says 22, because that is what the machine had then. `better-sqlite3` stayed; `node:sqlite` is still a release candidate.

Checked on Node 24.21.0: `pnpm verify` (12 + 17 + 5 tests), Playwright 2 passed, `docker compose up --build` with `node -v` inside the API container at `v24.21.0` and `GET :8800/api/health` returning `{"status":"ok"}`.

## Phase 0: what I decided up front

**Before any code**

- I designed the kiosk first, as a single static HTML mockup with a panel that forces every recovery screen (`docs/design/mockup/`). That is the first commit. The direction, recovery patterns, idle timing and token set came out of that work, so the design phase of the plan is mostly filing it.
- I wrote the H1 to H10 list in the README before the first line of app code: the things a lone customer will do that a happy-path demo never shows.
- Assumptions: landscape tablet at 1280×800 first; one snack bar; fake payment; no auth; English UI.
- Stack and shape, chosen while planning: pnpm workspace with `apps/api` (Fastify + SQLite), `apps/web` (Vite + React) and `packages/shared` (Zod contracts used by both).
- I chose to keep the item options from the mockup (size, flavor, toppings, with price deltas) even though the original plan listed modifiers as skipped. The mockup already designs the option sheet, and a snack bar without size or flavor looks unfinished. Cost: about 1.5 to 2 hours across contracts, API and client.

**What the tool was asked for**

- A build plan mapped onto this folder. The agent ran `align-first` and asked me two questions it could not answer from the files: Fastify or Hono, and whether to keep options.

**Kept**

- The plan, with Fastify and options in scope.

**Thrown away**

- Nothing in this phase.

**Gate 0**

- Assumptions and the H-list were in the plan I accepted. I asked the agent to run every phase without stopping, so the later gates were not held live; each one is marked below and still needs my review.

## Phase 1: bootstrap

**Decided before coding**

- pnpm workspace, Biome, strict TypeScript, Vitest, Zod; Fastify for the API, Vite + React for the kiosk (no SSR or SEO on a tablet at a counter).
- Node 22 is what this machine has, so Node 22 is the floor.

**What the tool was asked for**

- `bootstrap-repo` for the skeleton: workspace, `GET /health`, one screen, one schema, one test per package, Docker and a no-Docker path.

**Kept**

- The API runs its TypeScript with Node's own type stripping (`node src/server.ts`). No `tsx`, no build step for the API, and it works through the workspace link into `packages/shared`.
- Moment-0 observability from Fastify's request log: every request gets an `x-request-id` (kept if the caller sent one, echoed back), and the "request completed" line carries status and response time. A 5xx logs the error and returns only the request id.
- Compose: the API is not published to the host; nginx in the web container proxies `/api` to it, the same path the Vite dev proxy uses.

**Thrown away**

- `fastify-type-provider-zod`: version 7 pulls `@fastify/swagger` and `openapi-types` in as peers. I don't need generated docs, so the routes call `schema.safeParse` themselves.
- `node:sqlite` instead of `better-sqlite3`: it worked, but prints an experimental warning on Node 22.
- My first `allowBuilds: { better-sqlite3: true }`. The Docker build failed: approving the build made pnpm run `node-gyp rebuild`, which needs Python in the slim image. `better-sqlite3` 13 ships prebuilt binaries for every platform, so the fix was to deny the build. Recorded in AGENTS.md so nobody "fixes" it back.
- The Docker web build then failed with "Tsconfig not found": the Dockerfiles didn't copy `tsconfig.base.json`.
- Port 8080 for the web container: it was already taken on my machine by another project's Adminer. Now `WEB_PORT`, default 8800.
- `@types/node` 26 from the first install; pinned to 22 to match the runtime.

**Verification**

- `pnpm verify`: lint, typecheck in 3 packages, 4 tests passing.
- `pnpm dev`: `/api/health` answers through the Vite proxy on 5173.
- `docker compose up --build`: API healthy, `/api/health` and the page served on 8800.

**Time**: about 10 minutes of agent time (23:46 to 23:55).

**Gate 1**: not held live. Stack and shape were confirmed in the plan. Still to do myself: run `/setup-skills` if I want the skilldeck config in this repo.

## Phase 2: design research

**Decided before coding**

- This phase happened before the repo existed. I ran the design-research prompt from my plan (`design-brief`, `curate-design-inspiration`, `design-inspiration`, `information-architecture`, `design-tokens`), picked shipped references only (Square, Toast and Clover kiosks, Stripe Terminal, McDonald's, Shake Shack, the BoothIQ photo booth, UK rail ticket machines), and built the result as a clickable mockup with a panel that forces each recovery screen.

**What the tool was asked for**

- `record-decision`: condense the mockup's design notes into D1 in `docs/DECISIONS.md`, and record the stack choices from phase 1 as D2 and D3.

**Kept**

- The direction, the four recovery patterns, the idle rules and the token set, unchanged.
- One finding from testing the mockup that I want to keep visible: every change of screen or payment state has to restart the idle clock. Without it, a customer who waited through "Checking your payment" got the idle prompt the moment the declined screen appeared, and their order was wiped.

**Thrown away**

- Nothing in this phase.

**Time**: a few minutes to file it; the research itself was done before this session and isn't counted here.

**Gate 2**: not held live. The direction is the one I designed; nothing in it changed.

## Phase 3: contracts and data model

**Decided before coding**

- The endpoint and status tables from my plan, plus item options (`choiceIds` on each line).

**What the tool was asked for**

- `data-model` and `api-design` for menu, orders, lines and the idempotency record; Zod schemas in `packages/shared`; `record-decision` for the choices that will be questioned.

**Kept**

- Schemas in `packages/shared/src/{money,menu,order}.ts`, every amount `z.number().int().nonnegative()`. A schema test rejects an empty cart, qty 0, qty 999, a fractional qty, a float total and a short card number.
- `formatCents` formats with integer division, so no float ever touches money, even for display.
- D4 to D8 in `DECISIONS.md`.

**Thrown away**

- "Write the order and its payment result in one transaction", from my own plan. Writing it down as a decision showed it doesn't work: a transaction can't span the payment call, and if nothing is written until payment returns, a retry that arrives mid-payment finds no order and charges again. The order is now inserted as `pending_payment` first (D5).
- `GET /orders/:id` as the way to resume after a reload, also from my plan. If the response was lost the kiosk never got the id, and re-sending the `POST` isn't possible because the card number must not sit in `sessionStorage`. Replaced by a lookup by idempotency key (D8).
- Separate `option_groups` and `option_choices` tables, from the first draft of the data model. They're only read with their item, so they're a JSON column on `menu_items` (D7).
- Returning only the changed lines in a 409. The server doesn't know what the kiosk displayed; it returns every line re-priced and the kiosk does the diff (D6).

**Time**: about 5 minutes of agent time (23:55 to 23:58).

**Gate 3**: not held live. D5, D6 and D8 and the response table in the README; they're the parts most likely to come up.

## Phase 4: API

**Decided before coding**

- The contract from Phase 3, including 202 while a payment is still running.
- Fake cards, pickup numbers, chaos flags, and no card number in the database or the logs.

**What the tool was asked for**

- `create` for the routes; `security-hardening` on input, card data and logs; `observability` per order; `testing-strategy` then Vitest at `app.inject()`.

**Kept**

- Menu and order routes wired into Fastify. The order is inserted as `pending_payment` before the fake charge runs.
- One structured log line per order with `requestId`, `orderId`, `idempotencyKey` and `kioskId`. Pino redacts `*.cardNumber`; request/response serializers drop the raw body so a card number cannot ride along on `req`.
- Pickup `A-001`, unique per day via `pickup_counters`.
- Chaos from env: `CHAOS_LATENCY_MS`, `CHAOS_FAIL_RATE`.
- HTTP-seam tests for H1, H2 (in-flight 202), H4, H5, H7, H9, H10, missing options, option-delta 409, and lookup by key.

**Thrown away**

- Logging the incoming body in the production path. A test hook did that to prove redaction, and the first version of the test captured Pino's arguments _before_ redaction, so it "found" the card number in the logger internals. The test now reads the serialised log line, which is what would be written to disk.

**Time**: about 40 minutes of agent time.

**Gate 4**: not held live. The diff to read is `apps/api/src/orders/` and `apps/api/test/orders.test.ts`.

## Phase 5: kiosk client

**Decided before coding**

- Port the mockup's layout, tokens and copy. `useReducer` for the checkout machine (no XState: one machine, one file).
- Idle, recovery screens and option sheet stay as designed.

**What the tool was asked for**

- `frontend-craft`, `forms` (numpad), `state-management` (reducer).

**Kept**

- Three zones, 56–72px targets, on-screen numpad, no OS keyboard.
- Pay lock (`payLock` ref + `payPhase !== 'idle'`). Same `Idempotency-Key` on retry.
- Network failure goes to "Checking your payment… Please don't pay again", then `GET /orders?idempotencyKey=`.
- Menu backoff; last good menu in `localStorage`; payment blocked while the API is down.
- `sessionStorage` for cart + in-flight key. `?kiosk=` for the kiosk id.
- Idle 60s / 90s, 15s "Still there?", suspended during payment. Done resets after 12s.

**Thrown away**

- Dismissing a sheet or dialog by tapping the dimmed backdrop. Biome flagged it (a `div` with a click handler), and an accidental arm tap on a kiosk should not close a recovery screen. Each overlay has its own buttons.

**Verification**

- `pnpm --filter @kiosk/web test`: start screen + machine (add, options, pay lock, decline keeps the cart).
- Playwright at 1280×800: happy path and double-tap.
- I did not put this on a physical tablet over the LAN or on Slow 3G in this session. That walk is still mine.

**Time**: about 90 minutes of agent time.

**Gate 5**: not held live. Walk the flow with chaos on.

## Phase 6: failure proof

**Kept**

- Playwright: happy path, and a double-tap that asserts a single `201`.
- README "What happens when…" now has a trigger per H-item.

**Thrown away**

- Nothing.

**Time**: about 20 minutes, including a first run that hit port 5173 already owned by another local app. E2E now uses 5180 / 3010.

## Phase 7: show the work

**Kept**

- PROCESS (this file), DECISIONS D1–D8, SKIPPED.md.
- `design-review`: one high-impact fix — Start was tappable while the menu was still loading, which opened an empty order screen. Start now waits until the menu is ready, and the loading state says so.

**Thrown away**

- Nothing invented. The rest of the review findings were polish (numpad animation, attract visuals) and sit under the cut line.

**Time**: about 15 minutes.

## Phase 8: release check

**Commands and outcomes (this machine, 2026-10-28)**

```
pnpm verify
# biome check: 53 files, clean
# typecheck: shared, api, web
# tests: 12 shared + 17 api + 5 web, all passing

pnpm test:e2e
# 2 passed (happy path, double-tap → one 201) at 1280×800

docker compose up --build
# api healthy; GET http://localhost:8800/api/health → {"status":"ok"}
# GET http://localhost:8800 → Snack Bar HTML
```

No-Docker path: `pnpm install && pnpm dev` was already used for Playwright (API on 3010, Vite on 5180).

Fresh clone of this repo (local `git clone` into a temp dir, then follow the README):

```
pnpm install --frozen-lockfile
# 104 packages, lockfile up to date

pnpm verify
# biome check: 53 files, clean
# typecheck: shared, api, web
# tests: 12 shared + 17 api + 5 web, all passing
```

`git ls-files` has no `.env` and no `.pdf`. `.gitignore` covers `*.db`, `.env`, `*.pdf`.

**Gate 8**: not held live. Nothing has been pushed.

## Phase 9: close the remaining gaps

**Already true, left alone.** H1–H10, chaos flags, menu version, reload by idempotency key, cached menu with payment blocked, WAL, structured logs, and the traps (server prices, integer cents, no card number, recovery screens, no auth or CMS).

**Added**

- `/ops` in the same client, and `GET /ops/summary` plus `POST /ops/events`. Replays, 409s and declines increment in the order route. The kiosk posts a heartbeat every 30s and one idle reset when the countdown sends the next person to the start screen. No login; D9 says why.
- Machine tests for a menu that never loads, a 409 the customer confirms, the idle reset, and Pay disabled while the API is down.
- Playwright for a declined card, a dropped submit ("Please don't pay again"), and `/ops` showing the pickup number from a checkout.
- The running total is the live region. Recovery screens keep `role="alert"`.

**Still skipped.** Stock races and a screen recording. See Skipped in the [README](../README.md#skipped-and-why).

## Enhancement pass

**Already true at the start.** H1–H10, menu version and ETag, lookup by idempotency key and by order id, cached menu with Pay blocked, integer cents, no card number stored or logged, and an unauthenticated `/ops` page. Chaos existed, but it returned 503 before the handler, so a dropped request had never saved an order.

**What this pass changed**

- `CHAOS_FAIL_RATE` now drops `POST /orders` only after the paid or declined row is committed. A replay of that key returns the one order. Latency still delays every request.
- Staff assist posts `POST /kiosk/assist`. It shows on `/ops`, idle waits while it is open, and a second decline offers "Get staff help".
- The customer screen was restyled to the enhancement spec: self-hosted Archivo and Inter, venue name and accent (white text must clear 4.5:1, or the snack-bar orange stays), category rail, three-column menu, order panel, and the screen copy from that spec. Option groups stayed. The 30-second "show this code" screen stayed for a payment that never resolves.
- Idle is 60 seconds, then 10, with `?idle=` for demos. The done screen resets after 8 seconds. `/health` is checked every 10 seconds once a menu is loaded.
- `/ops` now has the app version, a Stale label after two minutes, a text status pill, and the assist list. Counter names were left as they were.
- Playwright now covers tap-to-done and the auto reset, double pay, a drop after commit, decline then another card, idle both ways, a price change, a sold-out line, a menu that 500s, payments going offline, an empty cart, and the quantity cap.

**Thrown away**

- The local "How this works" dialog. It never notified anyone.
- The paged six-up grid and the system-ui token set from the first mockup.
- A 503 before the order existed. That could not demonstrate a lost response.
- 90 seconds of idle at checkout, and a 15-second countdown. Each key already restarts the clock.
- Portrait Playwright, an axe run, and a reload-mid-payment Playwright test. The features stay; the extra tests were the cut line. See Skipped in the [README](../README.md#skipped-and-why).

**Verification**

`pnpm verify` (lint, typecheck, 12 shared + 22 API + 12 web tests) and `pnpm test:e2e` (12 passed at 1280×800). A fresh clone and my own read-through of this file were left for the final pass.

## Final docs pass

**What the tool was asked for**

- Bring every doc up to date against a fresh run, not against what earlier entries said: one status per item in a new [COVERAGE](COVERAGE.md), a README in a fixed order, the missing DECISIONS entries, and [APPROACH](APPROACH.md). No application code was to change. A claim that turned out false gets reported, not fixed.
- `verify-before-done` before any status was written, and `record-decision` for the new entries.

**What was verified** (Node 24.22.2, pnpm 11.1.3, 2026-11-02)

```
pnpm i --frozen-lockfile     # 107 packages, exit 0
pnpm typecheck               # shared, api, web: exit 0
pnpm lint                    # exit 1: 1 error, apps/web/src/id.ts quote style
pnpm test                    # 37 shared + 34 api + 37 web = 108 passed
pnpm test:e2e                # 18 passed (48.4s), 1280×800 with touch
docker compose up --build    # api healthy; /api/health {"status":"ok","payments":"up"}; page title "Snack Bar"
fresh clone                  # install, typecheck, test pass; pnpm verify exits 1 at lint
```

Two notes on the run, both about the machine rather than the repo:

- The container's Chromium was one build behind what Playwright 1.64 wanted, so I pointed Playwright at it from outside the repo.
- The Docker build needed the machine's proxy certificate added in a scratch copy of the Dockerfiles.

Then I checked by hand against the running stack:

- the stored row and the API log for a card payment (no card number)
- the log line for that order
- a replay
- a wrong total, a float total, a stale menu version
- `If-None-Match`
- a missing key
- `PRAGMA journal_mode`

In a browser I checked:

- the slow card
- a reload mid-payment
- the portrait layout
- target sizes
- a one-off axe run over every kiosk screen and `/ops`

The results are in [COVERAGE](COVERAGE.md).

**Claims that turned out false, and how they're reported**

- The README said the slow card `4000 0000 0000 9995` "approves after 15 seconds, longer than the kiosk waits" and listed it as the way to see "Checking your payment…". The kiosk has no client timeout. It shows "Processing payment…" for 15 seconds and then pays. The README now says that, and points at the rail's "No response, then approved" for H2.
- The README said to trigger a price change by editing `apps/api/seed/menu.json` and restarting. The seed only inserts missing rows, so an existing database keeps the old price. The README now says so and points at the rail's "+$0.50".
- The README said a replay answers with "the original status". A paid order replays as `200`, not `201`. Fixed in [API](API.md).
- AGENTS.md and the README say `pnpm verify` is the check before finishing. On this commit it fails at lint. I didn't fix it here because this pass doesn't touch code. It's [COVERAGE T6](COVERAGE.md#traps-to-avoid-t).

**What changed in the docs**

- New:
  - `docs/COVERAGE.md`: 38 items, 28 Handled, 9 Partial, 1 Not handled by choice.
  - `docs/APPROACH.md`
  - `docs/API.md`: the API tables, moved out of the README because Biome's Markdown formatter mis-measures a table that comes after characters like "…".
  - `docs/screenshots/`
- README:
  - rewritten in a fixed order
  - `docs/SKIPPED.md` folded into it and deleted
- DECISIONS:
  - D17 to D20 added
  - "Superseded:" notes on D1's recovery copy and D5's button labels
  - D10 and D12 reworded
- PROCESS: Phase 7 renamed, and the SKIPPED links re-pointed.
- CONTEXT: added "Checking", "Unresolved" and "Simulation rail".

**Kept**

- Every earlier PROCESS entry as I wrote it. Six of them miss one of asked / kept / thrown away / time (COVERAGE T9). I'd rather fill those from memory myself than have them invented.

**Thrown away**

- A README API table that Biome reformatted differently on every pass. It moved to `docs/API.md` instead of being fought.

**Time**: about 40 minutes of agent time on the clock, including the Docker build and two full Playwright runs.
