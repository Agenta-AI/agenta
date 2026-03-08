# Ports & Adapters Testing Strategy (Pytest)
*(Unit-only layers + one E2E, plus utils/helpers)*

This document captures the full context of the discussion and the resulting testing strategy for a **ports & adapters (hexagonal)** architecture using **FastAPI**, **SQLAlchemy async**, and **asyncpg**, with **inversion of control** wiring.

---

## Context: the architecture you described

You currently have **inversion of control** / dependency injection wiring roughly like:

1. **Outbound adapter (DB)**: Create a SQLAlchemy **engine** (async, asyncpg driver) and create a DAO implementation per entity.
2. **Core**: Core defines a **DAO interface (port)**. Core services are created by passing an implementation of that port (the DAO).
3. **Inbound adapter (HTTP)**: Routers receive Core services.
4. Compose routes into a FastAPI app and run it.

So dependencies flow "inward":
- Routers depend on Core services.
- Core depends on ports (interfaces).
- Adapters implement ports (DAOs) and depend on infrastructure (SQLAlchemy session/engine).
- The composition root wires everything together.

You explicitly want:
- Clear separation between **Core**, **routers**, and **DAOs**
- **Unit tests** for each layer using mocks/fakes (not a running DB/server)
- **One E2E** test suite that runs the real API with the real DB
- Additionally: **unit tests for utils/helpers**

You also explicitly requested to **drop integration tests** (e.g., DAO↔real Postgres component tests).

---

## Boundaries vs dimensions (API testing only, for now)

**Boundaries** describe *where* tests live in the architecture.
**Dimensions** describe *how* E2E tests are filtered or categorized.
These are orthogonal concerns.

Current state:
- The existing API test suite is **E2E/system only** (remote HTTP + real DB).
- The other boundaries are planned but not populated yet by the current API tests.

### Boundaries (API testing only)
1. **Utils/helpers** (pure unit)
2. **Core services** (unit; mock/fake ports)
3. **DAOs** (unit; mock AsyncSession)
4. **Routers** (unit; in-process ASGI with mocked services)
5. **E2E/system** (real DB + real API wiring)

---

## Dimensions (E2E only)

Dimensions apply **only** to E2E tests, and do **not** apply to unit-layer tests.

### API E2E dimensions (pytest runner)

| Dimension | Values | Notes |
|---|---|---|
| license | oss, ee | |
| role | owner, admin, editor, viewer | |
| plan | hobby, pro, business, enterprise | |
| path | happy, grumpy | `--happy` / `--grumpy` |
| case | typical, edge | `--typical` / `--edge` |
| lens | functional, performance, security | `--functional` / `--performance` / `--security` |
| speed | fast, slow | `--fast` / `--slow` |
| coverage | smoke, full | `full` = no coverage filter |

Required environment variables for API E2E:
- `AGENTA_API_URL`
- `AGENTA_AUTH_KEY`

Notes:
- `--coverage full` means **no coverage filter** is applied.
- `scope` is intentionally excluded for now.

### Web E2E dimensions (Playwright)

Source: `/Users/junaway/Agenta/github/agenta/web/tests/README.md` and `playwright/config/testTags.ts`

| Dimension | Values | Notes |
|---|---|---|
| coverage | smoke, sanity, light, full | |
| path | happy, grumpy | |
| case | typical, edge | |
| lens | functional, performance, security | |
| speed | fast, slow | |
| license | oss, ee | Depends on preset |
| permission | owner, editor, viewer | |
| entitlement | hobby, pro | |
| feature-scope | ee | Feature availability |
| env/preset | local, staging, beta, prod, demo, oss | |

Required environment variables for Web E2E:
- `TESTMAIL_API_KEY`
- `TESTMAIL_NAMESPACE`
- `AGENTA_OSS_OWNER_PASSWORD` (OSS runs only)
- `AGENTA_OSS_OWNER_EMAIL` (optional for OSS)
- `AGENTA_API_URL` (used for teardown and API flows)

Notes:
- `scope` exists in the web runner but is intentionally excluded here.

---

## The requested testing scope (what to test and what not to test)

### You want to test (unit level)
1. **Utils / helpers**
2. **Core** (application/domain services) — not routers, not DAOs
3. **Outbound adapters (DAOs)**, but via mocking the session/DB boundary (no running DB)
4. **Inbound adapters (routers/APIs)** via mocking services and running handlers in-process

### You do *not* want in unit tests
- A running **Postgres**
- A running **web server process**
- Any "fake Postgres server" or DB emulator

### You want to test (end-to-end level)
- A **real system**: API + DB running (or app in-process + real DB), as one E2E suite

---

## Why SQLite in-memory is not useful for Core tests

You clarified that you want to test **Core**, not routers/DAOs.

For Core tests:
- Core should depend on **ports** (interfaces) and should not know about SQL, sessions, engines, or HTTP.
- Using **SQLite in-memory** introduces an adapter dependency into what should be a pure unit test.
- If you are mocking the DAO anyway, SQLite is redundant.
- If you are not mocking the DAO, you are no longer testing "Core only"; you're testing a persistence adapter too.

**Conclusion:** For Core unit tests, prefer **mock/fake implementations of the DAO port** (pure Python), not SQLite.

---

## The final test pyramid you requested

You requested a strategy with:

1. **Unit tests: utils/helpers**
2. **Unit tests: Core services** (mock DAO port)
3. **Unit tests: DAOs** (mock SQLAlchemy AsyncSession — not engine)
4. **Unit tests: routers** (mock Core services; in-process ASGI)
5. **E2E tests: one suite** (real DB + real API wiring)

No separate "integration tests" layer.

---

# Unit tests

## 1) Utils / helpers tests (pure unit)

### What belongs here
- parsing/formatting utilities (IDs, dates, pagination tokens)
- validators and normalizers
- deterministic encoding/serialization (flatten/unflatten, safe encoders)
- hashing helpers
- small algorithms used by Core or adapters
- error mapping utilities *as long as they are not bound to SQLAlchemy/HTTP specifics*

### How to test
- direct function calls
- table-driven tests (`pytest.mark.parametrize`)
- (optional) property-based tests for parsers/encoders

### Tradeoffs
**Pros**
- fastest tests
- high signal: pure determinism, easy to cover edge cases
- no mocking needed

**Cons**
- avoid testing trivial wrappers around libraries unless you're encoding business rules
- don't create brittle tests that lock in implementation details

---

## 2) Core unit tests (mock the DAO port)

### What you test
- invariants and state transitions
- orchestration across ports (repo/DAO, clock, id generator, event bus, external clients)
- domain-level error mapping (e.g., `AlreadyExists`, `NotFound`)
- idempotency logic (in-memory fake makes this easy)
- emitted domain events / commands (if you have them)

### What you inject
- **Fake** or **Mock** for the DAO interface (port)

**Preference: fakes over mocks**
- Use **fakes** when Core behavior depends on persistence state (e.g., create then fetch; idempotency; sequences).
- Use **mocks** when you only care about an interaction (called once, called with specific args).

### Tradeoffs
**Pros**
- isolates Core perfectly
- extremely fast and stable
- focuses on business logic and contracts

**Cons**
- if Core leaks adapter concerns (SQLAlchemy models/sessions), test isolation gets hard
- correctness of SQL queries is not validated here (by design)

---

## 3) DAO unit tests (mock SQLAlchemy AsyncSession)

You confirmed you use **asyncpg with SQLAlchemy**.

### The seam to mock
Even though you "create an engine and pass it to the DAO", for unit tests the clean boundary is:

- mock **`AsyncSession`** (or a session factory / `async_sessionmaker`), not the engine

Why:
- DAOs typically call `session.execute(...)`, `session.commit()`, etc.
- Engine mocking pushes you into internal plumbing (connections/pooling/begin blocks), which is brittle
- Mocking sessions gives you "did the DAO send the right request?" without running a DB

### What DAO unit tests should cover
- **statement construction** (SQLAlchemy statement shape)
- **bound parameters** (values, required params present)
- call sequence (execute/commit/rollback if DAO controls it)
- row-to-domain mapping
- exception mapping:
  - SQLAlchemy/driver exceptions → your domain persistence errors

### Two common assertion styles
1) **Fake session records calls**
   - assert that `execute()` was called with a statement and params
2) **Compile statement using Postgres dialect**
   - compile SQLAlchemy statement with `postgresql.dialect()`
   - assert on **SQL fragments** + **compiled params**
   - avoid exact-string comparisons to reduce brittleness

### Tradeoffs (important)
**Pros**
- fast and deterministic
- verifies your adapter's request construction and mapping logic
- enforces the adapter-to-port contract at unit level

**Cons**
- cannot validate real Postgres semantics (JSONB operators, ON CONFLICT behavior, type casting, locks, query planner)
- may go "green" while Postgres rejects the query in reality
- therefore your E2E suite becomes the only semantic safety net for DB behavior

*(This is the explicit tradeoff you accept when skipping adapter integration tests.)*

---

## 4) Router unit tests (mock services, in-process ASGI)

You said "I don't need a running backend."
So router tests should be in-process:

- build FastAPI app
- mount routes
- dependency-inject (override dependencies) with mocked services
- use `httpx.AsyncClient` or FastAPI TestClient to call endpoints

### What routers tests cover
- request parsing and validation (422)
- status codes and response shapes
- error mapping at HTTP boundary
- auth boundary behaviors (if implemented in router/middleware)
- pagination inputs/outputs
- content negotiation (JSON, files, etc.)

### Tradeoffs
**Pros**
- no server process
- fast feedback
- protects API contract and translations

**Cons**
- does not validate full wiring with DAOs (by design at unit level)
- cannot validate actual network stack behavior (TLS, reverse proxy headers, etc.)

---

# E2E tests (one suite)

Since you are skipping integration tests, E2E is your only "real dependency" validation.

## What E2E must validate (because nothing else will)
1. Wiring across layers: routers → core → dao → db
2. Postgres semantics that mocks can't catch:
   - constraints (unique/fk)
   - transactionality and rollbacks
   - Postgres-specific features you use (JSONB, FTS, ON CONFLICT, RETURNING, etc.)
   - driver error shapes / mapping correctness

## Keep E2E small but targeted
A minimal E2E suite that pays for itself:
- **happy path CRUD** for 1–2 key entities
- **constraint case** (unique violation) to validate error mapping
- **transaction case** (force mid-operation failure; ensure rollback)
- **idempotency/concurrency-ish case** if relevant (even a simple repeat request)

## How to run E2E
- spin a real Postgres (docker-compose or testcontainers)
- run migrations
- run the FastAPI app (either:
  - in-process ASGI client with the real DI wiring, OR
  - as a process and call it over HTTP)

---

# Recommended project layout (matches the above)

```
tests/
  unit/
    utils/
      test_*.py
    core/
      test_*.py
    adapters/
      db/
        test_*.py
      http/
        test_*.py
  e2e/
    test_*.py
tests/_support/
  fakes.py
  builders.py
  assertions.py
```

Where `tests/_support` contains:
- InMemory/Fake repositories (ports)
- Fake session/result objects for DAO unit tests
- common builders for domain objects/DTOs
- minimal assertion helpers

---

# Practical mocking guidance per layer

## Core
- Mock/fake **ports** (DAO interface, clock, id generator)
- Avoid coupling tests to SQLAlchemy types or HTTP DTOs

## DAO
- Mock **AsyncSession** (and result objects)
- Optionally compile statements with **Postgres dialect** and assert fragments/params
- Test exception mapping with `sqlalchemy.exc.IntegrityError` and/or asyncpg error types if you map them

## Routers
- Mock Core services
- Override dependencies in FastAPI
- Assert status codes and response schemas

## E2E
- Real DI + real DB + migrations
- Small suite, high-value scenarios

---

# Summary of the key tradeoffs you accepted

By choosing **unit tests only** for Core/DAO/router/utils and **one E2E suite**, you gain:
- simplicity
- speed
- strong boundary testing via mocks

But you accept:
- fewer early signals for Postgres-specific issues
- higher reliance on E2E to catch SQL/transaction/type/constraint semantics
- potential "green unit tests, red E2E" when SQL is wrong or dialect-specific

Given that constraint, the best mitigation is:
- keep DAO unit assertions focused on statement structure + params (not exact SQL)
- make the E2E suite intentionally include at least 1–2 tests that exercise the Postgres features you actually rely on
