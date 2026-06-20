# Status

Source of truth for this planning folder. Update as work proceeds.

## Current state — 2026-06-20

Research complete. Plan drafted and then reviewed by Codex (gpt-5.5, xhigh). Plan widened in
response (see plan.md Phases 1, 3, 5). **Phase 1 is implemented and green.**

### Phase 1 done (2026-06-20)

- Fixed the `callRef` bug in `src/tools/dispatch.ts` (lines 88, 92 now use `toolName`).
- Added dev deps: `vitest` 4.1.9, `@vitest/coverage-v8` 4.1.9, `typescript` 5.9.3; bumped
  `@types/node` to 24.13.2 (matches the Node 24 runtime). `pnpm-lock.yaml` updated.
- Added `vitest.config.ts` (node env, junit to `test-results/junit.xml`, v8 coverage).
- Added scripts: `test`, `test:unit`, `test:watch`, `test:coverage`, `typecheck`.
- Moved `test/*.test.ts` (9 files, including `extension-tools.test.ts` from the
  `feat/agent-runner-engines` lane) to `tests/unit/*.test.ts`, wrapped in `describe`/`it`,
  kept `node:assert`, fixed import depth to `../../src/`.
- Added `test-results/` and `coverage/` to `.gitignore`.

Verified: `pnpm typecheck` exits 0 (and a planted type error makes it exit 2, so the gate has
teeth). `pnpm test` = 9 files, 42 tests, all pass, junit written. `pnpm test:coverage` works
(32.6% line coverage; engines are not exercised by unit tests yet, as expected).

Not mine in the same working tree: `src/engines/pi.ts`, `src/engines/rivet.ts`, the
Dockerfiles, and `src/engines/skills.ts` were already modified/untracked from the parallel
`feat/agent-runner-engines` lane. The combined tree still typechecks and tests green.

### Phase 2 done (2026-06-20)

- Added job `run-services-node-unit-tests` to `.github/workflows/12-check-unit-tests.yml`,
  mirroring the web (pnpm setup) and python-services (has_tests guard + package-selection
  gate) jobs: Node 24 + corepack pnpm, `pnpm install --frozen-lockfile`, `pnpm run typecheck`,
  `pnpm run test:unit` (working-directory `services/agent`), then publish
  `services/agent/test-results/junit.xml` as "Agent Runner Unit Test Results".
- No `setup-python`: the code-tool test spawns `python3`/`node`, both preinstalled on ubuntu
  runners.
- Verified locally: the workflow YAML parses and the job is present;
  `pnpm install --frozen-lockfile` succeeds (lockfile matches package.json), so CI will not
  fail on a lockfile mismatch.

### Codex review of Phase 1+2 (xhigh) — all 5 findings fixed (2026-06-20)

Codex confirmed the `callRef` fix is correct and the test conversion is assertion-faithful,
then found 5 issues. All fixed and verified:

1. **High — CI could pass while running nothing.** The `has_tests` guard let the job skip
   silently. Removed it; vitest exits non-zero on no test files, so a missing suite now fails.
2. **High — the nested `.gitignore` is itself ignored.** Root `.gitignore` line 68 (`.*`)
   ignores every nested `.gitignore`, so the `services/agent/.gitignore` artifact rules could
   never land. Reverted that edit; added `services/agent/test-results/` and
   `services/agent/coverage/` to ROOT `.gitignore` (the repo's convention). Verified with
   `git check-ignore`.
3. **Medium — typecheck did not cover tests/config.** Broadened `tsconfig.json` `include` to
   `src + tests + vitest.config.ts`. Proven: a planted type error in a test file now fails
   `pnpm typecheck`.
4. **Medium — brittle env isolation.** `skills.test.ts` now saves/restores
   `AGENTA_AGENT_SKILLS_DIR` in `afterAll`; `responder.test.ts` has an `afterEach` that clears
   `AGENTA_RIVET_DENY_PERMISSIONS` even if an assertion throws.
5. **Low — the fixed bug had no direct test.** Added two `relayToolCall` tests in
   `tool-dispatch.test.ts`: the ok path returns the relayed text, and the empty-error path
   asserts `tool relay failed for <toolName>` (this would have thrown `ReferenceError` before
   the fix).

Final state after Phase 1+2: `pnpm typecheck` exits 0 (covers src + tests + config; planted
errors exit 2). `pnpm test` = 9 files / 44 tests pass. `pnpm install --frozen-lockfile` clean.
Workflow YAML valid.

### Phase 3 done (2026-06-20)

The TS side of the cross-language wire contract (the "later PR" the Python
`test_wire_contract.py` names). Two layers, per Codex's correction that types are erased:

- `tests/utils/golden.ts` reads the shared fixtures from
  `sdks/python/oss/tests/pytest/unit/agents/golden/` in place via `node:fs` (no copy).
- `tests/unit/wire-contract.test.ts`:
  - **Runtime**: loads `run_request.pi.json`, `run_request.claude.json`, `run_result.ok.json`,
    `run_result.error.json`; asserts shapes; exercises `resolvePromptText`,
    `resolveRunSessionId`, `messageText`; checks the camelCase capability keys and the
    trailing untyped event the wire carries.
  - **Compile-time**: `KNOWN_REQUEST_KEYS` (mirrored from the Python test) and the capability
    keys are assigned to `(keyof AgentRunRequest)[]` / `(keyof HarnessCapabilities)[]`. If
    `protocol.ts` renames or drops a field the wire still emits, `tsc` fails.

Both gates proven: a wire key not on `AgentRunRequest` fails `tsc` (TS2322); clean restores
it. Final: `pnpm test` = **10 files / 51 tests** pass, `pnpm typecheck` exits 0.

Phases 1, 2, and 3 are implemented, reviewed, and green.

### Phase 4 done (2026-06-20)

- `services/agent/AGENTS.md` + `CLAUDE.md` symlink (matches `web/`, `api/`): standalone pnpm
  package, commands, where code/tests go, the mirrored wire contract, the testing seams.
- **Testability seam (Codex's #1 structural item):** `server.ts` exports
  `createAgentServer(run)` / `createRequestListener(run)`; `cli.ts` exports
  `runCli(raw, stream, io)` with an injectable engine and output sink (streaming stays live).
  Both entrypoints auto-run only when they are the process entry (`src/entry.ts`
  `isEntrypoint`), so importing them in tests is inert.
- New tests: `server.test.ts` (5) drives a real server on an ephemeral port with a fake
  engine (/health, /run, 400 invalid JSON, 500 failure, NDJSON order); `cli.test.ts` (4)
  drives `runCli` with a fake engine + collecting write (one-shot, invalid JSON, failure,
  streaming order).
- Deferred (documented): `typescript-eslint` (tsc --strict + prettier is the floor; risks a
  rabbit hole in existing engine code) and decomposing `rivet.ts`/`otel.ts` (opportunistic).

### Phase 5 partial (2026-06-20) — runner side done; client/release/CI need decisions

Implemented (self-contained, additive):
- `src/version.ts`: `PROTOCOL_VERSION = 1`, `RUNNER_VERSION` (from package.json), engines,
  harnesses. `GET /health` now returns this identity instead of `{status:"ok"}`. Verified
  live: `{"status":"ok","runner":"0.1.0","protocol":1,"engines":[...],"harnesses":[...]}`.
- `package.json` version `0.0.0` -> `0.1.0`.
- Fixed the misleading `sdks/python/.../adapters/local.py` docstring (the source of the wheel
  worry): the runner is NOT in the wheel; runner-delivery is an open decision.

Deferred (genuine decisions / other areas / would deepen entanglement):
- Client-side probe: the Python adapter should `GET /health` once and refuse an incompatible
  protocol major (SDK `ts_runner.py`/adapters; needs the version-compat policy decided).
- Release ownership + SDK pinning a runner protocol range (decision: does the sidecar version
  track the Agenta release or version independently?).
- Sidecar image publishing in CI (`42-railway-build.yml` builds only api/web/services today).
- Config hygiene: `services/oss/src/agent/app.py` raw `os.getenv` -> shared `env` object
  (that file is modified by another lane right now; editing it would conflict).

Final after Phases 4+5: `pnpm test` = **12 files / 60 tests** pass, `pnpm typecheck` exits 0.

### Commit status (2026-06-20)

Not committable as an independent unit yet. GitButler committed the new files cleanly (tests,
config, CI, docs) but refused to commit the edits to `package.json`, `dispatch.ts`,
`tsconfig.json` and the old-test deletions, because those files are owned by the in-flight
`feat/agent-runner-engines` commits below in the stack. A half-committed lane is broken, so
the lane was rolled back to snapshot `fce735461f`. All work is intact and green on disk. It
should land WITH the agent-runner feature (that lane's owner includes these files, or this
test work stacks cleanly once that feature is actually committed/pushed).

## Codex review (xhigh) — 2026-06-20

Codex's verdict: the plan is directionally right but too narrow. It fixes test ergonomics
but does not yet make the runner a versioned, supportable server component. Verified findings
we accepted:

- **Real bug (verified):** `services/agent/src/tools/dispatch.ts` references `callRef` at
  lines 88 and 92, but that identifier is not defined in `relayToolCall` (only `spec.callRef`
  exists elsewhere). On a Daytona relay failure/timeout, the error-message build throws
  `ReferenceError` and masks the real error. A `tsc --noEmit` gate catches it. This is the
  strongest argument for the typecheck gate, and it is a one-line fix.
- **`typescript` is not a dependency (verified):** `node_modules/.bin/tsc` does not exist.
  The `typecheck` script needs `typescript` added; `tsx` does not provide `tsc`.
- **Phase 3 was naive (accepted):** TS interfaces are erased at runtime, so "round-trip the
  golden JSON through `protocol.ts`" does nothing at runtime. Use runtime validation (a zod
  schema or explicit structural assertions), plus a separate type-level check.
- **Testability seam (accepted):** export `createServer(runAgent)` / `runCli(runAgent)` so
  HTTP and CLI paths can be tested with a fake engine, no live Pi/Claude/rivet.
- **CI detail (verified):** `test/code-tool.test.ts` spawns `python3`. The Node CI job needs
  Python available, or that test gets split out.
- **Bigger gaps (accepted, now Phase 5):** no protocol/version negotiation, no sidecar image
  publishing in CI, no release ownership (`package.json` is `0.0.0`), local code-tool
  execution has no stated sandbox/resource policy, and `services/oss/src/agent/app.py` reads
  `AGENTA_AGENT_*` via raw `os.getenv` instead of the shared env object.
- **Packaging smoking gun (verified):** `sdks/python/.../adapters/local.py` docstring says a
  "bundled JS runner ... shipped inside the wheel," but it is marked NOT YET IMPLEMENTED.
  Nothing TS is in the wheel today; the future `LocalBackend` plans to put a bundled JS
  runner there. That aspirational note is the likely source of the wheel worry.

Where Codex was wrong: it claimed 9 test files; there are 8 (`skills.test.ts` was already
counted). Minor.

## What is true in the repo today

- `services/agent` is a standalone pnpm package (own lockfile, Node 24, ESM, `tsx` runtime,
  `strict` tsconfig with `noEmit`).
- 8 unit tests exist under `services/agent/test/`, written as hand-run `tsx` + `node:assert`
  scripts. No `pnpm test`, no runner, no aggregation.
- Those tests run in NO CI workflow. `12-check-unit-tests.yml`'s services job is Python-only
  (`services/oss/tests/pytest/unit`).
- No typecheck gate runs anywhere, despite `strict`.
- The wire contract is pinned from Python only (`test_wire_contract.py` + golden fixtures);
  the TS `protocol.ts` has no test asserting it.
- The repo already standardizes vitest for TS units (`web/packages/*`), with a written
  folder spec (`docs/designs/testing/testing.structure.specs.md`).

## Open decisions

1. **Runner: vitest vs node:test.** Recommended: vitest (matches `web/packages`, junit +
   coverage + watch out of the box). Blocks Phase 1 config only; structure is the same
   either way.
2. **Folder layout: move `test/` to `tests/unit/`?** Recommended: yes, to match web packages
   and the structure spec. Low-risk mechanical move.
3. **Does `typecheck` failure fail CI?** Recommended: yes.
4. **Add eslint to `services/agent`?** Recommended: defer (optional Phase 4); prettier +
   `tsc --strict` is the floor.

## Progress

- [x] Inventory the new TS and how it builds/ships
- [x] Confirm the test/CI/typecheck gaps (verified: no CI runs the runner tests)
- [x] Capture the repo's existing TS conventions (vitest, structure spec, CI shape)
- [x] Write context / research / plan
- [x] Phase 1: vitest + scripts + convert tests (green: 42 tests, typecheck gate live)
- [x] Phase 2: CI Node job + junit publish (added to 12-check-unit-tests.yml; YAML + frozen install verified)
- [x] Phase 3: golden-fixture contract test on the TS side (runtime + compile-time guards; both proven)
- [x] Phase 4: `AGENTS.md` + the `createAgentServer`/`runCli` seam + server/cli tests (eslint deferred)
- [~] Phase 5: runner-side version/`/health` + version bump + local.py docstring DONE; client probe, release scheme, image publishing, app.py config hygiene DEFERRED (decisions)
- [ ] Commit: lands with `feat/agent-runner-engines` (shared files block an independent commit)

## Notes / caveats for the next reader

- `services/agent` is intentionally NOT in `web/pnpm-workspace.yaml`. Keep it standalone so
  the sidecar Docker build stays decoupled from the web dependency graph.
- The golden fixtures live under `sdks/python/oss/tests/pytest/unit/agents/golden/`. The TS
  contract test should read them in place, not copy them.
- Frontend TS (`web/oss/src/components/AgentChatSlice/`) is out of scope; it already has a
  home and conventions.
- Some runner modules read env at import time; new tests should dynamic-import after setting
  env (vitest isolates modules per file).
