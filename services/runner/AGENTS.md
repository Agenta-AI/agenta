# Agent runner (TypeScript) conventions

Scope: everything under `services/runner/`. This is the Node "agent runner" sidecar. It runs
the agent loop and serves one contract: a JSON `/run` request in, a structured result out.
The Python agent service (`services/oss/src/agent/`) decides *what* to run; this package
*runs* it. It lives in Node because the harnesses (Pi, Claude Code, and the `sandbox-agent` package)
are Node libraries with no Python SDK. The repo-wide rules live in `/AGENTS.md`; the
architecture overview is this folder's `README.md`.

## This is a standalone pnpm package

Not part of the `web/` pnpm workspace. It has its OWN `pnpm-lock.yaml`, builds its own Docker
image, and pins Node 24 / pnpm 10.30 / ESM (`"type": "module"`). It runs through `tsx` (no
app compile step); the only build is `pnpm run build:extension` (esbuild-bundles the Pi
extension into `dist/`). Keep it standalone so the sidecar image stays decoupled from the web
dependency graph.

## Commands

```bash
pnpm install              # from services/runner, with Node 24 on PATH
pnpm run serve            # HTTP sidecar on :8765 (GET /health, POST /run)
pnpm run run:cli          # one JSON request on stdin -> one result on stdout
pnpm test                 # vitest: all unit tests
pnpm run test:watch       # vitest watch
pnpm run test:coverage    # vitest + v8 coverage
pnpm run typecheck        # tsc --noEmit (src + tests + vitest.config)
```

## Where code and tests go

- Runtime code: `src/` — `engines/` (one engine: `sandbox_agent`), `tools/`, `tracing/`,
  `extensions/`. Entrypoints: `cli.ts`, `server.ts`. The `/run` wire contract is `protocol.ts`.
- Tests: `tests/unit/**/*.test.ts` (vitest, `node:assert` is fine inside `it`). Shared test
  helpers and fixtures live in `tests/utils/`. This mirrors `web/packages/*` and the repo
  testing.structure spec. Do not add tests back under a flat `test/` directory.
- Build/test artifacts (`test-results/`, `coverage/`, `dist/`) are git-ignored from the ROOT
  `.gitignore` — a nested `services/runner/.gitignore` does NOT take effect (the repo-wide
  `.*` rule ignores all nested `.gitignore` files).

## The wire contract is mirrored — change both sides

`src/protocol.ts` is the source of the `/run` types. The Python side hand-mirrors them in
`sdks/python/agenta/sdk/agents/utils/wire.py`, and the contract is pinned by shared golden
fixtures in `sdks/python/oss/tests/pytest/unit/agents/golden/`. Both sides assert those
fixtures: Python in `test_wire_contract.py`, TypeScript in `tests/unit/wire-contract.test.ts`.
If you add, rename, or remove a wire field, update the golden, then `protocol.ts` AND
`wire.py` AND both contract tests, deliberately. The TS test has a compile-time key guard, so
a drifted `protocol.ts` fails `tsc`.

## Testing seams

`server.ts` and `cli.ts` export `createAgentServer(run)` / `runCli(raw, {run})` so the HTTP
and CLI behavior can be tested with a fake engine (no live Pi/Claude/sandbox-agent). Prefer testing
through those seams over importing the real engines. Engine-internal logic that is pure
(`tracing/otel.ts` state machine, `tools/*`, `engines/skills.ts`) is unit-tested directly.

## Before committing

There is no eslint here yet (deferred); `tsc --strict` + the repo-wide prettier hook are the
floor. Run `pnpm test` and `pnpm run typecheck` before pushing.
