# Plan

Four phases, ordered so value lands early and nothing later depends on a refactor. Phases 1
and 2 are the core ask (easy-to-run tests, tests in CI). Phase 3 protects the contract.
Phase 4 is structure and maintainability, adopted progressively.

Effort estimates assume one developer familiar with the runner. They are deliberate, not
padded.

## Phase 1 — Make the tests run with one command (~half day)

Goal: `pnpm test` in `services/agent` runs every unit test, with watch and coverage.

0. **Fix the latent bug the typecheck will expose.** `src/tools/dispatch.ts` references an
   undefined `callRef` at lines 88 and 92 inside `relayToolCall`. Use the in-scope value
   (`toolName`, or thread the spec's `callRef` in) so the error path stops throwing
   `ReferenceError`. Found by Codex; this is the proof the typecheck gate has teeth.
1. Add dev deps to `services/agent/package.json`: `vitest`, `@vitest/coverage-v8`, **and
   `typescript`** (currently absent: `node_modules/.bin/tsc` does not exist, so `typecheck`
   cannot run without it). Match the versions `web/packages/*` pin (`vitest` `^4.1.x`); align
   `@types/node` with Node 24.
2. Add `services/agent/vitest.config.ts`, modeled on `agenta-shared/vitest.config.ts`:
   `include: ["tests/unit/**/*.test.ts"]`, `environment: "node"`,
   `reporters: ["default", "junit"]` to `test-results/junit.xml`, v8 coverage over `src/`.
3. Add scripts to `package.json`:

   ```jsonc
   "test": "pnpm run test:unit",
   "test:unit": "vitest run",
   "test:watch": "vitest",
   "test:coverage": "vitest run --coverage",
   "typecheck": "tsc --noEmit"
   ```

4. Move `test/*.test.ts` to `tests/unit/*.test.ts` and wrap the bare `{ ... }` blocks in
   `describe` / `it` so reporting and junit are per-case. **Do not bother rewriting every
   `assert` to `expect`** (Codex's point): vitest runs `node:assert` fine, so the conversion
   is just adding `describe`/`it` wrappers, not touching assertions. Keep filenames. The
   dynamic-import-after-env pattern (e.g. `skills.test.ts`) stays valid; add
   `vi.resetModules()` only where a file needs a clean module per case.
5. Update the `Run:` header comment in each test to `pnpm test` (or
   `pnpm exec vitest run tests/unit/<name>.test.ts` for a single file).

Done when: `pnpm test` is green locally and prints a single summary across all files.

## Phase 2 — Run them in CI (~half day)

Goal: the runner's tests gate every PR that touches `services/agent`.

1. Add a `run-services-node-unit-tests` job to `.github/workflows/12-check-unit-tests.yml`,
   mirroring the existing `run-web-unit-tests` setup but scoped to the package:
   - `actions/setup-node@v4` with `node-version: '24'`, `corepack enable`.
   - Cache the pnpm store keyed on `services/agent/pnpm-lock.yaml`.
   - `working-directory: services/agent`, `pnpm install --frozen-lockfile`, then
     `pnpm run typecheck` and `pnpm run test:unit`.
   - **Ensure `python3` is on the runner.** `test/code-tool.test.ts` spawns `python3` (and
     `node`) through `runCodeTool`. ubuntu-latest ships python3, but make it explicit, or
     split the subprocess code-tool test into an integration test the unit job can skip.
   - Publish `services/agent/test-results/junit.xml` with
     `EnricoMi/publish-unit-test-result-action@v2`, `check_name: Agent Runner Unit Tests`.
2. Path-filter the job. The workflow already triggers on `services/**`; gate the new job's
   steps so it only does work when `services/agent/**` changed (the same `if:` pattern the
   other jobs use for their package selection), to avoid installing Node on unrelated PRs.
3. Decide whether `typecheck` failing fails the job. Recommendation: yes. The code is
   already `strict`; a type error should not merge.

Done when: a PR touching `services/agent` shows an "Agent Runner Unit Tests" check, and a
deliberately broken type or assertion turns it red.

## Phase 3 — Guard the wire contract from the TS side (~half day)

Goal: a contract change must update Python and TypeScript together, or fail on both.

**Codex correction (important):** `protocol.ts` is types only, erased at runtime. "Loading
JSON and round-tripping it through an interface" validates nothing at runtime. The contract
test needs real runtime checks, in two layers:

1. Add `tests/utils/golden.ts` that loads the shared fixtures from
   `sdks/python/oss/tests/pytest/unit/agents/golden/` (relative path from the runner, read
   at test time). No copying; one source of truth.
2. **Runtime validation, not type assertion.** Either (a) introduce a zod (or equivalent)
   schema that mirrors `protocol.ts` and `parse()` each golden fixture in
   `tests/unit/wire-contract.test.ts`, or (b) write explicit structural assertions (required
   keys present, types correct, the `ok` discriminant). Option (a) doubles as a real runtime
   guard the server can use on inbound requests; option (b) is lighter but only a test.
3. **Type-level check, separately.** Use vitest's `expectTypeOf` (or a `tsd`-style check) so
   a fixture that drifts from `AgentRunRequest` fails `typecheck`, independent of the runtime
   assertions.
4. Exercise the pure helpers in `protocol.ts` (`messageText`, `resolvePromptText`,
   `resolveRunSessionId`) against fixture-derived inputs.
5. Note in `protocol.ts` and Python `test_wire_contract.py` that the contract is now pinned
   from both sides, so future editors look both ways.

Done when: editing a field name in `protocol.ts` without updating the fixtures (or vice
versa) fails this test, at runtime and at typecheck.

## Phase 4 — Structure and maintainability (progressive, no big bang)

Adopt as the runner is touched, not in one sweep.

1. **Add `services/agent/AGENTS.md`** (with a `CLAUDE.md` symlink, matching `web/`, `api/`).
   Keep it short: the package is a standalone pnpm project; how to run/serve/test/typecheck;
   where runner code goes (`src/{engines,tools,tracing}`) and where tests go
   (`tests/unit`, fixtures in `tests/utils`); the wire contract is mirrored in Python
   `wire.py` and pinned by golden fixtures, so change both sides; vitest is the runner.
   Add a thin `.claude/rules` / `.cursor/rules` pointer if the repo expects one.
2. **Local typecheck gate (optional).** The root `.husky/pre-commit` already runs prettier
   and gitleaks repo-wide. Optionally add `pnpm --dir services/agent typecheck` for changed
   TS, or leave the gate to CI to keep commits fast. Recommendation: CI is the gate; skip
   the local hook unless commits regularly land type errors.
3. **Linting (optional, phase-2 nice-to-have).** There is no eslint outside `web/`.
   `prettier` (global hook) covers formatting. A small `typescript-eslint` flat config for
   `services/agent` would add real value for async runner code (`no-floating-promises`,
   `no-misused-promises`). Treat as optional; `tsc --strict` + prettier is an acceptable
   floor.
4. **Extract a testability seam (Codex).** `server.ts` and `cli.ts` wire transport to the
   engines inline, so HTTP/CLI behavior can only be tested with a live harness. Export
   `createServer(runAgent)` and `runCli(runAgent)` that take the engine as an argument. Then
   unit tests inject a fake engine returning a deterministic `AgentRunResult` and cover
   `/health`, invalid-JSON handling, `POST /run`, NDJSON record ordering, and CLI exit codes,
   with no Pi/Claude/sandbox-agent. This is the highest-value structural change for testability.
5. **Decompose the two large files opportunistically.** When next editing `engines/sandbox_agent.ts`
   or `tracing/otel.ts`, pull a cohesive seam into its own module and unit-test it, the way
   `responder.ts` was extracted from `sandbox_agent.ts`. Not a scheduled refactor.

## Phase 5 — Make it a versioned, supportable service (Codex's main gap)

The review's core point: the plan above makes the runner testable but does not make it a
first-class deployable. These items make the SDK and the sidecar safe to release on their
own cadences. Scope and sequence with the platform/release owner; some are bigger than a
half-day.

1. **Protocol/version negotiation.** Add a `protocolVersion` (major) to the wire and have
   `GET /health` (or a new `/capabilities`) return `runnerVersion`, `protocolVersion`,
   supported engines, and harnesses. The Python adapter probes once and refuses an
   incompatible major before the first run. Today `/health` returns only `{status:"ok"}` and
   `package.json` is `0.0.0`.
2. **Release ownership.** Decide whether the sidecar version tracks the Agenta release or is
   versioned independently, and stop shipping `0.0.0`. The SDK should pin a compatible runner
   *protocol* range, not a package-version equality.
3. **Sidecar image publishing.** No CI publishes the runner image today (only api/web/services
   images are built, e.g. in `42-railway-build.yml`). Add a build/publish job so the HTTP
   sidecar (the production boundary) is actually distributable.
4. **Local code-tool execution policy.** `runCodeTool` scopes secret env, but a `code` tool
   still runs an arbitrary `python3`/`node` process in the sidecar. State the sandbox,
   resource, and network policy (it is already sandboxed in Daytona; the local/in-sidecar
   path needs an explicit stance), so this is a deliberate posture, not an oversight.
5. **Config hygiene.** `services/oss/src/agent/app.py` reads `AGENTA_AGENT_*` via raw
   `os.getenv`. The repo convention (root `AGENTS.md`) is to add config to
   `api/oss/src/utils/env.py` and consume the shared `env` object. Align it.
6. **Fix the stale `local.py` docstring.** `sdks/python/.../adapters/local.py` says the Pi
   runner is "shipped inside the wheel," which is not true today and is the likely source of
   the wheel confusion. Either implement that path deliberately (see the packaging options in
   the answer to question 1) or correct the docstring to match reality.

## Sequencing and ownership

- Phases 1 to 3 are independent of any runtime change and can land as one small PR or three
  tiny ones. They add no production code paths, only tooling and tests. Start here.
- Phase 4 item 1 (`AGENTS.md`) is worth doing alongside Phase 1 so the new test location is
  documented the moment it exists. Item 4 (the `createServer`/`runCli` seam) unblocks the
  HTTP/CLI tests and is worth pulling forward.
- Phase 5 is a separate track, owned with whoever owns releases and deployment. It does not
  block Phases 1 to 4, but it is what turns "tested code" into "supportable service."
- None of this blocks ongoing runner feature work; it runs in parallel.

## What success looks like

- `cd services/agent && pnpm test` runs the whole suite in one go, green, with a summary.
- A PR touching the runner gets a red/green unit-test + typecheck check automatically.
- `protocol.ts` cannot drift from the Python wire without a test failing.
- A new contributor reads `services/agent/AGENTS.md` and knows where code and tests go and
  how to run them, without reading the whole tree.
