# Process

How this went from an empty folder to a finished kiosk, one entry per phase, written as I went. The agent drafted each entry from what actually happened in the session; I review and edit every line.

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
