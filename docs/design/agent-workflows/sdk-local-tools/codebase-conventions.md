# Codebase conventions learned

This is a fresh repository review. It records observed patterns and distinguishes the
patterns worth following from legacy or inconsistent code that should not become precedent.

## Organization

- Growing backend domains are directories, not a sequence of suffixed files.
  `api/oss/src/core/tools/` uses `dtos.py`, `interfaces.py`, `service.py`, `registry.py`,
  `exceptions.py`, and provider subpackages.
- The SDK also nests substantial subsystems. `sdks/python/agenta/sdk/engines/running/`
  contains interfaces, registries, handlers, runners, errors, templates, and sandbox logic.
- `sdks/python/agenta/sdk/evaluations/runtime/` is a particularly relevant shared-runtime
  package. API core imports those SDK model classes directly from
  `api/oss/src/core/evaluations/runtime/types.py` and defines only API-specific additions.
- Small composition areas remain flat. `services/oss/src/agent/` has one file per concern:
  `app.py`, `client.py`, `config.py`, `schemas.py`, `secrets.py`, `tools.py`, `tracing.py`.
- Tests are organized by runner, test boundary, then domain. Unit tests do not require a
  running backend; HTTP adapter behavior belongs in integration tests.
- `__init__.py` is generally used as a curated import surface, while implementations remain
  in role-specific modules.

## File naming

- Common role names in maintained API core domains are `dtos.py`, `interfaces.py`,
  `service.py`, `types.py`, `utils.py`, and `exceptions.py`.
- Semantic names are preferable when the role is clearer than a generic bucket:
  `streaming.py`, `registry.py`, `delivery.py`, `context.py`, `mappings.py`.
- Abbreviations such as `defs` are uncommon as file-role names and do not identify whether
  values are configuration, DTOs, schemas, or runtime specifications.
- `utils.py` exists widely but often becomes a mixed bucket. New code should use a semantic
  filename when one is available.
- A domain-qualified generic filename can be clear (`tools/registry.py`); the same generic
  filename at a broad level (`agents/tool_resolution.py`) tends to accumulate unrelated
  concerns.

## Class naming

- Pydantic classes are nouns that describe their lifecycle or API role:
  `ToolConnectionCreate`, `ToolExecutionRequest`, `WorkflowRevisionData`,
  `HarnessAgentConfig`.
- Abstract contracts use both plain domain names in the SDK (`Backend`, `Harness`,
  `Session`) and `*Interface` in API core (`ToolsDAOInterface`,
  `ToolsGatewayInterface`). Consistency within one subsystem matters more than copying one
  suffix globally.
- Implementations identify their mechanism or provider:
  `InProcessPiBackend`, `SandboxAgentBackend`, `ToolsGatewayRegistry`.
- Domain exceptions generally end in `Error` and often inherit from a domain base, as in
  `ToolsError`, `EmbedError`, and `UnsupportedHarnessError`.
- The codebase usually capitalizes well-known acronyms in class names (`API`, `LLM`), though
  there are mixed conventions for newer acronyms. A subsystem should choose one spelling
  deliberately and keep it consistent.

## Function and method naming

- Functions use verb-first snake_case names: `resolve_json_pointer`,
  `create_connection`, `list_integrations`, `make_oauth_state`.
- Async methods generally use the same domain verb as sync behavior. Some older SDK modules
  use `a*` prefixes such as `acreate`; this is legacy style and should not be copied into the
  new agent runtime.
- Boolean helpers read as predicates (`supports`, `is_active`, `is_valid`) or explicit
  questions (`_mcp_enabled`).
- Mapper functions are clearest when named for the conversion (`decode_oauth_state`,
  `_to_harness_config`). Generic verbs such as `attach` should name the data being attached.
- Private helpers use a leading underscore. A service importing another module's private or
  implementation helper usually indicates the package boundary is wrong.

## Function structure

- New API code prefers keyword-only parameters using `*`.
- Long signatures and calls use visual grouping with `#` separators in API core.
- Services orchestrate dependencies; pure conversion belongs in focused helpers or mapping
  modules.
- Adapters own provider-specific behavior. Core orchestration depends on interfaces rather
  than concrete HTTP or database implementations.
- Constructors receive dependencies explicitly. `ToolsService` receives its DAO and adapter
  registry; agent `Environment` receives a backend.
- Return contracts are typed models when they cross layers. Positional tuples are used in
  places but are less extensible and less self-documenting.
- Mutating a result model after construction is not a dominant pattern for domain results;
  constructing a complete return value is clearer.

## Variables

- Domain-specific names are preferred at boundaries: `project_id`, `provider_key`,
  `integration_key`, `connection_create`.
- Short names such as `p`, `out`, `defs`, `entry`, and `values` appear in implementation
  code but are weaker choices when the value crosses several stages.
- Names should preserve lifecycle: `tool_config`, `tool_spec`, `secret_names`,
  `secret_values`, and `resolved_tools`.
- Wire-specific camelCase is isolated to serialization or explicit wire dictionaries.
  Python domain fields remain snake_case.

## Models and DTOs

- API core keeps domain contracts in `dtos.py` or `types.py`; FastAPI request and response
  envelopes live in API-layer `models.py`.
- Database entities do not leak through service or router contracts.
- Discriminated Pydantic unions are already used for tool references and workflow data.
- Request, response, config, and resolved/runtime values are usually distinguishable by
  suffixes such as `Create`, `Request`, `Response`, `Config`, and `Data`.
- Reusing `Dict[str, Any]` for a stable cross-language contract weakens validation and makes
  drift harder to detect. Stable wire objects should have typed models and golden
  serialization tests.
- Canonical executable configuration should reject unexpected fields. Permissive legacy
  handling belongs in a named compatibility adapter.
- Mutable Pydantic defaults such as `items: List[...] = []` exist in older code. New models
  should use `Field(default_factory=list)` and `Field(default_factory=dict)`.

## Docstrings and comments

- The explicit API guidance says comments should explain non-obvious reasons, invariants,
  workarounds, or concurrency/security hazards, not narrate the code.
- Good public docstrings state the contract and important behavior in one paragraph.
- Module docstrings are useful for dependency boundaries and protocol ownership.
- Detailed architecture history, phased decisions, and product rationale belong in
  `docs/design/`, not in every source module.
- Section separators are common in large modules, but needing many sections can also be a
  signal that the file should become a package.
- Comments around secret isolation, callback reachability, and compatibility aliases are
  justified because they preserve security or backwards compatibility.

## Exceptions

- New API architecture defines domain exceptions in core and translates them at the API
  boundary.
- Domain bases allow broad and narrow handling (`ToolsError` and its subclasses).
- Useful exceptions carry structured fields such as provider, connection, status, or
  conflicting identifiers.
- `HTTPException` should not leak into core services or SDK runtime logic.
- Broad catches and best-effort behavior exist for cleanup and optional telemetry. They are
  appropriate only when failure is intentionally non-fatal.
- Broad catches around required configuration, tool resolution, or declared secrets can
  hide correctness failures and need an explicit policy.
- Raising generic `RuntimeError` while a typed domain error exists is inconsistent and loses
  machine-readable context.

## Dependency direction

- API routing depends on core services; core services depend on interfaces; adapters
  implement those interfaces.
- The agent service already depends on SDK runtime contracts. The SDK must not import the
  service.
- The TypeScript runner consumes resolved runtime specs; it should not understand loose
  playground compatibility shapes.
- Compatibility parsing should happen once, before resolution.
- HTTP gateway resolution and vault access are adapters, not properties of the tool models.
- When the SDK owns neutral runtime models, API code can import the same classes rather than
  maintaining a parallel union.

## Testing

- SDK unit tests should cover parsing, pure mapping, policy, and serialization without a
  backend.
- Service integration tests should cover HTTP status handling, authentication headers,
  malformed responses, and timeouts.
- Golden files are already used for the Python-to-TypeScript runner contract and are the
  right mechanism for tool-spec drift.
- Tests should be named for behavior, not internal helper names, when possible.
- Security behavior needs direct tests: secret scoping, missing-secret handling, redaction,
  and no ambient environment leakage.
- Correlation and identity behavior also needs tests: duplicate names, built-in/custom
  collisions, and provider responses returned in a different order.

## Strong patterns to copy

- `api/oss/src/core/tools/`: explicit domain roles and typed exceptions.
- `sdks/python/agenta/sdk/agents/interfaces.py` plus `agents/adapters/`: ports separated from
  implementations.
- `sdks/python/agenta/sdk/engines/running/`: nested SDK subsystem with role-specific files.
- `sdks/python/agenta/sdk/evaluations/runtime/`: SDK-owned neutral runtime contracts reused
  directly by API core.
- `api/oss/src/dbs/postgres/*/mappings.py`: conversions isolated from persistence and
  services.
- `agents/utils/wire.py` plus TypeScript protocol golden tests: one explicit cross-language
  boundary.

## Patterns to avoid treating as precedent

- Very large multipurpose modules such as `agents/dtos.py` and API
  `core/tools/service.py`.
- Legacy SDK async naming with `a*` prefixes.
- `except:` or broad `except Exception` followed by `print`.
- Generic `utils.py` files that contain unrelated domain behavior.
- Silent coercion or dropping as the sole parsing contract.
- Mutable collection defaults in Pydantic models.
- Comments that restate the following code.

## Practical standard for this feature

For local tools, the repository evidence supports:

- one `agents/tools/` domain package.
- lifecycle-specific names (`Config`, `Spec`, `ResolvedToolSet`).
- explicit interfaces for injected secret and gateway dependencies.
- typed domain errors.
- strict default behavior with separately named compatibility behavior.
- pure private mapping helpers.
- one runner serialization boundary.
- tests split by parsing, resolution, secrets, gateway HTTP, and wire contract.
- a sibling MCP package only when MCP is an actual supported subsystem.
