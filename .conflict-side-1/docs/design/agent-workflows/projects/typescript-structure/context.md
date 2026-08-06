# Context

## Why this work exists

The agent-workflows project introduced the first substantial server-side TypeScript in a
repo that was Python on the backend and TypeScript only on the frontend. The new code is
the agent runner sidecar at `services/agent/`. It drives the agent harnesses (Pi, Claude
Code, sandbox-agent's `sandbox-agent`) because those are Node libraries with no Python SDK. The
Python agent service calls into it over one JSON contract.

This code grew fast during the build-out. It works and it is reasonably well-factored, but
it sits outside the conventions the rest of the monorepo follows. The owner is a Python
developer and wants this TypeScript to feel as routine to maintain and test as the Python
does: a single command to run the tests, the tests running in CI, a typecheck gate, and a
clear place for new code and new tests to go.

## Goals

1. **Testable, easily.** One command (`pnpm test`) runs every unit test for the runner.
   Watch mode and coverage work. Writing a new test is obvious and low-ceremony.
2. **Tested in CI.** The runner's tests run on every PR that touches it, with results
   published the same way the Python and web suites are.
3. **Typechecked.** The `strict` TypeScript already configured produces a CI signal, so a
   type error fails the build instead of reaching the dockerized sidecar at runtime.
4. **Contract-safe.** The wire contract between the Python service and the Node runner is
   guarded from both sides, not just from Python.
5. **Maintainable and discoverable.** A new contributor (or agent) can find where runner
   code and runner tests belong, following the same instruction-layering the repo uses for
   `web/` and `api/`.

## Non-goals

- Rewriting or re-architecting the runner. The `engines` / `tools` / `tracing` split and
  the `protocol.ts` contract stay. This is about tooling and structure, not a redesign.
- Folding `services/agent` into the `web/` pnpm workspace. It is a deployable sidecar with
  its own Docker build and its own lockfile; it should stay a standalone package (see
  research.md for the trade-off).
- Changing the frontend TypeScript (`web/oss/src/components/AgentChatSlice/`). That code
  already lives in the web app under established conventions (vitest, package practices).
  It is out of scope here.
- End-to-end / live-LLM acceptance tests for the runner. Those depend on real harness
  credentials and are tracked separately in the agent-workflows test work. This plan is
  about the fast unit/contract layer that can run on every PR with no secrets.

## Who this is for

The maintainer (Python-first) and any future contributor or agent touching
`services/agent`. research.md includes a Python-to-TypeScript mental model so the tooling
choices map onto things already familiar from the SDK and API side (uv, ruff, pytest).
