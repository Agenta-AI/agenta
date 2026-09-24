# Agenta tools kit: implementation plan

**Goal:** Offer `rename_session`, the automation tools, and later the channel tools in every run of an agent, with a saved switch to turn them off, while the build kit keeps only the playground authoring tools.

**Architecture:** The SDK defines the kit. The agent handler (`sdks/python/agenta/sdk/agents/handler.py`) adds the kit's tools to the run's tool list just before it resolves tools, after it reads the saved `agenta_tools` switch, the run kind, the session, and the variant. An author's own entry always wins, and nothing is written back to the configuration. Default permissions come from a new optional field on platform operations. The API drops the moved tools from the build kit, publishes the kit as a read-only static workflow for the playground, and marks automation and evaluation runs. The playground shows the kit as a block of switches that edit the draft.

**Tech stack:** Python 3 with Pydantic (SDK and service); FastAPI (API); TypeScript with React, Jotai, and Vitest (`@agenta/entities`, `@agenta/entity-ui`, `@agenta/playground`).

Read [design.md](design.md) first. Each phase ships as its own pull request, in this order. Phase 1 can ship alone: the build kit still sends the moved tools, and the duplicate rule keeps runs working. Phase 2 must not ship before phase 1, or playground runs lose the moved tools. Phase 3 should ship with phase 1 or 2. Phase 4 can follow in the next release. Phase 5 waits for the channel-tools change.

## Conventions used in every task

Commands run from the repository root unless a `cd` is shown.

- **SDK unit test:** `cd sdks/python && uv run --no-sync python run-tests.py <path>[::<test>]`. Run `uv sync --locked` once first.
- **Service unit test:** `cd services && uv run --no-sync python run-tests.py <path>[::<test>]`.
- **API unit test:** `cd api && uv run --no-sync python run-tests.py <path>[::<test>]`.
- **Web unit test:** `cd web/packages/<package> && pnpm vitest run <path>`.
- **Before each commit:** `ruff format && ruff check --fix` in `sdks/python`, `services`, or `api` for Python changes. `cd web && pnpm lint-fix` for web changes. In a GitButler workspace, commit with `but commit <branch> -m "<message>"`. Otherwise use `git commit -m "<message>"`.

Every task follows five steps: (1) write the failing test, (2) run it and see it fail, (3) implement, (4) run it and see it pass, (5) commit. When the run command is the same for steps 2 and 4, it is written once.

---

## Phase 1: The kit on the agent service

PR title: `feat(sdk): add the Agenta tools kit to every agent run`. Size: M, 5 tasks, about 2-3 days.

### Task 1.1: Default permission on platform operations

- Modify: `sdks/python/agenta/sdk/agents/platform/op_catalog.py` (add `default_permission: Optional[Permission] = None` to `PlatformOp`; set `allow` on `rename_session` and `test_subscription`, `ask` on `create_schedule`, `create_subscription`, `remove_schedule`, `remove_subscription`), `sdks/python/agenta/sdk/agents/platform/platform_tools.py` (`AgentaPlatformToolResolver.resolve` takes `permission_default`; emit `tool_config.permission` when set, else `op.default_permission` when `permission_default == "allow_reads"`, else `None`), `sdks/python/agenta/sdk/agents/tools/resolver.py` (pass `permission_default` at the platform call, line 340).
- Test: create `sdks/python/oss/tests/pytest/unit/agents/platform/test_platform_default_permission.py`.
- If the channel-tools change already added this field (its task 2.7), skip steps 1-4 and only set the values above.

1. Write `test_default_applies_when_author_set_none_under_allow_reads`, `test_author_permission_wins_over_default`, `test_agent_wide_ask_wins_over_default` (the spec permission is `None`, so the runner applies `ask`), `test_agent_wide_deny_wins_over_default`, and `test_op_without_default_keeps_read_only_rule`.
2. Run `cd sdks/python && uv run --no-sync python run-tests.py oss/tests/pytest/unit/agents/platform/test_platform_default_permission.py`. It fails on the missing field.
3. Add the field, the values, and the resolver change.
4. Run the same command, plus `oss/tests/pytest/unit/agents/platform/test_op_catalog.py` and `oss/tests/pytest/unit/agents/platform/test_resolve.py`. All pass.
5. Commit: `feat(sdk): optional default permission on platform operations`.

### Task 1.2: The kit definition

- Create: `sdks/python/agenta/sdk/agents/platform/agenta_tools.py` with a frozen `AgentaTool` model (`op`, `needs_session: bool`, `needs_variant: bool`, `manages_automations: bool`, `needs_channel_bot: bool`) and the tuple `AGENTA_TOOLS` in display order: `rename_session` (needs session), `discover_triggers`, `list_schedules`, `list_subscriptions`, `list_deliveries`, `test_subscription`, `create_schedule` and `create_subscription` (need variant, manage automations), `remove_schedule` and `remove_subscription` (manage automations). Channel tools come in phase 5.
- Test: create `sdks/python/oss/tests/pytest/unit/agents/platform/test_agenta_tools_kit.py`.

1. Write `test_every_member_is_a_catalog_op`, `test_no_member_is_a_build_kit_authoring_tool` (none of `commit_revision`, `read_config`, `test_run`, `rename_agent`, `discover_tools`, `create_app`, `list_starters`, the skills tools), `test_default_permissions_match_design` (a table from design decision 2), and `test_members_are_unique`.
2. Run `cd sdks/python && uv run --no-sync python run-tests.py oss/tests/pytest/unit/agents/platform/test_agenta_tools_kit.py`. It fails on import.
3. Write the module.
4. Run the same command. It passes.
5. Commit: `feat(sdk): define the Agenta tools kit`.

### Task 1.3: The saved switch

- Modify: `sdks/python/agenta/sdk/agents/dtos.py` (add `AgentaToolsSwitch` with `enabled: bool = True` and `disabled_tools: List[str] = []`; add `agenta_tools: AgentaToolsSwitch` to `AgentTemplate` at line 780; read it in `from_params` from `parameters.agent.agenta_tools`, falling back to the defaults), `sdks/python/agenta/sdk/utils/types.py` (add an optional `agenta_tools` field to `AgentTemplateSchema` at line 1246, which forbids unknown keys, with a title and description for the drawer).
- Test: create `sdks/python/oss/tests/pytest/unit/agents/test_agent_template_agenta_tools.py`.

1. Write `test_missing_block_means_all_on`, `test_enabled_false_is_read`, `test_disabled_tools_are_read`, `test_unknown_tool_name_is_kept_and_ignored_later`, `test_schema_accepts_agenta_tools` (a template with the block validates against `AgentTemplateSchema`), and `test_template_without_block_still_validates`.
2. Run `cd sdks/python && uv run --no-sync python run-tests.py oss/tests/pytest/unit/agents/test_agent_template_agenta_tools.py`. It fails on the missing field.
3. Add the model, the parse, and the schema field.
4. Run the same command, plus every file under `oss/tests/pytest/unit/agents/` whose name starts with `test_agent_template`. All pass.
5. Commit: `feat(sdk): saved agenta_tools switch on the agent template`.

### Task 1.4: Add the kit to a tool list

- Modify: `sdks/python/agenta/sdk/agents/platform/agenta_tools.py` (add `add_agenta_tools(tools, *, switch, run_kind, has_session, has_variant, channel_bot_active=False) -> list`; it returns a new list and never mutates its input).
- Rules, in order: nothing when `switch.enabled` is false; skip names in `switch.disabled_tools`; skip an op the list already has as a platform entry; for `run_kind` `test` or `evaluation` keep only read-only ops; for `automation` skip ops that manage automations; skip `needs_session` ops without a session and `needs_variant` ops without a variant; skip `needs_channel_bot` ops unless `channel_bot_active`. Each added entry is `PlatformToolConfig(op=...)` with no permission.
- Test: create `sdks/python/oss/tests/pytest/unit/agents/platform/test_add_agenta_tools.py`.

1. Write `test_adds_every_tool_by_default`, `test_kit_off_adds_nothing`, `test_disabled_tool_is_skipped`, `test_author_entry_is_kept_and_not_duplicated` (an author `create_schedule` with `deny` stays single and keeps `deny`), `test_added_entries_carry_no_permission`, `test_test_run_gets_reads_only`, `test_evaluation_gets_reads_only`, `test_automation_run_has_no_create_or_remove`, `test_no_session_drops_rename_session`, `test_no_variant_drops_create_tools`, and `test_input_list_is_not_mutated`.
2. Run `cd sdks/python && uv run --no-sync python run-tests.py oss/tests/pytest/unit/agents/platform/test_add_agenta_tools.py`. It fails on import.
3. Implement the function.
4. Run the same command. It passes.
5. Commit: `feat(sdk): add the Agenta tools to a run's tool list`.

### Task 1.5: Call it in the handler

- Modify: `sdks/python/agenta/sdk/agents/handler.py`. Move the run-context read (`rc = comp.run_context()` and the `run_kind` layering, lines 454-461) above `comp.resolve_tools(...)` at line 386. Then call `add_agenta_tools(agent_template.tools, switch=agent_template.agenta_tools, run_kind=..., has_session=bool(session_id), has_variant=<variant id in rc>)` and pass the result to `resolve_tools`. Skip the step when `PlatformConnection().base_url()` is empty or when `AGENTA_AGENT_TOOLS_KIT_ENABLED` is `false` (read in `agenta_tools.py`, default on).
- Test: create `sdks/python/oss/tests/pytest/unit/agents/test_agenta_tools_injection.py`, following the fake composition in `oss/tests/pytest/unit/agents/test_agent_composition_seam.py`. Add one case to `services/oss/tests/pytest/unit/agent/test_invoke_handler.py`.

1. Write `test_inline_playground_run_gets_the_kit`, `test_referenced_run_gets_the_kit` (parameters from a saved revision, as a channel or API run sends them), `test_old_build_kit_overlay_does_not_duplicate`, `test_kit_off_in_parameters_adds_nothing`, `test_run_kind_from_meta_filters`, `test_no_api_address_adds_nothing_and_run_starts`, `test_rollback_variable_disables_the_step`, and, in the service file, `test_invoke_resolves_rename_session_for_a_saved_agent`.
2. Run `cd sdks/python && uv run --no-sync python run-tests.py oss/tests/pytest/unit/agents/test_agenta_tools_injection.py`. It fails because nothing is added.
3. Wire the step.
4. Run the same command, `oss/tests/pytest/unit/agents/test_agent_composition_seam.py`, and `cd services && uv run --no-sync python run-tests.py oss/tests/pytest/unit/agent/test_invoke_handler.py`. All pass.
5. Commit: `feat(sdk): add the Agenta tools kit in the agent handler`.

---

## Phase 2: The build kit and run markers

PR title: `feat(api): move always-on tools out of the build kit`. Size: S, 3 tasks, about 1-2 days.

### Task 2.1: Trim the build kit

- Modify: `api/oss/src/core/workflows/build_kit.py` (remove `rename_session` and the nine automation ops from `DEFAULT_BUILD_KIT_OPS` and `_BUILD_KIT_OP_PERMISSIONS`; update `BUILD_KIT_WORKFLOW_DESCRIPTION` to say the always-on tools live in `__ag__agenta_tools`).
- Test: modify `api/oss/tests/pytest/unit/applications/test_build_kit_overlay.py`.

1. Write `test_build_kit_has_no_agenta_tool` (imports `AGENTA_TOOLS` from the SDK and checks the overlay holds none of them), `test_build_kit_keeps_authoring_tools`, and `test_template_first_run_has_no_agenta_tool_in_overlay` (calls `apply_ui_build_kit`).
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/applications/test_build_kit_overlay.py`. The new cases fail.
3. Trim the lists.
4. Run the same command, plus `oss/tests/pytest/unit/workflows/test_static_catalog.py` and `oss/tests/pytest/unit/agent_templates/`. All pass.
5. Commit: `feat(api): drop always-on tools from the playground build kit`.

### Task 2.2: The read-only kit workflow

- Create: `api/oss/src/core/workflows/agenta_tools.py` (`AGENTA_TOOLS_WORKFLOW_SLUG = "__ag__agenta_tools"`; `build_agenta_tools_listing()` returns `{"tools": [{"type": "platform", "op": ..., "default_permission": ..., "read_only": ..., "needs_channel_bot": ...}]}` from the SDK kit and catalog).
- Modify: `api/oss/src/core/workflows/static_catalog.py` (register the slug with `kind: "agent_config"`, `embeddable: False`, next to `BUILD_KIT_WORKFLOW_SLUG` at line 366).
- Test: create `api/oss/tests/pytest/unit/workflows/test_agenta_tools_static_workflow.py`.

1. Write `test_listing_matches_sdk_kit_in_order`, `test_listing_carries_default_permissions`, `test_static_workflow_is_not_embeddable`, and `test_commit_embedding_the_kit_is_refused` (the same path `_reject_non_embeddable_workflow_embeds` covers in `api/oss/src/core/workflows/service.py:1781`).
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/workflows/test_agenta_tools_static_workflow.py`. It fails on import.
3. Add the module and the catalog entry.
4. Run the same command, plus `oss/tests/pytest/unit/workflows/test_static_catalog.py`. Both pass.
5. Commit: `feat(api): publish the Agenta tools kit as a read-only static workflow`.

### Task 2.3: Mark automation and evaluation runs

- Modify: `api/oss/src/tasks/asyncio/triggers/dispatcher.py` (set `meta.run_kind = "automation"` on the invoke request at line 365), `api/oss/src/core/evaluations/runtime/adapters.py` (set `meta.run_kind = "evaluation"` at lines 130 and 538, merged with any existing scenario `meta`).
- Test: modify `api/oss/tests/pytest/unit/triggers/test_triggers_dispatcher.py` and `api/oss/tests/pytest/unit/evaluations/test_run_batch_invocation.py`.

1. Write `test_schedule_fire_marks_run_kind_automation`, `test_subscription_fire_marks_run_kind_automation`, `test_batch_evaluation_marks_run_kind_evaluation`, and `test_evaluation_keeps_existing_scenario_meta`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/triggers/test_triggers_dispatcher.py` and the evaluations file. The new cases fail.
3. Set the markers.
4. Run both commands. Both pass.
5. Commit: `feat(api): mark automation and evaluation runs with a run kind`.

---

## Phase 3: Instructions

PR title: `feat(sdk): platform instructions follow the Agenta tools`. Size: S, 1 task, about half a day to a day. It can ship inside phase 1.

### Task 3.1: Split the sections

- Modify: `sdks/python/agenta/sdk/agents/platform_instructions.py` (move the Triggers bullet, lines 285-287, and "Setting up an automation", lines 300-305, into a new `AGENTA_AUTOMATION_SECTION`; add the rule that a scheduled run starts a new Agenta session and does not answer in the thread that set it up; add `AGENTA_CHANNEL_SECTION`; in `compose_platform_instructions`, line 412, include the automation section when `create_schedule` or `create_subscription` is in `tool_names` and the channel section when `send_channel_message` is; add a variant of the "where results go" sentence for runs with `send_channel_message`).
- Test: modify `sdks/python/oss/tests/pytest/unit/agents/test_platform_instructions.py`.

1. Write `test_slack_run_with_create_schedule_gets_automation_section_without_config_section`, `test_run_without_create_tools_has_no_automation_section`, `test_automation_section_says_where_results_go`, `test_with_send_tool_the_agent_is_told_to_include_a_destination`, `test_channel_section_only_with_send_tool`, and `test_config_section_still_follows_commit_revision`.
2. Run `cd sdks/python && uv run --no-sync python run-tests.py oss/tests/pytest/unit/agents/test_platform_instructions.py`. The new cases fail.
3. Split the text and the gating. Keep every sentence short and in the file's current voice.
4. Run the same command. It passes.
5. Commit: `feat(sdk): gate automation and channel guidance on their tools`.

---

## Phase 4: The playground block

PR title: `feat(frontend): Agenta tools block in the agent configuration`. Size: M, 3 tasks, about 2-3 days.

### Task 4.1: Fetch the kit list

- Modify: `web/packages/agenta-entities/src/workflow/api/api.ts` (add `AGENTA_TOOLS_WORKFLOW_SLUG` and `fetchAgentaToolsKit`, modeled on `fetchAgentBuildKitOverlay` at line 382), `web/packages/agenta-entities/src/workflow/state/store.ts` (add `agentaToolsKitAtom`, modeled on `agentBuildKitOverlayAtom` at line 1474, with the same persister), and the two `index.ts` exports.
- Test: create `web/packages/agenta-entities/tests/unit/agenta-tools-kit-atom.test.ts`.

1. Write `it("fetches the kit by its reserved slug")`, `it("returns null for an empty project")`, and `it("reports an error without throwing")`.
2. Run `cd web/packages/agenta-entities && pnpm vitest run tests/unit/agenta-tools-kit-atom.test.ts`. It fails on import.
3. Implement.
4. Run the same command. It passes.
5. Commit: `feat(frontend): fetch the Agenta tools kit`.

### Task 4.2: The block

- Create: `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/AgentaToolsSection.tsx` and `useAgentaTools.tsx`. The hook reads the kit list and the draft's `agenta_tools` block, and writes the block through the same draft path the other template fields use. Rows reuse `describeBuildKitPlatformTool` from `buildKitDescriptors.tsx` for names and descriptions.
- Modify: `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/useModelHarness.tsx` or `AgentTemplateControl.tsx` (render the block in the tools area, above the Advanced section), and `buildKitDescriptors.tsx` (descriptions for the channel tools).
- Test: create `web/packages/agenta-entity-ui/tests/unit/agentaToolsSection.test.tsx`.

1. Write `it("lists every kit tool with its default permission")`, `it("switching a tool off writes disabled_tools to the draft and marks it dirty")`, `it("the master switch writes enabled: false")`, `it("a tool the author listed shows 'Set in your tools' and no switch")`, `it("channel rows explain they need a connected bot")`, and `it("renders nothing while the kit list is loading or failed")`.
2. Run `cd web/packages/agenta-entity-ui && pnpm vitest run tests/unit/agentaToolsSection.test.tsx`. It fails on import.
3. Build the hook and the block.
4. Run the same command, plus `tests/unit/agentSettings.test.tsx` and `tests/unit/buildKitDescriptors.test.ts`. All pass.
5. Commit: `feat(frontend): Agenta tools block with saved switches`.

### Task 4.3: Run request and `/m`

- Modify: `web/packages/agenta-playground/tests/unit/agentRequest.test.ts` only, unless a test finds a gap. The draft already carries `agenta_tools` into the run, and the build kit overlay no longer holds the moved tools after phase 2.
- Test: extend `web/packages/agenta-playground/tests/unit/agentRequest.test.ts`.

1. Write `it("sends the draft agenta_tools block with the run")` and `it("the build kit overlay sends no Agenta tool")` (with the phase 2 overlay as a fixture).
2. Run `cd web/packages/agenta-playground && pnpm vitest run tests/unit/agentRequest.test.ts`.
3. Fix any gap the tests find.
4. Run the same command. It passes. Open `/m` on the local stack and check that the block renders in its configuration pane (`web/mobile/src/features/chat/ConfigPane.tsx`).
5. Commit: `test(frontend): run request carries the saved Agenta tools switch`.

---

## Phase 5: Channel tools join the kit

PR title: `feat(sdk): channel tools in the Agenta tools kit`. Size: S, 1 task, about half a day. Ships with or after phase 1 of the channel-tools change, and replaces that change's task 1.8.

### Task 5.1: Add the channel tools with the active-bot condition

- Modify: `sdks/python/agenta/sdk/agents/platform/agenta_tools.py` (add the four channel ops with `needs_channel_bot=True`; `send_channel_message` keeps its `allow` default from the catalog), `sdks/python/agenta/sdk/agents/handler.py` (before `add_agenta_tools`, when any channel op is still switched on, read availability with `read_channel_tools_availability` from the channel-tools plan under one deadline, as `_bounded_session_context` does at line 136, and pass `channel_bot_active`).
- Remove from the channel-tools plan: the `AgentComposition.resolve_channel_tools` hook and `add_channel_tools`. Keep its availability route and client.
- Test: extend `sdks/python/oss/tests/pytest/unit/agents/platform/test_add_agenta_tools.py` and `sdks/python/oss/tests/pytest/unit/agents/test_agenta_tools_injection.py`.

1. Write `test_channel_tools_need_an_active_bot`, `test_availability_is_not_checked_when_every_channel_tool_is_off`, `test_availability_timeout_adds_other_tools_only`, and `test_evaluation_gets_channel_reads_only`.
2. Run `cd sdks/python && uv run --no-sync python run-tests.py oss/tests/pytest/unit/agents/platform/test_add_agenta_tools.py`. The new cases fail.
3. Implement.
4. Run the same command and the injection file. Both pass.
5. Commit: `feat(sdk): add channel tools through the Agenta tools kit`.

---

## Phase 6: Live QA

No pull request. About 1.5-2 days, including fixes.

Deploy the stack with `load-env hosting/docker-compose/oss/.env.oss.dev` and `bash ./hosting/docker-compose/run.sh --oss --dev --build`. Verify on the Daytona sandbox as well as locally. Use one agent with no hand-listed Agenta tool.

1. Playground: ask "check my schedules" and "set up a daily digest at 9". Expect `list_schedules` without a prompt and an approval card for `create_schedule`.
2. API: invoke the saved agent with and without a session ID. Expect `rename_session` only with a session.
3. Slack: in a thread, ask "remind the team every Monday at 9". Expect an approval card in the thread. After approval, check that a schedule exists and that its task names the channel destination (after phase 5).
4. Telegram: the same request. Expect the approval card as plain lines with Approve and Deny.
5. Schedule fire: let the schedule from step 3 fire. Expect no `create_schedule` in the run, and a post to the channel after phase 5.
6. Evaluation: run a small evaluation of the agent. Expect only read-only Agenta tools in each run's trace.
7. Switch: turn `create_schedule` off in the drawer, commit, deploy, and repeat step 3. Expect the agent to say it cannot set up a schedule.
8. Record who can answer the approval card in a shared Slack channel. Report it to Mahmoud.
