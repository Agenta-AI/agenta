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
   |        +--------+
   |        |
   |     Slice 4  SDK gateway resolver, resolved policy, prompt guidance
   |                 |
   |              Slice 5  Runner policy gate, search filtering, approval
   |                 |
   +--> Slice 6  Frontend integration rows and permission drawer
                     |
                  Slice 7  End-to-end wiring and local deployment check
```

Slice 6 needs only the saved format from Slice 1. It can run beside slices 2 to 5.

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
- `sdks/python/agenta/sdk/agents/tools/gateway_policy.py`. New file. The compiler, its two
  input models (`CatalogToolInfo`, `CompiledTool`), and the migration function.
- `sdks/python/agenta/sdk/agents/tools/__init__.py`. Export the new names.

### Contract it implements

`data-model.md`, all sections. `permission-layers.md`, "SDK permission compilation".
[contracts.md](contracts.md) sections 1, 2, and 9.

### What it must build

The configuration model, exactly as contracts section 1 describes. Validation rules from
`data-model.md`, "Validation": non-empty routing fields, a required `default`, the four
permission values, non-empty tool keys, and `extra="forbid"`.

The compiler, exactly as contracts section 9 describes. It returns compiled tools and stale
keys separately.

The migration function. It reads a list of raw tool entries and returns a list where legacy
gateway entries are grouped into `gateway_connection` entries. Group by provider,
integration, and connection. Set the new default to `deny`. Copy each old `permission` into
the tool map. An old entry with no `permission` becomes `inherit`.

The migration must read both legacy encodings, not just one. See the conflict note below.

A validator that rejects two `gateway_connection` entries for the same provider and
integration in one revision.

### What it must not touch

- `sdks/python/agenta/sdk/agents/platform/gateway.py`. Slice 4 owns it.
- `effective_permission` at `models.py:51`. It stays as it is. The compiler calls the same
  rule but does not replace the function.
- Any API file. Any TypeScript file.
- The wire. This slice adds no field to `wire_models.py`.

### Tests

[qa.md](qa.md) already specifies these. This slice implements cases **C1 to C34**. Do not
restate them here. Read the tables in `qa.md`, "SDK compiler tests".

Add to `sdks/python/oss/tests/pytest/unit/agents/tools/`.

- `test_gateway_policy.py`. The compiler truth table, C1 to C17, and the other compiler
  cases, C18 to C27. C13 is the case the format exists for, so write it first. C26 is a
  security rule: catalog metadata never overrides an authored `deny`.
- `test_gateway_connection_config.py`. The parse and validation cases, C20 to C24 and C28 to
  C30.
- `test_gateway_migration.py`. The migration cases, C31 to C34. Cover both legacy encodings.
  See the conflict note below.

Extend `sdks/python/oss/tests/pytest/unit/agents/tools/test_permission_parity.py` only if
the compiler adds a case the shared golden file must hold, which is C27. Do not bend an
existing case.

Run: `cd sdks/python && py-run-tests`.

### Done when

The three test files pass. `ruff format --check` and `ruff check` are clean. A legacy
`gateway` entry still parses through `TOOL_CONFIG_ADAPTER`. No other test in the repository
changed behavior.

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

The catalog parser keeps the provider slug it already reads. Today it strips a prefix from
it and throws the original away. Keep both: the stripped Agenta key and the provider slug.

Every place that rebuilds the provider slug from the integration and the tool key reads the
stored value instead. There are two such places on the resolve and execute paths, and one
correct longest-prefix splitter on the search path. Keep the splitter, because search
results arrive as bare provider slugs with no catalog row.

`/tools/resolve` accepts a `gateway_connection` entry. For each one it validates the
connection exactly as the per-tool arm does today, then lists that integration's catalog and
returns key and `read_only` for every tool. Reuse the existing router cache. Do not add a
second cache.

The endpoint keeps answering legacy `gateway` entries in `custom`. A single request may hold
both arms.

### What it must not touch

- `/tools/call`. Slice 3 owns it.
- The Composio search adapter. Slice 3 owns it.
- Any permission logic. This slice returns `read_only` and nothing else about policy.
- Any SDK file. Any TypeScript file.

### Tests

This slice implements case **A19** from [qa.md](qa.md), and the resolve half of A23.

Add to `api/oss/tests/pytest/unit/tools/`.

- `test_catalog_action_identity.py`. A19. A parsed action keeps the provider slug.
  `get_action` and `execute` use the stored value, never a rebuilt string. An integration
  whose provider slug is not a plain uppercase prefix still resolves. Use a hyphenated
  integration such as `google-calendar` and a prefix-overlap pair such as `slack` and
  `slackbot`.
- `test_resolve_gateway_connection.py`. A connection entry returns the catalog slice. A
  missing connection returns 404. An inactive or invalid connection returns 400. A request
  holding a legacy entry and a connection entry returns both arms, which is the API half of
  G11.

Extend `api/oss/tests/pytest/unit/tools/test_resolution.py` so the existing five-segment
call reference assertion still passes.

Follow the local style: build the service with `object.__new__` and patch the seams. Do not
add a database or a network call.

Run: `cd api && uv run --no-sync python -m pytest oss/tests/pytest/unit/tools -q`.

### Done when

Both test files pass, the existing tools suite passes, and ruff is clean. The generated
frontend client is regenerated in Slice 6, not here.

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
`provider` from `context`. Reject an empty query. Call the existing Composio search adapter.
Check first whether the current Composio operation accepts a native toolkit filter. Use the
native filter when it exists. Otherwise include the integration in the use-case text, as
`runtime-tools.md` allows. Translate the provider result into Agenta integration and tool
keys with the existing helpers. Return the object from contracts section 7. Do not apply
agent permission here. Keep the existing search cache.

`gateway.run`. Read `provider`, `integration`, `connection`, and `tool` from `context`.
Check project `RUN_TOOLS` access. Resolve the connection and check that it is active and
valid. Check that the tool key belongs to that integration's catalog. Read the canonical
provider action ID from the catalog row that Slice 2 stored. Check that `arguments` is an
object. Execute through the provider adapter.

Reject a call whose `context` is missing or incomplete. Do not fall back to a default.

Errors follow contracts section 8. An unknown tool key returns up to five close keys from
the same integration. Compute closeness with `difflib.get_close_matches` over the catalog
keys. Do not write a new string-distance function.

### What it must not touch

- `/tools/resolve`. Slice 2 owns it.
- The catalog parser. Slice 2 owns it.
- Agent permission. The API never computes it.
- Approval, pause, or resume. The runner owns them.
- Any SDK file. Any TypeScript file.

### Tests

This slice implements cases **A1 to A18, A20, A21, A22, and A23** from [qa.md](qa.md). A19
belongs to Slice 2. Read the tables in `qa.md`, "API tests".

Add to `api/oss/tests/pytest/unit/tools/`.

- `test_gateway_search_route.py`. A1 to A9. Replay against the existing fixture at
  `api/oss/tests/pytest/unit/tools/fixtures/composio_search_tools.json`. Note A4: the API
  must not filter by agent permission. A test that asserted such filtering would encode the
  wrong ownership.
- `test_gateway_run_route.py`. A10 to A18, A20, and A21. A17, malformed arguments, and A19,
  the rebuilt action ID, are both regressions of named current defects. Write A17 first.

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
- `sdks/python/agenta/sdk/agents/adapters/harnesses.py`. Call the guidance builder.

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
  and absent without one. The existing prefix assertions still hold.

Run: `cd sdks/python && py-run-tests`.

### Done when

The new tests pass, the four existing golden files are unchanged, and ruff is clean.

### Wire ownership

The SDK owns the Python half of contracts section 5. Slice 5 owns the TypeScript half. The
two must land in an order that keeps `main` working: add the optional field on both sides
before anything reads it.

---

## Slice 5: Runner policy gate, search filtering, and approval

Enforce the compiled policy on every delivery path, filter search results, ask for approval,
and fix the operator override order.

### Scope

- `services/runner/src/protocol.ts`. Add `gatewayPolicy` to `AgentRunRequest` and its types.
- `services/runner/src/permission-plan.ts`. Fix the operator override order. Add the gateway
  lookup.
- `services/runner/src/tools/callback.ts`. Send `context` on the gateway callback.
- `services/runner/src/tools/relay.ts`. Gate the gateway call and filter the search result.
- `services/runner/src/engines/sandbox_agent/acp-interactions.ts`. Carry the integration and
  the tool key in the approval identity and on the approval card.
- `services/runner/tests/unit/wire-contract.test.ts`. Add the new key.

### Contract it implements

`permission-layers.md`, "Runner enforcement", "Search visibility", "Approval", and "Operator
override". `runtime-tools.md`, "Runner gate" and "Translation and filtering".
[contracts.md](contracts.md) sections 4, 5, 6, and 7.

### What it must build

**The operator override fix.** Today the deployment-wide deny switch only replaces the plan
default. The effective-permission function reads an explicit specification permission first,
so an explicit `allow` beats the switch. Make the switch a first-class top-priority
condition inside that one function. Every caller already routes through it, so one change
closes every path. The existing test for the switch does not exercise a gate that carries an
explicit permission. Add that case.

**The gateway gate.** When the model calls `run_tool`, read the integration and the tool key
from the model's arguments. Look them up in `gatewayPolicy`. Treat a missing integration or a
missing tool as `deny`. Apply the operator override, then the compiled value. Reject `deny`,
continue on `allow`, and start an approval interaction on `ask`.

Run this gate on every delivery path. The local loopback path, the in-sandbox path used on
Daytona, and the relay file loop all carry a gateway call. The relay execution seam is the
one point every path passes through, so the gate belongs there. Do not rely on the harness
or on the model naming a tool.

**Approval identity.** The stored decision key must include the integration and the tool key
in addition to the canonical arguments. Keying on the coarse `run_tool` name alone would let
one approved call authorize a different integration tool. The approval card shows the
integration, the tool key, and the arguments.

**Search filtering.** After the API answers a `gateway.search` call, and before the result
reaches the harness, parse the JSON, then apply the five filters from `runtime-tools.md`:
drop unconfigured providers and integrations, drop keys missing from the policy, drop `deny`,
drop results with no usable object schema, and keep at most five. Write the filtered object
back. When nothing remains, write the empty result and its message. When the body does not
parse, write the `tool_search_unavailable` error.

This is the first place the runner processes a callback result instead of passing it through.
Add the step only for the two gateway call references. Every other tool keeps its current
pass-through path.

**The callback context.** Read the provider and the connection for that integration from
`gatewayPolicy` and send them as `context`. The model never supplies them.

### What it must not touch

- The permission vocabulary. Do not add a runner permission value.
- The harness settings renderers in the SDK. The harness keeps permitting the two runtime
  tools by their coarse names.
- The Sessions interaction API. Reuse `createInteraction` and `resolveInteraction` as they
  are.
- The API. Slice 3 owns it.

### Tests

This slice implements cases **R1 to R28** from [qa.md](qa.md), and the unit half of N1 to
N11. Read the tables in `qa.md`, "Runner tests".

Add to `services/runner/tests/unit/`.

- `gateway-policy-gate.test.ts`. R1 to R8. R6 is the operator override correction. It must
  fail before the fix and pass after it. R7 and R8 pin the order: operator deny, then the
  compiled permission, then a stored answer.
- `gateway-delivery-paths.test.ts`. R9 to R14. R10 to R13 are the core security tests of
  this feature. A relay request file written inside the sandbox is gated by the same rule as
  a harness call, with the same result.
- `gateway-approval-identity.test.ts`. R15 to R21. R17 is the case that a coarse tool name
  alone would break.
- `gateway-search-filter.test.ts`. R22 to R28. R28 must assert on the serialized payload,
  not on the object the runner built.

Extend `tests/unit/permission-plan.test.ts` with R6. Extend `tests/unit/tool-relay-guard.test.ts`
with R14. Extend `tests/unit/wire-contract.test.ts` with the new top-level key.

Check the shared permission golden file at
`sdks/python/oss/tests/pytest/unit/agents/golden/permission_decisions.json`. If the operator
override fix changes an expected value there, fix both languages. Do not bend a case to make
one side pass.

Run: `cd services/runner && pnpm run typecheck && pnpm test`.

### Done when

The four new test files pass, the existing runner suite passes, `tsc` is clean, and the
Python and TypeScript permission parity tests agree.

### Wire ownership

The runner owns the TypeScript half of contracts section 5 and the caller half of section 6.

---

## Slice 6: Frontend integration rows and permission drawer

Build the authoring surface from the design handoff. Add whole integrations. Set one
permission preset per integration. Override single tools.

### Scope

Read `/home/mahmoud/code/agenta/design_handoff_integration_permissions/README.md` first, and
section 2a of the design board beside it. Section 2a is the specification. Sections 1a and 1b
are earlier work. Do not build them.

- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/toolUtils.ts`. Parse the new
  entry. Add an identity helper for a connection entry.
- `.../SchemaControls/toolPermission.ts`. Read and write the connection policy.
- `.../SchemaControls/agentTemplate/ToolManagementList.tsx`. One row per integration.
- `.../SchemaControls/agentTemplate/IntegrationPermissionDrawer.tsx`. New file. The
  permission drawer.
- `.../SchemaControls/agentTemplate/AgentIntegrationDrawer.tsx`. The add drawer, reshaped.
- `.../SchemaControls/agentTemplate/itemDescriptors.tsx` and `itemKinds.tsx`. Describe and
  route the new entry.
- `.../SchemaControls/agentTemplate/useAgentTools.ts`. Add and remove a connection entry.
- `web/packages/agenta-api-client`. Regenerate after Slice 2 and Slice 3 land.

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

**Migration on read.** The tools list reads legacy entries and shows them under the matching
integration row with a badge that marks them as an old format. Opening that integration's
drawer writes the migrated `gateway_connection` entry into the draft, using the Slice 1
migration rules. Migration writes on an author action, never on a page load, so an untouched
agent is never rewritten by being viewed.

**Reuse, do not rebuild.** The two-line select with a title and a help line already exists as
`PermissionPolicySelect`. The collapsible group, the section header, and the app logo already
exist in `sectionGroups.tsx`. The catalog browser already exists as `CatalogChooser`. The
connect flow already exists as `ConnectDrawer`. Use them.

### What it must not touch

- The API. The frontend never computes an effective permission. It shows what is saved.
- The agent-wide permission control. It stays where it is.
- The trigger surfaces that share `CatalogChooser` and `sectionGroups.tsx`. Any change to
  those shared files must keep the trigger callers working.
- The generated client by hand. Regenerate it with the script.

### Tests

This slice implements cases **F1 to F15** from [qa.md](qa.md), and G5. Read the table in
`qa.md`, "Frontend tests". Test the pure translation functions. Do not test the drawer
layout.

Add to `web/packages/agenta-entity-ui/tests/unit/`.

- `integrationPresets.test.ts`. F1 to F9. Every preset in both directions, the override
  count, and the clear-on-preset behavior.
- `gatewayConnection.test.ts`. F10 to F12 and F14. The read-only and write partition comes
  from the catalog flag, and a tool with an absent flag lands in the write group. F14
  matters most: a saved key that left the catalog stays visible and the config is not
  rewritten.
- `gatewayMigration.test.ts`. F13 and G5. Both legacy encodings migrate to the same result,
  and a migrated group reads back the permissions it was saved with.

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

## Open questions

These are gaps between the design documents and the code. Each one carries a recommendation.
Ask before departing from a recommendation.

### 1. What "Ask for write and delete" means when the agent-wide mode changes

The preset saves `default: "inherit"`. Under the agent-wide mode `allow_reads`, that means
reads run and writes ask, which is what the preset says. `allow_reads` is the default
agent-wide mode in the SDK and in the frontend. But an author can change the agent-wide mode
to `ask`, `allow`, or `deny`. The preset then quietly means something else while still
showing the same words.

**Recommendation.** Save `inherit`, and show a line under the select when the agent-wide mode
is not `allow_reads`: "This agent's permission policy is set to {mode}, so these tools follow
it." Do not expand the preset into an explicit per-tool map. An explicit map bloats the saved
entry, breaks when the catalog changes, and makes every new provider tool ask.

### 2. How the drawer shows a tool set to `inherit`

The saved format has four per-tool values. The design handoff gives the per-tool select three
options: Ask, Allow, and Deny. Migration writes `inherit` for every legacy tool that carried
no explicit permission, and today the frontend adds tools with no permission field. So after
migration, most rows will hold a value the select cannot show.

**Recommendation.** Add a fourth per-tool option named "Follow agent policy", with the same
glyph the "Ask for write and delete" preset uses. It is one extra row in a menu that already
exists, and it keeps the migrated value editable without losing it. This is a departure from
the handoff, so it needs a short design sign-off before Slice 6 builds it.

### 3. Whether an agent may hold both entry formats at once

`data-model.md` says readers accept both discriminators during migration. `runtime-tools.md`
says the model gets two tools when the agent has at least one connection entry. Neither says
what happens when an agent holds a connection entry and a legacy per-tool entry together.

**Recommendation.** Allow it. The legacy entry keeps producing its own named tool, and the
connection entry produces the two derived tools. The model then sees both surfaces for one
run. This costs nothing and keeps a half-migrated agent working. Slice 4 tests it.

### 4. Whether Composio's search operation accepts a toolkit filter

`runtime-tools.md` says implementation must check this before relying on query enrichment.
The current adapter sends only the queries and a session, with no scoping argument.

**Recommendation.** Slice 3 checks the current provider API first. If a native filter exists,
use it. If not, include the integration name in the use-case text and rely on the runner's
filter. Either way the runner filter is the boundary, so the answer changes result quality,
not correctness.

### 5. Latency of the catalog slice at run start

The compiler needs every catalog tool for each configured integration. Contracts section 3
returns that slice from `/tools/resolve` so the SDK makes one round trip per run instead of
one per tool. The API lists the catalog behind a five-minute cache. A cold list for a large
integration is several provider pages.

**Recommendation.** Ship it as described and measure the cold and warm resolve times in Slice
7. If a cold resolve is slow enough to hurt, the fix is a longer cache for the key and
`read_only` pair, not a change to the design.

### 6. Client tools and the new result-processing step

The runner passes every callback result to the harness unchanged today. Slice 5 adds the
first exception, for `gateway.search`.

**Recommendation.** Scope the step to the two gateway call references by name. Do not build a
general result-processing pipeline. A second case can generalize it later, with evidence.

## Conflicts between the design and the current code

The plan already resolves these. They are recorded so a slice does not rediscover them.

**There is no call reference include-list parser to delete.** The design's "API changes"
table says the API should accept a stable route "instead of parsing policy from `call_ref`".
On `main` there is no such parser. The include-list grammar exists only on the superseded
branch `feat/composio-toolkit-backend`. What `main` has is a five-segment routing grammar
that carries resource identity, not policy. So Slice 3 adds the new routes beside the old
grammar and deletes nothing. The old grammar must keep working for saved revisions and warm
sessions.

**The frontend has never written the canonical `gateway` entry.** The migration section of
`data-model.md` shows migrating from entries shaped `{"type": "gateway", "action": ...}`. The
current add drawer writes a different shape, a function entry whose name is a five-segment
slug. Both shapes exist in saved revisions. The migration in Slice 1 and Slice 6 must read
both. A migration that reads only the documented shape would silently drop most real agents'
tools.

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
