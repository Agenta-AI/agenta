# What the code does today

Every claim here was read from the repository on 2026-07-30, before the fix landed, so this file
records the state that produced the bug. The empty `tools` list it describes is what
[PR #5597](https://github.com/Agenta-AI/agenta/pull/5597) replaced with Pi's four default
built-ins. File paths are repository-relative.

## The two fields named `tools`

The single largest source of confusion in this area is that two different fields are called
`tools`, at two different layers, with two different shapes.

| Layer | Field | Shape | Meaning |
| --- | --- | --- | --- |
| Agent template (saved config) | `parameters.agent.tools` | list of tool-config objects discriminated by `type`: `builtin`, `gateway`, `code`, `client`, `reference`, `platform`, or an `@ag.embed` reference | Everything the agent can call |
| Runner `/run` request | `tools` | list of plain strings | The Pi built-ins this run may use |

Everything in the template that is not `type: "builtin"` leaves the template through
`customTools`, not through `tools`. So a template `tools` list of ten entries can produce a
`/run` `tools` list of zero.

The strict schema arm is `ToolConfig`
(`sdks/python/agenta/sdk/agents/tools/models.py:245`), so the published JSON Schema describes
only the typed-dict form. The runtime coercion in
`sdks/python/agenta/sdk/agents/tools/compat.py:62` is looser and also accepts a bare string
(`"read"`) and a bare `{"name": "read"}`. Any value written into the shipped default must use
the typed form, because the default is validated against the strict schema.

## The chain from saved config to Pi's active tool list

1. `AgentTemplate.from_params` (`sdks/python/agenta/sdk/agents/dtos.py:637`) reads
   `parameters.agent.tools`. `_parse_agent_fields` (`dtos.py:1323`) uses the template value when
   it is not `None`, and otherwise falls back to the composition's default template.
2. `_coerce_tools` (`dtos.py:622`) turns each entry into a `ToolConfig`.
3. `ToolResolver.resolve` (`sdks/python/agenta/sdk/agents/tools/resolver.py:113`) splits the
   list. Entries of type `builtin` become `builtin_names`; everything else becomes `tool_specs`.
4. `PiHarness._to_harness_config` (`sdks/python/agenta/sdk/agents/adapters/harnesses.py:75`)
   copies `builtin_names` onto the `PiAgentTemplate` unchanged.
5. `PiAgentTemplate.wire_tools()` (`dtos.py:881`) emits `"tools": list(self.builtin_names)`. The
   key is always present.
6. `request_to_wire` (`sdks/python/agenta/sdk/agents/utils/wire.py:82`, spread at `:142`) folds
   that into the `/run` body, which `sdks/python/agenta/sdk/agents/adapters/sandbox_agent.py:85`
   POSTs to the runner.
7. `normalizePiBuiltinGrants` (`services/runner/src/engines/sandbox_agent/run-plan.ts:196`) turns
   the field into the grant list. Missing field yields `PI_DEFAULT_ACTIVE_BUILTINS`
   (`run-plan.ts:192`, the four names `read`, `bash`, `edit`, `write`). Present-but-empty yields
   an empty list.
8. `replaceActiveBuiltinTools` (`services/runner/src/extensions/agenta.ts:157`) rewrites Pi's
   active tool set at `before_agent_start` (`agenta.ts:213`), keeping the granted built-ins in
   place and deleting the rest. Non-built-in tools keep their positions.

Step 5 is why the "missing field" branch in step 7 never fires from the platform.

## Permission gating already works and is separate from granting

Granting a built-in is not the same as letting it run. The two are enforced at different points.

- The grant list decides whether the tool exists at all. It is applied once, before the agent
  starts.
- The permission plan decides whether an existing tool may run this time. The `tool_call` hook at
  `services/runner/src/extensions/agenta.ts:224` reports every built-in call, and `piDialogAllows`
  (`agenta.ts:102`) blocks unless the runner answers `allow`. This landed in commit `3606e5d5cb`
  on 2026-07-10 and is on `main`.

The read-only table at `services/runner/src/permission-plan.ts:40` marks `read`, `grep`, `find`,
and `ls` read-only, and `bash`, `edit`, `write` not read-only. Under the shipped default
permission mode `allow_reads` (`sdks/python/agenta/sdk/utils/types.py:1072`), a granted read-only
tool runs without asking and a granted tool that is not read-only raises an approval. That table
classifies names; it does not grant them. Only a granted built-in runs at all, so `grep`, `find`,
and `ls` stay unavailable unless an author grants them. Under the four-name default this design
ships, `read` runs without asking and `bash`, `edit`, and `write` each raise an approval.

`computeBuiltinGatingActive` (`run-plan.ts:233`) decides whether to run the gating machinery at
all. It turns gating on when the resolved permission plan could gate a built-in, or when the
grant list differs from `PI_DEFAULT_ACTIVE_BUILTINS`. A default agent has permission mode
`allow_reads`, so `plan.default !== "allow"` and gating is on regardless of the grant list.

## What the playground does differently

`build_agent_template_overlay()` (`api/oss/src/core/workflows/build_kit.py:75`) returns a
fragment that prepends `{"type": "builtin", "name": n}` for each of `AGENTA_FORCED_TOOLS`
(`sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py:64`, the value `["read", "bash"]`),
then the platform ops, then the reserved client-tool embeds.

The backend produces the overlay but never merges it. Two consumers serve it:
`api/oss/src/apis/fastapi/applications/router.py:1915` ships it as
`additional_context.playground_build_kit.agent_template_overlay`, and
`api/oss/src/core/workflows/static_catalog.py:229` registers it as the `__ag__build_kit` static
workflow, which is marked non-embeddable and is rejected at commit
(`api/oss/src/core/workflows/service.py:1340`).

The frontend applies it, per run only.
`web/packages/agenta-playground/src/state/execution/agentRequest.ts:326` calls
`withBuildKitOverlay` on a throwaway copy of the run parameters. The merge lives in
`web/packages/agenta-playground/src/state/execution/buildKitOverlay.ts`. For list sections
(`tools`, `skills`, `mcps`) it merges by identity, computed at `buildKitOverlay.ts:47`:
`platform:<op>`, else `workflow:<slug>`, else `name:<name>`. An overlay entry whose identity
matches a base entry replaces that base entry in place. An overlay entry with no match is
appended.

The consequence for this project: if the base template already carries
`{"type": "builtin", "name": "read"}`, the overlay's identical entry replaces it in place. No
duplicate appears, and the merged list is unchanged apart from ordering. A base entry stored as
the bare string `"read"` would not match (`isRecord` fails at `buildKitOverlay.ts:48`) and would
produce a duplicate, which is another reason the default must use the typed-dict form.

Note that the overlay grants only `read` and `bash`, so the playground has never had `edit` or
`write` either. An agent that appears to write files in the playground is writing them through
`bash` redirection.

## The default template and its consumers

`build_agent_v0_default()` lives at `sdks/python/agenta/sdk/utils/types.py:1412` and emits
`"tools": []` at `:1429`. Three production call sites read it.

| Call site | What it is |
| --- | --- |
| `services/oss/src/agent/schemas.py:41` | The `default` on `parameters.agent` in the agent service's `/inspect` schema |
| `sdks/python/agenta/sdk/engines/running/interfaces.py:537` | The `default` on the same field of the SDK built-in interface `agenta:builtin:agent:v0` |
| `sdks/python/agenta/sdk/engines/running/utils.py:288` | The fallback parameters for a run that binds `agenta:builtin:agent:v0` with no parameters at all |

The `/inspect` default and the built-in interface default are pinned equal to each other and to
the builder by `services/oss/tests/pytest/unit/agent/test_default_agent_template.py`.

### How a newly created agent gets that value

The frontend does not read a JSON Schema `default`. The backend hoists object defaults out of
the schema and into a materialized `parameters` block:
`api/oss/src/resources/workflows/catalog.py:104` extracts each parameter property's `default`
into `data["parameters"]`, then `_normalize_parameter_schema_defaults` (`catalog.py:74`) strips
the non-primitive default back off the schema. The templates endpoint
(`api/oss/src/apis/fastapi/workflows/router.py:166`) serves the result.

The frontend factory `createEphemeralAppFromTemplate`
(`web/packages/agenta-entities/src/workflow/state/appUtils.ts:134`) copies
`template.data.parameters`, overlays the author's last-used harness, model, and connection, and
`web/oss/src/components/pages/agent-home/hooks/useCreateAgent.ts:84` posts the result as the
agent's first revision. So the value in `build_agent_v0_default()` is literally what lands in a
new agent's saved configuration.

### Other independent copies of the default

These do not call the builder and can drift.

- `services/oss/src/agent/config.py:26` duplicates the default model and AGENTS.md text, and its
  `load_config()` supplies `tools: []` at `:106`. This is the request-time fallback used when a
  request carries no template at all (`services/oss/src/agent/app.py:58`, threaded to the SDK at
  `sdks/python/agenta/sdk/agents/handler.py:265`), and it never touches
  `build_agent_v0_default()`.
- `services/runner/config/agent.json` and `services/runner/config/AGENTS.md` are the on-disk
  editable copies of the same default.
- `sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py:126` holds a documentation copy of
  the config shape bundled into the build-an-agent skill, with `"tools": []` in its example.
- `sdks/python/oss/tests/pytest/unit/test_skill_template_catalog.py:70` hand-copies the template
  and claims to mirror the default.

## The harness that already forces built-ins

`AgentaHarness` (harness kind `pi_agenta`) unions `AGENTA_FORCED_TOOLS` into `builtin_names` at
`sdks/python/agenta/sdk/agents/adapters/harnesses.py:141` through `force_tools()`
(`agenta_builtins.py:774`). So a `pi_agenta` agent always has `read` and `bash`, anywhere it
runs. `PiHarness` (`pi_core`, the shipped default) forces nothing.

## The Claude warning

`ClaudeHarness._to_harness_config` (`harnesses.py:94`) drops built-ins and logs:

```python
if config.builtin_names:
    log.warning(
        "ClaudeHarness ignores %d built-in tool(s); built-ins are a Pi concept",
        len(config.builtin_names),
    )
```

Today this warning almost never fires, because almost no template carries built-ins. If the
default template carries four, every Claude run started from a default-derived template logs it.

## What the author can see and change in the UI

There is already a built-in picker, and it is not in the Tools section.

`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/PiSettingsControl.tsx` renders a
multi-select labelled "Built-in tools" over exactly Pi's seven names (`PiSettingsControl.tsx:33`).
It reads and writes the same `parameters.agent.tools` array
(`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/useModelHarness.tsx:1000`), and it
appears in the Advanced section under Permissions, only when the harness is `pi_core` or
`pi_agenta` (`useModelHarness.tsx:186`).

Three facts about it matter for this work.

- Its help text reads "Optional Pi built-ins to author explicitly; empty leaves Pi's harness
  defaults." That is false. An empty selection produces no grants and Pi loses all built-ins.
- Its write path (`PiSettingsControl.tsx:83`) calls `onChange(nextTools.length ? nextTools : undefined)`.
  Deselecting every built-in on a template with no other tools removes the `tools` key entirely.
  Removing the key does not reach the runner's missing-field branch: `_parse_agent_fields` falls
  back to the composition default, which is `[]`, and `wire_tools` emits `[]`.
- It moves every selected built-in to the end of the `tools` array on each write.

The Tools section itself has no built-in picker.
`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/AgentToolSelectorPopover.tsx:9`
says so explicitly in its header comment. A built-in that is already in the list renders as a row
in the "Built-in" group of `ToolManagementList.tsx:284`, and clicking it opens a JSON-only drawer
because `itemKinds.tsx:85` returns `"json"` for anything that is not a function tool, a reference
tool, or a gateway tool.

The row label is wrong too. `describeTool`'s built-in branch
(`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/itemDescriptors.tsx:195`)
labels the row from the entry's `type` and ignores its `name`. Every Pi built-in therefore renders
with the identical label "builtin". The branch was written for provider built-ins such as
`{type: "web_search_preview"}`, where `type` is the name.

## Tests that touch this behavior

### Tests that would fail on a default-template change

`services/oss/tests/pytest/unit/agent/test_default_agent_template.py:68` and `:74` assert
`inspect_default["tools"] == []` and `builtin_default["tools"] == []`. These are the only
assertions in the repository that would break.

### Tests that adapt on their own

`api/oss/tests/pytest/unit/tools/test_platform_handlers.py:237` and
`sdks/python/oss/tests/pytest/unit/test_workflow_shapes_running.py:261` both compute their
expectation from `build_agent_v0_default()`.

### The shared golden fixtures are not affected

`sdks/python/oss/tests/pytest/unit/agents/golden/` holds six files. Two carry a `tools` field:
`run_request.pi_core.json` (`["read", "write"]`) and `run_request.claude.json` (`[]`).

`sdks/python/oss/tests/pytest/unit/agents/test_wire_contract.py` builds a `PiAgentTemplate` with
`builtin_tools=["read", "write"]` hardcoded at `:125`, runs it through `request_to_wire`, and
asserts equality against the golden at `:243`. It never imports `build_agent_v0_default` and
never calls `AgentTemplate.from_params`. `services/runner/tests/unit/wire-contract.test.ts` reads
the same files in place (`services/runner/tests/utils/golden.ts:15`) and asserts on the parsed
request; it does not build a run plan from them.

So changing the default template moves no golden fixture and no pinned wire contract. The `/run`
field shape is unchanged: it stays `tools?: string[]` at `services/runner/src/protocol.ts:469`.

### Existing runner coverage of the grant list

- `services/runner/tests/unit/builtin-grant-list.test.ts` pins that `tools: ["read"]` yields
  exactly `["read"]` and that `replaceActiveBuiltinTools` drops the rest.
- `services/runner/tests/unit/sandbox-agent-run-plan.test.ts:205` is the closest existing test to
  this bug. It pins that an omitted `tools` key yields the four defaults with gating off, and that
  `tools: []` yields no grants with gating on. It asserts the runner's semantics are correct. It
  cannot catch this bug, because the bug is that the platform never sends the omitted form.
- `services/runner/tests/unit/extension-tools.test.ts:224` pins that
  `replaceActiveBuiltinTools` preserves the positions of non-built-in tools.
- `services/runner/tests/unit/sandbox-agent-pi-assets.test.ts:203` pins the env vars
  `AGENTA_AGENT_BUILTIN_GATING` and `AGENTA_AGENT_BUILTIN_GRANTS`.

The gap the bug fell through is that no test drives the default template all the way to a `/run`
body. The Python side tests the default template's contents, and the runner side tests the wire
field's semantics, and nothing joins them.
