# Testing Boundaries

Boundaries describe *where* in the architecture a test lives -- which layer it exercises and what it isolates. Each boundary defines what is under test, what is mocked or faked, and what assertions are appropriate.

This document is interface-agnostic. For how boundaries apply to a specific interface, see the per-interface specs ([API](testing.interface.api.specs.md), [SDK](testing.interface.sdk.specs.md), [Web](testing.interface.web.specs.md)).

---

## 1. Utils/helpers (pure unit)

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

---

## 6. What NOT to test at unit level

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
