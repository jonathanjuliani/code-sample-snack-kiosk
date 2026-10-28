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
