# Agent tools: conventions review

This reviews the agent **tools** code (SDK + Python service) against our house conventions:
the `api/AGENTS.md` architecture rules, the SDK agents package idiom, and the existing
`api/oss/src/core/tools/` domain. Headline verdict: the tool code is in good shape and
mostly already matches the layer it lives in. The naming and docstrings are consistent with
the agents package. The two real gaps are both small: `ResolvedTools` is a `@dataclass` in a
package where every other contract is a Pydantic model, and the service raises bare
`RuntimeError` where a typed error reads better. Everything else is keep-as-is or a
discuss-later.

## Tool code map

| File | Layer | Role |
| --- | --- | --- |
| `sdks/python/agenta/sdk/agents/tool_defs.py` | SDK | Neutral tool vocabulary (`*ToolDef`, `McpServer`) + loose-shape parsers (`parse_tool_def`). |
| `sdks/python/agenta/sdk/agents/tool_resolution.py` | SDK | `LocalToolResolver`, `SecretResolver`/`EnvSecretResolver`, `ResolvedTools`, the per-kind spec builders. |
| `sdks/python/agenta/sdk/agents/dtos.py` | SDK | Holds `ToolCallback`, `SessionConfig` (the resolution output target). |
| `services/oss/src/agent/tools.py` | Service | Server-side orchestration: gateway over HTTP, delegates local kinds to the SDK. |
| `services/oss/src/agent/secrets.py` | Service | Vault secret resolution (`resolve_named_secrets`, `resolve_harness_secrets`). |
| `services/oss/src/agent/client.py` | Service | Shared backend base URL + caller credential. |
| `services/oss/src/agent/app.py` | Service | The `/invoke` handler that calls `resolve_tools` / `resolve_mcp_servers`. |
| `services/agent/src/tools/*.ts` | TS runner | The execution side (`code.ts`, `client.ts`, `mcp-server.ts`, ...). Out of focus. |

## What I learned about the codebase

These are the conventions I confirmed by reading, each with a citation. Useful as a
standalone reference.

- **`api/AGENTS.md` rules are scoped to `api/`.** The file says so in its first line:
  "Scope: everything under `api/`" (`api/AGENTS.md:3`). The SDK (`sdks/python`) and the
  service (`services/oss`) are different layers with their own idioms. Judge tool code
  against the layer it lives in.
- **API domains follow a fixed folder shape**: `apis/fastapi/<domain>` + `core/<domain>` +
  `dbs/postgres/<domain>`, with named files `router.py` / `models.py` / `service.py` /
  `interfaces.py` / `dtos.py` / `dao.py` / `mappings.py` (`api/AGENTS.md:58-78`). The
  canonical copy-me example is `api/oss/src/core/workflows/` (`api/AGENTS.md:74-77`).
- **The existing tools domain follows that shape**: `api/oss/src/core/tools/` has
  `dtos.py`, `exceptions.py`, `interfaces.py`, `service.py`, `registry.py`, `utils.py`, and
  `providers/` (confirmed by directory listing). It is the fuller layout the SDK tool code
  is being compared against.
- **API domain exceptions are typed and live in the core layer**, never `HTTPException` in
  services (`api/AGENTS.md:209-217`). The tools domain has a base `ToolsError` plus typed
  subclasses with structured context, for example `ActionNotFoundError`
  (`api/oss/src/core/tools/exceptions.py:4-58`). Note: this domain uses `exceptions.py`,
  while `api/AGENTS.md:210` names `core/{domain}/types.py` or `dtos.py`. So even inside
  `api/` the exception-file name is not uniform.
- **API services return typed Pydantic DTOs, not dicts or tuples** (`api/AGENTS.md:298-345`).
  The tools service proves resolution output can be a model: `resolve_agent_tools` returns
  `AgentToolsResolution` carrying `List[ResolvedAgentTool]`
  (`api/oss/src/core/tools/service.py:489-519`, defined at
  `api/oss/src/core/tools/dtos.py:277-298`).
- **API signature style is keyword-only with `#`-grouped sections** (`api/AGENTS.md:188-206`).
  Live example: `ToolsDAOInterface.create_connection(self, *, project_id, user_id, #,
  connection_create)` (`api/oss/src/core/tools/interfaces.py:22-30`).
- **In-code comments are kept minimal, the why not the what** (`api/AGENTS.md:21-22`).
- **The SDK agents package has its own explicit hexagonal vocabulary**, documented in its
  module docstring: `dtos.py` (contracts), `interfaces.py` (ports/ABCs), `adapters/`
  (implementations), `utils/` (plumbing) (`sdks/python/agenta/sdk/agents/__init__.py:3-11`).
  This is the idiom the tool code must match, not the API folder shape.
- **SDK contracts are Pydantic `BaseModel`, deliberately.** The `dtos.py` docstring states
  "These are Pydantic models (the SDK already depends on Pydantic)"
  (`sdks/python/agenta/sdk/agents/dtos.py:6-7`); all 12 contracts in that file subclass
  `BaseModel` (grep count). The tool *defs* follow this too (`tool_defs.py:43-101`,
  `McpServer` at `:117`).
- **SDK ports are ABCs.** `Sandbox` / `Session` / `Backend` all subclass `ABC` with
  `@abstractmethod` (`sdks/python/agenta/sdk/agents/interfaces.py:41,58,94`). `Protocol`
  exists in the SDK but is reserved for structural typing of third-party modules, for
  example `_LitellmModule(Protocol)` (`sdks/python/agenta/sdk/utils/lazy.py:22`), and for
  call-shape contracts like `InvokeFn(Protocol)`
  (`sdks/python/agenta/sdk/decorators/running.py:54`). So an owned, implemented-by-us port
  is an ABC; a Protocol is for "shape someone else satisfies".
- **The agents package names its errors file `errors.py`, not `exceptions.py`**, and its
  errors subclass `RuntimeError` with structured attributes:
  `UnsupportedHarnessError(RuntimeError)` stores `.harness` and `.backend`
  (`sdks/python/agenta/sdk/agents/errors.py:13-21`). This is the SDK's own version of the
  API's typed-domain-exception rule.
- **The snake/camel boundary is handled by `to_wire()` methods on DTOs.** `ContentBlock`,
  `TraceContext`, and `ToolCallback` each own a `to_wire()` that maps snake_case fields to
  camelCase wire keys (`dtos.py:122-142`, `:255-262`, `:273-274`). The `/run` request is
  assembled in `utils/wire.py` (`request_to_wire`, `sdks/python/.../utils/wire.py:24-57`).
  The TS side mirrors the names in `services/agent/src/protocol.ts`
  (`utils/wire.py:3-5`).
- **The agents `__init__.py` curates `__all__` with section comments** grouping DTOs, the UI
  codec, tool definitions, resolution, ports, errors, and adapters
  (`sdks/python/agenta/sdk/agents/__init__.py:73-128`).
- **The agents package uses rich module + class docstrings.** Every module opens with a
  multi-paragraph docstring explaining the layer and the why
  (`dtos.py:1-9`, `interfaces.py:1-16`, `tool_defs.py:1-25`). This is louder than the
  API's "minimal comments" rule, and it is the established norm *for this package*.
- **The SDK uses one module logger per file**: `log = get_module_logger(__name__)`
  (`tool_resolution.py:47`, `secrets.py:22`, `tools.py:46`).
- **Tests split unit vs integration by directory and gate gateway/network tests behind
  `pytest.mark.integration`.** Unit tool tests live in
  `sdks/python/oss/tests/pytest/unit/agents/` (`test_tool_defs.py`,
  `test_tool_resolution.py`) and service-side in
  `services/oss/tests/pytest/unit/agent/test_tool_refs.py`; the gateway HTTP path lives in
  `services/oss/tests/pytest/integration/agent/test_resolve_tools_http.py` with
  `pytestmark = pytest.mark.integration` (`test_resolve_tools_http.py:19`). Test modules
  open with a docstring naming what they lock (`test_tool_resolution.py:1-8`).

## Proposals and parallels

### 1. File organization and placement

- **House pattern.** API splits a domain into many small files
  (`api/AGENTS.md:58-78`). The SDK agents package splits by *role* not by feature: one
  `dtos.py`, one `interfaces.py`, an `adapters/` package, a `utils/` package
  (`__init__.py:3-11`). The `tool_defs.py` / `tool_resolution.py` pair sits as two
  sibling modules at the package root, next to `dtos.py` and `streaming.py`.
- **Current state.** `tool_defs.py` (vocabulary + parsing) and `tool_resolution.py`
  (resolution + secrets + spec builders) are two modules. `tool_resolution.py` is doing
  three jobs: secret sources (`SecretResolver`/`EnvSecretResolver`), free-function spec
  builders, and the `LocalToolResolver`. It is 225 lines, cohesive, and reads cleanly.
- **Proposal: Keep.** Two modules for ~460 lines is right for this package. A `tools/`
  subpackage would be over-built next to a single-file `dtos.py` that holds 12 models. The
  one thing worth flagging: `SecretResolver` is a generic seam (a `code` tool, an MCP
  server, and tomorrow other consumers use it). If a second resolver-shaped abstraction
  lands, lifting `SecretResolver`/`EnvSecretResolver` into the package's `interfaces.py`
  (where ports already live) would match the idiom better than keeping it in
  `tool_resolution.py`. Not now. **Worth discussing** only when a second consumer appears.

### 2. File naming

- **House pattern.** Dominant names are `dtos.py`, `service.py`, `interfaces.py`,
  `utils.py`, `enums.py` (`api/AGENTS.md:62-72`). But the agents package already chose a
  different file set on purpose: `dtos.py`, `interfaces.py`, `streaming.py`,
  `tool_defs.py`, plus adapter subpackages such as `adapters/vercel/` for protocol-specific
  edge code. Descriptive feature names are the norm *here* when the name marks a real seam.
- **Current state.** `tool_defs.py` and `tool_resolution.py` follow the agents package's
  own descriptive-name idiom, not the API's `dtos.py`/`service.py` idiom.
- **Proposal: Keep.** Renaming to `dtos.py`/`service.py` would collide with the package's
  existing `dtos.py` and would not be more informative. `tool_defs.py` and
  `tool_resolution.py` say exactly what they hold. The names are good.

### 3. Class naming

- **House pattern.** API uses `*Service`, `*DAOInterface`, `*DTO` suffixes
  (`ToolsService`, `ToolsDAOInterface`, `SecretResponseDTO`). The SDK agents package uses
  bare role nouns for ports (`Backend`, `Harness`, `Sandbox`, `Session`,
  `interfaces.py:41-198`) and bare nouns for DTOs (`Message`, `AgentResult`).
- **Current state.** `LocalToolResolver`, `SecretResolver`, `EnvSecretResolver`,
  `ResolvedTools`, and the `*ToolDef` family. These read as role nouns, matching the agents
  package. `EnvSecretResolver` as a concrete adapter of `SecretResolver` mirrors
  `InProcessPiBackend` adapting `Backend`.
- **Proposal: Keep.** The names match the package's own port/adapter naming. `*ToolDef`
  parallels the API's `Agent*Tool` discriminated union
  (`api/oss/src/core/tools/dtos.py:253-274`) closely enough that a reader crossing the two
  layers will not be surprised.

### 4. Function naming and signature style

- **House pattern.** API prefers keyword-only params with a leading `*` and `#`-grouped
  sections (`api/AGENTS.md:188-206`; live at
  `api/oss/src/core/tools/interfaces.py:22-30`). The SDK agents package follows this on its
  *ports*: `Session.prompt(self, messages, *, on_event=None)`
  (`interfaces.py:67-72`), `Backend.create_session(self, sandbox, config, *, harness, ...)`
  (`interfaces.py:120-129`).
- **Current state.** `LocalToolResolver.__init__(self, secret_resolver=None, *,
  enable_mcp=False)` already uses keyword-only for the flag
  (`tool_resolution.py:166-171`), matching the ports. But the module-level spec builders are
  positional: `code_tool_spec(tool, env)`, `mcp_server_spec(server, values)`,
  `attach_orthogonal(entry, tool)` (`tool_resolution.py:88,98,124`).
- **Proposal: Small change (optional).** These free functions take two args each and are
  internal builders called from one place. Positional is defensible and the call sites are
  clear (`tool_resolution.py:208-209`, `services/oss/src/agent/tools.py:133`). If you want
  strict parity with the package's keyword-only norm, make the second arg keyword-only
  (`code_tool_spec(tool, *, env)`). Low value, low risk. I would **keep** unless you are
  doing a parity sweep.

### 5. Function structure

- **House pattern.** Small, single-responsibility functions with early returns; the
  split-then-build pattern (collect, then transform). The API resolver does exactly this
  (`api/oss/src/core/tools/service.py:489-519`: split builtins vs custom, build each).
- **Current state.** `LocalToolResolver.resolve_defs` splits defs by type with three
  comprehensions, then builds (`tool_resolution.py:198-211`). `resolve_tools` in the service
  does the same split (`tools.py:152-180`). The functions are short, each does one thing,
  and they early-return on empty (`tools.py:153-154`). The parsers in `tool_defs.py` use
  early returns throughout (`parse_tool_def`, `:182-208`).
- **Proposal: Keep.** This is the cleanest dimension. The structure matches the house
  split-then-build pattern precisely.

### 6. Docstrings

- **House pattern.** Two competing norms. `api/AGENTS.md:21-22` says keep in-code comments
  minimal (why not what). The SDK agents package, by contrast, opens every module with a
  multi-paragraph docstring (`dtos.py:1-9`, `interfaces.py:1-16`, `tool_defs.py:1-25`) and
  gives most classes a why-focused docstring.
- **Current state.** `tool_defs.py` and `tool_resolution.py` carry rich module docstrings
  and per-class/per-function docstrings in the package's house voice. They explain *why*
  (the three-axis split, why gateway can't resolve offline, why MCP is flag-gated), not
  *what*.
- **Proposal: Keep.** The docstrings match the agents package norm, which is the relevant
  one. They are on the heavy side by `api/AGENTS.md` standards, but that rule does not own
  this package, and the surrounding files set the heavier bar. Consistency wins. One nit:
  `EnvSecretResolver.resolve` has a why-comment about the single read
  (`tool_resolution.py:74`) that is genuinely a why, so it is fine.

### 7. Variable naming

- **House pattern.** snake_case Python locals; camelCase only at the wire boundary, and the
  boundary is owned by `to_wire()` methods on DTOs (`dtos.py:122-142`,
  `ToolCallback.to_wire`, `:273-274`).
- **Current state.** Locals are snake_case throughout. The camelCase keys
  (`needsApproval`, `inputSchema`, `callRef`, `mcpServers`) appear only inside the
  dict-literal builders (`tool_resolution.py:100-106`, `services/oss/src/agent/tools.py:126-132`).
  The boundary is clean and intentional: snake_case in, camelCase out.
- **Proposal: Keep**, with one observation flagged in dimension 8: the builders emit
  camelCase from a free function returning `Dict[str, Any]`, whereas the rest of the package
  emits camelCase from a typed `to_wire()`. The variable naming itself is correct; the
  *mechanism* is the discussion (see below).

### 8. Typing and data contracts

This is the most substantive finding.

- **House pattern.** API services return typed Pydantic DTOs, not dicts or tuples
  (`api/AGENTS.md:298-345`), and the tools domain already returns
  `AgentToolsResolution` / `ResolvedAgentTool` for resolution output
  (`api/oss/src/core/tools/dtos.py:277-298`). The SDK agents package makes contracts Pydantic
  `BaseModel` on purpose (`dtos.py:6-7`), and wire serialization lives in a `to_wire()` on
  the model (`ContentBlock.to_wire`, `dtos.py:122`).
- **Current state — three sub-points:**
  1. `ResolvedTools` is a `@dataclass` (`tool_resolution.py:149-156`). It is the **only**
     `@dataclass` in the agents package; everything else there is a `BaseModel`. (The SDK
     uses `@dataclass` only in `utils/types.py` and `evaluations/preview/utils.py`, not in a
     contract layer.)
  2. `ResolvedTools` duplicates four fields of `SessionConfig` verbatim: `builtin_tools`,
     `custom_tools`, `tool_callback`, `mcp_servers` (`tool_resolution.py:153-156` vs
     `dtos.py:512-517`). The resolver builds a `ResolvedTools`, then the service unpacks it
     field-by-field onto `SessionConfig` (`app.py:91-103` via the `resolve_tools` tuple).
  3. The wire specs are untyped `Dict[str, Any]` built by free functions
     (`code_tool_spec` etc.), not a typed model with `to_wire()`.
- **Proposals:**
  - **`ResolvedTools` -> Pydantic `BaseModel`: Small change, do it.** It is a one-line swap
    (`@dataclass` to `BaseModel`, `field(default_factory=...)` to `Field(default_factory=...)`)
    and it removes the lone odd-one-out in a Pydantic package. Cheap, lowers surprise.
  - **The `SessionConfig` field duplication: Worth discussing, lean keep.** `ResolvedTools`
    is the resolver's *output contract*; `SessionConfig` is the run's *input bundle*. They
    overlap by design because resolution feeds the session. The current service path returns
    a bare tuple `(builtins, custom_tools, callback)` from `resolve_tools`
    (`tools.py:142-180`), which is exactly the tuple anti-pattern `api/AGENTS.md:341-344`
    warns against. The higher-leverage fix is to have the service `resolve_tools` return the
    `ResolvedTools` model (once it is a model) instead of a 3-tuple, and have `app.py` spread
    it onto `SessionConfig`. That kills the tuple, keeps the two contracts distinct, and does
    not force a premature merge. Note this crosses the layer boundary: `resolve_tools` lives
    in `services/oss` but would return an SDK type, which is fine and already the dependency
    direction (`service -> SDK`).
  - **Typed wire specs with `to_wire()`: Worth discussing, defer.** Turning each
    `code_tool_spec`/`client_tool_spec`/`mcp_server_spec` dict into a small Pydantic model
    with `to_wire()` would match `ContentBlock`/`ToolCallback`. But the wire shape is shared
    three ways (SDK builder, service gateway path, TS `protocol.ts`) and is pinned by the
    golden contract tests. The dict-literal builders are readable and the camelCase keys sit
    right next to the snake_case source. I would defer this until the tool wire shape needs
    to grow; the payoff today is mostly aesthetic.
  - **`SecretResolver` ABC vs Protocol vs callable: Keep the ABC.** It is an owned port with
    a single method, implemented by us (`EnvSecretResolver`, the service's
    `_VaultSecretResolver`, the test `_DictSecrets`). That is exactly when the package uses
    an ABC (`interfaces.py:41-129`), not a Protocol (which it reserves for third-party module
    shapes, `utils/lazy.py:22`). A bare `Callable[[Sequence[str]], Awaitable[Dict[str,str]]]`
    would lose the name and the docstring seam. The ABC is the right call.

### 9. Exception handling

- **House pattern.** API defines typed domain exceptions in the core layer and never raises
  `HTTPException` from services (`api/AGENTS.md:209-217`); the tools domain has the full
  `ToolsError` hierarchy (`api/oss/src/core/tools/exceptions.py`). The SDK agents package has
  its own version: typed errors in `errors.py` subclassing `RuntimeError` with structured
  attributes (`errors.py:13-21`). The anti-pattern is bare `Exception`/`ValueError`/error
  dicts for domain errors (`api/AGENTS.md:291-296`).
- **Current state.** The service's gateway path raises bare `RuntimeError` four times
  (`services/oss/src/agent/tools.py:84,102,112,122`): missing API base, HTTP error, count
  mismatch, incomplete spec. The SDK side raises nothing (it skips and warns,
  `tool_resolution.py:184-188`). The tests assert on `RuntimeError` + a message substring
  (`test_resolve_tools_http.py:43,89,97,111`).
- **Proposal: Small change, worth doing.** This is the clearest convention miss. The
  service already imports from the SDK and the SDK already has `errors.py`. Define a small
  typed error there, for example `ToolResolutionError(RuntimeError)` carrying structured
  context (the failing ref count, the HTTP status), and raise it in `tools.py` instead of
  four bare `RuntimeError`s. It subclasses `RuntimeError`, so the existing
  `pytest.raises(RuntimeError, ...)` tests still pass, and callers can catch narrowly. Keep
  it in the SDK `errors.py` next to `UnsupportedHarnessError`, since the failure is about
  tool resolution (an SDK concept) and the service is the caller. Caveat: the service is not
  a FastAPI router with an `@intercept_exceptions` boundary the way `api/` is; it runs inside
  `ag.workflow`. So this is about *type clarity and structured context*, not about HTTP
  mapping. Do not over-engineer a full hierarchy; one typed error is enough today.

### 10. Module exports / `__init__.py`

- **House pattern.** The agents `__init__.py` curates `__all__` with `#` section comments
  grouping DTOs, the UI codec, tool definitions, resolution, ports, errors, adapters
  (`__init__.py:73-128`).
- **Current state.** The new tool exports are grouped under two labelled sections: "Tool
  definitions (the neutral tool vocabulary)" and "Local tool resolution (offline; secrets
  pluggable, env by default)" (`__init__.py:97-111`). Every new name (`AgentToolDef`,
  `LocalToolResolver`, `SecretResolver`, `EnvSecretResolver`, `ResolvedTools`, the parsers)
  is exported.
- **Proposal: Keep.** The exports are consistent with the file's own pattern, the section
  comments are accurate, and the grouping reads well.

### 11. Tests

- **House pattern.** Unit vs integration split by directory; network/gateway behind
  `pytest.mark.integration`; module docstrings naming what is locked.
- **Current state.** Clean. Unit tool tests sit in
  `sdks/python/oss/tests/pytest/unit/agents/test_tool_defs.py` and `test_tool_resolution.py`
  and in `services/oss/tests/pytest/unit/agent/test_tool_refs.py`. The gateway HTTP path is
  isolated in `services/oss/tests/pytest/integration/agent/test_resolve_tools_http.py` with
  `pytestmark = pytest.mark.integration` (`:19`). Fixtures follow the package style: a small
  in-test `SecretResolver` subclass `_DictSecrets` (`test_tool_resolution.py:21-28`), and an
  `install_http` fixture for the integration mock. Each test module opens with a docstring
  (`test_tool_resolution.py:1-8`, `test_tool_refs.py:1-8`).
- **Proposal: Keep.** This dimension is exemplary. The offline/online split mirrors the
  code's own offline/gateway split, the fixtures use the real ABCs, and the docstrings make
  each file self-explaining. One tiny note: `test_tool_refs.py` imports the private
  `_gateway_ref` (`test_tool_refs.py:15`); testing a private is fine here since it is the
  unit under test, but flag it so nobody "fixes" it by exporting the symbol.

## Prioritized recommendation

What a CTO would push on, highest leverage and lowest risk first. Be honest: most of this
code is already right.

1. **Make `ResolvedTools` a Pydantic `BaseModel`.** One-line change. Removes the only
   `@dataclass` in a Pydantic package and matches `api/AGENTS.md`'s typed-DTO rule. Do now.
2. **Replace the bare `RuntimeError`s in `services/oss/src/agent/tools.py` with one typed
   error** (`ToolResolutionError(RuntimeError)` in the SDK `errors.py`) carrying structured
   context. Subclassing `RuntimeError` keeps the existing tests green. Do now.
3. **Have the service `resolve_tools` return the `ResolvedTools` model instead of a
   3-tuple.** This kills the tuple anti-pattern (`api/AGENTS.md:341-344`) and the
   field-by-field unpack in `app.py`. Depends on item 1. Do next.
4. **Defer: typed wire specs with `to_wire()`.** Real consistency win, but the wire shape is
   shared three ways and pinned by golden tests; the payoff today is aesthetic. Revisit when
   the tool wire shape grows.
5. **Defer / optional: keyword-only on the free spec builders, and lifting `SecretResolver`
   into `interfaces.py`.** Both are parity polish. Do them only as part of a deliberate
   sweep or when a second `SecretResolver` consumer lands.

Everything else (file placement, file names, class names, function structure, docstrings,
variable naming, exports, tests) already matches the layer's conventions. Leave it alone.
