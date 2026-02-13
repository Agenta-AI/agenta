# Testing Boundaries

Boundaries describe *where* in the architecture a test lives -- which layer it exercises and what it isolates. Each boundary defines what is under test, what is mocked or faked, and what assertions are appropriate.

This document is interface-agnostic. For how boundaries apply to a specific interface, see the per-interface specs ([API](testing.interface.api.specs.md), [SDK](testing.interface.sdk.specs.md), [Web](testing.interface.web.specs.md)).

---

## Folder structure and boundaries

The standardized test folder structure maps to architectural boundaries:

```
tests/
  manual/                    # Can test any boundary, not automated
  legacy/                    # Archived, not run
  pytest/ or playwright/
    e2e/                     # Boundary 5: E2E/system (black box)
    unit/                    # Boundaries 1-4: Architectural layers (white box)
      utils/                 # Boundary 1: Pure functions
      core/                  # Boundary 2: Business logic with mocked ports
      adapters/
        db/                  # Boundary 3: DAO with mocked session
        http/                # Boundary 4: HTTP with in-process client
    utils/                   # Shared fixtures + library/tool tests
```

### Folder semantics and boundaries

| Folder | Boundary coverage | Testing mode | Purpose |
|--------|------------------|--------------|---------|
| `e2e/` | Boundary 5 only | Black box, system running | Full integration across all layers |
| `unit/` | Boundaries 1-4 | White box, system NOT running | Layer isolation with dependency injection |
| `utils/` | Mixed | White box | Shared test fixtures + library/tool tests (boundary unclear) |
| `manual/` | Any boundary | Freestyle | Developer reference, not automated, can test any layer |

### manual/ folder organization by domain

The `manual/` folder has no fixed substructure but commonly organizes by domain or feature. Examples across interfaces:

**API manual tests** (`api/oss/tests/manual/`):
- `annotations/crud.http` -- Annotation CRUD operations
- `auth/admin.http` -- Admin account creation
- `evaluations/*.http` -- Evaluation flows
- `testsets/*.http` -- Testset operations, testcase inclusion
- `tracing/*.http` -- Trace ingestion, filtering, windowing
- `workflows/*.http` -- Workflow artifacts, revisions, variants

**SDK manual tests** (`sdk/tests/manual/`):
- `imports/*.py` -- Import and initialization tests
- `workflows/*.py` -- SDK workflow testing
- `tools/*.py` -- Tool invocation and schema validation

**Web manual tests** (`web/oss/tests/manual/`):
- `datalayer/*.ts` -- Data layer integration tests (Jotai atoms against live API)

**Services manual tests** (`services/oss/tests/manual/`):
- `smoke.http` -- Basic service health check

Manual tests may exercise any boundary (pure utils, business logic, full E2E) but are not automated. They serve as developer reference for reproducing scenarios, testing flows, or validating behavior during development.

---

## 1. Utils/helpers (pure unit)

**Folder location:** `pytest/unit/utils/` or colocated with source (Web component tests)

**What belongs here:**
- Parsing and formatting utilities (IDs, dates, pagination tokens).
- Validators and normalizers.
- Deterministic encoding and serialization (flatten/unflatten, safe encoders).
- Hashing helpers.
- Small algorithms used by Core or adapters.
- Error mapping utilities that are not bound to SQLAlchemy or HTTP specifics.

**How to test:**
- Direct function calls.
- Table-driven tests (`pytest.mark.parametrize` / `test.each`).
- (Optional) Property-based tests for parsers and encoders.

**Test doubles:** None needed.

**Assertions:** Input to output equality.

**Tradeoffs:**
- Fastest tests, highest signal, easy to cover edge cases.
- Avoid testing trivial wrappers around libraries unless they encode business rules.
- Do not create brittle tests that lock in implementation details.

---

## 2. Core services (unit, mock ports)

**Folder location:** `pytest/unit/core/`

**What to test:**
- Invariants and state transitions.
- Orchestration across ports (repo/DAO, clock, ID generator, event bus, external clients).
- Domain-level error mapping (e.g., `AlreadyExists`, `NotFound`).
- Idempotency logic.
- Emitted domain events or commands (if applicable).

**What to inject:**
- Fake or mock implementation of each DAO interface (port).
- Fake clock, fake ID generator where relevant.

**Preference: fakes over mocks.** Fakes are preferred when Core behavior depends on persistence state (create-then-fetch, idempotency, sequences). Mocks are preferred when verifying interactions only (called once, called with specific args).

**Assertions:**
- Return values match expected domain objects.
- Side effects occurred (port methods called with correct args).
- Domain errors raised for invalid states.

**Tradeoffs:**
- Isolates Core perfectly; extremely fast and stable.
- Focuses on business logic and contracts.
- Correctness of SQL queries is NOT validated here (by design).
- If Core leaks adapter concerns (SQLAlchemy models or sessions), test isolation breaks.

---

## 3. Adapters -- outbound/DB (unit, mock session)

**Folder location:** `pytest/unit/adapters/db/`

**The seam to mock:**
Even though DAOs receive an engine at construction time, the clean unit-test boundary is `AsyncSession` (or `async_sessionmaker`), not the engine.

**Why AsyncSession, not engine:**
- DAOs call `session.execute(...)`, `session.commit()`, etc.
- Engine mocking pushes into internal plumbing (connections, pooling, begin blocks), which is brittle.
- Mocking sessions answers "did the DAO send the right request?" without running a database.

**What to test:**
- Statement construction (SQLAlchemy statement shape).
- Bound parameters (values, required params present).
- Call sequence (execute, commit, rollback if the DAO controls it).
- Row-to-domain mapping (DBE to DTO).
- Exception mapping: SQLAlchemy/driver exceptions to domain persistence errors.

**Two assertion styles:**

1. **Fake session records calls** -- Assert that `execute()` was called with a statement and params matching expectations.
2. **Compile statement using Postgres dialect** -- Compile the SQLAlchemy statement with `postgresql.dialect()`, then assert on SQL fragments and compiled params. Avoid exact-string SQL comparisons to reduce brittleness.

**Tradeoffs:**
- Fast and deterministic.
- Verifies adapter request construction and mapping logic.
- Enforces the adapter-to-port contract at unit level.
- Cannot validate real Postgres semantics: JSONB operators, ON CONFLICT behavior, type casting, locks, query planner.
- May go "green" while Postgres rejects the query in reality.
- The E2E suite becomes the only semantic safety net for database behavior.

This is the explicit tradeoff accepted by skipping adapter integration tests.

---

## 4. Adapters -- inbound/HTTP (unit, in-process)

**Folder location:** `pytest/unit/adapters/http/`

**How to test:**
- Build a FastAPI app with routes mounted.
- Override dependencies to inject mocked Core services.
- Use `httpx.AsyncClient` or FastAPI `TestClient` to call endpoints in-process (no running server).

**What to test:**
- Request parsing and validation (422 for malformed input).
- Status codes and response shapes (200, 201, 404, 409, etc.).
- Error mapping at the HTTP boundary (domain errors to HTTP status and body).
- Auth boundary behaviors (if implemented in router or middleware).
- Pagination inputs and outputs.
- Content negotiation (JSON, file uploads, etc.).

**Test doubles:** Mocked Core services injected via FastAPI dependency overrides.

**Tradeoffs:**
- No server process, fast feedback.
- Protects API contract and translation logic.
- Does not validate full wiring with DAOs (by design).
- Cannot validate actual network stack behavior (TLS, reverse proxy headers).

---

## 5. E2E/system (real dependencies)

**Folder location:** `pytest/e2e/` or `playwright/e2e/`

**Testing mode:** Black box. System is running. Tests only interact with public surfaces (API URLs, Web URLs) using credentials.

Since adapter integration tests are skipped, E2E is the only "real dependency" validation.

**What E2E must validate (because nothing else will):**
1. Wiring across layers: routers to core to DAO to database.
2. Postgres semantics that mocks cannot catch:
   - Constraints (unique, foreign key).
   - Transactionality and rollbacks.
   - Postgres-specific features: JSONB, full-text search, ON CONFLICT, RETURNING.
   - Driver error shapes and mapping correctness.

**Scope:**
A minimal E2E suite that pays for itself:
- Happy-path CRUD for key entities.
- Constraint case (unique violation to correct error mapping).
- Transaction case (force mid-operation failure to ensure rollback).
- Idempotency or concurrency case (if relevant).

**How to run:**
- Spin a real Postgres instance (docker-compose or testcontainers).
- Run migrations.
- Run the FastAPI app (either in-process ASGI client with real DI wiring, or as a process called over HTTP).

**Examples across interfaces:**
- **API E2E** (`api/oss/tests/pytest/e2e/`): HTTP requests to API endpoints, organized by domain (workflows, evaluations, testsets, etc.)
- **SDK E2E** (`sdk/tests/pytest/e2e/`): SDK client calls against live API (workflows, evaluations, observability)
- **Web E2E** (`web/oss/tests/playwright/e2e/`): Playwright browser tests against running web app (settings, app, playground, etc.)

---

## 6. The utils/ folder: dual purpose

**Folder location:** `pytest/utils/` or `playwright/utils/`

The `utils/` folder serves two distinct purposes:

### 6.1. Shared test fixtures (primary use)

Test infrastructure shared by `e2e/` and `unit/` tests:
- **Fixture modules** -- pytest fixtures, Playwright helpers
- **Account management** -- Test account creation and cleanup
- **API clients** -- Authenticated/unauthenticated HTTP clients
- **Test constants** -- Timeouts, base URLs, environment variables

**Examples:**
- `api/oss/tests/pytest/utils/api.py` -- `authed_api`, `unauthed_api` fixtures
- `api/oss/tests/pytest/utils/accounts.py` -- `cls_account`, `mod_account`, `foo_account` fixtures
- `sdk/tests/pytest/utils/sdk.py` -- SDK client fixtures
- `web/tests/playwright/utils/` -- Playwright utility helpers (currently `.gitkeep` placeholder)

### 6.2. Library and tool tests (secondary use)

Tests for **libraries, tools, and helper functions** that the system uses but that aren't part of the system's core business logic:
- Shared validation libraries
- Internal benchmark utilities
- Helper functions with edge cases
- Infrastructure tooling

**Boundary ambiguity:** There's a gray line between `unit/utils/` (pure business utilities, Boundary 1) and `utils/` (tooling utilities). When in doubt:
- If it's business domain logic → `unit/utils/`
- If it's infrastructure/tooling → `utils/`

**Current state:** Most `utils/` folders currently contain only shared fixtures. Library/tool tests may be added as needed.

---

## 7. What NOT to test at unit level

The following are explicitly excluded from unit-level test infrastructure:

- A running Postgres instance.
- A running web server process.
- Any "fake Postgres server" or database emulator.
- SQLite in-memory as a substitute for Postgres.

**Why SQLite in-memory does not help:**
- Core tests should depend on ports (interfaces), not SQL adapters. SQLite introduces an adapter dependency into what should be a pure unit test.
- If the DAO is mocked, SQLite is redundant.
- If the DAO is not mocked, the test is no longer "Core only" -- it tests a persistence adapter too.
- SQLite and Postgres have different SQL dialects, type systems, and constraint behaviors. A passing SQLite test provides false confidence about Postgres behavior.

For Core unit tests, prefer in-memory fake implementations of the DAO port (pure Python).
