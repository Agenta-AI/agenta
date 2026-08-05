# TypeScript structure for the agent runner

Planning workspace for making the new TypeScript code in the agent-workflows project
usable, maintainable, and testable, with tests that run easily and run in CI.

The new TypeScript lives mostly in one place: `services/agent/` (the Node "agent runner"
sidecar). This folder researches its current shape and proposes how to structure, test,
and gate it the way the rest of the monorepo already handles Python and frontend code.

## Files

- [context.md](context.md) — why this work exists, goals, non-goals, who it is for.
- [research.md](research.md) — what is actually in the repo today: where the TS lives, how
  it builds, ships, and is (barely) tested; the conventions the repo already standardizes
  for TS; a Python-to-TypeScript mental model; the gaps.
- [plan.md](plan.md) — the phased plan to close the gaps, with concrete file changes,
  scripts, and CI wiring.
- [status.md](status.md) — source of truth for progress and open decisions. Read this
  first to see where things stand.

## TL;DR

The runner code is well-organized (clear `engines/`, `tools/`, `tracing/` seams, a single
`protocol.ts` wire contract). The weak spots are tooling, not architecture:

1. Eight test files exist but there is **no test runner and no `pnpm test`**. Each test is
   a hand-run `tsx` script.
2. Those tests run in **no CI workflow**. The Node side is invisible to the unit-test gate.
3. There is **no typecheck gate** even though the code is already `strict: true`.
4. The TS side has **no test asserting the cross-language wire contract**, which is only
   pinned from Python today.

The plan adopts **vitest** (the runner `web/packages/*` already use), wires a Node job into
`12-check-unit-tests.yml`, adds a `tsc --noEmit` gate, and adds a golden-fixture round-trip
test so `protocol.ts` cannot drift from the Python wire silently.
