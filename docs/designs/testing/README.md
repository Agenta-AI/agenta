# Testing

This directory specifies the testing strategy for the Agenta monorepo, covering all system interfaces: API, SDK, Web, Services, and Docs. The strategy uses orthogonal documents: principles describe the philosophy, boundaries describe architectural layers, dimensions describe filtering, structure describes folder layout, and interface documents describe per-component specifics.

**The folder decides the layer, and the rule is about RUNTIME dependencies.** It
applies to every part of the repo — api, sdks, services, runner, web, packages —
in both Python and TypeScript.

The distinction is runtime, not code. Importing a module, a package, or another
workspace's library is a **code** dependency and stays unit — import as much as
you like. What moves a test out of `unit/` is needing something **running**: a
database, an object store, a broker, an HTTP server, a browser, a spawned
process, a container. Reading `POSTGRES_HOST` from the environment is fine;
connecting to it is not. One runtime dependency, still exercising a single unit →
`integration/`. Point-like or flow-like end to end → `acceptance/`.

**That includes the part's own server.** An api unit test must not need the api
running, a web unit test must not need the web app served, and the same holds for
the runner, services and workers. Import the code and call it; do not boot your
own process and talk to it over a socket. This is the case that slips through
most often, because the dependency looks internal — it is not, it is a running
thing.

In-process is the dividing line, not the protocol. Constructing an app object in
the test and driving it through an in-memory transport — FastAPI's `TestClient`,
`httpx.ASGITransport`, a React render — starts no server and stays **unit**, as
long as everything below is faked. The check that settles it: **stop the
deployment and run the test.** If it still passes, it was a unit test.

A runtime dependency is **relative to the part you are testing**, so the same
thing changes layer depending on which side of it you sit. Postgres is a runtime
dep of the api; the api is a runtime dep of web and of the sdks; a sandbox
provider is one of the runner. A web test that calls a running api is not a unit
test even though it opens no database, and an sdk test hitting a live endpoint is
not a unit test even though it is one function call. Conversely a web test that
imports `@agenta/entities` and drives it with fixtures is a unit test, however
many packages it pulls in.

This is not stylistic. A unit test that reaches a shared running resource becomes
order-dependent — green alone, red in a full-layer run once another test mutates
state it assumed — and that failure reads as a regression in whatever branch is
checked out.

---

## Quick Reference

### Core Specifications

| Document | Description |
|----------|-------------|
| [testing.principles.specs.md](testing.principles.specs.md) | Philosophy, test pyramid, tradeoffs, mocking approach |
| [testing.boundaries.specs.md](testing.boundaries.specs.md) | Architectural test layers and what to test at each |
| [testing.dimensions.specs.md](testing.dimensions.specs.md) | Unified marker/tag taxonomy across all runners |
| [testing.structure.specs.md](testing.structure.specs.md) | Folder layout, file types, naming conventions |

### Interface Specifications

| Document | Description |
|----------|-------------|
| [testing.interfaces.specs.md](testing.interfaces.specs.md) | Overview of all system interfaces and testing matrix |
| [testing.interface.api.specs.md](testing.interface.api.specs.md) | API testing: current state, targets, mocking guidance |
| [testing.interface.sdk.specs.md](testing.interface.sdk.specs.md) | SDK testing: unit, integration, smoke |
| [testing.interface.web.specs.md](testing.interface.web.specs.md) | Web testing: Playwright E2E, data layer, component unit |

### Supporting Documents

| Document | Description |
|----------|-------------|
| [testing.fixtures.specs.md](testing.fixtures.specs.md) | Shared test infrastructure, accounts, helpers, scoping |
| [testing.running.specs.md](testing.running.specs.md) | How to run tests: local, cloud, CI |
| [testing.initial.specs.md](testing.initial.specs.md) | Original discussion-format spec (preserved as reference) |
| [rtm/web-acceptance-rtm.md](rtm/web-acceptance-rtm.md) | Web acceptance requirements traceability matrix for the current OSS Playwright suite |

---

## Which layer a test belongs to

**The folder decides the layer, not a marker**, and the question is what must be
**running** — not what is imported.

| Layer | May use | Needs running |
| ----- | ------- | ------------- |
| `unit/` | any import; env values; fixtures, fakes, in-memory doubles | **nothing** |
| `integration/` | one or more runtime deps, still exercising a single unit | e.g. Postgres, Redis, the api, a browser |
| `acceptance/` | a deployment, point-like or flow-like end to end | the stack |

A code dependency never moves a test out of `unit/`; a runtime dependency always
does — **including the part's own server.** An api unit test must not need the
api running; a web unit test must not need the web app served; the same for the
runner, services and workers. Call the function, construct the class, drive the
component — do not boot the thing you are testing and talk to it over a socket.
If a test needs its own process up, it is `integration/` at least.

What counts as a runtime dep is relative to the part under test — its own server
first, then whatever it calls:

| Part | Typical runtime deps |
| ---- | -------------------- |
| `api/` | Postgres, Redis, object store, the workers |
| `sdks/` | a running api |
| `services/` | the api, plus whatever the service brokers |
| `services/runner/` | sandbox providers, spawned agent processes, the api |
| `web/` | the api; a browser for Playwright |
| `web/packages/` | the api, for the packages that reach it (e.g. `agenta-entities`, `agenta-annotation` both have `tests/integration/`); nothing for pure-logic and component tests |

A package having its own `integration/` folder is normal, not a smell:
`web/packages/agenta-entities/tests/` holds both, with the integration side
gated on `AGENTA_API_URL` + `AGENTA_AUTH_KEY` and skipping when they are absent.
That is the shape to copy — split by what must be running, in the same package.

**An empty `unit/`, `integration/` or `acceptance/` folder means the setup is
incomplete — not that the layer does not apply.** Every part needs all three.
A missing integration layer usually means its tests were filed as unit tests
(where they fail intermittently, see above) or as acceptance tests (where they
are skipped on any machine without a full stack). If a layer is empty, the
question is what is missing from it, not whether it is needed.

## Status Matrix

Test folder structure is now **standardized** across all components with `manual/`, `legacy/`, and `pytest/`|`playwright/` containing `acceptance/`, `integration/`, `unit/`, and `utils/` subdirectories.

| Component | Unit Tests | Integration Tests | Acceptance Tests | Manual Tests | CI |
|-----------|-----------|------------------|-----------------|--------------|-----|
| **API** | Structure ready | Structure ready | ✅ 155 tests across 7 domains | ✅ HTTP files, scripts | Linting only |
| **SDK** | ✅ 22 tests (tracing decorators) | Structure ready | ✅ 66 tests (SDK against live API) | ✅ Workflow tests, imports | Linting only |
| **Web** | ✅ Jotai atom tests (colocated) | Structure ready | ✅ Playwright feature suites | ✅ Data layer tests (manual) | Linting only |
| **Services** | Structure ready | Structure ready | Structure ready | ✅ smoke.http | N/A |
| **Docs** | N/A | N/A | Planned (link checking, build) | N/A | N/A |

---

## Quick Start: Running Tests

### API Tests

```bash
# Run all E2E tests
cd api
AGENTA_API_URL=http://localhost:10180/api AGENTA_AUTH_KEY=change-me-auth \
  python -m pytest oss/tests/pytest/ -v

# Run smoke tests only (fast subset)
python -m pytest oss/tests/pytest/ -v -m coverage_smoke

# Run specific domain
python -m pytest oss/tests/pytest/acceptance/workflows/ -v

# Run with dimension filters
python -m pytest oss/tests/pytest/ -v -m "coverage_smoke and path_happy"
python -m pytest oss/tests/pytest/ -v -m "cost_free"  # Exclude paid tests
```

### SDK Tests

```bash
# Run all tests (unit + E2E)
cd sdk
AGENTA_API_URL=http://localhost:10180/api AGENTA_AUTH_KEY=change-me-auth \
  uv run pytest oss/tests/pytest/ -v

# Run unit tests only (no external deps)
uv run pytest oss/tests/pytest/unit/ -v

# Run acceptance tests only (requires running API)
uv run pytest oss/tests/pytest/acceptance/ -v -m acceptance

# Run with dimension filters
uv run pytest oss/tests/pytest/acceptance/ -v -m "coverage_smoke and cost_free"
```

### Web Tests

```bash
cd web/tests

# Run smoke tests (OSS) - AGENTA_LICENSE not needed when path is explicit
AGENTA_WEB_URL=http://localhost:10180 \
TESTMAIL_NAMESPACE=<your-namespace> \
TESTMAIL_API_KEY=<your-key> \
  npx playwright test ../oss/tests/playwright/acceptance/smoke.spec.ts

# Run smoke tests (EE)
AGENTA_WEB_URL=http://localhost:10180 \
TESTMAIL_NAMESPACE=<your-namespace> \
TESTMAIL_API_KEY=<your-key> \
  npx playwright test ../ee/tests/playwright/acceptance/smoke.spec.ts

# Run all acceptance tests for a specific feature (OSS)
npx playwright test ../oss/tests/playwright/acceptance/settings/

# Run with tag filters (requires AGENTA_LICENSE when using default testDir)
AGENTA_LICENSE=oss npx playwright test --grep "@coverage:smoke"
AGENTA_LICENSE=oss npx playwright test --grep "@coverage:smoke.*@cost:free"
```

**Note:** Web tests require valid TESTMAIL credentials. See [web/tests/playwright.config.ts](../../web/tests/playwright.config.ts) for configuration details.

---

## Agent release gate (manual QA)

The agent runtime has a portable, wire-level QA harness packaged as the **`agent-release-gate`**
skill (`.agents/skills/agent-release-gate/`). It drives the same product endpoint the playground
drives and asserts on the SSE frame stream and real side effects, never on model prose, so it runs
against any deployment (cloud or self-hosted) from three env vars (`AGENTA_BASE`,
`AGENTA_PROJECT_ID`, `AGENTA_API_KEY`) that connect the driver to the deployment. Some individual
cells need more than that — a vault provider key, a custom-provider slug, or a subscription
sidecar login — documented per cell in `resources/coverage.md`. The continuity journeys (`warm`,
`cold1`, `cold2`) additionally need a **store-backed** deployment: with no object store the runner
falls back to an ephemeral working directory, so they SKIP by default and FAIL with
`--require-store`. Run the gate before an agent-workflows release, or after changing the runner,
the SDK agent adapters, or the runner images. The skill's `SKILL.md` has the run procedure; `resources/coverage.md` has the cells ×
journeys matrix.

## Related In-Tree Documentation

| Location | Description |
|----------|-------------|
| `web/tests/guides/` | Playwright E2E guides (generation, organization, fixtures, recording) |
| `sdk/tests/unit/README.md` | SDK unit test quick start |
| `sdk/tests/unit/TESTING_PATTERNS.md` | SDK testing patterns and approaches |
| `web/tests/playwright/config/testTags.ts` | Web test tag definitions |
| `api/pytest.ini` | API pytest configuration and markers |
| `sdk/pytest.ini` | SDK pytest configuration and markers |
