# Inversion of Control for the Hotel Agent

> **Status:** Research draft. Iterate freely.
> **Goal of this doc:** survey how RL envs, agent eval frameworks, and modern agent SDKs handle the agent ↔ tools boundary, and stake out the pattern we'll use so the four hotel-agent runtimes (OpenAI Agents, Claude Agent SDK, PydanticAI, LangGraph) share a single domain core and support **single-step tool tests**.

---

## 1. What we mean by "inversion of control" here

In a naive agent setup, the agent module owns its tools — it imports `make_booking`, `search_rooms`, etc., and the function bodies talk directly to the database, the KB, and any external API. Two things go wrong:

1. **You can't share the tool body across runtimes.** Each agent SDK wants a different decorator and a different parameter shape.
2. **You can't unit-test a tool independently of the agent loop.** Tests either spin up the LLM or stub the agent — both heavy and slow.

By "invert control" we mean: **the agent never holds the tools or their state. Tools (or, more precisely, their underlying domain operations) are constructed and owned outside the agent, and made available to it through whatever injection mechanism the SDK provides.** The agent just emits intents (tool calls); something else routes them.

The two payoffs we care about:

- **Cross-runtime portability:** the same domain logic powers all four runtimes; only a thin adapter differs.
- **Single-step tests:** the test harness can call one operation in isolation, with deterministic inputs and a real (or fake) backing store, without an LLM in the loop.

Both flow from the same architectural move.

---

## 2. Prior art tour

Read this section as a synthesis of patterns, not a survey. Each subsection ends with one line on what we steal.

### 2.1 Gymnasium (`gym.Env`) — the RL ancestor

The original IoC story. The agent is pure: it observes, picks an `action` from a discrete/box/dict space, and the env executes everything.

```python
# Gymnasium core (paraphrased)
class Env:
    def reset(self, *, seed=None, options=None) -> tuple[Obs, Info]: ...
    def step(self, action) -> tuple[Obs, Reward, Terminated, Truncated, Info]: ...
```

Side effects live entirely in `step()`. The agent has zero tools, only an action space. You can drop in any policy, including a hand-coded one, and the env doesn't care.

**What we steal:** the *philosophy* — the agent emits intents, the env executes. We will not literally adopt `step()/reset()` because LLM tool-calling already encodes intents (`{name, arguments}`) and modern SDKs route them for us. But the mental model — "actions in, observations out, env owns state" — is the foundation for everything else here.

### 2.2 τ-bench (Sierra Research) — env-as-tool-host for LLMs

τ-bench is the cleanest LLM analogue of `gym.Env`. The agent gets tool **schemas** but not tool **functions**; the env owns the function bodies and the database. ([source](https://github.com/sierra-research/tau-bench/blob/main/tau_bench/envs/tool.py))

```python
# tau_bench/envs/tool.py — verbatim
import abc
from typing import Any

class Tool(abc.ABC):
    @staticmethod
    def invoke(*args, **kwargs):
        raise NotImplementedError

    @staticmethod
    def get_info() -> dict[str, Any]:
        raise NotImplementedError
```

The env holds `self.tools_map: dict[str, Tool]` and `self.data` (the database). The agent loop:

1. Env shows tool **info** (OpenAI tool schemas) to the LLM.
2. LLM produces a tool call → wrapped as an `Action(name, kwargs)`.
3. `env.step(action)` routes:
   `self.tools_map[action.name].invoke(data=self.data, **action.kwargs)`.
4. Env returns observation + reward.

Reward in τ-bench is computed by **hashing the database before/after** vs. ground truth. This is a huge tell: if you've structured tools so they only mutate `data`, you can grade trajectories without inspecting the LLM's prose.

**What we steal:**
- **Tools as classes/objects with `invoke` + `get_info`**, not free functions decorated with whatever the SDK likes. The class form is library-neutral.
- **The env owns the database/state.** Tools don't capture connections in closures; they receive a `data` (or service) handle from the env on each call.
- **Tests can target `env.step(Action(...))` directly** — no LLM, no SDK, single step in, mutated state out.

### 2.3 Harbor (creators of Terminal-Bench) — bash-as-action-space

Harbor is the *opposite extreme*: it inverts so hard that there are no structured tools at all. ([source](https://github.com/harbor-framework/harbor/blob/main/src/harbor/environments/base.py))

```python
class BaseEnvironment(ABC):
    """The containerized environment the agent interacts with."""

    @abstractmethod
    async def start(self, force_build: bool) -> None: ...

    @abstractmethod
    async def stop(self, delete: bool): ...

    @abstractmethod
    async def exec(
        self, command: str, cwd: str | None = None,
        env: dict[str, str] | None = None,
        timeout_sec: int | None = None,
        user: str | int | None = None,
    ) -> ExecResult: ...

    # also: upload_file, download_file, is_file, run_healthcheck, ...

class ExecResult(BaseModel):
    stdout: str | None = None
    stderr: str | None = None
    return_code: int
```

The agent's entire interaction with the world is `exec(command)` returning `(stdout, stderr, return_code)`. Verification is a separate concern run *after* the agent stops — the env doesn't know the task. `EnvironmentCapabilities` (gpus, internet, windows, mounted) is a flags model the env publishes so policies and verifiers can introspect.

**What we steal:**
- **Capabilities flags.** Useful pattern: a runtime publishes `EnvironmentCapabilities` (or for us, something like `HotelCapabilities` — supports_concurrent_bookings, supports_payment, etc.) so frontends/tests can adapt without runtime trial-and-error.
- **Verifier-as-separate-concern.** Don't bundle eval logic into the env. `core/` exposes domain ops; eval/grading code is a separate module that reads the post-state.
- **Lifecycle methods (`start`/`stop`).** Our hotel env needs DB seed/teardown; modeling it as start/stop keeps tests clean.

**What we don't steal:** the bash-only action space. Hotel ops are inherently structured (book a room, look up a reservation), and forcing them through `exec()` would be silly. Harbor's domain (terminal benchmarks) earns it; ours doesn't.

### 2.4 OpenAI Agents SDK — `RunContextWrapper` as DI container

```python
# OpenAI Agents SDK
@dataclass
class HotelDeps:
    hotel_service: HotelService
    user_id: str

agent = Agent[HotelDeps](name="concierge", instructions="...", tools=[...])

@function_tool
async def search_rooms(
    ctx: RunContextWrapper[HotelDeps],
    check_in: date, check_out: date, guests: int,
) -> list[Room]:
    return await ctx.context.hotel_service.search_rooms(...)

result = await Runner.run(agent, "I need a room for two", context=HotelDeps(...))
```

`RunContextWrapper[T]` is the DI seam: the context object passes through every tool, hook, and handoff. Critically, **the context is never sent to the LLM** — purely code-side. ([docs](https://openai.github.io/openai-agents-python/context/))

Caveats:
- **Sub-agents and `agent.as_tool` nest contexts** — there's an open issue where the inner agent's tools lose access to the outer context. Worth knowing if our hotel agent gets a sub-agent (e.g., a separate "billing" sub-agent).
- **No first-class test-override API** like PydanticAI has. You override by constructing a different deps object and passing it to `Runner.run`.

### 2.5 PydanticAI — the gold standard for testability

```python
@dataclass
class HotelDeps:
    hotel_service: HotelService
    user_id: str

agent = Agent('openai:gpt-4o', deps_type=HotelDeps)

@agent.tool
async def search_rooms(ctx: RunContext[HotelDeps], check_in: date, check_out: date) -> list[Room]:
    return await ctx.deps.hotel_service.search_rooms(check_in, check_out, ctx.deps.user_id)

result = await agent.run("I need a room for two", deps=HotelDeps(...))
```

Same story as OpenAI Agents structurally, but with a **first-class test-time override**:

```python
with agent.override(deps=test_deps):
    result = await application_code(...)
```

Inside the `with`, every `agent.run(...)` ignores the deps the caller passed and uses `test_deps` instead. This is the pattern we want every runtime to *approximate* — explicit override-at-test-time so production code paths run untouched. ([docs](https://ai.pydantic.dev/dependencies/))

### 2.6 Claude Agent SDK — closures inside an in-process MCP server

This one is structurally different. The Claude SDK has **no** context/deps argument on the handler:

```python
# Verbatim from Anthropic docs
@tool("get_temperature", "...", {"latitude": float, "longitude": float})
async def get_temperature(args: dict[str, Any]) -> dict[str, Any]:
    # args is the LLM-validated dict; that's all you get
    ...

server = create_sdk_mcp_server(name="weather", version="1.0.0", tools=[get_temperature])
```

The tools get bundled into an in-process MCP server, then registered:

```python
options = ClaudeAgentOptions(
    mcp_servers={"weather": server},
    allowed_tools=["mcp__weather__get_temperature"],
)
async for msg in query(prompt="...", options=options): ...
```

To inject dependencies you have **two real choices**, and both are uglier than RunContext:

1. **Closure over deps at module-build time.** The tool is created inside a factory function:
   ```python
   def make_hotel_tools(deps: HotelDeps) -> list:
       @tool("search_rooms", "...", {"check_in": str, "check_out": str})
       async def search_rooms(args):
           return await deps.hotel_service.search_rooms(...)
       return [search_rooms, ...]
   ```
2. **Module-level singleton** that the tool reads from. Simple but global state — bad for concurrent requests with different users.

Closure-via-factory is the right answer. It mirrors how MCP servers normally take config in their `__init__`. Test-override = "build the server with test deps."

> **❓ Open question:** Claude SDK has no per-request context. If we need per-request data (auth user, session id), do we (a) build a fresh MCP server per request, (b) thread it through the prompt/system message, or (c) thread it through a side-channel like contextvars? (b) leaks deps to the LLM, (c) is fragile. (a) is the cleanest but has overhead — needs measurement.

### 2.7 LangGraph — `InjectedState` as a hidden tool param

LangGraph thinks in graph state, not deps containers:

```python
from typing import Annotated
from langgraph.prebuilt import InjectedState

@tool
def search_rooms(
    check_in: str, check_out: str,
    state: Annotated[dict, InjectedState],  # hidden from the LLM, injected at exec
) -> list[dict]:
    hotel_service = state["hotel_service"]
    ...
```

`InjectedState` is a special annotation: the LLM doesn't see this parameter in the tool schema, but at runtime LangGraph fills it from the current graph state. Same trick for `tool_call_id` and a few other framework-managed values. ([docs](https://reference.langchain.com/python/langgraph.prebuilt/tool_node/InjectedState))

The graph state replaces the deps container, but the *effect* is identical — the framework injects, the tool author doesn't pass.

### 2.8 MCP — the cross-library lingua franca

All four runtimes can consume MCP servers. So the temptation is: write our domain ops as one in-process MCP server, point all four runtimes at it. ([Anthropic MCP intro](https://modelcontextprotocol.io/))

It's a real option, but with caveats:

- **Per-request DI is awkward.** MCP servers are constructed once with their config; they don't take a per-call context. Same problem as Claude SDK above.
- **Schema becomes MCP-shaped.** You give up library-native ergonomics (Pydantic types in PydanticAI, Zod in TypeScript, dataclasses everywhere).
- **Some tools fit, others don't.** A pure side-effect-free DB query is a great MCP tool. Anything that needs the runtime's own state (e.g., LangGraph's `messages`) leaks back into the runtime.

**Verdict for us:** keep MCP in our pocket as an *option for the lowest-common-denominator tools* (the truly stateless ones: KB search, currency conversion). For tools that need request-scoped state (user auth, current booking draft), use the runtime's native DI.

---

## 3. Side-by-side: how each runtime injects

| Runtime | Tool decorator | DI mechanism | Test-time override | LLM sees the deps? |
|---|---|---|---|---|
| OpenAI Agents | `@function_tool` | `RunContextWrapper[T]` → `ctx.context` | Pass new deps to `Runner.run` | No |
| PydanticAI | `@agent.tool` | `RunContext[T]` → `ctx.deps` | `agent.override(deps=...)` ✓ | No |
| Claude Agent SDK | `@tool(...)` (MCP) | Closure over deps at server-build time | Build server with test deps | No |
| LangGraph | `@tool` + `Annotated[..., InjectedState]` | Graph state injection | Compile graph with test state | No |
| τ-bench (reference) | Class with `invoke`/`get_info` | Env passes `data` into `invoke` | Construct env with test `data` | Schema only via `get_info` |

The "Test-time override" column tells the real story: PydanticAI is the only one with first-class support. Everywhere else we have to *engineer* the override path. That informs the design.

---

## 4. Why a single tool library across all four runtimes won't fly

Naive plan: write `@hotel_tool def search_rooms(...): ...` once and have it work in all four runtimes. This fails for concrete reasons:

- **Signatures are incompatible.** OpenAI/PydanticAI want `ctx` first; LangGraph wants `Annotated[..., InjectedState]`; Claude SDK wants `args: dict`. There is no signature that all four accept.
- **Schema is built by the decorator.** Each library introspects the decorated function to build the LLM-visible schema (Pydantic types, Zod, JSON schema). A "neutral" tool can't produce all four shapes from one definition without a generator.
- **Per-runtime control flow differs.** LangGraph tools live in a graph that may emit `Command(update=...)` messages to mutate state. A tool with that signature is non-portable to PydanticAI.

So we don't write portable *tools*. We write a portable **service layer one notch deeper**, and a thin per-runtime adapter on top.

---

## 5. The pattern we propose

```
core/
├── domain/                  # pydantic types: Room, Booking, User, ...
├── db/                      # SQLite schema, seed, repository (sync or async)
├── knowledge_base/          # KB index + retrieval (e.g., FAQ, policies)
├── services/
│   ├── hotel_service.py     # the business logic — no LLM, no decorators
│   └── kb_service.py
├── operations.py            # registry: name → callable spec (the contract)
└── container.py             # factory: build a (HotelService, KBService, ...) bundle

runtimes/<lib>/<vanilla|with_agenta>/
├── adapters.py              # thin tool wrappers that call core.services.*
└── agent.py                 # assemble + run
```

### 5.1 The contract

`core/services/hotel_service.py` exposes plain methods:

```python
class HotelService:
    def __init__(self, db: HotelDB, kb: KBService): ...

    async def search_rooms(self, *, check_in: date, check_out: date, guests: int) -> list[Room]: ...
    async def book_room(self, *, room_id: UUID, user_id: UUID, ...) -> Booking: ...
    async def cancel_booking(self, *, booking_id: UUID, user_id: UUID) -> Booking: ...
    async def lookup_policy(self, *, query: str) -> str: ...
```

These are the "operations." Inputs are typed; outputs are typed; no LLM, no SDK, no decorators. **This is what tests target.**

### 5.2 The per-runtime adapter

Each runtime's adapter knows how its SDK injects deps and writes a thin function per operation:

```python
# runtimes/pydanticai/vanilla/adapters.py
@agent.tool
async def search_rooms(
    ctx: RunContext[HotelDeps],
    check_in: date, check_out: date, guests: int,
) -> list[Room]:
    return await ctx.deps.hotel.search_rooms(
        check_in=check_in, check_out=check_out, guests=guests,
    )

# runtimes/claude_agent_sdk/vanilla/adapters.py — closure-style
def make_hotel_tools(hotel: HotelService):
    @tool("search_rooms", "Search for available rooms.", {...})
    async def search_rooms(args):
        rooms = await hotel.search_rooms(
            check_in=date.fromisoformat(args["check_in"]),
            check_out=date.fromisoformat(args["check_out"]),
            guests=args["guests"],
        )
        return {"content": [{"type": "text", "text": rooms_to_markdown(rooms)}]}
    return [search_rooms, ...]
```

Adapter rules:
- **No business logic.** Adapter only does I/O conversion (LLM-shape ↔ domain-shape).
- **No DB access.** Adapter only calls `HotelService` methods.
- **No prompt logic.** Prompts come from `core/prompts/` (later: from Agenta).

### 5.3 Why this enables single-step tool tests

Three test layers, each useful for something different:

1. **Service-level (the workhorse).** `pytest tests/services/test_hotel_service.py` — instantiate `HotelService` with a real (in-memory) SQLite + a real KB, call methods, assert state. No LLM, no SDK. Should be 90% of our test count.
2. **Adapter-level.** Per runtime, exercise the adapter directly: feed it the args shape an LLM would produce, assert the right service call happened. Useful for catching schema/typing bugs. Does *not* need the LLM either — synthesize the args.
3. **Optional env-step / harness-level.** If we build a τ-bench-style env (a `HotelEnv.step(Action)` over `HotelService`), tests can drive trajectories of actions deterministically. Good for replay tests and grading.

> **❓ Open question:** do we build the τ-bench-style env layer right away, or only if a need shows up? Argument for: it makes future eval and replay trivial. Argument against: extra surface area, none of the four target SDKs need it. Lean: build it as a *harness*, not as a runtime — a thin wrapper around `HotelService` used in tests and (later) in offline eval, but not required by any runtime.

---

## 6. Capabilities and per-tool overrides

Borrowing Harbor's `EnvironmentCapabilities` idea, we publish what the deployed core can do:

```python
class HotelCapabilities(BaseModel):
    can_book: bool = True
    can_cancel: bool = True
    accepts_payment: bool = False
    has_kb: bool = True
    kb_kind: Literal["faq", "vector", None] = "faq"
```

Useful for:
- **Frontend:** show/hide UI elements based on what the backend supports.
- **Eval:** task suites can declare requirements (`requires.can_book == True`) and skip otherwise.
- **Multi-runtime:** if one runtime can't do something, capabilities are how we communicate it.

---

## 7. Single-step tests — concrete shape

```python
# tests/services/test_search_rooms.py
async def test_search_rooms_filters_by_capacity(hotel_service: HotelService):
    rooms = await hotel_service.search_rooms(
        check_in=date(2026, 6, 1), check_out=date(2026, 6, 3), guests=4,
    )
    assert all(r.capacity >= 4 for r in rooms)
    assert {r.room_number for r in rooms} == {"301", "302"}  # known seed data
```

```python
# tests/adapters/openai_agents/test_search_rooms_adapter.py
async def test_adapter_passes_args_through(hotel_service):
    deps = HotelDeps(hotel=hotel_service, user_id="u1")
    ctx = RunContextWrapper(context=deps)  # no LLM
    rooms = await search_rooms(ctx, check_in="2026-06-01", check_out="2026-06-03", guests=4)
    assert len(rooms) > 0
```

The PydanticAI runtime's adapter test would use `agent.override(deps=test_deps)` directly. The Claude SDK's would build a server with test deps and exercise the handler.

---

## 8. Open questions — to resolve in the next pass

- **Sync vs async at the service layer.** Lean: async (matches every SDK, matches FastAPI). Confirm.
- **`HotelService` as a single class vs. one class per resource (rooms, bookings, kb).** Lean: split, with a `HotelDeps` aggregate that bundles them. Less stuff in one file.
- **Where does "current user" live?** In `HotelDeps`? In each method signature? Auth at the service layer or at the adapter? Lean: pass `user_id` explicitly to service methods (no implicit auth state); the adapter pulls it from the runtime context.
- **Build a τ-bench-style harness now or later?** (See §5.3.)
- **MCP for KB tools?** KB search is stateless and a great fit for MCP. Tempting to write it once and serve to all four runtimes. Decide after we have the basic per-runtime adapter pattern working.
- **Streaming.** Vercel AI SDK on the frontend wants streamed tokens + tool-call events. How does that flow through `HotelService` → adapter → runtime → HTTP → frontend? Probably handled at the runtime layer, but worth a sketch.
- **Idempotency / "human-in-the-loop" approval.** Booking is destructive. Tool annotations (Claude SDK has `destructiveHint`, MCP has equivalents) and runtime-level approval flows differ a lot. Defer until first booking adapter is wired.
- **Concurrent users / per-request scoping.** All runtimes except Claude SDK have per-request DI. For Claude SDK, the choice is "build server per request" or "use contextvars." Decide once we benchmark.

---

## 9. Decision (tentative)

Two non-negotiables locked in:

1. **The shared core is a service layer, not a tool layer.** Tools per runtime are thin adapters that call services. We do NOT try to write a single decorator that works for all four.
2. **Tools never own deps; deps come in via the runtime's native DI.** PydanticAI's `agent.override` is the test-time idiom we approximate everywhere.

Everything else is an open question above.

---

## 10. References

- **τ-bench**: [GitHub](https://github.com/sierra-research/tau-bench), [paper](https://arxiv.org/abs/2406.12045), [Sierra blog](https://sierra.ai/blog/benchmarking-ai-agents)
- **τ²-bench**: [GitHub](https://github.com/sierra-research/tau2-bench) — adds dual-control (user can call tools too)
- **Harbor**: [GitHub](https://github.com/harbor-framework/harbor), [docs](https://www.harborframework.com/), `BaseEnvironment` in `src/harbor/environments/base.py`
- **Gymnasium**: [Env API](https://gymnasium.farama.org/api/env/), [GEM: Gym for Agentic LLMs](https://arxiv.org/html/2510.01051v1)
- **OpenAI Agents SDK**: [Context management](https://openai.github.io/openai-agents-python/context/), [RunContext ref](https://openai.github.io/openai-agents-python/ref/run_context/)
- **Claude Agent SDK**: [Custom tools](https://code.claude.com/docs/en/agent-sdk/custom-tools), [overview](https://code.claude.com/docs/en/agent-sdk/overview)
- **PydanticAI**: [Dependencies](https://ai.pydantic.dev/dependencies/), [tools API](https://ai.pydantic.dev/api/tools/)
- **LangGraph**: [InjectedState](https://reference.langchain.com/python/langgraph.prebuilt/tool_node/InjectedState), [ToolNode source](https://github.com/langchain-ai/langgraph/blob/main/libs/prebuilt/langgraph/prebuilt/tool_node.py)
- **MCP**: [modelcontextprotocol.io](https://modelcontextprotocol.io/), [OpenAI Agents MCP](https://openai.github.io/openai-agents-python/mcp/)
