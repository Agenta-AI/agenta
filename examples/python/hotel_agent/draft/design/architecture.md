# Architecture: Core Layer (RFC)

> **Status:** RFC implemented (steps 1–8). Steps 9–10 (per-runtime adapters)
> deferred to [`library-matrix.md`](library-matrix.md) per §Implementation order.
> Runtime-specific concerns (per-SDK tool adapters, agent assembly) live in
> [`library-matrix.md`](library-matrix.md) once that exists.
>
> **Last updated:** 2026-05-01 (implementation landed, see `core/` and `tests/`)

## Summary

The hotel agent will run on four interchangeable runtimes (OpenAI Agents, Claude Agent SDK, PydanticAI, LangGraph) on top of a single core. This RFC specifies that core: domain types, the PMS integration layer, the retrieval layer, the clock, and the dependency-injection container that runtimes consume.

Four decisions drive everything below.

The PMS is treated as an external system. Our SQLite-backed fake implements the same Protocol a real Mews or Cloudbeds adapter would. The fake is what runs in the demo; the Protocol is what makes future adapters drop-in.

The knowledge base is a retrieval primitive, not a service. The agent decides what to query and how to use the results. We do not wrap it in semantic methods like `get_cancellation_policy()`.

Policy lives in the agent's system prompt, not in code. The PMS does not refuse cancellations or reject tier-ineligible upgrades. The agent reasons over the rules; evals measure whether it gets it right.

Three things are injectable per request: the PMS client, the retriever, and the clock. They flow into the agent through the runtime's native DI mechanism, wrapped in a small `AgentDeps` container.

## Background

This RFC builds on three earlier docs.

[`inversion-of-control.md`](inversion-of-control.md) surveys IoC patterns across RL envs (Gymnasium), LLM agent benchmarks (tau-bench, Harbor), and the four target SDKs. Conclusion we carry forward: invert at the service layer, not the tool layer; tool signatures are incompatible across SDKs and that is fine.

[`scope.md`](scope.md) names the six guest-facing capabilities and caps the design at ~8-10 service methods.

[`policy.md`](policy.md) (TODO) will hold the actual rules. This RFC assumes policy text exists somewhere the agent can read.

## Layered architecture

```
runtimes/<lib>/<vanilla|with_agenta>/
        │
        │  uses framework's DI to receive →
        ▼
core/
├── domain/                     # Pydantic types. The shared vocabulary.
├── integrations/
│   └── pms/
│       ├── protocol.py         # PMSClient, InventoryAPI, ReservationsAPI, ...
│       ├── fake.py             # FakePMS (SQLite-backed)
│       └── README.md           # how a real adapter would slot in
├── retrieval/
│   ├── protocol.py             # Retriever Protocol
│   ├── store.py                # default vector-store impl
│   └── docs/                   # markdown the index reads
├── clock.py                    # Clock Protocol + SystemClock + FixedClock
├── deps.py                     # AgentDeps container
├── db/
│   ├── tables.py               # SQLAlchemy schema for the fake
│   ├── session.py              # async engine, session factory
│   └── seed.py                 # deterministic seed data
└── container.py                # composition root: build a default AgentDeps
```

The arrow goes one way: runtimes depend on `core/`. Nothing in `core/` imports from `runtimes/`.

## The integration layer (PMS)

### Why "integrations" and not "services"

In a production hotel system, what we are wrapping is someone else's API. Mews exposes a Connector API. Cloudbeds exposes a v1.2 REST API. Apaleo splits things across Inventory, Rates, and Booking APIs. A real "BookingService" in a hotel app is a thin client over one of these.

Treating the PMS as an external integration from day one gives us two benefits. The fake's interface stays honest about what real CRMs look like; the demo is teaching something true. And future contributors can replace the fake with a real adapter without touching anything else.

### Protocol per concern

Five concerns, each its own Protocol. They are aggregated into a single `PMSClient` Protocol so callers see one surface, but implementations can split or share internal state.

```python
# core/integrations/pms/protocol.py
from datetime import date, datetime
from typing import Protocol

from core.domain import (
    Guest, Offer, Quote, RatePlan, Reservation, ReservationModify,
    Room, RoomType, ServiceCharge,
)


class InventoryAPI(Protocol):
    async def list_room_types(self) -> list[RoomType]: ...
    async def get_room_type(self, code: str) -> RoomType: ...


class RatesAPI(Protocol):
    async def list_rate_plans(
        self, *, room_type: str | None = None,
    ) -> list[RatePlan]: ...

    async def quote(
        self, *,
        room_type: str, rate_plan: str,
        check_in: date, check_out: date, guests: int,
    ) -> Quote: ...


class AvailabilityAPI(Protocol):
    async def search(
        self, *,
        check_in: date, check_out: date, guests: int,
        room_type: str | None = None,
    ) -> list[Offer]: ...


class ReservationsAPI(Protocol):
    async def create(
        self, *,
        guest_id: str, room_type: str, rate_plan: str,
        check_in: date, check_out: date, guests: int,
    ) -> Reservation: ...

    async def get(self, reservation_id: str) -> Reservation: ...

    async def list_for_guest(
        self, guest_id: str, *, status: str | None = None,
    ) -> list[Reservation]: ...

    async def modify(
        self, reservation_id: str, changes: ReservationModify,
    ) -> Reservation: ...

    async def cancel(self, reservation_id: str) -> Reservation: ...


class GuestsAPI(Protocol):
    async def get(self, guest_id: str) -> Guest: ...
    async def get_by_email(self, email: str) -> Guest | None: ...


class ServicesAPI(Protocol):
    async def add_to_reservation(
        self, reservation_id: str, service_code: str,
        *, when: datetime | None = None,
    ) -> ServiceCharge: ...

    async def list_for_reservation(
        self, reservation_id: str,
    ) -> list[ServiceCharge]: ...


class PMSClient(Protocol):
    inventory: InventoryAPI
    rates: RatesAPI
    availability: AvailabilityAPI
    reservations: ReservationsAPI
    guests: GuestsAPI
    services: ServicesAPI
```

A few points worth fixing in the contract.

The PMS does not enforce policy. `cancel(reservation_id)` always cancels if the reservation exists. The agent is responsible for refusing to call this in policy-violating cases.

Times are explicit. `add_to_reservation` takes a `when` parameter. Cancellation, modification, and any other time-sensitive operation will read time from the injected clock when the fake needs to make a decision (not for our v1, since the fake does not enforce rules; but the seam is there for future use).

Identifiers are strings, not UUIDs. Real PMSs return opaque ids whose format we do not control. Treating them as strings keeps the contract honest.

### The fake implementation

`FakePMS` is a class that fulfills `PMSClient` by composing six small classes, each backed by an async SQLAlchemy session over the fake's SQLite. The fake's job is to behave like a CRUD layer with no opinions.

```python
# core/integrations/pms/fake.py
class FakePMS:
    def __init__(self, session_factory: SessionFactory, clock: Clock):
        self.inventory = FakeInventoryAPI(session_factory)
        self.rates = FakeRatesAPI(session_factory)
        self.availability = FakeAvailabilityAPI(session_factory, self.rates)
        self.reservations = FakeReservationsAPI(session_factory, clock)
        self.guests = FakeGuestsAPI(session_factory)
        self.services = FakeServicesAPI(session_factory, clock)
```

Three implementation rules for the fake.

It writes to and reads from the SQLite database described in `core/db/tables.py`. Nothing else. No in-memory dicts that drift out of sync with the DB.

It accepts a `Clock` rather than calling `datetime.now()` directly. Every test that touches a time-sensitive operation runs against a `FixedClock`.

It returns `domain.*` Pydantic types, not SQLAlchemy rows. The mapping happens inside the fake; callers never see ORM objects. This mirrors what a real HTTP adapter would do (parse JSON to Pydantic).

### Seed data

`core/db/seed.py` populates the fake at startup with deterministic data:

- One hotel ("Grand Mountain Resort").
- Five room types covering the price range we want to demo (Standard, Deluxe, Suite, Family, Presidential).
- Three rate plans (Flexible, Advance Purchase, Member Rate) with the policy variations from `policy.md`.
- Roughly 20 physical rooms.
- 5-10 guest profiles spanning all loyalty tiers.
- A handful of existing reservations across past, current, and future dates (so the agent can demo "modify my upcoming booking" without a setup step).

Seed data is loaded into a fresh SQLite file on demand. Every test gets its own copy.

### Future adapters

A real `MewsPMS` or `CloudbedsPMS` would live alongside `fake.py`. It implements the same six Protocols by talking to the real HTTP API. None of `domain/`, `retrieval/`, `runtimes/*`, or the agent prompts change. Out of scope for v1 but the seam is what makes it possible later.

## Retrieval

### Why this is not a service

The knowledge base does one thing: retrieves chunks relevant to a query. That is a primitive, not a domain service. Wrapping it in semantic methods (`KnowledgeBaseService.get_cancellation_policy()`) would push agent logic down into the infrastructure and make the demo less honest about how RAG works.

The agent decides when to query, how to phrase the query, and how to weave results into its response. That is the RAG pedagogy we are demonstrating.

### Protocol and default implementation

```python
# core/retrieval/protocol.py
from typing import Protocol


class Chunk(BaseModel):
    text: str
    source: str          # e.g. "policy/cancellation.md"
    score: float


class Retriever(Protocol):
    async def search(self, query: str, k: int = 5) -> list[Chunk]: ...
```

The default implementation in `core/retrieval/store.py` builds a vector index from markdown documents under `core/retrieval/docs/`. We will use a small embeddings model and an in-process vector store (e.g. LanceDB or a flat numpy index) to keep the demo dependency-free.

### Document sources

Initial corpus, indexed at startup:

- `docs/policy/*.md` — the rule rationales and worked examples (sibling to `policy.md`).
- `docs/amenities.md` — gym, pool, spa, restaurant hours.
- `docs/neighborhood.md` — local attractions, transit.
- `docs/faq.md` — frequently asked questions.

The point is for the retriever to return text the agent quotes verbatim or paraphrases. Faithfulness becomes one of our eval surfaces.

## Clock

A small but load-bearing dependency.

```python
# core/clock.py
from datetime import datetime
from typing import Protocol


class Clock(Protocol):
    def now(self) -> datetime: ...


class SystemClock:
    def now(self) -> datetime:
        return datetime.utcnow()


class FixedClock:
    def __init__(self, when: datetime):
        self._when = when

    def now(self) -> datetime:
        return self._when
```

Every test that touches cancellation timing, modification windows, or "is the stay current" reasoning constructs a `FixedClock` for the scenario. Production wires a `SystemClock`.

The clock is part of `AgentDeps` rather than baked into the fake because the agent itself reads "now" when reasoning about policy. The system prompt will reference the clock too (typically by injecting "Today is YYYY-MM-DD" into the prompt template).

## AgentDeps container

The single object every runtime receives:

```python
# core/deps.py
from dataclasses import dataclass

from core.clock import Clock
from core.integrations.pms.protocol import PMSClient
from core.retrieval.protocol import Retriever


@dataclass(frozen=True)
class AgentDeps:
    pms: PMSClient
    retriever: Retriever
    clock: Clock
    current_user_id: str
```

`current_user_id` is the authenticated guest. It is per-request and scopes everything the agent can do. The PMS, retriever, and clock can be shared across requests; the user cannot.

## Composition root

```python
# core/container.py
def build_default_deps(
    *,
    db_url: str = "sqlite+aiosqlite:///./hotel.db",
    docs_dir: Path = Path("core/retrieval/docs"),
    current_user_id: str,
) -> AgentDeps:
    session_factory = make_session_factory(db_url)
    clock = SystemClock()
    pms = FakePMS(session_factory, clock)
    retriever = VectorRetriever.from_dir(docs_dir)
    return AgentDeps(
        pms=pms,
        retriever=retriever,
        clock=clock,
        current_user_id=current_user_id,
    )
```

This is the single place where concrete implementations are wired. Tests call a different builder (`build_test_deps(...)`) that swaps in a `FixedClock`, a fresh seeded SQLite, and optionally a recording wrapper.

## Runtime adapter contract

This section is intentionally short. Full per-SDK details belong in [`library-matrix.md`](library-matrix.md). For this RFC the contract every runtime must satisfy is:

A runtime accepts an `AgentDeps` instance at construction or run time. It uses its SDK's native DI mechanism (PydanticAI `deps_type=AgentDeps`, OpenAI Agents `RunContextWrapper[AgentDeps]`, LangGraph `InjectedState`, Claude SDK closure-at-build-time) to thread `AgentDeps` into tool functions.

The runtime exposes one tool function per agent capability. Tool functions do not contain business logic. Each one calls one or two methods on `deps.pms.*` or `deps.retriever`, optionally formats the result for the LLM, and returns.

The runtime's adapter file should be ~5 lines per tool. If a tool function gets long, the logic belongs in the integration layer, not the runtime.

## Mapping to layered architecture concepts

| Layer in this RFC | Agenta API equivalent | Pythonic equivalent | What it actually is |
|---|---|---|---|
| `core/domain/*.py` | DTO | schema / model | Pydantic data bag, no behavior |
| `core/db/tables.py` | DBE | model / table | SQLAlchemy table, no behavior |
| `integrations/pms/protocol.py` | Interface | Protocol | Contract, no implementation |
| `integrations/pms/fake.py` | DAO + Service | client / adapter | Concrete impl. Wraps SQLite for the demo. |
| `retrieval/*` | (none) | retriever / index | Our own RAG primitive |
| `clock.py` | (none) | clock | Time abstraction, swappable for tests |
| `deps.py` | (constructor wiring) | DI container | Bundle injected into the agent |
| `container.py` | composition root in `entrypoints/` | composition root | Where concrete impls are wired |

The big difference from Agenta: we have no separate `services/` layer above the integration. Agenta's services exist to enforce rules and orchestrate across multiple DAOs. We have neither concern. Policy lives in the prompt; orchestration happens in the agent loop.

## Testing strategy

Three test layers, each useful for different things.

**Service-level (the workhorse).** Test `FakePMS.reservations.cancel(...)` directly. Construct a fake with a seeded SQLite and a `FixedClock`. Assert the right rows changed. No LLM, no SDK, no runtime. This is where most coverage lives.

**Adapter-level (per runtime).** Synthesize the args an LLM would have produced and feed them to the runtime's adapter function. Assert the right PMS method got called with the right arguments. Catches schema drift and conversion bugs. No LLM in the loop.

**Trajectory-level (with LLM, optional).** Drive the full agent end to end with a real model on a small set of scenarios. Compare the final DB state against ground truth. This is where the policy compliance evals run.

Two cross-cutting capabilities the integration layer enables.

**Snapshot.** Copy the SQLite file before a run. Compare or restore after. Restoration is one line. Tests can also serialize an in-memory SQLite via `connection.iterdump()` if the file is held in memory.

**Recording.** Wrap any `PMSClient` in a `RecordingPMS` decorator that logs every method call (name, kwargs, return value, mutated state delta). The recording is a JSON document that can be stored, replayed, or asserted against in tests.

```python
class RecordingPMS:
    def __init__(self, inner: PMSClient, log: list[dict]):
        self._inner = inner
        self._log = log
        # delegate each sub-API to a recording wrapper
        self.reservations = RecordingReservationsAPI(inner.reservations, log)
        ...
```

Both capabilities are optional. Tests are useful even without them. They are there when we need them.

## Implementation order

The order minimises rework and gives us testable surface as fast as possible.

1. `core/domain/*.py`. Pydantic types are the contract everyone else depends on. Get them right first.
2. `core/db/tables.py` + `core/db/session.py`. SQLAlchemy schema and async session factory.
3. `core/db/seed.py`. Deterministic seed data; lets us run anything end to end.
4. `core/integrations/pms/protocol.py`. The Protocols. No implementations yet; this is just the contract.
5. `core/integrations/pms/fake.py`. The FakePMS, one sub-API at a time.
6. `core/clock.py` + `core/deps.py` + `core/container.py`. The DI wiring.
7. `core/retrieval/*`. Vector index + retriever. Can be stubbed initially.
8. `tests/services/*`. Unit tests against `FakePMS`. We should be able to run these before any agent code exists.
9. First runtime adapter (suggest PydanticAI for ergonomics; full DI story).
10. Subsequent runtimes.

Steps 1-8 are independent of any agent SDK. They define the work in this RFC. Steps 9-10 are scope for [`library-matrix.md`](library-matrix.md).

## Alternatives considered

**A `services/` layer above the PMS.** Earlier draft. Dropped because the only thing it was doing was policy enforcement, and we moved policy to the prompt. Without policy, the services would be one-line passthroughs to the integration. Not worth the layer.

**A tau-bench style `Env` class with `step(action)` dispatcher.** Discussed in `inversion-of-control.md` §2.2. Would give us name-based dispatch and a uniform way to register tools across runtimes. Dropped because every SDK already has its own tool-calling loop; adding our own dispatcher would mean fighting four frameworks at once. Revisit if we need offline replay outside any specific runtime.

**An MCP server as the cross-runtime tool layer.** All four runtimes can consume MCP. We could write the PMS as an MCP server and have every runtime mount it. Dropped for v1 because per-request DI through MCP is awkward (server is constructed once with config). The retriever is a plausible MCP candidate later, since it has no per-request state.

**A general-purpose `Environment` wrapping PMS + retriever + clock.** Tempting because it bundles snapshot/restore/reset on one object. Dropped because `AgentDeps` is enough; the snapshot operation is a property of SQLite, not of the abstraction. We can add an `Environment` wrapper later if a use case demands it.

## Open questions

- Sync vs async at the integration layer. Leaning async to match every SDK and FastAPI. Confirm.
- Whether to expose `AvailabilityAPI.search` as the agent's primary discovery tool, or wrap it inside a higher-level "search rooms" tool that filters and ranks. Probably the latter; agent surface should be ergonomic, not raw.
- The seed-data scenarios. We need 5-10 named test fixtures (Sarah-checks-in-tomorrow, Bob-wants-to-cancel-late, etc.) for evals. Defer to `testing.md` once we draft it.
- Retrieval implementation choice (LanceDB vs in-memory FAISS-like vs DuckDB-VSS). Tradeoff: dependency footprint vs. quality at scale. For demo scale, in-memory is enough.
- How `current_user_id` reaches `AgentDeps` in production. From the FastAPI auth middleware? From a header? Defer to `frontend.md`.

## References

- [`inversion-of-control.md`](inversion-of-control.md) — the IoC research this RFC follows
- [`scope.md`](scope.md) — what the agent can accomplish
- [`policy.md`](policy.md) — the rules the agent reasons over (TODO)
- [Mews Connector API](https://docs.mews.com/) — reservation/inventory/rates shape we model after
- [Cloudbeds API v1.2](https://hotels.cloudbeds.com/api/docs/) — alternate reference
- [Apaleo Booking API](https://api.apaleo.com/swagger/index.html?urls.primaryName=Booking+V1) — domain split (Inventory/Rates/Booking)
- [PydanticAI Dependencies](https://ai.pydantic.dev/dependencies/) — the DI pattern we approximate everywhere
