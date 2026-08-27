# Execution plan

Seven slices. Each one is small enough for one agent to build alone. Read
[contracts.md](contracts.md) before writing any field name.

## How to use this plan

Every slice states its scope, the design section it implements, what it must not touch, the
tests it writes, and how to know it is done. A slice also states which side of the
Python and TypeScript wire it owns, so two slices never edit the same shape.

The tests are specified in [qa.md](qa.md), where each case carries an ID. A slice names the
IDs it implements and does not restate them. Read the matching `qa.md` section before
writing a test file.

Run the slices in this order.

```text
Slice 1  SDK configuration model and permission compiler
   |
   +--> Slice 2  API catalog tool identity and connection resolve
   |        |
   |        +--> Slice 3  API gateway search and run routes
   |                 |
   |                 +--> Slice 4  SDK resolver, resolved policy, prompt guidance
   |                 |        |
   |                 |     Slice 5  Runner policy gate, search filtering, approval
   |                 |
   +-----------------+--> Slice 6  Frontend rows and permission drawer
                                       |
                                    Slice 7  End-to-end wiring and deploy check
```

Slice 6 splits in two. Its pure parts, the config parser, the preset translation, the
migration, and the local types, need only the saved format from Slice 1 and can start
immediately. Its generated-client regeneration needs Slice 3, because the script rebuilds
the whole client from a running API's OpenAPI document, and that document must already carry
the new resolve arm and the new catalog field. Do not regenerate before Slice 3 lands.

## Rules that apply to every slice

- Do not change the three design documents.
- Do not add a configuration field that no design section names.
- Do not add a new abstraction layer. Extend the class or function that already does the job.
- Keep legacy `gateway` entries working. Readers accept both discriminators until the
  migration window closes.
- Python: run `ruff format` then `ruff check --fix` in the folder you changed. CI pins ruff
  0.15.12 and checks the whole repository, so judge formatting with `uvx ruff@0.15.12`.
- Frontend: run `pnpm lint-fix` in `web`.
- Runner: run `pnpm run typecheck` and `pnpm test` in `services/runner`.

---

## Slice 1: SDK configuration model and permission compiler

Build the saved entry and the pure function that turns it into per-tool decisions. Nothing
in this slice makes a network call.

### Scope

- `sdks/python/agenta/sdk/agents/tools/models.py`. Add `GatewayConnectionRef`,
  `GatewayPermissions`, `GatewayConnectionToolConfig`. Add the new arm to the `ToolConfig`
  union and its `TypeAdapter`.
- `sdks/python/agenta/sdk/agents/tools/compat.py`. Validate the revision-level rule inside
  `coerce_tool_configs`. See below.
- `sdks/python/agenta/sdk/agents/tools/gateway_policy.py`. New file. The compiler, its input
  model `CatalogToolInfo`, and its result models `CompiledTool` and `CompiledGatewayPolicy`.
- `sdks/python/agenta/sdk/agents/tools/__init__.py`. Export the new names.

### Contract it implements

`data-model.md`, all sections. `permission-layers.md`, "SDK permission compilation".
[contracts.md](contracts.md) sections 1, 2, and 9.

### What it must build

The configuration model, exactly as contracts section 1 describes. Validation rules from
`data-model.md`, "Validation": non-empty routing fields, a required `default`, the four
permission values, non-empty tool keys, and `extra="forbid"`.

The compiler, exactly as contracts section 9 describes. It returns one
`CompiledGatewayPolicy` carrying `tools` and `stale_keys`.

The revision-level validator that rejects two `gateway_connection` entries for the same
provider and integration. **It cannot live in `TOOL_CONFIG_ADAPTER`.** That adapter validates
one entry at a time and never sees the list, so a cross-entry rule is invisible to it. Put
the check in `coerce_tool_configs` in `compat.py`, which already receives the whole list and
is the single entry point both the SDK resolver and the API use.

This slice writes **no migration function in Python.** Migration is an authoring action that
happens in the drawer, so the frontend owns it in TypeScript, in Slice 6. A Python helper
here would have no caller: the SDK only ever reads saved revisions, and it must keep reading
legacy entries either way. Adding an uncalled migration path would be a second
implementation to keep in step with the real one.

The SDK's obligation is narrower and unchanged: a legacy `gateway` entry must keep parsing,
resolving, and running.

### What it must not touch

- `sdks/python/agenta/sdk/agents/platform/gateway.py`. Slice 4 owns it.
- `effective_permission` at `models.py:51`. It stays as it is. The compiler calls the same
  rule but does not replace the function.
- Any API file. Any TypeScript file.
- The wire. This slice adds no field to `wire_models.py`.

### Tests

[qa.md](qa.md) already specifies these. This slice implements cases **C1 to C26, C28 to C30,
and C34**. Do not restate them here. Read the tables in `qa.md`, "SDK compiler tests".

C27, the cross-language wire shape, belongs to Slice 4, which owns the wire model. This
slice owns no wire field, so it cannot test one.

C31 to C33, the migration cases, belong to Slice 6 as TypeScript cases, because the frontend
owns migration.

Add to `sdks/python/oss/tests/pytest/unit/agents/tools/`.

- `test_gateway_policy.py`. The compiler truth table, C1 to C17, and the other compiler
  cases, C18 to C26. C13 is the case the format exists for, so write it first. C26 is a
  security rule: catalog metadata never overrides an authored `deny`.
- `test_gateway_connection_config.py`. The parse and validation cases, C20 to C24, C28 to
  C30, and C34. C24, the duplicate-entry rule, must be driven through `coerce_tool_configs`
  with a list, not through the single-entry adapter.

Run: `cd sdks/python && py-run-tests`.

### Done when

Both test files pass. `ruff format --check` and `ruff check` are clean. A legacy `gateway`
entry still parses through `TOOL_CONFIG_ADAPTER`. No other test in the repository changed
behavior.

### Wire ownership

Python only. This slice owns no shared wire shape.

---

## Slice 2: API catalog tool identity and connection resolve

Give the catalog a canonical provider action ID, and teach `/tools/resolve` to answer a
connection entry with the catalog slice the compiler needs.

### Scope

- `api/oss/src/core/tools/providers/composio/catalog.py`. Keep the provider slug in the
  parsed action instead of discarding it.
- `api/oss/src/core/tools/dtos.py`. Add the canonical ID field to `ToolCatalogAction`. Add
  the resolve response model from contracts section 3.
- `api/oss/src/core/tools/providers/composio/adapter.py`. Read the canonical ID from the
  catalog on `get_action` and `execute`. Delete the concatenation helper and the dead
  extraction helper.
- `api/oss/src/core/tools/service.py`. Add a method that resolves one connection entry and
  returns its catalog slice.
- `api/oss/src/apis/fastapi/tools/models.py`. Accept the new arm in `ToolResolveRequest`.
  Add `gateway_connections` to `ToolResolveResponse`.
- `api/oss/src/apis/fastapi/tools/router.py`. Wire the new arm through `/tools/resolve`.

### Contract it implements

`permission-layers.md`, "Catalog input" and the "API changes" table rows for gateway
resolution and catalog DTOs. [contracts.md](contracts.md) sections 2 and 3.

### What it must build

**One cached, fully paginated catalog helper.** This is the load-bearing piece of the slice.
Everything else depends on it.

Add one service method that returns the complete catalog for one integration, as a list of
key, provider action ID, and `read_only`. It pages through the provider until the cursor is
exhausted, and it caches the assembled whole under its own namespace with a time limit.

Do not try to reuse the existing five-minute cache. That cache lives in the HTTP router and
is keyed per page of a per-request query, so the service cannot read it and no single entry
holds a whole catalog. Reusing it is not possible, and an earlier draft of this plan was
wrong to say so.

This one helper serves four callers:

1. The `gateway_connections` arm of `/tools/resolve`, which returns key and `read_only`.
2. `get_action`, which needs the canonical provider action ID.
3. `execute`, on both the new `gateway.run` route and the legacy five-segment route.
4. The close-key suggestions in Slice 3.

**The provider action ID path.** The catalog parser keeps the provider slug it already reads.
Today it strips a prefix and throws the original away. Keep both, the stripped Agenta key and
the provider slug, and store the provider slug on the catalog model.

Then remove the rebuild. `get_action` and `execute` currently reconstruct the slug by
concatenation because neither has a catalog row in hand, and neither `ToolExecutionRequest`
nor the gateway port can carry a canonical ID today. So this slice also:

- adds the canonical provider action ID field to `ToolExecutionRequest` and to the
  `ToolsGatewayInterface` execute signature;
- has `get_action` and `execute` look the ID up through the catalog helper before calling the
  provider;
- routes the legacy five-segment call path through the same lookup, so both call paths
  resolve identity the same way.

Keep the longest-prefix splitter in `discovery.py`. Search results arrive as bare provider
slugs with no catalog row, so that path still needs it. It is the only correct splitter of
the three; the two naive ones go away with the rebuild.

**The resolve arm.** `/tools/resolve` accepts a `gateway_connection` entry. For each one it
validates the connection exactly as the per-tool arm does today, then reads the catalog
helper and returns key and `read_only` for every tool.

The endpoint keeps answering legacy `gateway` entries in `custom`. A single request may hold
both arms.

### What it must not touch

- `/tools/call`. Slice 3 owns it.
- The Composio search adapter. Slice 3 owns it.
- Any permission logic. This slice returns `read_only` and nothing else about policy.
- Any SDK file. Any TypeScript file.

### Tests

This slice implements case **A19** from [qa.md](qa.md), and the API half of **G11**.

A23 is not this slice. It is one regression test that the `/tools/connections` contract is
unchanged, and it belongs to Slice 3.

Add to `api/oss/tests/pytest/unit/tools/`.

- `test_catalog_helper.py`. The helper assembles a catalog that spans several provider
  pages into one complete list. A second call inside the time limit does not call the
  provider again. A cursor that ends on an exact page boundary terminates. Multi-page
  coverage is the point: a helper tested only against a one-page fake will look correct and
  silently truncate a 200-tool integration in production.
- `test_catalog_action_identity.py`. A19. A parsed action keeps the provider slug.
  `get_action` and `execute` read the ID through the helper, never from a rebuilt string.
  The legacy five-segment path resolves the same ID as the new route. An integration whose
  provider slug is not a plain uppercase prefix still resolves. Use a hyphenated integration
  such as `google-calendar` and a prefix-overlap pair such as `slack` and `slackbot`.
- `test_resolve_gateway_connection.py`. A connection entry returns the catalog slice. A
  missing connection returns 404. An inactive or invalid connection returns 400. G11: a
  request holding a legacy entry and a connection entry returns both arms.

Extend `api/oss/tests/pytest/unit/tools/test_resolution.py` so the existing five-segment
call reference assertion still passes.

Follow the local style: build the service with `object.__new__` and patch the seams. Do not
add a database or a network call.

Run: `cd api && uv run --no-sync python -m pytest oss/tests/pytest/unit/tools -q`.

### Done when

The three test files pass, the existing tools suite passes, and ruff is clean. No code path
builds a provider action ID by string concatenation any more. The generated frontend client
is regenerated in Slice 6, after Slice 3, not here.

### Wire ownership

The API owns the resolve request and response. The SDK reads them in Slice 4. Any change to
contracts section 3 belongs to this slice.

---

## Slice 3: API gateway search and run routes

Add the two stable routes the runner calls, with private context instead of a parsed
routing string.

### Scope

- `api/oss/src/core/tools/interfaces.py`. Add `search_capabilities` to the gateway port.
- `api/oss/src/core/tools/service.py`. Add a runtime search method and a run method that
  take an integration, a connection, and a tool key.
- `api/oss/src/core/tools/dtos.py`. Add `context` to `ToolCall`. Add the search result model
  from contracts section 7.
- `api/oss/src/core/tools/discovery.py`. Reuse the translation helpers for the runtime search
  result. Add nothing that duplicates them.
- `api/oss/src/apis/fastapi/tools/router.py`. Route `gateway.search` and `gateway.run` in
  `call_tool`, before the five-segment parse.
- `api/oss/src/core/tools/exceptions.py`. Add the error cases from contracts section 8 if a
  suitable class does not already exist.

### Contract it implements

`runtime-tools.md`, "Provider search", "Translation and filtering", "API execution", and
"Execution errors". `permission-layers.md`, "API execution" and the "API changes" table.
[contracts.md](contracts.md) sections 6, 7, and 8.

### What it must build

`context` on the request envelope, as contracts section 6 describes. The two new call
references read it. The legacy five-segment grammar ignores it and keeps working.

`gateway.search`. Read `query` and the optional `integration` from the arguments. Read
`provider` from `context`. Reject an empty query. Pass the integration to Composio as a
native toolkit filter. That capability is settled, not a question: it was measured on
2026-08-26, and a scoped search and an unscoped search both returned in about 2.3 seconds.
Do not write the fallback that enriches the use-case text. Translate the provider result into
Agenta integration and tool keys with the existing helpers. Return the object from contracts
section 7. Do not apply agent permission here. Keep the existing search cache.

**The API does not check whether an integration is configured on the agent.** It cannot. The
search context carries only `provider`, and the agent's configured set lives in
`gatewayPolicy`, which is private to the runner. The runner rejects an unconfigured
integration before it makes the callback. That check is Slice 5, and `qa.md` case A6 is
owned by the runner, not by this slice.

`gateway.run`. Read `provider`, `integration`, `connection`, and `tool` from `context`.
Check project `RUN_TOOLS` access. Resolve the connection and check that it is active and
valid. Check that the tool key belongs to that integration's catalog. Read the canonical
provider action ID through the Slice 2 catalog helper. Check that `arguments` is an object.
Execute through the provider adapter.

Reject a call whose `context` is missing or incomplete. Do not fall back to a default.

Errors follow contracts section 8. An unknown tool key returns up to five close keys from
the same integration, computed with `difflib.get_close_matches` over the catalog helper's
keys. Do not write a new string-distance function.

Note that these suggestions come from the whole integration catalog, so they can name a tool
the agent denied. The API cannot filter them, for the same reason it cannot check the
configured set. The runner sanitizes the list against `gatewayPolicy` in Slice 5.

**Structured logging.** Slice 7 has to report the measurements listed in
`runtime-tools.md`, and nothing records them today. Emit one log line per seam, with the
existing module logger. No metrics framework, no new dependency.

| Seam | Fields |
| --- | --- |
| Provider search returns | latency in milliseconds, whether the cache was hit, result count |
| Provider search fails | the error class, whether it is retryable |
| Resolve returns a catalog slice | integration, tool count, latency, whether the cache was hit |
| Provider execution finishes | integration, tool key, outcome, latency |

### What it must not touch

- `/tools/resolve`. Slice 2 owns it.
- The catalog parser. Slice 2 owns it.
- Agent permission. The API never computes it.
- Approval, pause, or resume. The runner owns them.
- Any SDK file. Any TypeScript file.

### Tests

This slice implements cases **A1 to A5, A7 to A18, and A20 to A23** from [qa.md](qa.md).
A6 belongs to Slice 5, because only the runner knows the configured set. A19 belongs to
Slice 2. Read the tables in `qa.md`, "API tests".

Add to `api/oss/tests/pytest/unit/tools/`.

- `test_gateway_search_route.py`. A1 to A5 and A7 to A9. Replay against the existing fixture
  at `api/oss/tests/pytest/unit/tools/fixtures/composio_search_tools.json`. A9 asserts the
  outbound request carries the toolkit filter; it is a fixed expectation now, not a
  conditional one. Note A4: the API must not filter by agent permission. A test that
  asserted such filtering would encode the wrong ownership.
- `test_gateway_run_route.py`. A10 to A18, A20, and A21. A17, malformed arguments, is a
  regression of a named current defect. Write it first.

A22 and A23 are existing suites. A23 is one regression test that the `/tools/connections`
contract is unchanged; do not extend it with resolve or gateway coverage.

Keep the existing `test_workflow_tool_call.py` passing. It shares `call_tool`, and G9 says
its routing is unchanged.

### Done when

Both test files pass, the whole tools suite passes, and ruff is clean. A legacy five-segment
call still routes as before.

### Wire ownership

The API owns contracts sections 6, 7, and 8. Slice 5 implements the runner side of the same
sections and must not change them alone.

---

## Slice 4: SDK gateway resolver, resolved policy, and prompt guidance

Turn saved connection entries into two runtime tools, one private policy object, and one
prompt section.

### Scope

- `sdks/python/agenta/sdk/agents/platform/gateway.py`. Send connection entries to
  `/tools/resolve`, read the catalog slice, call the compiler, and build the two derived
  specifications.
- `sdks/python/agenta/sdk/agents/tools/resolver.py`. Add the connection branch beside the
  existing gateway branch.
- `sdks/python/agenta/sdk/agents/tools/models.py`. Add the resolved policy models. Add the
  result type the gateway resolver returns.
- `sdks/python/agenta/sdk/agents/dtos.py`. Add `wire_gateway_policy`, beside
  `wire_permissions`.
- `sdks/python/agenta/sdk/agents/wire_models.py`. Add the `gatewayPolicy` field.
- `sdks/python/agenta/sdk/agents/utils/wire.py`. Emit the field.
- `sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py`. Add the guidance builder.
- `sdks/python/agenta/sdk/agents/adapters/harnesses.py`. Call the guidance builder from every
  harness adapter.
- **The propagation path.** A compiled policy produced in the resolver does not reach
  `wire_models.py` on its own. Carry it explicitly through every seam between the two, and
  check each one, because a copy that drops the field fails silently as an absent policy,
  which the runner reads as deny:
  - `sdks/python/agenta/sdk/agents/handler.py`;
  - `ResolvedToolSet` in `tools/models.py`, which is what the resolver returns;
  - `SessionConfig`, which the handler builds from it;
  - each harness-template copy seam in `dtos.py`, where a template is rebuilt field by field.
- `services/runner/src/protocol.ts` and `services/runner/tests/unit/wire-contract.test.ts`.
  The passive TypeScript side. See "Wire ownership" below.

### Contract it implements

`runtime-tools.md`, "Decision", "Private runtime context", the two tool sections, and
"Prompt guidance". `permission-layers.md`, "Resolved policy".
[contracts.md](contracts.md) sections 3, 4, 5, and 9.

### What it must build

The resolver sends every connection entry in one `/tools/resolve` request, together with any
legacy entries. It reads `gateway_connections` from the response, calls the Slice 1 compiler
once per integration with the agent-wide `permission_default`, and produces the resolved
policy from contracts section 5.

The two derived specifications, exactly as contracts section 4 fixes them. They are built
locally. The API does not name them. They are produced once for the whole agent, not once
per connection.

The resolved policy rides the run request as one top-level `gatewayPolicy` field. Omit it
when the agent has no connection entry, so a run without one keeps its current payload.

The prompt section. Build it only when the agent has at least one connection entry. It holds
the six items listed in `runtime-tools.md`, "Prompt guidance", and the configured
integration names. Place it in the Agenta half of the instructions, before the author's own
text. Do not save it in the agent revision.

**Inject it through every harness adapter, not only `compose_instructions`.** That function
feeds the Agenta harness alone. Claude, Codex, and Pi each assemble their own prompt surface,
so a section added only to `compose_instructions` leaves three of the four harnesses with two
runtime tools and no instructions for using them. Each adapter has its own carrier: the
instructions file for the file-based harnesses, and the appended system text for Pi. Add a
test per harness that the section is present.

Keep the existing per-tool gateway path working, including the rule that only a 404 drops
one tool with a warning while any other failure fails the run.

Stale keys the compiler reports become resolution warnings, using the existing warning list
on `ResolvedToolSet`.

### What it must not touch

- The API. Slice 2 and Slice 3 own it.
- `services/runner`. Slice 5 owns it.
- `effective_permission`. It stays as it is.

### Tests

This slice implements cases **C27, G6, and G11** from [qa.md](qa.md), plus the resolver
behavior below.

Add to `sdks/python/oss/tests/pytest/unit/agents/platform/`.

- `test_gateway_connection_resolve.py`. One connection entry produces two specifications and
  one policy. Two integrations produce one shared pair of specifications and two policy
  entries. G11: a legacy entry and a connection entry in one agent both resolve. G6: an
  agent with no connection entry gets neither derived tool. A stale configured key becomes a
  warning and no executable entry, which is the SDK half of C19.

Add to `sdks/python/oss/tests/pytest/unit/agents/`.

- Extend `test_wire_contract.py`. A run with no connection entry matches the existing golden
  files byte for byte. A run with one connection entry emits `gatewayPolicy` in the shape of
  contracts section 5. Add `gatewayPolicy` to the permitted top-level key set.
- Add one golden file for the connection case. Do not edit the four existing ones except to
  prove they are unchanged.
- Extend `test_harness_adapters.py`. The guidance section is present with a connection entry
  and absent without one, **once per harness**: Claude, Codex, Pi, and Agenta. The existing
  prefix assertions still hold.
- C27, the cross-language wire shape, is this slice's alone. Extend
  `test_permission_parity.py` so the Python and TypeScript models accept the same
  `gatewayPolicy` object, including a `readOnly` of `null`.

Run: `cd sdks/python && py-run-tests`, then `cd services/runner && pnpm run typecheck`.

### Done when

The new tests pass, the four existing golden files are unchanged, ruff is clean, and `tsc`
passes in the runner with the new field declared.

### Wire ownership

The SDK owns the Python half of contracts section 5. Slice 5 owns enforcement.

**This slice lands both sides of the declaration, in one order that never breaks `main`.**
Add the passive TypeScript side first, in the same slice:

1. Declare `gatewayPolicy` as an optional field on `AgentRunRequest` in `protocol.ts`, and
   add it to `KNOWN_REQUEST_KEYS` in `wire-contract.test.ts`. No behavior reads it yet.
2. Then emit it from Python.

Doing it the other way round breaks the repository between the two slices. The runner's key
guard is a compile-time check over the permitted top-level keys, so a Python emitter that
ships first sends a field the TypeScript contract test rejects. The declaration is inert, so
landing it early costs nothing and keeps every intermediate commit green.

**Do not enable the two derived tools until Slice 5 has landed.** The passive field above is
inert, but `search_tools` and `run_tool` are not. They carry `permission: "allow"`, and the
gate that turns that into a real decision is Slice 5. A deployment that has Slice 4 and not
Slice 5 hands the model a `run_tool` that reaches the provider with no policy applied at all,
which is worse than the behavior this project replaces.

Keep the derived tools behind a flag that Slice 5 turns on, or land the two slices together.
Do not ship Slice 4 to any environment on its own. Slice 7 checks this by confirming that a
build carrying `run_tool` also refuses a denied tool.

---

## Slice 5: Runner policy gate, search filtering, and approval

Enforce the compiled policy on every delivery path, filter search results, ask for approval,
and fix the operator override order.

### Scope

Slice 4 already declared `gatewayPolicy` in `protocol.ts`. This slice reads it.

- `services/runner/src/permission-plan.ts`. Fix the operator override order. Add the gateway
  lookup.
- `services/runner/src/tools/callback.ts`. Send `context` on the gateway callback.
- `services/runner/src/tools/relay.ts`. Gate the gateway call, validate arguments, filter the
  search result, and sanitize run suggestions.
- `services/runner/src/engines/sandbox_agent/run-turn.ts` and `services/runner/src/responder.ts`. Reach the pause
  and approval machinery from the relay gate. See "Delivery paths" below.
- `services/runner/src/engines/sandbox_agent/acp-interactions.ts`. Show the integration and
  the tool key on the approval card.

### Contract it implements

`permission-layers.md`, "Runner enforcement", "Search visibility", "Approval", and "Operator
override". `runtime-tools.md`, "Runner gate" and "Translation and filtering".
[contracts.md](contracts.md) sections 4, 5, 6, and 7.

### What it must build

**The operator override fix.** Today the deployment-wide deny switch only replaces the plan
default, and the effective-permission function reads an explicit specification permission
first, so an explicit `allow` beats the switch.

Two things are wrong, not one. Fix both.

1. **Order.** Make the switch a first-class top-priority condition, ahead of the
   specification permission.
2. **Freshness and reach.** Read the switch at decision time inside the shared gate that
   every tool family passes through, not from a plan captured at run start. The plan is built
   once, so an operator who turns the switch on mid-run does not affect a live run. Client
   tools also take a path that does not call the effective-permission function today, so a
   fix confined to that function would leave them uncovered.

The existing test for the switch asserts only the returned plan and never builds a gate that
carries an explicit permission, which is why the hole is untested.

**The gateway gate.** When the model calls `run_tool`, read the integration and the tool key
from the model's arguments. Look them up in `gatewayPolicy`. Treat a missing integration or a
missing tool as `deny`. Apply the operator override, then the compiled value. Reject `deny`,
continue on `allow`, and start an approval interaction on `ask`.

Validate the shape before deciding: `arguments` must be a plain object. The existing
required-argument check tests presence only, so a forged relay file can carry a string or an
array where an object belongs and reach approval with input the schema would reject. Check
the type on every path, including relay files, and reject before the approval card, never
after it.

**Coarse gating.** The two runtime tools carry `permission: "allow"` on their specifications,
per contracts section 4. That is what lets a compiled `allow` actually run without a prompt.
It is not an authorization decision; the semantic gate below is. Do not remove it thinking it
loosens policy: without it every gateway call raises a meaningless second card named
`run_tool`, and a compiled `allow` never runs unprompted.

**Delivery paths.** Run the gate on every path. The local loopback path, the in-sandbox path
used on Daytona, and the relay file loop all carry a gateway call, and the relay execution
seam is the one point they all pass through. Do not rely on the harness or on the model
naming a tool.

The relay seam can execute or refuse today, but it cannot pause. It has no way to create a
Sessions interaction or end the turn, so a forged relay call that compiles to `ask` would
either run or be refused outright, and neither is correct. Thread the existing pause and
responder wiring from `run-turn.ts` into the relay gate so the relay path raises a real
approval card and pauses, exactly as the harness path does.

**Approval identity.** Reuse `approvedCallKey`. It already keys on the tool name plus the
canonical arguments, and for `run_tool` the arguments contain the integration and the tool
key, so two different integration tools already produce two different keys. No new keying
scheme is needed, and inventing one risks breaking warm-session resume for every other tool.

Two obligations remain. Preserve the full outer arguments when computing the key, so the
integration and tool stay inside it. And show the integration and the tool key on the
approval card, so a person approves a named action rather than the word `run_tool`.

**Search filtering.** After the API answers a `gateway.search` call, and before the result
reaches the harness, parse the JSON, then apply the five filters from `runtime-tools.md`:
drop unconfigured providers and integrations, drop keys missing from the policy, drop `deny`,
drop results with no usable object schema, and keep at most five. Write the filtered object
back. When nothing remains, write the empty result and its message. When the body does not
parse, write the `tool_search_unavailable` error.

Reject an unconfigured `integration` argument here, before the callback, because only the
runner holds the configured set. This is `qa.md` case A6, moved from the API.

**Run error sanitizing.** Separately from the above, the `gateway.run` error envelope can
carry close-key suggestions drawn from the whole integration catalog, so it can name a tool
the agent denied or never configured. Drop those keys from the suggestion list against
`gatewayPolicy` before the error reaches the model. This is a small field edit on an error
payload, not result transformation.

Keep both narrow. Success-result transformation applies to `gateway.search` alone. Every
other tool, including `gateway.run` on success, keeps its current pass-through path. Do not
build a general result-processing pipeline.

**The callback context.** Read the provider and the connection for that integration from
`gatewayPolicy` and send them as `context`. The model never supplies them.

**Structured logging.** Emit one line per seam, so Slice 7 can report the measurements:
search results before and after filtering with the drop count by reason, the rank of the
result the model then ran, gate decisions by outcome, and any execution attempt with no
prior successful search.

### What it must not touch

- The permission vocabulary. Do not add a runner permission value.
- The harness settings renderers in the SDK. The harness keeps permitting the two runtime
  tools by their coarse names.
- The Sessions interaction API. Reuse `createInteraction` and `resolveInteraction` as they
  are.
- The API. Slice 3 owns it.

### Tests

This slice implements cases **A6 and R1 to R28** from [qa.md](qa.md), the unit half of N1 to
N11, and the two cases added by this review, R29 and R30. Read the tables in `qa.md`,
"Runner tests".

Add to `services/runner/tests/unit/`.

- `gateway-policy-gate.test.ts`. R1 to R8. R6 is the operator override correction and must
  fail before the fix and pass after it. R8 requires a switch flipped after run start, so
  drive it by changing the environment between two decisions in one run, not by building a
  new plan. R7 and R8 pin the order: operator deny, then the compiled permission, then a
  stored answer. Add one case per tool family, including client tools, since they take a
  different path today.
- `gateway-delivery-paths.test.ts`. R9 to R14, plus R29, the relay-path argument type check.
  R10 to R13 are the core security tests of this feature. R13 must assert that a forged relay
  file compiling to `ask` produces a real Sessions interaction and a paused turn, not a
  refusal.
- `gateway-approval-identity.test.ts`. R15 to R21. R17 should pass with the existing
  `approvedCallKey` once the full outer arguments are preserved; write it to prove that,
  not to justify a new keying scheme.
- `gateway-search-filter.test.ts`. A6 and R22 to R28. R28 must assert on the serialized
  payload, not on the object the runner built.
- `gateway-run-suggestions.test.ts`. R30, the sanitized suggestion list. A denied key and an
  unconfigured key are both removed from a `gateway.run` error before the model sees it.

Extend `tests/unit/permission-plan.test.ts` with R6. Extend
`tests/unit/tool-relay-guard.test.ts` with R14.

Check the shared permission golden file at
`sdks/python/oss/tests/pytest/unit/agents/golden/permission_decisions.json`. If the operator
override fix changes an expected value there, fix both languages. Do not bend a case to make
one side pass.

Run: `cd services/runner && pnpm run typecheck && pnpm test`.

### Done when

The five new test files pass, the existing runner suite passes, `tsc` is clean, and the
Python and TypeScript permission parity tests agree.

### Wire ownership

The runner owns enforcement of contracts section 5, which Slice 4 declared, and the caller
half of section 6.

---

## Slice 6: Frontend integration rows and permission drawer

Build the authoring surface from the design handoff. Add whole integrations. Set one
permission preset per integration. Override single tools.

### Scope

Read [ui-handoff.md](ui-handoff.md) first, then section 2a of
[ui-handoff-board.html](ui-handoff-board.html). Both are copied into this workspace and
versioned on this branch, so the specification cannot drift or go missing. Section 2a is the
specification. Sections 1a and 1b are earlier work. Do not build them.

**Order.** The pure parts below need only Slice 1 and can start at once. Regenerating the
API client needs Slice 3 to have landed, because the generator rebuilds the whole client
from a running API's OpenAPI document.

- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/toolUtils.ts`. Parse the new
  entry. Add an identity helper for a connection entry.
- `.../SchemaControls/toolPermission.ts`. Read and write the connection policy.
- `.../SchemaControls/agentTemplate/ToolManagementList.tsx`. One row per integration.
- `.../SchemaControls/agentTemplate/IntegrationPermissionDrawer.tsx`. New file. The
  permission drawer.
- `.../SchemaControls/agentTemplate/AgentIntegrationDrawer.tsx`. The add drawer, reshaped.
- `.../SchemaControls/agentTemplate/itemDescriptors.tsx` and `itemKinds.tsx`. Describe and
  route the new entry.
- `.../SchemaControls/agentTemplate/useAgentTools.ts`. Add, replace, and remove a connection
  entry.
- `.../SchemaControls/gatewayMigration.ts`. New file. The migration from legacy entries.
  The frontend owns migration; there is no Python twin.
- `web/packages/agenta-api-client`. Regenerate, after Slice 3 lands.

### Contract it implements

The design handoff, option 2a. [contracts.md](contracts.md) sections 1 and 10.
`data-model.md`, "Migration".

### What it must build

**Integration rows.** The tools section shows one row per configured integration, with the
app logo, the name, a permission glyph, a short label, and a chevron. Clicking the row opens
the permission drawer. A plus button in the section header opens the add drawer. Remove the
per-row expansion and the per-row plus.

**The permission drawer.** A right-side drawer with the default-permission select, a tool
search box, and two collapsible groups, read-only and write and delete. Each tool row has a
per-tool select. Follow the sizes, colors, and copy in the handoff.

**Preset translation.** Write and read presets exactly as contracts section 10 fixes them.
The preset is derived, never saved. Setting a per-tool value makes the shown preset Custom.
Picking a preset clears the override map.

**The add drawer.** Search and add whole integrations. Quick-add from the project's existing
connections. Pick a connection when several exist for one integration. Reuse the existing
connect flow component for the Connect button. A new integration is added with the "Ask for
write and delete" preset.

Choosing a different connection for an integration that is already configured **replaces**
the existing entry in one write. It never appends a second one. The saved format allows only
one entry per provider and integration, so an append produces a revision the SDK refuses to
parse, and the author would see the failure only later, at run time. Replacement keeps the
policy the author already set and swaps the connection slug alone.

**Migration.** The frontend owns migration, in TypeScript. There is no Python twin to keep in
step.

The tools list reads legacy entries and shows them under the matching integration row with a
badge that marks them as an old format. Opening that integration's drawer writes the migrated
`gateway_connection` entry into the draft. Migration writes on an author action, never on a
page load, so an untouched agent is never rewritten by being viewed.

Group legacy entries by provider, integration, and connection. Set the new default to `deny`
and copy each old `permission` into the tool map. An old entry with no `permission` becomes
`inherit`. Read both legacy encodings, not just the documented one. See the conflict note
below.

**Migrate an integration only when all its legacy entries share one connection.** The saved
format allows one entry per provider and integration, but a legacy revision may hold entries
for one integration across two connections. Grouping those by connection would produce two
entries for one integration, which is invalid.

When an integration's legacy entries name two or more connections, do not migrate that
integration. Leave its legacy entries exactly as they are. They keep parsing, resolving, and
running, and the rows keep the legacy badge. Migrate the other integrations in the same
revision normally. Do not guess which connection the author meant, and do not drop the
entries for the connections you did not pick.

**Reuse, do not rebuild.** The two-line select with a title and a help line already exists as
`PermissionPolicySelect`. The collapsible group, the section header, and the app logo already
exist in `sectionGroups.tsx`. The catalog browser already exists as `CatalogChooser`. The
connect flow already exists as `ConnectDrawer`. Use them.

**Group rollups show authored policy, not effective permission.** Each group header
summarizes the saved values of the tools inside it: one shared value when they agree, and a
mixed label when they do not. A tool saved as `inherit` displays as "follows agent policy".

The drawer must not resolve `inherit` into `allow` or `ask` to build that summary. Doing so
would mean reimplementing the compiler in TypeScript against an agent-wide mode the drawer
does not own, and the two implementations would drift. The runner is the only place that
computes an effective permission.

### What it must not touch

- The API. The frontend never computes an effective permission. It shows what is saved.
- The agent-wide permission control. It stays where it is.
- The trigger surfaces that share `CatalogChooser` and `sectionGroups.tsx`. Any change to
  those shared files must keep the trigger callers working.
- The generated client by hand. Regenerate it with the script.

### Tests

This slice implements cases **C31 to C33, F1 to F17, and G5** from [qa.md](qa.md). C31 to
C33 are the migration cases, moved here from Slice 1 and written in TypeScript. F16 and F17
were added by this review. Read the table in `qa.md`, "Frontend tests". Test the pure
translation functions. Do not test the drawer layout.

Add to `web/packages/agenta-entity-ui/tests/unit/`.

- `integrationPresets.test.ts`. F1 to F9. Every preset in both directions, the
  clear-on-preset behavior, and F7, where the override count is the number of saved entries
  in `tools`, including an entry that happens to equal the default.
- `gatewayConnection.test.ts`. F10 to F12, F14, and F16. F11 asserts an authored-policy
  rollup: a group of tools all saved `inherit` rolls up as "follows agent policy", and a
  mixed group rolls up as mixed. No test here may resolve `inherit`. F14 matters most: a
  saved key that left the catalog stays visible and the config is not rewritten. F16 is the
  atomic connection swap, which must replace and never append.
- `gatewayMigration.test.ts`. C31 to C33, F13, G5, and F17. Both legacy encodings migrate to
  the same result, a migrated group reads back the permissions it was saved with, and F17 is
  the multi-connection case: an integration whose legacy entries name two connections is left
  unmigrated, with its entries intact.

F15, the write-through, extends `toolPermission.test.ts`. Keep `toolPermission.test.ts` and
`gatewayTool.test.ts` passing.

Run: `cd web && pnpm --filter @agenta/entity-ui test`, then `pnpm lint-fix`, then
`pnpm turbo run types:check --filter=@agenta/entity-ui`.

### Done when

The three test files pass, the two existing test files still pass, lint and types are clean,
and the rendered surface matches section 2a of the design board.

### Wire ownership

The frontend owns contracts section 10. It reads contracts section 1 and must not change it.

---

## Slice 7: End-to-end wiring and local deployment check

Prove the whole path works on a running stack.

### Scope

- No new product code, unless a gap found here needs a fix. A fix belongs to the slice that
  owns the file.
- `api/oss/tests/pytest/acceptance/tools/`. One acceptance test for the two routes.
- `.agents/skills/agent-release-gate/`. The new cell described in
  [release-gate-changes.md](release-gate-changes.md).

Do not rewrite [qa.md](qa.md). It is the test specification, not a results log. Record run
results in the pull request and in [status.md](status.md).

### Contract it implements

The end-to-end flow in `permission-layers.md`. The live QA script in [qa.md](qa.md).

### What it must do

Deploy the local stack. From the repository root, load the matching environment file and run
the compose script with the same edition and image. See the root `AGENTS.md` for the four
allowed pairs.

Run the fourteen-step live QA journey in [qa.md](qa.md), "Live QA script". Steps 8 and 14 are
the pair that matters. Step 8 proves the search filter. Step 14 proves the gate. A pass on
step 8 alone proves nothing about authorization.

Run the weak-model journey, W1 to W6, on Haiku. Phrase every task the way a user types it.
Do not name `search_tools`, `run_tool`, or a tool key in the prompt. A prompt that names the
mechanism proves the backend path works and proves nothing about what a model finds alone.

Run the regression list, G1 to G11, and the live half of the negative list, N12 to N14. N12
looks wrong and is intended: a project credential with `RUN_TOOLS` may still call the Tools
API directly. Record it as a decision.

Check N7 and N8 by reading the real serialized payloads and the real sandbox contents, not
by reading the code.

Record the measurements listed in `runtime-tools.md`, "Measurements", plus the cold and warm
resolve latency from open question 5. They decide whether a local search index is needed
later.

Read them from the structured log lines that slices 3 and 5 emit. Do not reconstruct them by
hand from transcripts. If a measurement in that list has no log line behind it, the gap is a
bug in slice 3 or slice 5, not something to estimate here.

Add the release gate cell, following [release-gate-changes.md](release-gate-changes.md). It
is one new cell, one fixture requirement, and two edits to existing files. Wire
`check_no_silent_turn` into the pass condition of every leg. A leg that passes because
something did not appear is also satisfied by a turn that did nothing at all.

### Tests

- `api/oss/tests/pytest/acceptance/tools/test_gateway_routes.py`. Speak HTTP through the
  `authed_api` fixture. Mint the account with the existing helpers in
  `api/oss/tests/pytest/utils/accounts.py`. Do not hand-roll account creation. Mark it
  `integration` so it skips without a database.

### Done when

The live journey, the weak-model journey, the regression list, and the negative list all
pass on the local stack. The acceptance test passes. The release gate cell passes twice
before anyone promotes it to mandatory.

Report skips honestly. This feature carries authorization logic, so a skip in a permission,
approval, or sandbox test is an untested claim. Report "N passed, M skipped, of which k are
untested claims", and name the k.

### Wire ownership

None. This slice reads the contracts and changes none of them.

---

## Decisions taken during review

These began as open questions. A review on 2026-08-26 resolved all six. Each states what was
adopted. Do not reopen one without saying what new evidence changed it.

### 1. What "Ask for write and delete" means when the agent-wide mode changes. ADOPTED

The preset saves `default: "inherit"`. Under the agent-wide mode `allow_reads`, that means
reads run and writes ask, which is what the preset says. `allow_reads` is the default
agent-wide mode in the SDK and in the frontend. But an author can change the agent-wide mode
to `ask`, `allow`, or `deny`. The preset then quietly means something else while still
showing the same words.

**Adopted.** Save `inherit`, and show a line under the select when the agent-wide mode is not
`allow_reads`: "This agent's permission policy is set to {mode}, so these tools follow it."
Do not expand the preset into an explicit per-tool map. An explicit map bloats the saved
entry, breaks when the catalog changes, and makes every new provider tool ask.

### 2. How the drawer shows a tool set to `inherit`. ADOPTED

The saved format has four per-tool values. The design handoff gives the per-tool select three
options: Ask, Allow, and Deny. Migration writes `inherit` for every legacy tool that carried
no explicit permission, and today the frontend adds tools with no permission field. So after
migration, most rows will hold a value the select cannot show.

**Adopted.** Add a fourth per-tool option named "Follow agent policy", with the same glyph
the "Ask for write and delete" preset uses. It is one extra row in a menu that already exists,
and it is required for lossless editing: without it, a migrated row holds a value the drawer
cannot display and an author cannot restore once they change it.

This is a departure from the handoff. Get the short design sign-off before Slice 6 starts,
not after, because the per-tool select is built once.

### 3. Whether an agent may hold both entry formats at once. ADOPTED

`data-model.md` says readers accept both discriminators during migration. `runtime-tools.md`
says the model gets two tools when the agent has at least one connection entry. Neither says
what happens when an agent holds a connection entry and a legacy per-tool entry together.

**Adopted.** Allow it. The legacy entry keeps producing its own named tool, and the connection
entry produces the two derived tools. The model then sees both surfaces for one run. This
keeps a half-migrated agent working, and finding 1 above makes it unavoidable: an integration
with legacy entries across two connections is deliberately left unmigrated, so mixed
revisions are a supported steady state, not only a transient one.

It does not cost nothing. Two surfaces can disagree about the same tool: a legacy entry may
say `allow` for a tool the connection entry denies. The legacy entry is its own tool with its
own permission and keeps its own behavior; the connection policy governs only calls made
through `run_tool`. That is the rule. Slice 4 tests the coexistence and `qa.md` case G12
tests the conflicting-permission collision.

### 4. Whether Composio's search operation accepts a toolkit filter. RESOLVED

Measured on 2026-08-26. The provider search operation does accept toolkit scoping. A scoped
search and an unscoped search both returned in about 2.3 seconds, so scoping costs nothing.

**Pinned.** Slice 3 passes the native toolkit filter. Do not write the use-case-text
enrichment fallback, and do not re-check the capability during implementation. `qa.md` case
A9 asserts the outbound request carries the filter, as a fixed expectation rather than a
conditional one.

### 5. Latency of the catalog slice at run start. RESOLVED

The earlier recommendation said to reuse the existing five-minute catalog cache. That was
wrong against the current code. The cache lives in the HTTP router and is keyed per page of a
per-request query, so the service cannot read it and no entry holds a whole catalog.

**Resolved by Slice 2.** That slice adds one cached, fully paginated service helper that
returns a complete catalog for one integration. Measure cold and warm resolve latency in
Slice 7 against that helper. If a cold resolve is slow enough to hurt, the fix is a longer
time limit on the helper, not a change to the design.

### 6. Scope of the new result-processing step. RESOLVED

The runner passes every callback result to the harness unchanged today. Slice 5 adds an
exception, and the earlier recommendation scoped it to "the two gateway call references",
which is broader than needed.

**Scoped.** Success-result transformation applies to `gateway.search` alone. `gateway.run` on
success stays a pass-through. `gateway.run` on error gets a narrow field edit instead: the
close-key suggestion list is sanitized against `gatewayPolicy`, because the API builds it
from the whole catalog and can otherwise name a denied tool. Do not build a general
result-processing pipeline.

## Conflicts between the design and the current code

The plan already resolves these. They are recorded so a slice does not rediscover them.

**There is no call reference include-list parser to delete.** The design's "API changes"
table says the API should accept a stable route "instead of parsing policy from `call_ref`".
On `main` there is no such parser. The include-list grammar exists only on the superseded
branch `feat/composio-toolkit-backend`. What `main` has is a five-segment routing grammar
that carries resource identity, not policy. So Slice 3 adds the new routes beside the old
grammar and deletes nothing. The old grammar must keep working for saved revisions and warm
sessions.

**The design's migration rule can produce a configuration its own validation rejects.**
`data-model.md` groups legacy entries by provider, integration, and connection, while its
validation allows at most one entry per provider and integration. A legacy revision holding
entries for one integration across two connections migrates into two entries for that
integration, which is invalid.

The design is decided and does not change. The plan resolves the gap in the migration step
instead: migrate an integration only when all of its legacy entries share one connection.
Otherwise leave that integration's legacy entries untouched and keep the legacy badge on its
row. This is the only resolution that neither invents an author's intent nor drops entries.
It also makes a mixed-format revision a permanent supported state, which decision 3 above
records. Slice 6 owns it and `qa.md` case F17 tests it.

**The frontend has never written the canonical `gateway` entry.** The migration section of
`data-model.md` shows migrating from entries shaped `{"type": "gateway", "action": ...}`. The
current add drawer writes a different shape, a function entry whose name is a five-segment
slug. Both shapes exist in saved revisions. The migration in Slice 6 must read both. A
migration that reads only the documented shape would silently drop most real agents' tools.

**The catalog throws away the canonical provider action ID.** The design says execution must
never rebuild that ID by string concatenation. Today the parser strips the provider prefix
and discards the original, and two call paths rebuild it. Slice 2 fixes this. Note that the
search path has a third, correct splitter that handles overlapping prefixes. Keep it, because
search results arrive without a catalog row.

**The call request model does not forbid extra fields.** An older API silently drops a
`context` object rather than refusing it. That would be a fail-open path if the new routes
reused the old call reference. They do not. The new routes are new names, so an older API
returns an error for an unknown reference. Slice 3 must not add any fallback that would turn
this back into a silent success.

**The provider search method is not on the gateway port.** The service reaches it by
attribute lookup, so a provider without it fails at run time instead of at import. Slice 3
promotes it to the port.

**The operator override is checked in the wrong order.** The design says this must be
corrected. The runner's effective-permission function reads an explicit specification
permission before it reads the plan default, and the operator switch only replaces that
default. The existing test asserts the plan shape and never exercises a gate carrying an
explicit permission, so the hole is untested. Slice 5 fixes both.

**A configuration entry that the frontend cannot parse disappears from five places.** The
frontend's gateway parser returns nothing for any entry whose type is not exactly `gateway`.
Grouping, identity, permission matching, descriptors, and the item router all depend on it.
Slice 6 must extend the parser before anything writes the new entry, or a saved
`gateway_connection` will vanish from the authoring surface without an error.

**The class named in the briefing does not exist on `main`.** `GatewayToolkitConfig` lives
only on the superseded branch. Slice 1 creates a new class. It does not modify one.
