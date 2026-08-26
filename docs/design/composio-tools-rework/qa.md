# QA for gateway connections

This page defines the tests for the gateway connection rework. The saved configuration is
defined in [data-model.md](data-model.md). The runtime tools are defined in
[runtime-tools.md](runtime-tools.md). The permission layers are defined in
[permission-layers.md](permission-layers.md).

Every test in this page carries an ID. The release gate proposal in
[release-gate-changes.md](release-gate-changes.md) refers to those IDs.

## Test principles

1. **Test at the layer that fails.** The permission compiler is a pure function, so its
   truth table belongs in an SDK unit test. The operator override is a runner rule, so it
   belongs in a runner unit test. Do not test a compiler rule through a live agent run.
2. **A skipped test is a failed test.** This feature carries authorization logic. A skip in
   a permission, approval, or sandbox test counts as an untested claim. Report it as "N
   passed, M skipped, of which k are untested claims", and name the k.
3. **"Fixed" means live-verified by the person who fixed it.** Re-run the original scenario
   on the live stack. Read the stored row through `POST /sessions/interactions/query` or
   `POST /sessions/turns/query`. A green unit test is not a fix.
4. **Assert on the wire and on side effects, never on model prose.** Check the frame types,
   the stored interaction row, and the real provider result. Do not check what the model
   said about what it did.
5. **A filtered search result is not an authorization boundary.** Every test that proves
   `deny` must prove it at `run_tool`, not only at `search_tools`.
6. **A green turn can hide a dead component.** The runtime fails open. A turn that produced
   no text, no tool call, no approval card and no error is a swallowed failure, not a pass.

## Test layers and harnesses

| Layer | Location | Run command |
| --- | --- | --- |
| SDK unit | `sdks/python/oss/tests/pytest/unit/agents/tools/` | `cd sdks/python && py-run-tests` |
| API unit | `api/oss/tests/pytest/unit/tools/` | `cd api && py-run-tests` |
| API acceptance | `api/oss/tests/pytest/acceptance/tools/` | `cd api && py-run-tests` |
| EE API acceptance | `api/ee/tests/pytest/acceptance/tools/` | `cd api && py-run-tests` |
| Agent service unit | `services/oss/tests/pytest/unit/agent/tools/` | `cd services && py-run-tests` |
| Runner unit | `services/runner/tests/unit/` | `cd services/runner && pnpm test:unit` |
| Frontend unit | `web/packages/agenta-entity-ui/tests/unit/` | `pnpm --filter @agenta/entity-ui test` |
| Live QA | the running stack | See [Live QA script](#live-qa-script) |

API and acceptance tests mint ephemeral accounts through the fixtures in
`api/oss/tests/pytest/utils/accounts.py`. The fixtures are `foo_account`, `cls_account`,
and `mod_account`. Each returns `{"api_url", "credentials": "ApiKey ..."}`. Do not hand-roll
account creation.

`web/tests/` holds a Playwright harness with fixtures but no test files today. This feature
does not need a browser suite. Its browser-only steps stay in live QA.

## SDK compiler tests

The compiler is a new pure function. Its target file is
`sdks/python/agenta/sdk/agents/tools/gateway_policy.py`. It must not import API models.
Write its tests in a new file `sdks/python/oss/tests/pytest/unit/agents/tools/test_gateway_policy.py`.

### Permission resolution truth table

`entry` is the value in `policy.permissions.tools` for the tool key. `absent` means the map
has no key for that tool. `mode` is the agent-wide runner permission mode. `read_only` is
the catalog hint.

| ID | entry | default | mode | read_only | result |
| --- | --- | --- | --- | --- | --- |
| C1 | absent | `allow` | any | any | `allow` |
| C2 | absent | `ask` | any | any | `ask` |
| C3 | absent | `deny` | any | any | `deny` |
| C4 | absent | `inherit` | `allow` | any | `allow` |
| C5 | absent | `inherit` | `ask` | any | `ask` |
| C6 | absent | `inherit` | `deny` | any | `deny` |
| C7 | absent | `inherit` | `allow_reads` | `true` | `allow` |
| C8 | absent | `inherit` | `allow_reads` | `false` | `ask` |
| C9 | absent | `inherit` | `allow_reads` | absent | `ask` |
| C10 | `allow` | `deny` | any | any | `allow` |
| C11 | `ask` | `allow` | any | any | `ask` |
| C12 | `deny` | `allow` | any | any | `deny` |
| C13 | `inherit` | `deny` | `allow_reads` | `true` | `allow` |
| C14 | `inherit` | `deny` | `allow_reads` | `false` | `ask` |
| C15 | `inherit` | `deny` | `allow_reads` | absent | `ask` |
| C16 | `inherit` | `deny` | `deny` | any | `deny` |
| C17 | `inherit` | `allow` | `ask` | any | `ask` |

C13 is the case the format exists for. An absent key uses the connection default `deny`.
An explicit `inherit` skips that default and reaches the agent-wide mode. C3 and C13 must
not produce the same result.

C9 and C15 cover the unknown `read_only` hint. Unknown resolves like a write.

### Other compiler tests

| ID | Case | Expected |
| --- | --- | --- |
| C18 | Output values | The result contains only `allow`, `ask`, or `deny`. `inherit` never crosses the boundary. |
| C19 | Configured tool missing from the catalog | It is absent from the resolved executable policy. It is reported as a stale authoring entry. |
| C20 | Catalog tool with no entry and no default | Rejected at parse time. `default` is required. |
| C21 | Unknown permission value | Rejected at parse time. |
| C22 | Unknown top-level field | Rejected at parse time. |
| C23 | Empty `provider`, `integration`, or `slug` | Rejected at parse time. |
| C24 | Two `gateway_connection` entries for one provider and integration | Rejected at parse time. |
| C25 | Catalog grows a new tool after the config was saved | The new tool resolves through the connection default. |
| C26 | Provider `read_only: true` on a tool with an explicit `deny` | Result stays `deny`. Catalog metadata never overrides an authored `deny`. |
| C27 | Resolved policy wire shape | The Python and TypeScript models accept the same `gatewayPolicy` object. Extend `test_permission_parity.py`. |

C26 is a security rule, not a preference. Write it as its own test.

### Parsing and compatibility tests

Extend `sdks/python/oss/tests/pytest/unit/agents/tools/test_models.py` and
`test_parsing.py`. `GatewayToolConfig` with `type: "gateway"` lives in
`sdks/python/agenta/sdk/agents/tools/models.py` today.

| ID | Case | Expected |
| --- | --- | --- |
| C28 | A `gateway_connection` entry | Parses into the new model. |
| C29 | A legacy `gateway` entry | Still parses. Still resolves. Still runs. |
| C30 | A revision holding both entry types | Both parse. |
| C34 | Saved tool key absent from the current catalog | The revision stays parsable. Catalog drift must not break an old revision. |

C24, the duplicate-entry rule, is a revision-level rule. Drive it through
`coerce_tool_configs` with a list of entries. The single-entry `TOOL_CONFIG_ADAPTER` never
sees two entries and cannot enforce it.

C27, the cross-language wire shape, belongs to the slice that owns the wire model, not to the
compiler slice.

### Migration cases (TypeScript)

Migration runs in the frontend, so these are vitest cases in
`web/packages/agenta-entity-ui/tests/unit/gatewayMigration.test.ts`, not pytest cases. There
is no Python migration function.

| ID | Case | Expected |
| --- | --- | --- |
| C31 | Legacy group migration | Entries that share provider, integration, and connection group into one entry with `default: "deny"`. |
| C32 | Legacy entry with no `permission` | Maps to `inherit`. |
| C33 | Legacy entry with `permission: "allow"` | Maps to `allow`. |

## API tests

The tools router is `api/oss/src/apis/fastapi/tools/router.py`. `POST /tools/call` enforces
`Permission.RUN_TOOLS`. The Composio adapter is
`api/oss/src/core/tools/providers/composio/adapter.py`.

A provider search fixture already exists at
`api/oss/tests/pytest/unit/tools/fixtures/composio_search_tools.json`. Reuse it. Do not call
Composio from a unit test.

### Search route

| ID | Case | Expected |
| --- | --- | --- |
| A1 | A provider search response | Translates into Agenta `integration` and `tool` keys. |
| A2 | Each translated result | Carries `name`, `description`, and an object `input_schema`. |
| A3 | A result the API cannot map to a catalog tool key | Dropped before the response. |
| A4 | Agent permissions | The API does not apply them. The translated response is not filtered by policy. |
| A5 | An empty `query` | Rejected with an actionable error. The provider is not called. |
| A6 | An unconfigured `integration` | Rejected before the callback. **Owned by the runner**, not the API. See the note below. |
| A7 | A provider transport failure | Returns `code: "tool_search_unavailable"` with `retryable: true`. |
| A8 | The search cache | A repeated identical query does not call the provider twice. |
| A9 | The native toolkit filter | The outbound provider request carries the toolkit filter for the requested integration. Assert the request shape. |

A4 looks strange but it is the design. The runner owns the policy filter. An API test that
asserted permission filtering would encode the wrong ownership.

A6 moved to the runner for the same reason. The search context carries only `provider`, and
the set of integrations configured on the agent lives in `gatewayPolicy`, which is private to
the runner. The API cannot know whether a model-supplied integration is configured, so it
cannot make this check. Write A6 as a runner test.

A9 is no longer conditional. Toolkit scoping was measured on 2026-08-26 and the provider
supports it, at the same latency as an unscoped search. Assert the filter is present. Do not
write a fallback path or a test for one.

### Run route

| ID | Case | Expected |
| --- | --- | --- |
| A10 | A caller without `RUN_TOOLS` | 403. Extend `api/oss/tests/pytest/unit/tools/test_platform_handlers.py`. |
| A11 | A tool key that belongs to another integration | Rejected. The tool must belong to the selected integration. |
| A12 | A connection from another project | Rejected. |
| A13 | A revoked connection | Rejected at execution time. |
| A14 | An inactive or invalid connection | Rejected at execution time. |
| A15 | An unknown or stale tool key | Error carries up to five close keys from the same integration's catalog. |
| A16 | The close-key list | Contains no key from another integration. The API scopes suggestions to the integration in the context. |
| A17 | `arguments` is a string, an array, or `null` | Actionable error. Never replaced with `{}`. |
| A18 | `arguments` is a valid object | Forwarded byte-for-byte to the provider adapter. |
| A19 | The provider action ID | Read from the catalog. Never rebuilt by string concatenation from integration and tool strings. |
| A20 | A provider rejection | The provider detail survives into the error so the model can correct the request. |
| A21 | Private callback context | The route reads provider, integration, connection, and tool from the context, not from the function arguments. |

A17 and A19 are both regressions of named current defects. Write them first.

A16 scopes suggestions to one integration, which is all the API can do. It cannot drop a key
the agent denied, because it does not hold the agent's policy. The runner sanitizes the list
against `gatewayPolicy` before the model sees it. That is case R30.

A19 is worth stating precisely, because it is the defect that already reached production: the
provider action ID must come from the catalog on every path, including the legacy five-segment
route, and no code path may rebuild it by joining the integration and the tool key.

### EE and acceptance

| ID | Case | Expected |
| --- | --- | --- |
| A22 | Role gating on the EE tools routes | Mirrors `api/ee/tests/pytest/acceptance/tools/test_tools_connections.py`. |
| A23 | The `/tools/connections` contract | Unchanged by this rework. `api/oss/tests/pytest/acceptance/tools/test_tools_connections.py` still passes. |

A23 is exactly one regression check on the connections contract. Do not extend it with
resolve-route or gateway-route coverage. A request that mixes a legacy entry and a connection
entry is case G11.

## Runner tests

The policy module is `services/runner/src/permission-plan.ts`. Approval interactions are
raised in `services/runner/src/engines/sandbox_agent/acp-interactions.ts`. Write the new
tests under `services/runner/tests/unit/`.

### The gate

| ID | Case | Expected |
| --- | --- | --- |
| R1 | Compiled `deny` | Rejected. No callback is made. |
| R2 | Compiled `allow` | The callback is made. No approval card appears. |
| R3 | Compiled `ask` | A `user_approval` interaction is created. The turn pauses. |
| R4 | An integration absent from the resolved policy | Treated as `deny`. |
| R5 | A tool key absent from the resolved policy | Treated as `deny`. |
| R6 | Operator deny plus compiled `allow` | Rejected. The operator switch is a first-class top-priority condition, not a replacement for the runner default. |
| R7 | Operator deny plus a stored `allow` approval answer | Rejected. Order is operator deny, then compiled permission, then stored answer. |
| R8 | Operator deny turned on after run start | Rejected. Drive it by flipping the switch between two decisions inside one run, not by building a second plan. |
| R8b | Operator deny and a client tool | Rejected. Client tools take a path that does not call the shared permission function today, so the fix must reach them too. |

R6 is the correction named in [permission-layers.md](permission-layers.md). The current
implementation replaces only the runner default, so an explicit `allow` can win today.
This test must fail before the fix and pass after it.

R8 and R8b are the second half of that correction, and they are separate failures. The
permission plan is built once at run start, so a switch flipped mid-run does not reach a live
run. And not every tool family routes through the shared decision function. A fix that only
reorders the checks inside that function passes R6 and still fails both of these. The switch
must be read at decision time, in a path every tool family shares.

### Delivery paths

The runner must apply the gate on every path that can deliver a tool call. The sandbox
relay is `services/runner/src/tools/relay.ts`. The build guard is
`services/runner/src/engines/sandbox_agent/relay-guard.ts`.

| ID | Case | Expected |
| --- | --- | --- |
| R9 | A model tool call over the harness path | Gated. |
| R10 | A relay request file written inside the sandbox | Gated by the same rule, with the same result as R9. |
| R11 | A relay request naming a denied tool | Rejected. The response file carries an error, not a result. |
| R12 | A relay request naming an unconfigured integration | Rejected. |
| R13 | A relay request naming a tool with compiled `ask` | Creates a real Sessions interaction and pauses the turn. It neither runs nor is refused outright. |
| R14 | The sandbox bundle | Contains no connection slug, no resolved policy, and no callback credential. Extend `services/runner/tests/unit/tool-relay-guard.test.ts`. |
| R29 | A relay request whose `arguments` is a string, an array, or `null` | Rejected before approval. The type is checked, not only the presence of required keys. |

R10 through R13 are the core security tests of this feature. The model naming a tool is not
proof that the tool is permitted.

R13 is the hardest of them to satisfy and the easiest to fake. The relay seam can execute or
refuse today, but it cannot create an interaction or end a turn. A test that accepts a
refusal here passes against an implementation that silently denies every relay-path `ask`,
which is the wrong behavior. Assert the interaction row and the pause.

R29 exists because the current required-argument check tests presence only. A forged relay
file can carry a value of the wrong type and reach the approval card with input the schema
would reject.

### Approval identity

| ID | Case | Expected |
| --- | --- | --- |
| R15 | The approval interaction payload | Carries the integration, the tool key, and a safe view of the arguments. |
| R16 | The approval card content | Shows the integration tool and its arguments, not only the name `run_tool`. |
| R17 | Two integrations that share a tool key | Produce two distinct approval identities. An answer for one does not satisfy the other. |
| R18 | The same tool with different arguments | Produce two distinct approval identities. |
| R19 | Arguments between the check and the callback | Forwarded unchanged. The runner does not rewrite malformed input. |
| R20 | An approval answer consumed once | A second call for the same identity raises a fresh gate. |
| R21 | An unanswered approval, then a new user message | The tool does not run. The row is swept to `cancelled`, not left `pending`. |

R17 should pass with the existing `approvedCallKey` helper, without a new keying scheme. That
helper keys on the tool name plus the canonical arguments, and for `run_tool` the arguments
already contain the integration and the tool key, so two integration tools already produce
two keys. Write R17 to prove that, and keep the full outer arguments when computing the key.

Inventing a gateway-specific identity would put a second keying scheme beside the one every
other tool uses, and warm-session resume depends on that one. The real new work is R16, the
semantic display on the card.

### Search result filter

| ID | Case | Expected |
| --- | --- | --- |
| R22 | A result from an unconfigured integration | Removed. |
| R23 | A result whose tool key is missing from the resolved policy | Removed. |
| R24 | A result whose compiled permission is `deny` | Removed. |
| R25 | A result with no usable object input schema | Removed. |
| R26 | Ten passing results | At most five reach the model. |
| R27 | All results removed | Returns an empty list with the short message. The message names no unconfigured integration. |
| R28 | The result payload | Carries no connection slug, no provider account ID, no provider action ID, no permission value, and no `read_only` flag. |
| A6 | A search naming an integration the agent did not configure | Rejected before the callback. The provider is never called. |
| R30 | A `gateway.run` error carrying close-key suggestions | Keys that are denied or absent from `gatewayPolicy` are removed before the model sees the error. |

R28 must assert on the serialized payload, not on the object the runner built.

R30 is an error-payload field edit, not result transformation. The API builds suggestions
from the whole integration catalog and cannot know the agent's policy, so an unsanitized list
tells the model the exact names of the tools it is forbidden to run. It pairs with N10 and
N14: a refusal must not enumerate what is available.

## Frontend tests

The permission helper is
`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/toolPermission.ts`. Its tests
are in `web/packages/agenta-entity-ui/tests/unit/toolPermission.test.ts`. The tools list is
`.../SchemaControls/agentTemplate/ToolManagementList.tsx`. The section groups are
`.../SchemaControls/sectionGroups.tsx`. The add drawer is
`.../SchemaControls/agentTemplate/AgentIntegrationDrawer.tsx`. The connect flow is
`web/packages/agenta-entity-ui/src/gatewayTool/drawers/ConnectDrawer.tsx`. The catalog
chooser is `web/packages/agenta-entity-ui/src/drawers/shared/CatalogChooser.tsx`.

Test the pure translation functions with vitest. Do not test the drawer layout.

| ID | Case | Expected |
| --- | --- | --- |
| F1 | Preset "Always ask" to config | `default: "ask"`, empty `tools`. |
| F2 | Preset "Ask for write and delete" to config | `default: "inherit"`, empty `tools`, with the agent mode `allow_reads`. |
| F3 | Preset "Allow all" to config | `default: "allow"`, empty `tools`. |
| F4 | Preset "Deny all" to config | `default: "deny"`, empty `tools`. |
| F5 | Config to preset, round trip | Each of F1 to F4 reads back as the same preset. |
| F6 | Config with one tool override | Reads back as "Custom". |
| F7 | Override count | Equals the number of saved entries in `tools`, including an entry whose value happens to equal the current default. |
| F8 | Setting one tool permission | Switches the preset to "Custom" and keeps the other tools unchanged. |
| F9 | Picking a preset while on "Custom" | Clears the overrides. |
| F10 | The read-only and write partition | Comes from the catalog `read_only` flag. A tool with an absent flag lands in the write group. |
| F11 | A group rollup summary | Summarizes the SAVED values of the tools in that group: one shared value when they agree, a mixed label when they do not. A group saved `inherit` reads "follows agent policy". |
| F12 | A legacy `gateway` entry group | Renders as one integration row with a deprecated badge. |
| F13 | A legacy group | Reads back the same permissions it was saved with. |
| F14 | A saved tool key absent from the catalog | Shows as a stale entry. The row does not disappear and the config is not rewritten. |
| F15 | Write-through | A permission change lands in the draft config immediately. |
| F16 | Choosing a different connection for an already-configured integration | REPLACES the existing entry in one write. Never appends a second entry for that integration. The saved policy is kept and only the connection slug changes. |
| F17 | An integration whose legacy entries name two or more connections | NOT migrated. Its legacy entries stay exactly as they are and keep the legacy badge. Other integrations in the same revision migrate normally. |

F14 matters because the drawer must not silently drop an authored intent when the provider
catalog changes.

F7 counts saved entries, not entries that differ from the preset. The two rules disagree
whenever an entry is redundant, and the comparison rule can show "Custom" with a count of
zero. [contracts.md](contracts.md) section 10 states the same single rule.

F11 asserts an authored-policy rollup. The drawer must not resolve `inherit` to build it.
Resolving would mean a second copy of the compiler in TypeScript, reading an agent-wide mode
the drawer does not own, and the two copies would drift.

F16 exists because the saved format allows one entry per provider and integration. An append
produces a revision the SDK refuses, and the author would not find out until run time.

F17 is the migration case the design's own rules do not cover. Grouping by connection would
give one integration two entries, which validation rejects. Leaving it unmigrated is the only
option that neither guesses the author's intent nor drops entries.

## Live QA script

Run this on a deployed stack with a real Composio connection. It is the primary user
journey. Every step names what to check.

### Setup

1. Open the workspace settings. Connect one Composio integration. Use GitHub or Slack.
2. Check that the connection shows as connected and valid.
3. Open the playground. Create an agent.

### Journey

| Step | Action | Check |
| --- | --- | --- |
| 1 | Open the Tools section. Click the plus icon. | The add-integration drawer opens. It lists the connected integration under `CONNECTED IN YOUR WORKSPACE`. |
| 2 | Add the integration. | The drawer stays open. The Playground shows one integration row. Its glyph reads "Ask for write and delete". |
| 3 | Click Done, then click the integration row. | The permission drawer opens. It shows the connection slug in the subtitle and a Connected state. |
| 4 | Set the default preset to "Ask for write and delete". | The two tool groups show the read-only rollup as "runs automatically" and the write rollup as "asks first". |
| 5 | Search for a destructive tool. Set it to Deny. | The preset switches to "Custom" with an override count of 1. The row shows the deny style. |
| 6 | Search for a write tool. Set it to Ask. | The override count reads 2. |
| 7 | Save the revision. | Read the stored revision through the API. Its `parameters.agent.tools` holds one `gateway_connection` entry with the two tool keys. |
| 8 | Ask the agent, in plain words, to do a task the denied tool would serve. | `search_tools` runs. The denied tool key is absent from the result. Read the tool output payload on the wire, not the reply text. |
| 9 | Ask the agent to do the task the `ask` tool serves. | `run_tool` pauses. An approval card appears. |
| 10 | Read the approval card. | It names the integration and the tool key. It shows the arguments. It does not read only `run_tool`. |
| 11 | Approve. | The provider call executes. Check the real side effect in the provider, for example the created issue or the posted message. |
| 12 | Read the stored session rows. | `POST /sessions/interactions/query` holds the `user_approval` row, resolved. `POST /sessions/turns/query` holds the turn. |
| 13 | Ask for a tool that resolves to `allow`. | It runs with no card. |
| 14 | Ask the agent to run the denied tool by name. | The runner rejects it. No callback reaches the API. No card appears. |

Steps 8 and 14 are the pair that matters. Step 8 proves the filter. Step 14 proves the gate.
A pass on step 8 alone proves nothing about authorization.

### Weak-model journey

Run the same journey again with a small model. Use Haiku. The one-shot benchmark showed a
small model works when it searches once and then runs, and fails when it searches again and
again.

| Step | Check |
| --- | --- |
| W1 | The model calls `search_tools` once for the task. |
| W2 | The model selects a returned integration and tool key. It does not invent a key. |
| W3 | The model copies the arguments from the returned schema. |
| W4 | The model does not repeat an equivalent search after a usable result. |
| W5 | After one simulated search failure, the model retries once and then stops. |
| W6 | The task completes end to end. |

Record the search count per task. Record the selected result rank. Record any execution
attempt with no prior successful search. Those three numbers decide whether the prompt
guidance needs to change.

The task prompts in this journey must be phrased the way a user types them. Do not name
`search_tools`, `run_tool`, or a tool key in the prompt. A prompt that names the mechanism
proves the backend path works. It proves nothing about what a model finds on its own.

## Regression list

| ID | Case | Expected |
| --- | --- | --- |
| G1 | An agent saved before this rework, with legacy `gateway` entries | Loads, resolves, and runs unchanged. |
| G2 | A legacy entry with `permission: "allow"` | Still runs without a card. |
| G3 | A legacy entry with `permission: "ask"` | Still raises a card. |
| G4 | A legacy entry with no `permission` | Follows the agent-wide mode, as before. |
| G5 | The Playground row for a legacy group | Shows the deprecated badge. |
| G6 | An agent with no gateway connection | Gets neither `search_tools` nor `run_tool`. |
| G7 | The existing agent journeys | `chat`, `mount`, `tool`, `approve`, `deny`, and `commit` still pass. |
| G8 | The client-tool round trip | Unaffected. The gateway approval reuses the machinery but does not change it. |
| G9 | `POST /tools/call` for a non-gateway `call_ref` | Unchanged routing. |
| G10 | The connections and catalog HTTP contracts | Unchanged. |
| G11 | A revision that mixes a legacy entry and a new entry | Both resolve. `/tools/resolve` answers the legacy entry in `custom` and the connection entry in `gateway_connections`. |
| G12 | A legacy entry and a connection entry with CONFLICTING permissions for the same tool | Each surface keeps its own rule. The legacy entry is its own named tool with its own permission. The connection policy governs only calls made through `run_tool`. Neither silently overrides the other. |

G12 is the case that makes mixed revisions more than a transient state. F17 leaves some
integrations unmigrated on purpose, so an agent can hold both formats indefinitely. Assert
the rule rather than assuming migration will resolve it later.

## Negative and security cases

| ID | Case | Expected |
| --- | --- | --- |
| N1 | The model names an integration the agent did not configure | The runner denies before the callback. The error names no unconfigured integration. |
| N2 | The model names a denied tool directly, with no prior search | The runner denies. No callback. No card. |
| N3 | The model invents a tool key | The runner denies. The API also rejects it if reached. |
| N4 | A relay request file inside the sandbox forges a call to a denied tool | Rejected by the runner gate. |
| N5 | A relay request file forges a connection slug or a provider account ID | Ignored. The runner uses its own private policy for connection selection. |
| N6 | A relay request file forges an approval answer | Ignored. Approval state lives in the runner and the Sessions API. |
| N7 | The connection slug in any model-visible payload | Absent. Check the tool specifications, the search results, the run result, the error messages, and the approval card. |
| N8 | The Composio API key | Never enters the sandbox. It never appears in the bundle, the environment, or a relay file. |
| N9 | The resolved policy table | Never enters the sandbox and never appears in a tool name or a `call_ref`. |
| N10 | A close-key suggestion after a stale key error | Names no denied tool and no unconfigured integration. The runner sanitizes the list; the API cannot, because it does not hold the agent's policy. See R30. |
| N11 | A search that Composio answers with unconfigured integrations | The model sees none of them. |
| N12 | A user with `RUN_TOOLS` calling `/tools/call` directly | Allowed. Agent permission policy governs model execution. It is not project RBAC. Record this as intended, not as a leak. |
| N13 | An approval answer for one integration replayed against another | Rejected. R17 covers the unit case. Check it live once. |
| N14 | The error text for a denied tool | Says the tool is not available. It does not list the tools that are available. |

N12 is the one case where the expected result looks wrong. The trust model says a project
credential with `RUN_TOOLS` can call the Tools API directly, as today. Write the test so a
future reader knows it was a decision.

N7 and N8 must be checked by reading the real serialized payloads and the real sandbox
contents. Do not check them by reading the code.
