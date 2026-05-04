# Implementation Status — Backend Core

> **Last updated:** 2026-05-01
> **Scope of this report:** Backend work from `architecture.md` §Implementation order, steps 1–8. No agent SDKs touched.

## TL;DR

Steps 1–8 of the RFC are complete and green. The framework-agnostic core (`draft/core/`) is in place: domain types, SQLAlchemy schema, deterministic seed, six PMS Protocols + a SQLite-backed `FakePMS`, clock + DI container + composition root, and an in-memory retriever indexing 9 markdown docs. Test surface is **43 service-level pytest tests, all passing in ~1s**, plus an end-to-end smoke check of the composition root. Steps 9–10 (per-runtime adapters) are out of scope for this pass and remain in `library-matrix.md` (TODO).

## What landed

```
draft/
├── pyproject.toml                          uv-managed; pydantic, sqlalchemy[asyncio], aiosqlite, pytest, ruff
├── core/
│   ├── __init__.py
│   ├── clock.py                            Clock Protocol + SystemClock + FixedClock
│   ├── deps.py                             AgentDeps (frozen dataclass): pms, retriever, clock, current_user_id
│   ├── container.py                        build_default_deps() — composition root
│   ├── domain/
│   │   ├── __init__.py
│   │   └── types.py                        Pydantic types: Guest, RoomType, Room, RatePlan,
│   │                                       Offer, QuoteLine, Quote, Reservation, ReservationModify,
│   │                                       ServiceCharge + enums (GuestTier, RateType,
│   │                                       ReservationStatus, ServiceTicketStatus)
│   ├── db/
│   │   ├── __init__.py
│   │   ├── tables.py                       SQLAlchemy schema (7 tables)
│   │   ├── session.py                      async engine + session factory + create/drop schema
│   │   ├── seed_data.py                    named-constant fixtures (GUESTS, ROOM_TYPES, RATE_PLANS,
│   │                                       ROOMS, RESERVATIONS, SERVICE_CATALOG, SERVICE_CHARGES)
│   │                                       + exported ids + SEED_NOW anchor
│   │   └── seed.py                         mechanical loader; walks seed_data
│   ├── integrations/
│   │   ├── __init__.py
│   │   └── pms/
│   │       ├── __init__.py
│   │       ├── protocol.py                 6 sub-API Protocols + PMSClient + typed errors
│   │       │                               (PMSError, ReservationNotFoundError,
│   │       │                               GuestNotFoundError, RoomTypeNotFoundError,
│   │       │                               RatePlanNotFoundError, InvalidDatesError)
│   │       └── fake.py                     FakePMS — SQLite-backed; mappers DBE→DTO;
│   │                                       NO policy enforcement
│   └── retrieval/
│       ├── __init__.py
│       ├── protocol.py                     Retriever Protocol + Chunk
│       ├── store.py                        InMemoryRetriever (IDF keyword retriever, dependency-free)
│       └── docs/                           9 markdown files indexed at startup
│           ├── amenities.md
│           ├── neighborhood.md
│           ├── faq.md
│           └── policy/
│               ├── cancellation.md         (rationales + worked examples)
│               ├── modifications.md
│               ├── upgrades.md
│               ├── pets.md
│               ├── fees.md
│               └── escalation.md
└── tests/
    ├── __init__.py
    ├── conftest.py                         fixtures: fixed_clock, engine, session_factory, pms
    │                                       — fresh in-memory SQLite + seed per test
    └── services/
        ├── __init__.py
        ├── test_inventory.py               3 tests
        ├── test_rates.py                   13 tests (Quote line/total invariants, tier waivers, errors)
        ├── test_availability.py            5 tests (capacity filter, pet-friendly, overlap reduction)
        ├── test_reservations.py            14 tests (CRUD + the policy-vs-PMS separation invariants)
        ├── test_guests.py                  5 tests
        └── test_services.py                3 tests
```

## How to run

```bash
cd examples/python/hotel_agent/draft
uv sync                                    # one-time
uv run pytest                              # 43 passed in ~1s
ruff format . && ruff check .              # clean
```

End-to-end smoke check (composition root → FakePMS → InMemoryRetriever):

```bash
uv run python -c "
import asyncio
from core.container import build_default_deps

async def main():
    deps = await build_default_deps(current_user_id='guest_sarah')
    rooms = await deps.pms.inventory.list_room_types()
    chunks = await deps.retriever.search('cancellation policy 24 hours', k=3)
    print(f'{len(rooms)} room types, {len(chunks)} retrieved chunks')

asyncio.run(main())
"
```

## Architectural invariants enforced (and tested)

These are the load-bearing invariants from the RFC. Each has at least one direct test.

1. **PMS does not enforce policy.** Three successive `modify()` calls on the same reservation succeed and yield `modification_count=3`. `cancel()` of a non-refundable inside the cutoff succeeds. `cancel()` is idempotent. The agent enforces policy; the PMS persists.
2. **Quote total = sum of line amounts.** Verified across all rate types (`FLEX`, `ADV`, `NONREF`), tier waivers (Standard/Gold/Platinum), pet/no-pet, multiple night counts.
3. **Platinum waiver.** When `quote(guest_id=GUEST_EVE_ID, …)`, the resort-fee line amount is `0` with a "Waived (Platinum tier)" detail. Gold and Standard pay `$35/night`.
4. **Time flows from Clock.** `created_at` and `cancelled_at` come from the injected clock — never `datetime.now()`. Every test runs against `FixedClock(SEED_NOW)`.
5. **Domain types are returned, not ORM rows.** Every method has an explicit DBE→DTO mapper in `fake.py`. Callers never see SQLAlchemy objects.
6. **Typed errors.** Six typed exceptions inherit from `PMSError`. No `IntegrityError`/`ValueError` leaks across the seam.
7. **`FakePMS` satisfies `PMSClient` under the type-checker.** Class-level attribute annotations match the Protocol's mutable-attribute invariance (see "Known wart" below).

## Seed data — the redoable pattern

`core/db/seed_data.py` is the single source of truth. Adding fixtures = adding tuples to one of the lists; nothing else changes. `seed.py` is a mechanical walker.

- **Anchor:** `SEED_NOW = datetime(2026, 6, 1, 12, 0, 0)`. All relative dates derive from this. Tests pin `FixedClock(SEED_NOW)`.
- **Exported ids:** `GUEST_SARAH_ID`, `RES_BOB_TOMORROW_ADV_ID`, etc. Tests import these instead of magic strings.
- **Coverage:** 7 guests across all 3 tiers, 5 room types, 3 rate plans, ~20 rooms (some pet-friendly), 9 service-catalog items, 8 reservations spanning past/present/future incl. `RES_BOB_INSIDE_CUTOFF_ID` for cancel-cutoff tests, `RES_EVE_CURRENT_STAY_ID` for in-stay tests, `RES_CARLA_FUTURE_NONREF_ID` for non-refundable tests.

The named scenario fixtures from the open-questions list (Sarah-checks-in-tomorrow, Bob-cancels-late, etc.) are deliberately NOT enumerated yet — that belongs in `testing.md` per the RFC's open questions.

## Decisions made during implementation

These extend or concretize the RFC.

1. **`InMemoryRetriever` (IDF keyword overlap)** is the v1 retriever, dependency-free. Resolves "Retrieval implementation choice" open question for this pass. Real vector store (LanceDB / DuckDB-VSS / numpy flat) is a follow-up; the Protocol is the swap-in seam.
2. **`Quote` fields are immutable tuples**, not lists, to keep the Pydantic model `frozen=True` honest.
3. **Platinum waiver renders the resort-fee line at `$0` with explanatory detail** (rather than omitting it). Easier for the agent to surface "your tier waives this" in chat.
4. **`InvalidDatesError`** raises on `check_out <= check_in` everywhere it could land bad data (quote, search, create, modify cross-field check). This is data validity, not policy.
5. **Cancel is idempotent.** Re-cancelling returns the existing row without re-stamping `cancelled_at`. Documented and tested.
6. **`uuid.uuid4().hex[:12]`** for new reservation/charge ids. String ids per RFC; uniqueness is sufficient at demo scale.

## Known wart (acknowledged, kept)

**Protocol mutable-attribute invariance forced narrowing on `FakePMS`.**

`PMSClient` declares `inventory: InventoryAPI` (etc.) as mutable attributes. By PEP 484 invariance rules, an implementer's attribute must be typed exactly `InventoryAPI`, not a subtype like `FakeInventoryAPI`. We resolved this by declaring class-level annotations on `FakePMS`:

```python
class FakePMS:
    inventory: InventoryAPI
    rates: RatesAPI
    ...
```

…and assigning `FakeInventoryAPI(...)` instances inside `__init__`. This satisfies basedpyright/mypy.

**Cleaner alternative we deliberately did NOT take:** make Protocol attributes read-only via `@property`. That would let implementers declare attributes naturally without invariance-driven narrowing. We chose the narrowing path because Protocol consumers don't ever mutate `pms.inventory`, the workaround is local to `FakePMS`, and `@property` would add six stubs to `protocol.py`. Flag this if you write a second implementer (e.g., `MewsPMS`).

## What's deliberately NOT here

- **Per-runtime adapters** (PydanticAI, OpenAI Agents, Claude Agent SDK, LangGraph). Step 9 of the RFC. → `library-matrix.md`.
- **Policy enforcement.** Lives only in the agent's system prompt. PMS-level tests assert the *absence* of enforcement.
- **A real vector store.** Protocol is in place; `InMemoryRetriever` works for demo scale.
- **Adapter-level tests** (synthesize LLM args, exercise adapter). Step 2 of the RFC's testing strategy. Lands with the first runtime.
- **Trajectory-level tests / replay.** The recording wrapper (`RecordingPMS` from RFC §Testing strategy) is not built; defer until the first runtime adapter exists.
- **`current_user_id` provenance** (FastAPI auth → `AgentDeps`). Open question per RFC; defer to `frontend.md`.
- **Named eval scenarios** (Sarah-tomorrow, Bob-late). Defer to `testing.md`.

## Next steps (suggested order)

1. Pick the first runtime to port. RFC suggests **PydanticAI** for ergonomics (cleanest DI story).
2. Write `runtimes/pydanticai/vanilla/adapters.py` (~5 lines per tool) and `agent.py`. Use `agent.override(deps=...)` for test-time wiring.
3. Add adapter-level tests (`tests/adapters/pydanticai/…`): synthesize args an LLM would emit; assert the right `deps.pms.*` method got called. No LLM in the loop.
4. Once one runtime works end-to-end, draft `library-matrix.md` with the side-by-side. Then port the remaining three.
5. Layer on Agenta integration (separate workstream — `agenta-integration.md`).

## Pointers for whoever picks this up cold

Reading order to get oriented in <30 min:

1. `examples/python/hotel_agent/CLAUDE.md` — project overview
2. `draft/design/scope.md` — what the agent does
3. `draft/design/policy.md` — the rules
4. `draft/design/architecture.md` — the RFC this implements
5. `draft/core/integrations/pms/protocol.py` — the contract every runtime sees
6. `draft/core/db/seed_data.py` — the demo's data model in concrete form
7. `draft/tests/services/` — the spec, executable

The composition root (`draft/core/container.py`) is where you start to wire a real runtime against this core.
