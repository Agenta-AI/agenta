# Tools code organization proposal

> Implemented on 2026-06-19. The package, naming, validation, service-adapter, MCP,
> API-model-sharing, test-organization, and runner-file recommendations below are now reflected
> in the working tree.

## Recommendation

Do not keep growing `agents/tool_defs.py` and `agents/tool_resolution.py`.

Move the SDK-owned tool runtime into a small `agents/tools/` package, name declarative
objects `*Config`, name runnable objects `*Spec`, keep compatibility parsing separate from
resolution, and make unsupported tools and missing secrets explicit policy decisions rather
than silent skips.

Keep MCP out of that package while MCP remains out of release scope. Either remove the
dormant MCP flow from this slice or place it in a sibling `agents/mcp/` package with its own
capability and rollout decisions.

This is an organization and naming proposal. It does not require changing the persisted
discriminator values (`builtin`, `gateway`, `code`, `client`) or the runner wire keys in the
first refactor.

## Pre-refactor inventory

### Python SDK

The local-tools implementation currently lives in:

- `sdks/python/agenta/sdk/agents/tool_defs.py`
  - Pydantic tool-definition models.
  - MCP server model.
  - compatibility parsing for loose and legacy config shapes.
- `sdks/python/agenta/sdk/agents/tool_resolution.py`
  - secret-source interface and environment implementation.
  - config-to-wire mapping.
  - local resolution orchestration.
  - gateway skip policy.
  - MCP feature-gate policy.
- `sdks/python/agenta/sdk/agents/dtos.py`
  - raw `AgentConfig.tools` and `AgentConfig.mcp_servers`.
  - resolved tool fields on `SessionConfig`.
  - harness-facing tool and MCP delivery fields.
- `sdks/python/agenta/sdk/agents/errors.py`
  - `ToolResolutionError`, currently not used by the resolver or service gateway path.
- `sdks/python/agenta/sdk/agents/adapters/harnesses.py`
  - maps already-resolved tool specs into harness configuration.
- `sdks/python/agenta/sdk/agents/utils/wire.py`
  - serializes harness configuration to the TypeScript runner contract.
- `sdks/python/agenta/sdk/utils/types.py`
  - imports the tool models to generate the editable agent-config schema.
- `sdks/python/agenta/sdk/agents/__init__.py`
  - re-exports most tool models, parsers, resolvers, and secret interfaces.

SDK tests currently live in:

- `sdks/python/oss/tests/pytest/unit/agents/test_tool_defs.py`
- `sdks/python/oss/tests/pytest/unit/agents/test_tool_resolution.py`
- `sdks/python/oss/tests/pytest/unit/agents/test_wire_contract.py`

### Python agent service

Server-side composition currently lives in:

- `services/oss/src/agent/tools.py`
  - partitions gateway and locally derivable tools.
  - implements the HTTP gateway resolver.
  - adapts gateway responses to the runner wire shape.
  - provides the vault-backed secret resolver.
  - reads the MCP feature flag.
- `services/oss/src/agent/secrets.py`
  - resolves model-provider keys.
  - resolves named tool secrets through the future vault consumer endpoint.
- `services/oss/src/agent/app.py`
  - calls the resolvers and fills `SessionConfig`.

Service tests currently live in:

- `services/oss/tests/pytest/unit/agent/test_tool_refs.py`
- `services/oss/tests/pytest/integration/agent/test_resolve_tools_http.py`
- `services/oss/tests/pytest/integration/agent/test_resolve_secrets_http.py`

### TypeScript runner

Runtime execution lives in:

- `services/agent/src/protocol.ts`
  - runner wire types, including `ResolvedToolSpec` and `McpServerConfig`.
- `services/agent/src/tools/execute.ts`
  - dispatches resolved tools by executor kind.
- `services/agent/src/tools/code.ts`
  - code-tool subprocess execution and environment isolation.
- `services/agent/src/tools/callback.ts`
  - calls the Agenta callback endpoint; despite the filename, this is not a client-fulfilled
    tool implementation.
- `services/agent/src/tools/relay.ts`
  - file relay for callbacks from isolated sandboxes.
- `services/agent/src/tools/mcp-server.ts`
  - exposes resolved tools through MCP.
- `services/agent/src/tools/mcp-bridge.ts`
  - MCP transport bridge.

Runner tests live in `services/agent/test/`, notably `tool-dispatch.test.ts`,
`tool-bridge.test.ts`, and `mcp-servers.test.ts`.

### Platform API

The existing platform tools domain is already organized as a package:

- `api/oss/src/apis/fastapi/tools/` - HTTP models, router, boundary parsing.
- `api/oss/src/core/tools/` - DTOs, interfaces, service, registry, exceptions, providers.
- `api/oss/src/dbs/postgres/tools/` - database entities, mappings, DAO.

This domain covers the platform catalog, provider connections, and remote execution. It is
related to, but not identical to, the SDK runtime-tool concern.

## Problems in the current SDK shape

### The files are split by chronology, not responsibility

`tool_defs.py` means “the first tool file” and `tool_resolution.py` means “everything added
after parsing.” The latter currently owns interfaces, an implementation, pure mappers,
orchestration, logging behavior, unsupported-tool policy, and MCP rollout policy.

Those concerns change for different reasons and should not share one module.

### `Def` does not explain the lifecycle stage

The important distinction is:

- configuration: persisted, declarative, may contain compatibility shapes.
- runtime specification: validated and ready for the runner.

`BuiltinToolDef` and `AgentToolDef` do not communicate that distinction. `*Config` and
`*Spec` do.

### “Local” is already inaccurate

`LocalToolResolver` is used by the service with `_VaultSecretResolver`, which performs an
HTTP-backed secret lookup. The class really resolves the locally derivable tool kinds; it
does not guarantee that all dependencies are local.

### Untyped dictionaries erase the contract

`custom_tools: List[Dict[str, Any]]` and helper return values such as
`code_tool_spec(...) -> Dict[str, Any]` make required fields, executor-specific fields, and
snake_case-to-camelCase conversion implicit.

The TypeScript side already has `ResolvedToolSpec`. Python should have the matching typed
model and serialize aliases at the wire boundary.

### The canonical tool configuration is duplicated

The SDK defines `AgentToolDef`; API core separately defines `AgentToolReference`,
`AgentBuiltinTool`, and `AgentComposioTool`. Their discriminators and supported variants
already differ.

The evaluations runtime demonstrates the preferred precedent:
`api/oss/src/core/evaluations/runtime/types.py` imports the SDK runtime classes directly and
defines only API-specific additions. The platform tools API should reuse the SDK-owned
neutral tool config and keep only catalog, connection, and provider-execution DTOs in API
core.

### Parsing failures are silent

`parse_tool_def` catches `ValidationError` and returns `None`. `parse_tool_defs` then drops
the entry. This is useful for a narrow compatibility adapter, but unsafe as the default
runtime behavior: a configured tool can disappear without telling the caller which entry
was invalid.

### Resolution policy is hidden inside mechanics

Current policy choices are embedded in implementation:

- gateway tools are logged and skipped offline.
- missing named secrets are omitted.
- MCP declarations become an empty list when a flag is off.
- unsupported gateway providers are logged and skipped.

These affect correctness and security. They need typed errors or explicit policy arguments.

### MCP is a sibling concept but is folded into one resolver result

The config itself treats `mcp_servers` as a sibling of `tools`, but `ResolvedTools` and
`LocalToolResolver` own both. Feature gating also happens during resolution even though the
actual constraint is a harness/backend execution capability.

### Public and private surfaces are unclear

The top-level `agenta.sdk.agents` package exports models, parsers, resolvers, and secret
interfaces together. The service imports `attach_orthogonal` from the implementation module.
That helper is an internal mapper, not an SDK concept.

### Gateway correlation depends on position

Gateway results are correlated back to requested tool configs with positional `zip`. Count
validation prevents truncation, but it does not prove that the backend preserved ordering.
The API contract should return a stable request reference or correlation ID and the adapter
should match on it.

### Tool-name collision behavior is unspecified

There is no visible validation for duplicate custom-tool names or collisions between a
built-in and a custom tool. The runner eventually registers tools by name, so the resolver
must define whether collisions are invalid, first-wins, or last-wins. Silent runner-level
overwriting is not an acceptable contract.

### Source docstrings contain temporary design history

The new modules contain release phases, plan decisions, and extensive architecture rationale.
That material will become stale. Source docstrings should state ownership and runtime
contracts; this design workspace should retain the history and tradeoffs.

## Repository parallels to follow

| Concern | Existing parallel | Lesson |
| --- | --- | --- |
| Domain package | `api/oss/src/core/tools/` | Split a growing domain by role instead of adding suffixed flat files. |
| Contracts and adapters | `sdks/python/agenta/sdk/agents/interfaces.py` + `adapters/` | Keep abstract dependencies separate from concrete implementations. |
| Nested subsystem | `sdks/python/agenta/sdk/engines/running/` | A domain inside the SDK can justify its own package and curated exports. |
| SDK-owned shared runtime | `sdks/python/agenta/sdk/evaluations/runtime/` + `api/oss/src/core/evaluations/runtime/types.py` | Define neutral runtime models once in the SDK; API code imports the same classes and adds only API-specific contracts. |
| Typed domain errors | `api/oss/src/core/tools/exceptions.py`, `agents/errors.py` | Raise domain errors with structured context; translate them at boundaries. |
| Registry/dispatch | `core/tools/registry.py`, `engines/running/registry.py` | Use a registry only when multiple implementations exist; do not begin with conditionals spread across callers. |
| Wire contract | `agents/utils/wire.py` + `services/agent/src/protocol.ts` | Keep Python names idiomatic and perform camelCase serialization at one boundary. |
| Tests by boundary | `docs/designs/testing/testing.structure.specs.md` | Keep pure parsing/resolution tests in SDK unit tests and HTTP gateway behavior in service integration tests. |

Patterns not worth copying include the 622-line `agents/dtos.py`, the 569-line API
`core/tools/service.py`, broad `utils.py` modules, and legacy SDK modules that print HTTP
errors or catch exceptions without a domain contract.

## Proposed SDK package

```text
sdks/python/agenta/sdk/agents/tools/
  __init__.py
  models.py
  interfaces.py
  parsing.py
  compat.py
  resolver.py
  wire.py
  errors.py
```

### `models.py`

Own declarative config and resolved runtime models:

- `ToolConfigBase`
- `BuiltinToolConfig`
- `GatewayToolConfig`
- `CodeToolConfig`
- `ClientToolConfig`
- `ToolConfig` - discriminated union.
- `CallbackToolSpec`
- `CodeToolSpec`
- `ClientToolSpec`
- `ToolSpec` - discriminated union for the runner-facing contract.
- `ResolvedToolSet`

Keep persisted discriminator values unchanged. Use Pydantic aliases for runner keys such as
`inputSchema`, `callRef`, and `needsApproval`.

Canonical models should use `ConfigDict(extra="forbid")`. Compatibility belongs before
model validation, not in permissive canonical models.

MCP types do not belong here while MCP is out of scope. If retained, place them under a
sibling `agents/mcp/` package:

```text
sdks/python/agenta/sdk/agents/mcp/
  __init__.py
  models.py
  interfaces.py
  resolver.py
  errors.py
```

### `parsing.py`

Own strict conversion from already-supported mappings into canonical models:

- `parse_tool_config`
- `parse_tool_configs`

Raise `ToolConfigError` with the item index and Pydantic cause. It should never silently
drop executable configuration.

### `compat.py`

Own old playground and persisted payload shapes:

- bare built-in names.
- `{"name": ...}` built-ins.
- the legacy `composio` discriminator.
- OpenAI function-picker gateway slugs.

Return canonical `ToolConfig` values plus structured diagnostics. Callers may select strict
or best-effort compatibility behavior explicitly; best-effort must not be the only API.

### `interfaces.py`

Own narrow injected dependencies:

```python
class ToolSecretProvider(Protocol):
    async def get_many(self, names: Sequence[str]) -> Mapping[str, str]: ...


class GatewayToolResolver(Protocol):
    async def resolve(
        self,
        tools: Sequence[GatewayToolConfig],
    ) -> GatewayToolResolution: ...
```

`ToolSecretProvider` is intentionally scoped. A generic `SecretResolver` name collides with
provider credentials, vault management, and other SDK secret concepts.

### `resolver.py`

Own one orchestration path:

```python
class ToolResolver:
    def __init__(
        self,
        *,
        secret_provider: ToolSecretProvider,
        gateway_resolver: GatewayToolResolver | None = None,
        missing_secret_policy: MissingSecretPolicy = MissingSecretPolicy.ERROR,
    ) -> None: ...

    async def resolve(
        self,
        tool_configs: Sequence[ToolConfig],
    ) -> ResolvedToolSet: ...
```

The resolver should:

1. partition configs by kind.
2. collect declared secret names once.
3. fetch secrets once.
4. build typed specs with small private pure functions.
5. invoke the injected gateway resolver when gateway tools exist.
6. return a newly constructed immutable result.

It should not parse raw payloads, read feature flags, silently skip unsupported kinds, or
mutate the result after construction.

The environment implementation can live here while it remains tiny:

- `EnvironmentToolSecretProvider`

Move it to `secrets.py` only if a second built-in implementation appears.

### `wire.py`

Own the one conversion from typed, snake_case Python models to the TypeScript runner
contract. Harness adapters should consume typed specs and should not normalize arbitrary
dictionaries.

### `errors.py`

Use one domain base with structured context:

- `ToolError`
- `ToolConfigError`
- `ToolResolutionError`
- `UnsupportedToolProviderError`
- `GatewayToolResolutionError`
- `MissingToolSecretError`

HTTP status and response excerpts belong on the service adapter error or as structured cause
context, not as generic `RuntimeError` strings in SDK orchestration.

### `__init__.py`

Export the intended public SDK:

- config models.
- `ToolResolver`.
- resolver/provider protocols intended for user extension.
- domain errors.

Do not export private mappers or compatibility-only helpers from `agenta.sdk.agents`.

## Naming proposal

| Current | Proposed | Reason |
| --- | --- | --- |
| `AgentToolDef` | `ToolConfig` | It is persisted declarative configuration, not an arbitrary definition. |
| `_ToolDefBase` | `ToolConfigBase` | Names the lifecycle stage. Keep private if users never instantiate it. |
| `BuiltinToolDef` | `BuiltinToolConfig` | Distinguishes config from resolved spec. |
| `GatewayToolDef` | `GatewayToolConfig` | Same distinction; keep the discriminator value stable. |
| `CodeToolDef` | `CodeToolConfig` | Same distinction. |
| `ClientToolDef` | `ClientToolConfig` | Same distinction. |
| `McpServer` | `MCPServerConfig` | It is configuration, not a running server. Matches repository acronym style (`API`, `LLM`). |
| `ResolvedTools` | `ResolvedToolSet` | Communicates an aggregate value, not a resolver action. |
| `SecretResolver` | `ToolSecretProvider` | Narrows scope and describes an injected source. |
| `EnvSecretResolver` | `EnvironmentToolSecretProvider` | Explicit source and scope. |
| `LocalToolResolver` | `ToolResolver` | The resolver can use local or remote injected providers. |
| `parse_tool_def(s)` | `parse_tool_config(s)` | Matches the renamed model and avoids abbreviation. |
| `attach_orthogonal` | `_apply_tool_metadata` | “Orthogonal” describes a design argument, not the function's behavior. |
| `code_tool_spec` | `_build_code_tool_spec` | Verb-first private mapper. |
| `client_tool_spec` | `_build_client_tool_spec` | Verb-first private mapper. |
| `mcp_server_spec` | `_build_mcp_server_spec` | Verb-first private mapper. |
| `defs` | `tool_configs` | Avoid unexplained abbreviation. |
| `entry` | `tool_spec` | Name the actual value. |
| `values` | `secret_values` | Name the domain content. |
| `custom_tools` internally | `tool_specs` | Keep `customTools` only as the legacy wire field name. |
| `builtins` internally | `builtin_names` | Distinguishes names from built-in config objects. |

Use `McpServerConfig` instead of `MCPServerConfig` only if cross-language spelling is
prioritized over the Python codebase's existing acronym convention. Pick one spelling and
apply it in Python docs, schema titles, and tests.

## Function and file structure

### Functions

- Use keyword-only parameters when a function has multiple same-shaped values.
- Keep parsing, resolution, mapping, and I/O in separate functions.
- Keep mapper helpers private and pure.
- Construct return objects once; avoid assigning fields after creation.
- Use one clear noun per variable: `tool_config`, `tool_spec`, `secret_names`,
  `secret_values`, `gateway_tools`.
- Do not expose an internal `resolve_defs` method solely so the service can bypass another
  public method. Inject the gateway implementation into the same resolver.
- Validate duplicate resolved names and built-in/custom collisions before returning.

### Docstrings and comments

The current modules read partly like design documents. Follow the repository's API comment
guidance:

- module docstring: purpose and dependency boundary in a few lines.
- public class/function docstring: contract, important policy, raised errors.
- no docstring for obvious Pydantic data containers.
- comments explain security constraints or compatibility reasons, not the next line of code.
- keep architecture rationale in this design folder.

### Exceptions

- Core SDK code raises tool-domain exceptions.
- The service gateway adapter wraps `httpx` errors as `GatewayToolResolutionError`.
- HTTP route code translates domain errors to HTTP responses.
- Runner execution failures remain tool-result failures when the model loop is expected to
  continue.
- Missing declared secrets should fail before tool execution by default. A best-effort mode
  can exist for backward compatibility, but it must be explicit and tested.
- Gateway results should correlate by stable ID/reference, not response position.

## Service-side proposal

Use a service-side adapter package. The current file already contains composition, gateway
HTTP, vault adaptation, and rollout policy:

```text
services/oss/src/agent/
  tools/
    __init__.py  # curated service entry point
    resolver.py  # build the SDK ToolResolver for one request
    gateway.py   # Agenta HTTP GatewayToolResolver
    secrets.py   # VaultToolSecretProvider
  secrets.py     # model-provider/harness secrets only
  client.py      # shared Agenta HTTP client configuration
```

Move `_VaultSecretResolver` to `tools/secrets.py` and rename it
`VaultToolSecretProvider`.

Return `ResolvedToolSet` from service resolution instead of a three-item tuple. This removes
positional unpacking from `app.py` and makes future additions non-breaking.

Feature flags should be read in the service composition/config layer. MCP capability checks
belong in harness/backend selection or delivery, not in the generic tool resolver.

## TypeScript proposal

The TypeScript runner already has the clearest tool directory. Keep that structure, with two
targeted naming fixes:

- rename `tools/execute.ts` to `tools/dispatch.ts`; the module selects an executor, while
  `code.ts` performs execution.
- keep the callback adapter named `tools/callback.ts`; “client” is confused with the
  `kind: "client"` tool that the browser fulfils.

Keep wire types in `protocol.ts` until the protocol itself is split. Moving only tool types
would create cross-file protocol ownership without enough benefit.

## Test organization proposal

Once the SDK source becomes a package, mirror the domain:

```text
sdks/python/oss/tests/pytest/unit/agents/tools/
  test_models.py
  test_parsing.py
  test_resolution.py
  test_secrets.py
```

Service tests should separate pure composition from network behavior:

```text
services/oss/tests/pytest/unit/agent/tools/
  test_resolution.py
  test_gateway_mapping.py

services/oss/tests/pytest/integration/agent/tools/
  test_gateway_http.py
  test_vault_secrets_http.py
```

Tests should assert:

- strict invalid-config errors include the failing index and cause.
- compatibility parsing reports dropped entries.
- canonical models reject unexpected fields.
- declared missing secrets follow the selected policy.
- unsupported gateway providers raise a typed error.
- gateway count mismatches and incomplete responses retain structured context.
- gateway responses are matched by stable correlation value rather than position.
- duplicate tool names and built-in/custom collisions have a deterministic error.
- no secret value appears in logs or exception messages.
- Python typed specs serialize exactly to the TypeScript golden wire contract.

## Migration plan

### Phase 1: package-only refactor

- Add `agents/tools/`.
- Move code without changing persisted values or wire output.
- Keep temporary imports from `tool_defs.py` and `tool_resolution.py` that emit deprecation
  warnings only if these modules have shipped publicly.
- Update internal imports to the new package.
- Reuse SDK tool-config models from API core and remove the duplicate API agent-tool union
  only after API compatibility tests are in place.

### Phase 2: type the resolved contract

- Add `ToolSpec` variants and `ResolvedToolSet`.
- Serialize runner aliases in one place.
- Replace `List[Dict[str, Any]]` and tuple returns.

### Phase 3: make policy explicit

- Add strict parsing and diagnostics.
- Add missing-secret policy.
- Raise typed errors for unsupported gateway configuration.
- Add duplicate-name and collision validation.
- Remove silent skip behavior from the default path.

### Phase 4: simplify service composition

- Inject `VaultToolSecretProvider` and the HTTP gateway resolver.
- Remove `resolve_defs` and internal mapper imports.
- Move feature-gate reads to composition.

### Phase 5: isolate or defer MCP

- Remove MCP from the tool resolver while it is disabled.
- If implementation must remain, move it to `agents/mcp/` and give it independent capability
  checks and tests.

### Phase 6: optional runner rename

- Rename TypeScript dispatch/callback files in a separate mechanical change.

## Likely CTO review questions

1. Which layer is the source of truth for tool configuration: SDK, API core, or runner
   protocol?
2. Why are API `AgentToolReference`, SDK `ToolConfig`, and TypeScript
   `ResolvedToolSpec` separate, and where is each conversion tested?
3. Why can an invalid configured tool disappear silently?
4. Why does an offline resolver silently skip a gateway tool instead of failing the run?
5. Why can a code tool execute when a declared secret is missing?
6. Why is a class named `LocalToolResolver` used with an HTTP vault dependency?
7. Why are runnable specs dictionaries instead of a discriminated model?
8. Why is MCP feature policy inside resolution when MCP support is a runtime capability?
9. Why is MCP grouped into `ResolvedTools` when the config calls it a sibling?
10. Which names are public API, and what is the compatibility plan if they have shipped?
11. Why does the service import an internal mapping helper from the SDK?
12. Why does `ToolResolutionError` exist while production paths raise `RuntimeError`?
13. Can secret values leak through logs, Pydantic reprs, exceptions, traces, or serialized
    session configuration?
14. Are gateway response ordering and one-to-one mapping guaranteed by a documented API
    contract?
15. What prevents Python and TypeScript tool specs from drifting?
16. Is the first PR a behavior change or an organization change, and can reviewers verify
    that distinction from tests?
17. Why do SDK and API core define different versions of the same agent-tool config?
18. How are duplicate names and built-in/custom collisions handled?
19. How is gateway response ordering guaranteed, and why is position an acceptable key?
20. Why is MCP implemented across config, resolution, wire, and runner while the feature is
    declared out of scope?

## Decision requested

Approve the package and lifecycle naming before adding more tool kinds:

- `agents/tools/`
- `*Config` for persisted declarations.
- `*Spec` for runnable contracts.
- `ToolResolver` with injected providers.
- typed errors and explicit policy.

If this is accepted, the next implementation PR should be a package-only refactor with no
wire or persisted-schema changes.
