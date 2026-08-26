# Research

What the code does today, with file and line references. Read this before changing a file
the plan names. Every reference was checked against `main` on 2026-08-26.

## 1. Python SDK: tool configuration

`sdks/python/agenta/sdk/agents/tools/models.py` is the source of truth for both the saved
configuration union and the runner-ready specification union. The API imports these classes
rather than defining its own.

| What | Where |
| --- | --- |
| `Permission = Literal["allow", "ask", "deny"]` | `models.py:25` |
| `PermissionMode` with `allow_reads` | `models.py:26` |
| `effective_permission(spec, read_only, mode)` | `models.py:51-61` |
| `ToolConfigBase`, `extra="forbid"`, `render`, `permission` | `models.py:64-75` |
| `GatewayToolConfig`, the legacy per-tool entry | `models.py:89-101` |
| Its five-segment `reference` property | `models.py:97-101` |
| The `ToolConfig` union and its adapter | `models.py:230-241` |
| `CallbackToolSpec` with `call_ref`, `context_bindings`, `ephemeral_args` | `models.py:336-391` |
| `ResolvedToolSet` with the `warnings` list | `models.py:436-462` |
| `GatewayToolResolution` | `models.py:465-471` |

`effective_permission` is the shared rule. Under `allow_reads` it returns `allow` only when
`read_only` is exactly `True`. Absent and `False` both return `ask`.

`ToolConfigBase` drops four deleted permission spellings before validation, at
`models.py:30-48`. Keep that behavior.

There is no `GatewayToolkitConfig` on `main`. It exists only on the superseded branch.

## 2. Python SDK: resolution

`sdks/python/agenta/sdk/agents/tools/resolver.py` splits the configuration list by type and
calls one adapter per family.

- The gateway branch is at `resolver.py:272-301`. It resolves one tool at a time on purpose.
- Only a 404 drops a single tool with a warning, at `resolver.py:284-295`. Any other failure
  raises, because a systemic failure would otherwise drop every tool silently.
- The warning text is built at `resolver.py:139-149`.
- Name checks run before any adapter call, at `resolver.py:117-131`, and again over the
  produced specifications at `resolver.py:133-136`.

`sdks/python/agenta/sdk/agents/platform/gateway.py` is the HTTP adapter.

- `_to_gateway_reference` builds the request entry at `gateway.py:94-104`.
- `resolve` posts `{"tools": references}` to `/tools/resolve` at `gateway.py:150-154`.
- It requires one returned specification per reference, at `gateway.py:196-204`.
- It matches responses back to configurations by the normalized call reference, at
  `gateway.py:214-230`.
- It builds each `CallbackToolSpec` at `gateway.py:250-261`, carrying `permission` from the
  configuration and `read_only` from the API.
- The single `ToolCallback` points at `{api}/tools/call`, at `gateway.py:265-268`.

The resolver deliberately keeps the callback assembled here. The comment at
`gateway.py:9-11` explains why.

## 3. Python SDK: the run wire

| What | Where |
| --- | --- |
| The agent-wide mode, default `allow_reads` | `dtos.py:728` |
| `wire_permissions`, the runner permission plan | `dtos.py:760-766` |
| `wire_tools`, per harness | `dtos.py:768-770` |
| The permitted permission modes | `dtos.py:118` |
| `customTools` on the wire model | `wire_models.py:509` |
| `toolCallback` | `wire_models.py:512` |
| `permissions` | `wire_models.py:517` |
| `WirePermissions.default`, default `allow_reads` | `wire_models.py:330` |
| `request_to_wire`, the payload builder | `utils/wire.py:137-173` |

The Python wire and `services/runner/src/protocol.ts` are hand-mirrored. The golden files
under `sdks/python/oss/tests/pytest/unit/agents/golden/` are the shared anchor. Adding a
top-level field means editing the golden file, `protocol.ts`, and the TypeScript key guard
together.

## 4. Python SDK: prompt assembly

`sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py` holds the forced prompt text.

- `AGENTA_PREAMBLE`, the instructions layer, at `agenta_builtins.py:47`.
- `AGENTA_FORCED_APPEND_SYSTEM`, the persona layer, at `agenta_builtins.py:62`.
- `_join` at `agenta_builtins.py:1121`.
- `compose_instructions(user)` at `agenta_builtins.py:1129`. It joins the preamble and the
  author's text, in that order.
- `compose_append_system(user)` at `agenta_builtins.py:1135`.
- `force_skills(skills)` at `agenta_builtins.py:1141`.

Consumed in `sdks/python/agenta/sdk/agents/adapters/harnesses.py` at `:152`, `:163`, and
`:168`.

Both existing layers are unconditional constants. The gateway guidance section is
conditional, so it needs a builder that returns nothing when the agent has no connection
entry. Tests in `test_harness_adapters.py` assert `startswith` against the constants at
`:167`, `:177`, and `:236`, so inserting a section between the preamble and the author's text
means updating those assertions.

Note the comment at `agenta_builtins.py:41`. Skill text and tool descriptions are read once
at import and must show one shape per deployment. Keep the new guidance section and the two
runtime tool descriptions consistent with each other.

## 5. API: the catalog

`api/oss/src/core/tools/providers/composio/catalog.py` reads the provider catalog over HTTP.
There is no cache in the adapter or the service. Caching lives in the router, keyed globally,
with a five-minute lifetime.

The action parser is at `catalog.py:382-405`. It reads the provider slug into a local
variable at `catalog.py:391`, strips the integration prefix at `catalog.py:392-397`, and then
returns a `ToolCatalogAction` at `catalog.py:399-405` that does not carry the slug. The
canonical ID is lost there.

`ToolCatalogAction` is at `api/oss/src/core/tools/dtos.py:51-66`, with `read_only` at
`dtos.py:61`. `ToolCatalogActionDetails` adds `schemas` and `scopes` at `dtos.py:64-66`. It
relists fields flat instead of extending, so a new field must be added in both places.

The provider slug is rebuilt by concatenation at
`api/oss/src/core/tools/providers/composio/adapter.py:304-311`, and used on both
`get_action` at `adapter.py:123-126` and `execute` at `adapter.py:171-174`.

There are three copies of the strip logic. The naive one at `catalog.py:392-397`, a dead copy
at `adapter.py:313-323`, and the correct longest-prefix version at
`api/oss/src/core/tools/discovery.py:78-104`. Only the third handles an overlapping pair such
as `slack` and `slackbot`. It is used on the search path, where results arrive as bare
provider slugs with no catalog row, so it must stay.

The only place a raw provider ID survives today is `DiscoveredTool.provider_action` at
`dtos.py:400-403`, and its own comment marks it as debug data, not an interface.

`api/oss/tests/pytest/unit/tools/test_composio_version_alignment.py` records a production
failure from this exact reconstruction.

## 6. API: the service

`api/oss/src/core/tools/service.py`.

| What | Where |
| --- | --- |
| `list_actions` | `service.py:148` |
| `get_action` | `service.py:171` |
| `execute_tool` | `service.py:318` |
| `resolve_connection_by_slug` | `service.py:345-398` |
| `resolve_tools` | `service.py:400` |
| `_resolve_composio_tool` | `service.py:432-481` |
| The five-segment call reference is built here | `service.py:470-473` |
| `discover_capabilities` | `service.py:487` |
| `_cached_search`, the search cache | `service.py:527-562` |
| Search reached by attribute lookup, not the port | `service.py:546-549` |

`resolve_connection_by_slug` is the single chokepoint for a connection. It checks presence at
`service.py:368-374`, active state at `:380-381`, validity at `:383-387`, and a missing
provider account at `:391-392`. Reuse it. Do not write a second one.

The derived connection properties live on the shared model at
`api/oss/src/core/gateway/connections/dtos.py:68-97`: `provider_connection_id`, `is_active`,
`is_valid`, and `has_auth`.

Resolution makes one provider round trip per configured tool, through `get_action`. That is
why the new arm returns a catalog slice instead.

## 7. API: search

`api/oss/src/core/tools/providers/composio/adapter.py:225-298` wraps
`COMPOSIO_SEARCH_TOOLS`. The payload is built at `adapter.py:238-244` and carries only
`queries` and `session`. There is no toolkit filter.

The adapter converts a provider-level failure that arrives as HTTP 200 with
`successful: false` into an error, at `adapter.py:274-281`. Keep that.

The response models are at `api/oss/src/core/tools/providers/composio/dtos.py:12-62`. The
pure translation helpers are in `api/oss/src/core/tools/discovery.py`, including
`split_composio_slug` at `discovery.py:78-104` and `translate_search_result`.

The search cache is at `service.py:527-562`. Its key is the provider plus the joined
use-case text, at `service.py:534-537`. Connection state is stripped before caching at
`service.py:556` and recomputed per call. The namespace is `tools:discover`, at
`service.py:58`.

`api/oss/tests/pytest/unit/tools/fixtures/composio_search_tools.json` is a recorded
response. `test_discovery.py` replays it and asserts the request path at `:79`.

## 8. API: the HTTP surface

`api/oss/src/apis/fastapi/tools/router.py` holds every endpoint. It is mounted at both
`/tools` and `/preview/tools`.

`/tools/resolve` is at `router.py:1097` and checks `VIEW_TOOLS`. Its request model is
`ToolResolveRequest` at `api/oss/src/apis/fastapi/tools/models.py:114-131`, which accepts only
builtin and gateway arms and says so at `models.py:130`. The response is
`ToolResolveResponse` at `models.py:134-137`, carrying `count`, `builtins`, and `custom`.
`ResolvedTool` is at `api/oss/src/core/tools/dtos.py:211-222`.

`/tools/call` is at `router.py:1159-1274`.

- `RUN_TOOLS` is checked at `router.py:1168-1174`.
- The reserved and workflow arms are routed at `router.py:1176-1187`.
- The five-segment parse is at `router.py:1190-1212`. It rejects anything that is not five
  dot-separated segments beginning with `tools`.
- Each segment is checked against a safe pattern at `router.py:1202-1207`.
- The connection is resolved at `router.py:1214-1226`.
- The Composio user ID is read from the stored connection at `router.py:1228-1233`.
- Arguments that arrive as a JSON string are normalized at `router.py:1235-1244`.

There is no include-list parser anywhere in the API. The grammar carries resource identity,
not a policy list.

`ToolCall` is at `api/oss/src/core/tools/dtos.py:152-155`. It holds only `data`. It is a plain
model without `extra="forbid"`, so an unexpected sibling is silently dropped rather than
refused.

Error handling has three systems. The adapter decorator at `router.py:101-148` maps provider
failures to 503, 404, 502, and 424. Domain failures are mapped inline, for `/tools/resolve`
at `router.py:1110-1119` and for `/tools/call` at `router.py:1221-1226`. Handler-mode
failures use the agent error envelope, `AgentError` at
`api/oss/src/core/tools/dtos.py:332-347`, returned inside HTTP 200 at `router.py:1331-1349`,
because the runner hides non-2xx bodies from the model. The new gateway routes use the third
system.

The exception classes are in `api/oss/src/core/tools/exceptions.py`. Two of them,
`ToolNotConnectedError` at `:141` and `ToolAmbiguousError` at `:149`, are defined and never
raised.

`api/oss/src/apis/fastapi/tools/utils.py` is unreferenced dead code. So are the empty stubs
under `api/oss/src/core/tools/providers/`.

The gateway port at `api/oss/src/core/tools/interfaces.py:15-69` declares six methods and
does not declare search.

## 9. Runner: permissions

`services/runner/src/protocol.ts` is the TypeScript half of the wire.

| What | Where |
| --- | --- |
| `PermissionMode`, `ToolPermission`, `PermissionsConfig` | `protocol.ts:95-107` |
| `ResolvedToolSpec`, including `contextBindings` and `ephemeralArgs` | `protocol.ts:125-175` |
| `ToolCallbackContext` | `protocol.ts:178-181` |
| `AgentRunRequest` | `protocol.ts:590-728` |
| `customTools` | `protocol.ts:657` |
| `toolCallback` | `protocol.ts:661` |
| `permissions` | `protocol.ts:663` |

`services/runner/src/public-spec.ts:40-50` whitelists the fields advertised to a harness. A
field added to `ResolvedToolSpec` is private by construction. A top-level field on
`AgentRunRequest` is also never advertised.

`services/runner/src/permission-plan.ts` is the enforcement core.

- The plan shape and the gate descriptor are at `permission-plan.ts:17-38`.
- `permissionsFromRequest` is at `permission-plan.ts:105-131`. The operator switch is at
  `permission-plan.ts:109-111`. It returns a plan with `default: "deny"` and no rules.
- `effectivePermission` is at `permission-plan.ts:133-144`. It reads the specification
  permission at `:137` and the server permission at `:138`, both before it reaches the plan
  default at `:143`. That is the ordering bug the design calls out.
- `decide` is at `permission-plan.ts:146-169`. A stored human decision is consulted only
  under `ask`, at `:155`.
- Rule matching picks the most restrictive match, at `permission-plan.ts:232-244`.
- `allow_reads` is applied at `permission-plan.ts:294-302`.
- The stored decision key shape is at `permission-plan.ts:178-197`.

The plan is built in two places, `run-plan.ts:559` and `run-turn.ts:596`. Both call
`permissionsFromRequest`, so one fix covers both.

The existing kill-switch test at `services/runner/tests/unit/permission-plan.test.ts:359-376`
asserts only the returned plan. It never builds a gate carrying an explicit permission, which
is why the hole is untested.

The harness never receives per-integration-tool rules. The SDK renders harness settings.
Claude settings are built in `sdks/python/agenta/sdk/agents/adapters/claude_settings.py`,
with per-tool rules at `:134-193` and the internal server name at `:60`. Codex settings
deliberately render no per-tool table, as the module docstring at
`sdks/python/agenta/sdk/agents/adapters/codex_settings.py:11-42` explains.

## 10. Runner: delivery paths

Every tool call reaches the runner by one of these paths.

| Path | Where the tools are listed | Where the gate runs |
| --- | --- | --- |
| Claude and Codex, local, loopback HTTP | `src/tools/tool-mcp-http.ts:130-153` | `tool-mcp-http.ts:216-238` |
| Claude and Codex, Daytona, in-sandbox shim | `src/tools/tool-mcp-stdio.ts:193-208` | no gate in the shim |
| Pi custom tools | `src/engines/sandbox_agent/extensions/agenta.ts:334-412` | `agenta.ts:376-395` |
| Pi built-ins | activated at `agenta.ts:234-240` | `agenta.ts:242-258` |
| Harness-native gates | not applicable | `acp-interactions.ts:590-704` |
| Client tools | `tool-mcp-http.ts:135-140` | three sub-paths |
| Relay file loop | not applicable | `src/tools/relay.ts:396-415` |

Every production execution funnels through the relay, because `runResolvedTool` prefers the
relay whenever a relay directory is set, at `src/tools/dispatch.ts:103-115`, and it is always
set. The single trusted execution seam is `executeAllowedRelayedTool` at
`src/tools/relay.ts:420-492`, and the single point where a result becomes a relay response is
its caller at `relay.ts:642-679`. Both run in the runner and hold the full private
specification. That is where the gateway gate and the search filter belong.

Do not hook the filter into `dispatch.ts`. On the Pi path that module runs inside the
sandbox.

The relay guard at `src/relay-guard.ts:93` returns allow for every non-Pi harness. Its own
comment at `relay-guard.ts:14-21` states the residual risk honestly. The gateway gate must not
depend on that guard.

## 11. Runner: the callback

`services/runner/src/tools/callback.ts:203-259` makes the HTTP call.

- Headers are built at `callback.ts:211-213`. The only out-of-band value today is
  `x-agenta-run-kind`.
- The body is built at `callback.ts:232-239`. It holds `data` and nothing else.
- The response is parsed at `callback.ts:261-276`. A business failure rides HTTP 200 with an
  error status and throws, at `callback.ts:319-331`.
- The result is capped at 100000 bytes at `callback.ts:333-339`. That cap is the only
  transformation applied to a tool result anywhere today.

Run context reaches the API only by being substituted into the arguments before the request,
through `applyContextBindings` at `relay.ts:481-483`. Values injected that way are
indistinguishable from model-written arguments once they arrive. That is the seam the private
`context` object replaces.

## 12. Runner: approval

`services/runner/src/engines/sandbox_agent/acp-interactions.ts`.

- `attachPermissionResponder` at `:202-229`.
- `pauseUserApproval` at `:260-306`. It emits the interaction request event at `:281-296` and
  pauses at `:305`.
- A pause sends no reply to the harness, ever. The reason is at `:254-259`.
- `replyPermission` at `:425-465`.
- `handleRequest` at `:590-704`.
- The interaction event ID is built at `:942-944`.

There are three distinct keys. The interaction token, built from the gate ID. The harness
tool-call ID. The cold-replay content anchor, `approvedCallKey` at
`services/runner/src/engines/sandbox_agent/responder.ts:70-81`, which is the tool name joined
with the canonical arguments. That third key is why the gateway approval identity must carry
the integration and the tool key. Two integration tools called through one coarse `run_tool`
name with the same arguments would otherwise share one stored approval.

The Sessions API calls are in `services/runner/src/sessions/interactions.ts`.
`createInteraction` posts to `/sessions/interactions/` at `:143`. `resolveInteraction` posts
to `/sessions/interactions/transition` at `:187`. Neither throws. Reuse both.

## 13. Frontend: the permission model

`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/toolPermission.ts`.

- `ToolPermission` is a three-value union at `toolPermission.ts:23`.
- `locateTemplate` tolerates both configuration shapes at `:42-48`.
- `matchToolIndex` matches a gate to an array index at `:55-77`.
- `findGrantableTool` at `:258-265`.
- `withToolPermission` at `:272-288`. It is pure, takes parameters in and returns parameters
  out, and returns nothing when the gate is not a tools entry.

`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/toolUtils.ts`.

- `parseGatewayTool` at `:48-67`. It hard-codes `type === "gateway"` at `:53` and returns
  nothing otherwise. Five call sites depend on it, so an unparsed entry disappears silently.
- `gatewayToolIdentity` at `:84-88`. It joins provider, integration, action, and connection,
  and deliberately excludes the permission.

Two encodings exist in saved revisions. The canonical one is
`{type: "gateway", provider, integration, action, connection, permission}`. The legacy one is
a function entry whose name is the five-segment slug, built by `buildGatewayToolSlug` at
`web/packages/agenta-shared/src/utils/toolSlug.ts:27-32`.

The only production writer of a gateway tool is the add drawer, and it writes the legacy
encoding. See section 15.

## 14. Frontend: the tools section

`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/ToolManagementList.tsx`.

- The partition is at `:284-319`. It preserves each tool's flat array index, because edit and
  remove address the array by index.
- Grouping is by integration, at `:298-307`.
- `GatewayProviderGroup` is at `:98-156`. The persisted expand state is at `:38-41` and
  `:121-128`. The per-group plus is at `:137-138`. The per-tool child rows are at `:141-153`.
- The collapsed rollup status is at `:69-96`.

The shared presentation primitives are in
`.../SchemaControls/sectionGroups.tsx`: `ProviderLogo` at `:29-41`, `SubSectionHeader` at
`:44-52`, and `CollapsibleProviderGroup` at `:58-150`. The trigger surfaces use them too, so
they must keep working.

Consumers that need updating with the row change are in `AgentTemplateControl.tsx` at
`:857-873` for the section content, `:865` for the drawer callback, `:855` for the count, and
`:603-690` for the tool status pipeline.

## 15. Frontend: the add drawer and the connect flow

`.../agentTemplate/AgentIntegrationDrawer.tsx`.

- Props at `:44-52`.
- The catalog hooks are adapted at `:94-126`.
- `item.readOnly` is mapped at `:258` and rendered as a chip at
  `.../drawers/shared/CatalogChooser.tsx:231-235`. It is display only. It does not gate
  adding and is not saved.
- The add path is at `:166-223`. It writes the legacy encoding at `:197-215`.
- A per-action schema fetch with two retries is at `:61-79`. The provider's single-action
  endpoint is unreliable, which is why the retry exists.
- The connect flow is rendered at `:269-282`.

`.../gatewayTool/drawers/ConnectDrawer.tsx` is the connect flow. Props at `:27-36`. It is a
default export. It creates the connection at `:103-111`, opens the provider popup with a
trusted-origin listener at `:115-175`, and invalidates the connection queries at `:91` and
`:113`.

`.../drawers/shared/CatalogChooser.tsx` is generic over integration, item, and connection. It
already holds the rail, the search, the multi-account switcher at `:330-424`, the reconnect
banner at `:839-867`, and the connect slot at `:1023-1027`. Reuse it.

## 16. Frontend: data hooks and the generated client

Connections are read through Jotai and TanStack Query, not SWR.
`web/packages/agenta-entities/src/gatewayTool/hooks/useToolConnectionsQuery.ts:8-32` holds
the atom and the hook. The key is at `:12`.

| Query | Key | File |
| --- | --- | --- |
| Project connections | `["tools","connections",projectId]` | `useToolConnectionsQuery.ts:12` |
| Catalog integrations | `["tools","catalog","integrations",...]` | `useToolCatalogIntegrations.ts:38-45` |
| Catalog actions | `["tools","catalog","actions",...]` | `useToolCatalogActions.ts:30` |
| Integration detail | `["tools","catalog","integrationDetail",...]` | `useToolIntegrationDetail.ts:14` |

Both catalog lists are infinite queries with a five-minute freshness window and a persister.
Integration search below three characters is ignored server-side, at
`useToolCatalogIntegrations.ts:32`, and the component mirrors that at `CatalogChooser.tsx:582`.

The HTTP wrappers are in `web/packages/agenta-entities/src/gatewayTool/api/api.ts`.

The generated client is `web/packages/agenta-api-client`, produced by Fern. Regenerate with
`bash ./clients/scripts/generate.sh --language typescript`. The script fetches the OpenAPI
document from a running local API, wipes the generated tree, and rebuilds it. The local API
must be running. Unrelated specification drift lands in the same commit.

Files that change when the API adds the new arm and the new catalog field:

- `src/generated/api/resources/tools/types/ToolResolveRequestToolsItem.ts`, which today has
  exactly two arms.
- `src/generated/api/types/ToolCatalogAction.ts` and `ToolCatalogActionDetails.ts`. The second
  relists fields flat, so both need the field.
- `src/generated/api/types/index.ts`, for a new exported type.

## 17. Frontend: what to reuse

- `PermissionPolicySelect` at
  `.../SchemaControls/agentTemplate/PermissionPolicySelect.tsx:31-67`. A two-line select with
  a title over a muted help line. Its option shape at `:10-16` is exactly what the preset
  select needs.
- `permissionPolicy.ts` at `.../SchemaControls/permissionPolicy.ts:8-24`. The agent-wide
  policy vocabulary, its labels, and its help text, shared by the drawer and the chat command
  palette so they cannot disagree. The default is `allow_reads` at `:24`.
- `CollapsibleProviderGroup`, `SubSectionHeader`, and `ProviderLogo` from `sectionGroups.tsx`.
- `RailField` from `.../drawers/shared/RailField.tsx`, which gives the label rhythm plus the
  changed-path marking and revert behavior.
- `EnhancedDrawer` from `@agenta/ui/drawer` for the drawer shell, and `EnhancedModal` for a
  small form.
- `ItemRow`, `ItemChildRow`, `StatusTag`, and `ItemAvatar` from `agentTemplate/ItemRow.tsx`.

There is no preset UI for tool permissions anywhere in the codebase yet. The evaluator preset
modal is unrelated.

## 18. Tests and commands

| Area | Location | Run |
| --- | --- | --- |
| SDK unit | `sdks/python/oss/tests/pytest/unit/agents/` | `cd sdks/python && py-run-tests` |
| API unit | `api/oss/tests/pytest/unit/tools/` | `cd api && uv run --no-sync python -m pytest oss/tests/pytest/unit/tools -q` |
| API acceptance | `api/oss/tests/pytest/acceptance/tools/` | `cd api && py-run-tests` |
| Runner unit | `services/runner/tests/unit/` | `cd services/runner && pnpm test` |
| Frontend unit | `web/packages/agenta-entity-ui/tests/unit/` | `cd web && pnpm --filter @agenta/entity-ui test` |

The SDK conftest at `sdks/python/oss/tests/pytest/unit/agents/conftest.py` exposes fake
sandbox, session, and backend objects as fixtures, and a `golden` loader at `:196-203`. The
fakes implement the real ports, so a new abstract method breaks them loudly.

The golden files that matter here are `run_request.pi_core.json`, `run_request.claude.json`,
`run_request.codex.json`, `run_request.attachment.json`, and `permission_decisions.json`.
`permission_decisions.json` is the cross-language permission anchor. Its own test docstring
says a disagreement between the two languages is real drift and the fixture must not be bent.

API unit tests use no database and no network. They build the service with `object.__new__`
and patch the seams, or build the router with simple namespace fakes. `asyncio_mode` is
`auto`, so an async test needs no marker. Acceptance tests speak HTTP through the
`authed_api` fixture, backed by `api/oss/tests/pytest/utils/accounts.py`, which mints an
account through the admin endpoint. Do not hand-roll account creation.

Runner tests use vitest with three projects. The unit project scrubs ambient environment
variables through `tests/setup/hermetic-env.ts`. `tests/unit/wire-contract.test.ts:34-64`
holds a compile-time key guard, so a new top-level wire key must be added there or `tsc`
fails.

Frontend tests use vitest with jsdom. There is no testing library dependency, so component
tests hand-roll a root. There are no tests today for `ToolManagementList`, `CatalogChooser`,
`AgentIntegrationDrawer`, `ConnectDrawer`, or `sectionGroups`. Test files are neither linted
nor type-checked, because both configurations cover `src` only.

## 19. Lint, formatting, and CI

Python. Run `ruff format` then `ruff check --fix` in the folder you changed. CI is
`.github/workflows/11-check-code-styling.yml`. It pins ruff 0.15.12 at lines 28 and 45, and
runs `ruff format --check` and `ruff check` from the repository root with no path argument.
The path filter decides only whether the job runs. Once it runs it walks the whole repository,
governed by the root `ruff.toml`, which excludes only `clients/`. Python under `.agents/` and
`docs/` is checked too. A locally installed older ruff will disagree with CI on formatting.
Judge CI-bound formatting with `uvx ruff@0.15.12`.

Frontend. Run `pnpm lint-fix` in `web`. The shared configuration is
`web/packages/eslint.config.mjs`. Rules that bite new code: explicit `any` is an error at
`:108`; the SDK root barrel and the query client singleton are banned at `:38-63`; imports are
alphabetized with react first at `:120-142`; prettier runs as an error with no semicolons, a
tab width of four, a print width of 100, and no bracket spacing, at `:145-154`.

Runner. Run `pnpm run typecheck` and `pnpm test` in `services/runner`. There is no eslint
there, and the prettier pre-commit hook covers `web` only. CI runs both commands in
`.github/workflows/12-check-unit-tests.yml`.

## 20. The superseded pull requests

[#6163](https://github.com/Agenta-AI/agenta/pull/6163), branch
`feat/composio-toolkit-backend`, and
[#6161](https://github.com/Agenta-AI/agenta/pull/6161), branch
`feat/composio-toolkit-frontend`. Both are open and based on `release/v0.112.3`. No human
review was submitted on either. The rejection is recorded in the design documents, not in the
pull request threads.

What they built. A `gateway_toolkit` entry granting a whole integration, one search tool and
one run tool per connection, and a single connection-level permission. The allowed tool list
rode inside the callback routing string, in the grammar
`toolkit.{provider}.{integration}.{connection}.run.include.{SLUG}...`. The SDK built it and
the API parsed it back.

Automated review found three problems that the new design removes. The run path never checked
that a requested tool belonged to the named integration. The provider, integration, and
connection all came from the model-supplied tool name and were never checked against the
resolved connection. The allowed slugs were built by uppercase concatenation, which breaks for
a hyphenated integration.

Worth reusing.

- The provider adapter change that executes a known slug directly, once the slug comes from
  the catalog instead of concatenation.
- The handler skeleton in the router: argument parsing, the success and error result helpers,
  and the model-readable rejection message.
- The two tool descriptions. Their prose matches the prompt guidance the design asks for.
- The test scaffolding, including a live provider test marked `integration` and skipped
  without an API key, and a fake-service handler test.
- On the frontend, the single optional render slot added to `CatalogChooser`, which is
  additive and affects no other caller.

Not reusable. Every routing-string grammar, the slug concatenation, and the single
connection-level permission field.
