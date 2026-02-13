# Testing Principles

## Architecture context

The Agenta API follows a ports-and-adapters (hexagonal) architecture with inversion of control:

1. **Outbound adapters (DB)**: SQLAlchemy async engine (asyncpg driver) + DAO implementations per entity.
2. **Core layer**: Defines DAO interfaces (ports). Core services receive port implementations.
3. **Inbound adapters (HTTP)**: FastAPI routers receive Core services.
4. **Composition root**: Wires everything together in `api/entrypoints/`.

Dependencies flow inward:

- Routers depend on Core services.
- Core depends on ports (interfaces).
- Adapters implement ports and depend on infrastructure (SQLAlchemy session/engine).
- The composition root wires concrete implementations.

This architecture applies most directly to the API. The principles of boundary isolation, mocking at seams, and E2E for real-dependency validation are universal across all components.

## Test pyramid

The target test pyramid has four layers, from fastest/most-isolated to slowest/most-integrated:

1. **Utils/helpers** (pure unit) — Parsing, formatting, validators, normalizers. No dependencies, no mocking needed. Direct function calls, table-driven tests.
2. **Core/business logic** (unit, mock ports) — Domain services tested with fake/mock implementations of their ports. Tests invariants, orchestration, domain error mapping.
3. **Adapter unit** (unit, mock infrastructure) — Outbound adapters (DAO -> mock session) and inbound adapters (router -> mock services). Tests the adapter's own logic in isolation.
4. **E2E/system** (real dependencies) — Full stack with real DB, real wiring. Validates cross-layer integration, infrastructure-specific semantics.

No separate "integration test" layer exists for the API. The gap between unit and E2E is intentional.

## Boundaries vs dimensions vs interfaces

These are three orthogonal axes of the testing strategy:

- **Boundaries** describe *where* in the architecture a test lives (which layer it exercises). See [testing.boundaries.specs.md](testing.boundaries.specs.md).
- **Dimensions** describe *how* tests are filtered or categorized (markers, tags). See [testing.dimensions.specs.md](testing.dimensions.specs.md).
- **Interfaces** describe *what system surface* is being tested (API, SDK, Web). See [testing.interfaces.specs.md](testing.interfaces.specs.md).

A single test can be described along all three axes: it tests at the E2E boundary, is tagged as `coverage_smoke` and `path_happy`, and exercises the API interface.

## Key strategic decisions

1. **Unit tests use mocks/fakes, not running infrastructure.** No running Postgres, no running web servers, no DB emulators at the unit level.
2. **One E2E suite per component.** Each interface (API, SDK, Web) has one E2E test suite that runs against real dependencies.
3. **No separate integration test layer for the API.** The API strategy explicitly drops DAO-to-real-Postgres component tests. E2E is the only "real dependency" validation.
4. **Fakes preferred over mocks.** When Core behavior depends on persistence state (create-then-fetch, idempotency, sequences), in-memory fake implementations of ports are preferred over mock objects. Mocks are reserved for interaction-only assertions (called once, called with specific args).

## Tradeoff summary

**Gains:**

- Simplicity — fewer test categories to maintain.
- Speed — unit tests are fast, no infrastructure spin-up.
- Strong boundary testing — each layer is tested against its contract via mocks/fakes.

**Costs:**

- Fewer early signals for Postgres-specific issues (constraints, JSONB operators, ON CONFLICT behavior, type casting, locks).
- Higher reliance on E2E to catch SQL/transaction/type/constraint semantics.
- Potential "green unit tests, red E2E" when SQL is wrong or dialect-specific.

**Mitigation:**

- DAO unit assertions should focus on statement structure and bound parameters, not exact SQL strings.
- The E2E suite should intentionally include tests that exercise Postgres-specific features the application relies on.

## Mocking philosophy

**Decision tree:**

```
Does the test need to verify state-dependent behavior?
  (create -> fetch, idempotency, sequences)
|-- YES -> Use a FAKE (in-memory implementation of the port)
|           - Stores state in a dict/list
|           - Supports create/read/update/delete
|           - Returns realistic domain objects
+-- NO  -> Does the test verify an interaction?
            (called once, called with specific args, called in order)
    |-- YES -> Use a MOCK (unittest.mock or pytest-mock)
    +-- NO  -> Direct function call (no test double needed)
```

**General rules:**

- Mock/fake at the boundary, not deep inside the implementation.
- Core tests mock ports (DAO interfaces, clock, id generators). Core tests never couple to SQLAlchemy types or HTTP DTOs.
- DAO tests mock AsyncSession. Statements may optionally be compiled with the Postgres dialect for assertion.
- Router tests mock Core services. FastAPI dependency overrides are used to inject test doubles.
- E2E tests use real DI wiring. No mocking.
