# Research

Findings from reading the repo on 2026-06-20. Everything below is observed in the tree, not
assumed.

## 1. Where the new TypeScript actually lives

Server-side TypeScript that did not exist before agent-workflows is concentrated in one
package:

```
services/agent/                 standalone pnpm package "agenta-agent-pi-wrapper"
  package.json                  ESM, type:module, pnpm 10.30, Node 24
  tsconfig.json                 strict, noEmit, moduleResolution Bundler
  pnpm-lock.yaml                its OWN lockfile (not in the web workspace)
  src/
    cli.ts        (88)          entrypoint: stdin JSON in, stdout JSON out
    server.ts     (155)         entrypoint: HTTP sidecar on :8765 (GET /health, POST /run)
    protocol.ts   (295)         the /run wire contract: request, result, events, caps
    responder.ts  (77)          permission/HITL policy seam (extracted from rivet.ts)
    engines/
      pi.ts       (403)         drive the Pi SDK in-process
      rivet.ts    (1085)        drive any harness over ACP via sandbox-agent
      skills.ts   (50)          resolve forced-skill names to dirs on disk
    tools/        (7 files)     callback, code, dispatch, mcp-bridge, mcp-server, relay, ...
    tracing/
      otel.ts     (1026)        turn a run into OTel spans nested under /invoke
    extensions/
      agenta.ts   (114)         Pi extension, esbuild-bundled into dist/ for Pi to load
  test/           (8 files)     hand-run tsx scripts (see section 3)
  skills/         SKILL.md       bundled forced-skills for the Agenta harness
  config/         fallback hello-world agent
  docker/         Dockerfile (prod) + Dockerfile.dev
  scripts/        build-extension.mjs (esbuild bundle of the extension)
```

Total runner source is ~4,100 lines. It is the only meaningful server-side TS in the repo.

Other TypeScript exists but is **not** in scope:

- `web/oss/src/components/AgentChatSlice/` — frontend, already under web conventions.
- `web/packages/*`, `web/oss`, `web/ee` — the established frontend, vitest + Playwright.
- `docs/`, `examples/` — Docusaurus and sample apps.

So "TypeScript in different places" is really one homeless package (`services/agent`) plus
frontend code that already has a home. The plan targets the package.

## 2. How the runner builds, runs, and ships today

- **No compile step for the app.** It runs through `tsx` (a TS-aware Node loader). Both the
  dev image (`tsx watch src/server.ts`) and the prod image (`tsx src/server.ts`) execute
  the source directly. `tsconfig.json` is `noEmit: true`; it exists only for typechecking,
  and nothing runs that typecheck.
- **One real build:** `scripts/build-extension.mjs` esbuild-bundles `src/extensions/agenta.ts`
  into `dist/extensions/agenta.js` so Pi can load it anywhere. Both Dockerfiles run
  `pnpm run build:extension`.
- **Two transports, one contract.** Python reaches the runner either over HTTP (the docker
  sidecar) or by spawning the CLI as a subprocess. Both carry the same `/run` JSON. See
  `sdks/python/agenta/sdk/agents/utils/ts_runner.py` (`deliver_http`, `deliver_subprocess`,
  plus the NDJSON streaming variants).
- **Standalone package.** `services/agent` has its own `pnpm-lock.yaml` and is absent from
  `web/pnpm-workspace.yaml`. That isolation is deliberate and worth keeping: the sidecar
  image installs only the runner's deps, with no coupling to the web dependency graph.
- **No TS in the wheel today, but a docstring claims otherwise.** The SDK wheel is pure
  Python (`uv_build`, zero `.ts`/`.js`). However `sdks/python/.../adapters/local.py` (the
  unimplemented `LocalBackend`) says the Pi runner is "the bundled JS runner ... shipped
  inside the wheel." That is aspirational and NOT YET IMPLEMENTED, but it is almost certainly
  the source of the "is the TS part of the SDK / wheel" worry. The future-local-backend
  question (bundle a built JS runner into the wheel vs require Docker/npm) is real and
  undecided; see plan Phase 5 item 6 and the distribution options in status.md.

Scripts present in `package.json` today: `run:cli`, `serve`, `serve:watch`,
`build:extension`, `login`. There is **no `test`, no `typecheck`, no `lint`, no `format`.**

## 3. How it is tested today (the gap)

There are 8 test files under `services/agent/test/`:

```
code-tool.test.ts   continuation.test.ts   mcp-servers.test.ts   responder.test.ts
skills.test.ts      stream-events.test.ts  tool-bridge.test.ts   tool-dispatch.test.ts
```

They are genuinely good tests in content. The problem is entirely in how they run:

- Each file is a **standalone script** using `node:assert/strict`, with bare `{ ... }`
  blocks for grouping and a `console.log("...: ok")` at the end. The header of each says
  `Run: pnpm exec tsx test/<name>.test.ts`.
- There is **no runner and no aggregation.** Running "the test suite" means running eight
  commands by hand. A failure is a thrown assertion and a non-zero exit on one file; there
  is no summary, no count, no `--watch`, no filtering, no coverage, no junit.
- They run in **no CI workflow.** `12-check-unit-tests.yml` has a `run-services-unit-tests`
  job, but it only looks at `services/oss/tests/pytest/unit` (Python) and runs
  `uv run python run-tests.py`. It never installs Node or touches `services/agent`. Every
  vitest mention in CI refers to `web/packages`. So the runner's tests have never gated a
  PR.
- There is **no TS-side contract test.** `protocol.ts` says the contract is pinned by
  golden fixtures under `sdks/python/oss/tests/pytest/unit/agents/golden/` and checked by
  the Python `test_wire_contract.py`. That guards the Python mirror (`wire.py`). Nothing on
  the TS side asserts that `protocol.ts` still accepts those fixtures, so the runner can
  drift from the contract and only Python would notice.

## 4. What the repo already standardizes for TypeScript tests

We do not need to invent a convention. The frontend already has one, and there is a written
spec:

- **vitest is the repo's TS unit runner.** `web/packages/*` (agenta-shared, entities,
  entity-ui, playground, annotation) each ship a `vitest.config.ts` and these scripts:

  ```jsonc
  "test": "pnpm run test:unit",
  "test:unit": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage",
  "typecheck": "tsc --noEmit"
  ```

  Config (from `agenta-shared/vitest.config.ts`): `include: ["tests/unit/**/*.test.ts"]`,
  `environment: "node"`, `reporters: ["default", "junit"]` writing `test-results/junit.xml`,
  and v8 coverage. This is exactly the shape a Node service wants.

- **CI runs them generically.** The web job runs `pnpm -r --if-present test:unit` across
  workspace packages and publishes `web/packages/*/test-results/junit.xml` via the
  `publish-unit-test-result-action`. Any package that defines `test:unit` is picked up; the
  rest are skipped. A new package following the same script names slots in for free.

- **There is a folder-layout spec.** `docs/designs/testing/testing.structure.specs.md`
  defines runner-first layout: `<component>/tests/<runner>/{unit,integration,acceptance,utils}`
  plus `manual/` and `legacy/`. In practice the vitest packages collapse this to
  `tests/unit/**/*.test.ts` (one runner, so no `vitest/` level). The agent runner's current
  flat `test/` directory matches neither; aligning it to `tests/unit/` matches the closest
  precedent (web packages) and the spec.

## 5. Python-to-TypeScript mental model

For mapping the tooling onto what the SDK/API side already does:

| Concern              | Python (api/, sdks/)      | TypeScript (services/agent)        |
|----------------------|---------------------------|------------------------------------|
| Package manager      | `uv`                      | `pnpm` (own lockfile)              |
| Run a script         | `uv run python x.py`      | `pnpm exec tsx x.ts`               |
| Test runner          | `pytest`                  | **vitest** (proposed)              |
| One command to test  | `uv run python run-tests.py` | `pnpm test` (proposed)          |
| Type checker         | `mypy` / pyright          | `tsc --noEmit` (configured, unrun) |
| Formatter            | `ruff format`             | `prettier` (runs repo-wide in hooks) |
| Linter               | `ruff check`              | none today (eslint is web-only)    |
| Fixtures             | `conftest.py` fixtures    | `tests/utils/` helper modules      |
| CI unit gate         | `12-check-unit-tests.yml` Python jobs | new Node job (proposed) |

The headline: the TS runner has a formatter (via the global pre-commit) but no test runner,
no test gate, and no type gate. The Python side has all three. Closing that is the work.

## 6. The cross-language contract is the seam that matters most

`protocol.ts` is the single source of the `/run` types. `sdks/python/.../utils/wire.py`
hand-mirrors them. The contract is pinned by shared golden JSON
(`run_request.pi.json`, `run_request.claude.json`, `run_result.ok.json`,
`run_result.error.json`) and asserted by `test_wire_contract.py` on the Python side only.

This is the highest-value place to add a TS test. A vitest test that loads those same
golden files and round-trips them through `protocol.ts` (parse the request shape, build a
result that matches the result fixture) means a contract change has to update both sides or
fail on both sides. It reuses fixtures that already exist, needs no harness and no network,
and directly protects the Python-to-Node boundary the whole feature rests on.

## 7. Maintainability observations (not blockers)

- **Architecture is sound.** Engines are peers behind one contract; tools are split by
  concern; the responder seam was already extracted from `rivet.ts` (and is unit-tested).
  `protocol.ts` carries thorough doc comments. A Python dev can navigate it.
- **Two large files.** `engines/rivet.ts` (1,085) and `tracing/otel.ts` (1,026) are the
  obvious decomposition candidates. The responder extraction is the precedent: pull
  cohesive seams out into separately testable units when you next touch them. Not a
  big-bang refactor, and not a prerequisite for the test/CI work.
- **No `AGENTS.md` for the package.** The repo pushes area conventions into nested
  `AGENTS.md` files (`web/AGENTS.md`, `api/AGENTS.md`) with a `CLAUDE.md` symlink.
  `services/agent` has a strong `README.md` but no `AGENTS.md`, so the "where does runner
  code/tests go, how do I run them" rules have nowhere to live. Adding one is cheap and
  fits the repo's instruction-layering model.
- **Env-at-import-time.** Some modules read env on import (e.g. `skills.ts` reads
  `AGENTA_AGENT_SKILLS_DIR`; the test sets it before a dynamic `import()`). vitest isolates
  modules per test file, so this keeps working, but new tests touching such modules should
  use dynamic import or `vi.resetModules()` rather than top-level import.

## 8. One real decision to make

**vitest vs `node:test`.** `node:test` is built in and adds zero dependencies, but it has
no first-class junit reporter or coverage UX and would diverge from the frontend. vitest
adds one dev dependency but matches `web/packages` exactly, gives junit + v8 coverage +
watch + filtering out of the box, and lets the CI wiring mirror the web job. Recommendation:
**vitest.** Everything in the plan assumes it; swapping to `node:test` would only change the
runner dependency and config, not the structure.
