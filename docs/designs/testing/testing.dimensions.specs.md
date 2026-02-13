# Testing Dimensions

## Concept

Dimensions are orthogonal classification axes applied to tests. They enable
selective test execution via CLI flags or markers. Each dimension is independent
of the others -- a test may carry any combination of dimension markers.

Dimensions are independent of boundaries. A test at any boundary (unit,
integration, E2E) can carry dimension markers, though in practice dimensions are
applied primarily to E2E tests. Unit tests generally do not need dimensions.

## Shared dimensions

These dimensions are common across all three runners (API, SDK, Web). Some dimensions have interface-specific values.

| Dimension | Values | Semantics |
| --------- | ------ | --------- |
| coverage | `smoke`, `full` (API/SDK); `smoke`, `sanity`, `light`, `full` (Web) | Breadth and depth of testing. `smoke` is breadth over depth; `full` is breadth and depth. Web adds `sanity` (narrow breadth, deep depth) and `light` (smoke + sanity). |
| path | `happy`, `grumpy` | Desired behavior vs undesired behavior (error states, invalid inputs). |
| case | `typical`, `edge` | Likely scenarios vs unlikely scenarios. |
| lens | `functional`, `performance`, `security` | The quality attribute under test: correctness, latency, or security posture. |
| speed | `fast`, `slow` | Expected duration. `fast` targets millisecond-scale execution; `slow` targets second-scale execution. |
| cost | `free`, `paid` | Whether the test incurs monetary costs. `free` = purely code execution (local services, internal APIs, free services). `paid` = uses paid third-party services (LLM APIs, external APIs with usage costs). |
| role | `owner`, `admin`, `editor`, `viewer` | The user permission level under which the test executes. API/SDK include `admin` role; Web uses `owner`, `editor`, `viewer`. |
| plan | `hobby`, `pro`, `business`, `enterprise` | The organization plan level under which the test executes. API/SDK include all tiers; Web typically uses `hobby`, `pro`. |
| license | `oss`, `ee` | License scope. **Dual usage:** (1) Structural organization via folder paths (`oss/tests/` vs `ee/tests/`) for local test organization; (2) Explicit markers/tags for filtering when testing against remote environments where folder structure doesn't indicate the remote server's license. |
| scope | Interface-specific values | The functional area or domain of the application under test. Web: `auth`, `apps`, `playground`, `datasets`, `evaluations`, `settings`, `deployment`, `observability`. API/SDK: Handled via directory structure (e.g., `workflows/`, `evaluations/`) rather than explicit markers. |

## Syntax mapping

### Pytest (API/SDK)

Markers follow the pattern `@pytest.mark.{dimension}_{value}`.

```python
@pytest.mark.coverage_smoke
@pytest.mark.path_happy
@pytest.mark.lens_functional
@pytest.mark.speed_fast
@pytest.mark.cost_free
@pytest.mark.license_oss
def test_create_workflow():
    ...
```

Example with EE-only feature:

```python
@pytest.mark.coverage_smoke
@pytest.mark.path_happy
@pytest.mark.lens_functional
@pytest.mark.cost_free
@pytest.mark.license_ee
def test_workspace_management():
    ...
```

Example with paid third-party service (LLM API):

```python
@pytest.mark.coverage_smoke
@pytest.mark.path_happy
@pytest.mark.lens_functional
@pytest.mark.cost_paid  # Uses OpenAI API
@pytest.mark.license_oss
def test_llm_generation():
    ...
```

CLI filtering uses the `-m` flag with marker expressions:

```bash
pytest -m coverage_smoke
pytest -m "coverage_smoke and path_happy"
pytest -m "coverage_smoke and lens_functional and speed_fast"
pytest -m "cost_free"  # Run only free tests
pytest -m "not cost_paid"  # Exclude tests that cost money
pytest -m "license_oss"  # Run only OSS tests (e.g., against remote OSS server)
pytest -m "license_ee"  # Run only EE tests (e.g., against remote EE server)
```

### Playwright (Web)

Tags follow the pattern `@{dimension}:{value}`.

```typescript
test("create app @coverage:smoke @path:happy @lens:functional @speed:fast @cost:free @license:oss", async () => {
    ...
})
```

Example with EE-only feature:

```typescript
test("manage workspace @coverage:smoke @path:happy @lens:functional @cost:free @license:ee", async () => {
    ...
})
```

Example with paid third-party service (LLM API):

```typescript
test("generate with LLM @coverage:smoke @path:happy @lens:functional @cost:paid @license:oss", async () => {
    // Test that calls OpenAI/Anthropic/etc API
    ...
})
```

CLI filtering uses dimension-specific flags:

```bash
npx playwright test -coverage smoke
npx playwright test -coverage smoke -path happy
npx playwright test -coverage smoke -lens functional -speed fast
npx playwright test -cost free  # Run only free tests
npx playwright test -license oss  # Run only OSS tests (e.g., against remote OSS server)
npx playwright test -license ee  # Run only EE tests (e.g., against remote EE server)
```

The full tag syntax mapping from `testTags.ts`:

| Dimension | CLI flag | Tag prefix |
| --------- | -------- | ---------- |
| scope | `-scope` | `@scope:` |
| coverage | `-coverage` | `@coverage:` |
| path | `-path` | `@path:` |
| plan | `-plan` | `@plan:` |
| role | `-role` | `@role:` |
| lens | `-lens` | `@lens:` |
| case | `-case` | `@case:` |
| speed | `-speed` | `@speed:` |
| license | `-license` | `@license:` |
| cost | `-cost` | `@cost:` |

## Usage guidelines

- Apply dimension markers to E2E tests. Unit tests generally do not need dimensions.
- Every E2E test should have at minimum: `coverage`, `path`, `lens`, and `cost` markers.
- Use `coverage_smoke` / `@coverage:smoke` for the smallest set that validates basic functionality.
- Use `path_happy` / `@path:happy` for expected flows, `path_grumpy` / `@path:grumpy` for error states and invalid inputs.
- **Always mark `cost`** -- `cost_free` / `@cost:free` for tests that only use local/internal services, `cost_paid` / `@cost:paid` for tests that call paid third-party APIs (LLMs, external services with usage costs).
- **Mark `license`** when the test is specific to a license level -- `license_oss` / `@license:oss` for OSS-only features, `license_ee` / `@license:ee` for EE-only features. Use these markers to filter when testing against remote environments.
- Combine dimensions to build targeted test suites:
  - `"smoke happy functional fast free"` -- Fast CI gate without costs
  - `"coverage_smoke and cost_free"` -- Quick validation without spending money
  - `"not cost_paid"` -- Exclude all tests that incur charges
  - `"coverage_smoke and license_oss"` -- Test against remote OSS environment
  - `"license_ee"` -- Test against remote EE environment

## Design rules

- **Dimension application:** Dimensions apply primarily to E2E tests. Unit tests generally do not need dimension markers.
- **`coverage` semantics:** Running with `coverage_full` (or no coverage filter) means all tests run. `full` is not a separate tier to mark individually -- it means "no filter applied."
- **`scope` in API/SDK:** Handled via directory structure (e.g., `pytest/e2e/workflows/`, `pytest/e2e/evaluations/`) rather than explicit markers. Web uses explicit `@scope:` tags.
- **`license` has dual usage:** Tests are organized structurally by folder (`oss/tests/` vs `ee/tests/`) for clarity. Explicit markers (`@pytest.mark.license_oss` / `@license:oss` tags) enable filtering when testing against remote environments where the folder structure doesn't indicate the remote server's license (e.g., running local tests against a remote staging server). Use markers when targeting specific remote license environments.
- **Interface-specific values:** Some shared dimensions have interface-specific values:
  - `coverage`: API/SDK use `smoke`/`full`; Web adds `sanity`/`light`
  - `role`: API/SDK include `admin`; Web uses `owner`/`editor`/`viewer`
  - `plan`: API/SDK include all tiers; Web typically uses `hobby`/`pro`
- **`cost` dimension clarifications:**
  - Mark `cost_free` / `@cost:free` if the test only exercises code, local services, internal APIs, or free external services (e.g., public APIs with no usage limits).
  - Mark `cost_paid` / `@cost:paid` if the test makes calls to paid third-party services where execution incurs monetary charges (LLM APIs like OpenAI/Anthropic/Cohere, cloud services with per-request pricing, etc.).
  - Tests hitting our own API/services are `cost_free` unless the API itself proxies to a paid service.
  - When in doubt: if running the test 1000 times would increase your cloud bill, mark it `cost_paid`.
