# Testing Interfaces

An interface is a system surface that external consumers interact with. Each interface has its own test infrastructure, execution environment, and applicable subset of [boundaries](testing.boundaries.specs.md).

This document provides a high-level overview. For detailed per-interface specifications, see the dedicated documents linked below.

---

## Current interfaces

| Interface | Description | Runner | Dedicated Spec |
|-----------|-------------|--------|----------------|
| **API** | FastAPI HTTP endpoints consumed by the SDK, Web frontend, and third-party integrations | Pytest | [testing.interface.api.specs.md](testing.interface.api.specs.md) |
| **SDK** | Python SDK consumed by end users to interact with Agenta programmatically | Pytest | [testing.interface.sdk.specs.md](testing.interface.sdk.specs.md) |
| **Web** | Next.js frontend consumed by users via browser | Playwright + Jest/Vitest | [testing.interface.web.specs.md](testing.interface.web.specs.md) |

## Future interfaces

| Interface | Description | Status |
|-----------|-------------|--------|
| **MCP** | Model Context Protocol server for AI agent integration | Planned |
| **Agents** | Agent-facing APIs and workflows | Planned |
| **Docs** | Documentation site (Docusaurus) | Planned |

---

## Interface x boundary matrix

This matrix shows which [boundaries](testing.boundaries.specs.md) apply to each interface, and the current state of test coverage.

| Boundary | API | SDK | Web |
|----------|-----|-----|-----|
| **Utils/helpers** (pure unit) | Planned | Exists (tracing decorators) | Exists (atom tests) |
| **Core services** (unit, mock ports) | Planned | Planned | N/A |
| **Adapters — outbound/DB** (unit, mock session) | Planned | N/A | N/A |
| **Adapters — inbound/HTTP** (unit, in-process) | Planned | N/A | N/A |
| **E2E/system** (real dependencies) | Exists (38+ tests) | Exists (integration suite) | Exists (Playwright suites) |

**Key observations:**
- All three interfaces have E2E coverage.
- Unit-level coverage exists only partially (SDK tracing decorators, Web atom tests).
- API unit tests across all layers are the primary gap to fill.

---

## Interface interaction model

```
Users ──► Web ──► API ──► Database
             │
Developers ──► SDK ──► API ──► Database
                  │
Agents ──► MCP ──► API ──► Database (future)
```

The API is the central interface. SDK and Web tests that run against a live API implicitly exercise the API stack. This means:
- API E2E tests validate the API in isolation.
- SDK integration tests validate the SDK + API together.
- Web E2E tests validate the Web + API together.

When an SDK or Web E2E test fails, the root cause may be in the API layer. Cross-reference API E2E results when debugging.

---

## Adding a new interface

When a new interface is added (e.g., MCP):

1. Create `testing.interface.<name>.specs.md` following the structure of existing interface specs.
2. Add a row to the interface matrix above.
3. Identify which [boundaries](testing.boundaries.specs.md) apply.
4. Add relevant [dimensions](testing.dimensions.specs.md) if the new interface introduces new filtering needs.
5. Update [testing.structure.specs.md](testing.structure.specs.md) with the folder layout.
6. Update [testing.running.specs.md](testing.running.specs.md) with execution commands.
7. Update [README.md](README.md) with the new document link.
