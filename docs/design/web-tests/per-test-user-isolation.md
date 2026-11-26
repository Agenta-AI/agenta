# Per-Test User Isolation for Playwright E2E Tests

This document describes the design for replacing the current single-user global-setup model with per-test user isolation. The goal is to give each test (or test group) its own authenticated user and project so tests can run in parallel without interfering with each other.

Related docs:
- [testing.fixtures.specs.md](../testing/testing.fixtures.specs.md) — Current fixture inventory
- [testing.interface.web.specs.md](../testing/testing.interface.web.specs.md) — Web testing overview

---

## Problem

The current setup creates **one user per test run** in `global-setup.ts`, serializes its `storageState` to disk, and every test reuses that session. This causes:

1. **No parallelism** — `workers: 1` and `fullyParallel: false` are forced because tests share state
2. **Cross-test pollution** — test A creates an app, test B sees it in its list
3. **Can't test roles/permissions** — only one user exists, so invite/role/permission testing is impossible
4. **Flaky ordering dependencies** — tests implicitly depend on state left by prior tests

---

## Current Architecture

```
global-setup.ts
├── OSS: authenticate admin → invite test user → authenticate test user
└── EE:  authenticate new user via OTP
         ↓
     storageState → results/{license}/state.json
         ↓
     playwright.config.ts: use.storageState (shared by all tests)
         ↓
     Every test runs as the same user in the same project
         ↓
global-teardown.ts: delete ephemeral project, cleanup secrets
```

### Key files

| File | Role |
|------|------|
| `web/tests/playwright/global-setup.ts` | Authenticates user, saves storageState, creates ephemeral project |
| `web/tests/playwright/global-teardown.ts` | Deletes ephemeral project, cleans up secrets, optionally deletes accounts |
| `web/tests/playwright/config/runtime.ts` | Path helpers for storageState, project metadata, output dirs |
| `web/tests/playwright.config.ts` | `use.storageState` references the shared file, `workers: 1` |
| `web/tests/tests/fixtures/base.fixture/` | Composition root: apiHelpers, uiHelpers, providerHelpers |
| `web/tests/tests/fixtures/user.fixture/` | Types + authHelpers (no actual fixture function) |
| `web/tests/tests/fixtures/session.fixture/` | Worker-scoped browser context with optional sharing |

---

## Target Architecture

```
global-setup.ts (slimmed)
├── OSS: authenticate admin only → save admin storageState
└── EE:  health check only (or no-op)
         ↓
     Worker-scoped userFixture
     ├── OSS: use admin session to invite a new user → authenticate via OTP
     └── EE:  sign up a new user via OTP directly
              ↓
          In-memory storageState per worker (not shared file)
              ↓
          Test-scoped projectFixture
              create project via API → run test → delete project
              ↓
          Each test gets: own user (per worker) + own project (per test)
              ↓
     Fixture teardown: delete project (test-scoped), optionally delete user (worker-scoped)
```

### Key design decisions

1. **User scope = worker.** Creating a user per test is too expensive (OTP flow + email round-trip). Users are created once per Playwright worker and reused across tests in that worker. Project isolation per test provides the actual data boundary.

2. **Project scope = test (or describe block).** Each test creates an ephemeral project and deletes it on teardown. Tests within a `describe` block can share a project if the block opts in.

3. **License switch inside the fixture, not around it.** Both OSS and EE run the same fixture. The fixture contains a `license === "oss"` branch internally. Both paths produce the same output shape: `{ email, storageState, projectId, workspaceId }`.

4. **Global setup is minimal.** OSS global-setup only authenticates the admin (needed to create invites). EE global-setup can be a simple health check or no-op.

5. **No shared storageState file.** Each worker holds its auth state in memory. The `playwright.config.ts` `use.storageState` is removed; instead, the fixture injects it per-context.

---

## Detailed Design

### Phase 1: Worker-scoped user fixture

Create `web/tests/tests/fixtures/user.fixture/index.ts` (currently does not exist).

```
user.fixture/index.ts
├── createUserForWorker(license, adminState?)
│   ├── OSS path:
│   │   1. Load admin storageState from results/{license}/admin-state.json
│   │   2. Call POST /api/.../invite with admin auth → get invite URL
│   │   3. Launch headless browser context
│   │   4. Navigate to invite URL, authenticate via OTP (reuse authenticateUser())
│   │   5. Capture storageState from the browser context
│   │   6. Return { email, storageState, organizationId, workspaceId }
│   │
│   └── EE path:
│       1. Generate unique Testmail email for this worker
│       2. Launch headless browser context
│       3. Navigate to /auth, authenticate via OTP (reuse authenticateUser())
│       4. Complete post-signup flow
│       5. Capture storageState from the browser context
│       6. Return { email, storageState, organizationId, workspaceId }
│
└── Fixture wiring (worker-scoped):
    - On init: call createUserForWorker()
    - Store result in workerState
    - On teardown: optionally delete user via API
```

**Type contract:**

```typescript
interface WorkerUserState {
    email: string
    storageState: BrowserContextStorageState  // in-memory, not file path
    organizationId: string
    workspaceId: string
}
```

The fixture is worker-scoped so each parallel worker gets its own user. Within a worker, tests run sequentially (Playwright default), so the user is safe to share.

### Phase 2: Test-scoped project fixture

Create a `projectFixture` (test-scoped) that:

1. Uses the worker user's auth to call `POST /api/projects/` → creates ephemeral project
2. Provides `projectId` and `projectBasePath` (`/w/{workspaceId}/p/{projectId}`) to the test
3. On teardown, calls `DELETE /api/projects/{projectId}`

```typescript
interface TestProjectState {
    projectId: string
    projectName: string
    basePath: string  // /w/{workspaceId}/p/{projectId}
}
```

Tests that need to share a project within a `describe` block can use `test.describe.configure({ mode: 'serial' })` with the project fixture scoped to the describe block.

### Phase 3: Slim global-setup

**OSS:**
```
global-setup.ts (OSS)
1. Launch browser
2. Authenticate admin user (existing authenticateUser() function)
3. Save admin storageState to results/oss/admin-state.json
4. Close browser
```

The admin state is read-only — workers use it to create invites but never modify it.

**EE:**
```
global-setup.ts (EE)
1. Health check: fetch baseURL, verify 200
2. (Optional) Warm up auth page to trigger Turnstile script caching
```

No user creation at all. Each worker handles its own signup.

### Phase 4: Config and infrastructure updates

**`playwright.config.ts`:**
```diff
- storageState: getStorageStatePath(),
+ // storageState removed — injected per-test by userFixture
  fullyParallel: true,
- workers: 1,
+ workers: process.env.CI ? 4 : 2,
```

**`session.fixture/index.ts`:**
Update to pull `storageState` from the worker-scoped user fixture instead of from disk. The `useSharedContext` flag still works — it shares the browser context across tests in the same worker, but the underlying user is from the fixture.

**`global-teardown.ts`:**
- Remove ephemeral project deletion (now handled by test-scoped fixture teardown)
- Keep model hub secret cleanup (or move it to fixture teardown too)

### Phase 5: Auth helper consolidation

Currently `authenticateUser()` exists in two places:
- `web/tests/playwright/global-setup.ts` (standalone function)
- `web/tests/tests/fixtures/user.fixture/authHelpers/index.ts` (fixture-bound)

Consolidate into a single shared module:
```
web/tests/utils/auth.ts
├── authenticateUser(page, options) → AuthResult
├── fillOTPDigits(page, otp, delay)
├── handlePostSignup(page)
├── handleTurnstile(page, options)
└── waitForSettledAuthenticatedPage(page, timeout)
```

Both global-setup and the user fixture import from this shared module. This eliminates the current duplication and ensures bug fixes (like the Turnstile handling) apply everywhere.

---

## Migration Strategy

The migration is incremental. Each phase can be merged independently.

### Step 1: Extract shared auth module
- Move `authenticateUser()` and helpers from `global-setup.ts` into `web/tests/utils/auth.ts`
- Update `global-setup.ts` to import from the shared module
- Update `user.fixture/authHelpers/index.ts` to import from the shared module
- **No behavior change.** Tests continue to work exactly as before.

### Step 2: Create worker-scoped user fixture
- Implement `user.fixture/index.ts`
- Wire it into the fixture chain: `base.fixture` → `user.fixture` → `session.fixture`
- Keep `global-setup.ts` creating the admin (OSS) or test user (EE) as today
- **Tests still use the global storageState.** The fixture is created but not yet consumed.

### Step 3: Create test-scoped project fixture
- Add project creation/deletion per test
- Tests that currently rely on the global ephemeral project switch to using the fixture's project
- **Incremental adoption.** Tests opt in one-by-one by using the new fixture.

### Step 4: Cut over config
- Remove `use.storageState` from `playwright.config.ts`
- Enable `fullyParallel: true` and increase `workers`
- Slim down `global-setup.ts` to admin-only (OSS) or health-check (EE)
- Update `global-teardown.ts`
- **All tests now use per-worker users and per-test projects.**

---

## Scoping Rules

| Scope | What | Lifecycle | Cleanup |
|-------|------|-----------|---------|
| **Global (run)** | Admin user (OSS only) | Created in global-setup, lives for entire run | Optionally deleted in global-teardown |
| **Worker** | Test user + storageState | Created on worker init, shared across tests in that worker | Deleted on worker teardown |
| **Test** | Ephemeral project | Created before each test, deleted after | Deleted in fixture teardown |

---

## Environment Variables

No new env vars are required. Existing vars continue to work:

| Variable | Used by | Purpose |
|----------|---------|---------|
| `AGENTA_LICENSE` | global-setup, fixture | OSS vs EE path switch |
| `AGENTA_WEB_URL` | everything | Base URL |
| `AGENTA_API_URL` | global-setup, fixture | API URL (derived from web URL if absent) |
| `TESTMAIL_NAMESPACE` | auth flows | Testmail inbox prefix |
| `TESTMAIL_API_KEY` | auth flows | Testmail API access |
| `AGENTA_TEST_AUTH_MODE` | auth flows | Force password/otp/auto |
| `AGENTA_TEST_OSS_OWNER_EMAIL` | global-setup (OSS) | Admin email override |
| `AGENTA_TEST_OSS_OWNER_PASSWORD` | global-setup (OSS) | Admin password |

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| OTP email delivery is slow (5-15s per user) | Worker-scoped users amortize the cost. With 4 workers, only 4 OTP flows run (+ 1 admin for OSS). |
| Testmail rate limits | Workers stagger startup naturally. Can add explicit delay if needed. |
| Turnstile blocks parallel auth flows | Each worker uses its own browser context. Turnstile tokens are per-session, no cross-worker conflict. |
| Admin storageState expires mid-run (long suites) | Admin session is only used for invite API calls. Can refresh on 401. |
| Existing tests assume shared state | Migration is incremental — tests opt in to the new fixture. Shared-state tests continue to work until migrated. |

---

## Open Questions

1. **Should workers share a user across `describe` blocks, or should each `describe` get its own user?** Current plan: worker-scoped user, test-scoped project. This means tests within a worker share the user but get isolated projects.

2. **How to handle test.describe.serial blocks that need to share project state?** Option A: fixture with `{ scope: 'test.describe' }` (Playwright supports this natively). Option B: tests within the block skip project teardown and share.

3. **Should the user fixture create the user lazily (on first test) or eagerly (on worker init)?** Eager is simpler and avoids race conditions. Lazy saves time if a worker gets no tests (unlikely).

4. **Do we need a pool of pre-created users for speed?** Not for now. OTP flow is ~10s and only runs once per worker. If it becomes a bottleneck, a pre-seeded user pool can be added behind the same fixture interface.
