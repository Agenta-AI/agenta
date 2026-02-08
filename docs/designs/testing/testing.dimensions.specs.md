# Testing Dimensions

## Concept

Dimensions are orthogonal classification axes applied to tests. They enable
selective test execution via CLI flags or markers. Each dimension is independent
of the others -- a test may carry any combination of dimension markers.

Dimensions are independent of boundaries. A test at any boundary (unit,
integration, E2E) can carry dimension markers, though in practice dimensions are
applied primarily to E2E tests. Unit tests generally do not need dimensions.

## Shared dimensions

These dimensions are common across all three runners (API, SDK, Web).

| Dimension | Values | Semantics |
| --------- | ------ | --------- |
| coverage | `smoke`, `full` (API/SDK); `smoke`, `sanity`, `light`, `full` (Web) | Breadth and depth of testing. `smoke` is breadth over depth; `full` is breadth and depth. Web adds `sanity` (narrow breadth, deep depth) and `light` (smoke + sanity). |
| path | `happy`, `grumpy` | Desired behavior vs undesired behavior (error states, invalid inputs). |
| case | `typical`, `edge` | Likely scenarios vs unlikely scenarios. |
| lens | `functional`, `performance`, `security` | The quality attribute under test: correctness, latency, or security posture. |
| speed | `fast`, `slow` | Expected duration. `fast` targets millisecond-scale execution; `slow` targets second-scale execution. |
| license | (implicit) | OSS vs enterprise edition. In pytest this is structural -- separate test paths (`oss/tests/pytest` vs `ee/tests/pytest`). In Playwright it is implicit via environment preset. There is no explicit marker for this dimension. |

## API/SDK-specific dimensions

These dimensions exist only in the pytest runners (API and SDK).

| Dimension | Values | Semantics |
| --------- | ------ | --------- |
| role | `owner`, `admin`, `editor`, `viewer` | The user permission level under which the test executes. |
| plan | `hobby`, `pro`, `business`, `enterprise` | The organization plan level under which the test executes. |

## Web-specific dimensions

These dimensions exist only in the Playwright runner (Web).

| Dimension | Values | Semantics |
| --------- | ------ | --------- |
| scope | `auth`, `apps`, `playground`, `datasets`, `evaluations`, `settings`, `deployment`, `observability` | The functional area of the application under test. |
| permission | `owner`, `editor`, `viewer` | The user permission level under which the test executes. |
| entitlement | `hobby`, `pro` | The organization entitlement level under which the test executes. |
| feature | `ee` | Feature availability scope. Marks tests that require enterprise edition features. |
| env | `local`, `staging`, `beta`, `oss`, `demo`, `prod` | The deployment environment or preset the test targets. |

## Syntax mapping

### Pytest (API/SDK)

Markers follow the pattern `@pytest.mark.{dimension}_{value}`.

```python
@pytest.mark.coverage_smoke
@pytest.mark.path_happy
@pytest.mark.lens_functional
@pytest.mark.speed_fast
def test_create_workflow():
    ...
```

CLI filtering uses the `-m` flag with marker expressions:

```bash
pytest -m coverage_smoke
pytest -m "coverage_smoke and path_happy"
pytest -m "coverage_smoke and lens_functional and speed_fast"
```

### Playwright (Web)

Tags follow the pattern `@{dimension}:{value}`.

```typescript
test("create app @coverage:smoke @path:happy @lens:functional @speed:fast", async () => {
    ...
})
```

CLI filtering uses dimension-specific flags:

```bash
npx playwright test -coverage smoke
npx playwright test -coverage smoke -path happy
npx playwright test -coverage smoke -lens functional -speed fast
```

The full tag syntax mapping from `testTags.ts`:

| Dimension | CLI flag | Tag prefix |
| --------- | -------- | ---------- |
| scope | `-scope` | `@scope:` |
| coverage | `-coverage` | `@coverage:` |
| path | `-path` | `@path:` |
| env | `-env` | `@env:` |
| feature | `-feature` | `@feature:` |
| entitlement | `-entitlement` | `@entitlement:` |
| permission | `-permission` | `@permission:` |
| lens | `-lens` | `@lens:` |
| case | `-case` | `@case:` |
| speed | `-speed` | `@speed:` |

## Usage guidelines

- Apply dimension markers to E2E tests. Unit tests generally do not need dimensions.
- Every E2E test should have at minimum: `coverage`, `path`, and `lens` markers.
- Use `coverage_smoke` / `@coverage:smoke` for the smallest set that validates basic functionality.
- Use `path_happy` / `@path:happy` for expected flows, `path_grumpy` / `@path:grumpy` for error states and invalid inputs.
- Combine dimensions to build targeted test suites (e.g., "smoke happy functional fast" for CI gates).

## Design rules

- `scope` is intentionally excluded from API/SDK dimensions. Pytest test organization uses directory structure rather than scope markers.
- Running with `coverage_full` (or no coverage filter) means all tests run. `full` is not a separate tier to mark individually -- it means "no filter applied."
- In the API/SDK context, dimensions apply to E2E tests only, not unit tests.
- The `license` dimension is not an explicit marker in pytest. It is handled structurally via separate test paths (`oss/tests/pytest` vs `ee/tests/pytest`).
- Web uses `permission` and `entitlement` where API/SDK uses `role` and `plan`. The concepts are equivalent but the naming reflects each runner's conventions.
