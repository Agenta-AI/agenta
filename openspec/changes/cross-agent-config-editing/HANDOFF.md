# Handoff: implement cross-agent config editing

You are implementing the OpenSpec change in this folder. This file is self-contained: read it first, then the files it names.

## The goal in one paragraph

Today an agent can read and edit only its own configuration (`read_config`, `commit_revision`). Add four platform tools so an agent can also list, read, create and edit **other** agents in the same project: `list_agents`, `read_agent_config`, `create_agent`, `edit_agent_config`. Group them as two capabilities, **List agents** (`list_agents`) and **Agent config** (the other three). Each capability is one toggle in the playground build kit and in the Agenta tools section. Each tool keeps its own allow/ask/off control. Every revision these tools write carries attribution in its commit message.

## Read in this order

1. `proposal.md`: what changes and the impact by layer.
2. `design.md`: today's behavior with file:line evidence, the eight decisions, risks and migration.
3. `specs/agent-directory/spec.md` and `specs/agent-config-management/spec.md`: the requirements and scenarios. These are the acceptance criteria.
4. `tasks.md`: the work in order. Tick each box as you finish it.
5. Related changes on the same branch: `openspec/changes/agenta-tools/` (the `agenta_tools` entry) and `openspec/changes/configure-build-kit-permissions/` (build kit defaults and browser-held choices). This change builds on both.

## Decisions that are final

Mahmoud decided these. Do not reopen them. If one blocks you, stop and report rather than working around it.

1. **Reach:** any agent in the caller's project. No target picker.
2. **Grouping:** two capabilities, as above. Test-running another agent is out of scope (agents add it as a subagent instead).
3. **Defaults:** on everywhere, every tool `allow`. Build kit: add to `DEFAULT_BUILD_KIT_OPS`. Agenta tools: add to `AGENTA_TOOLS` and `DEFAULT_AGENTA_TOOLS`. This is deliberately more open than self-edit, which is off by default in Agenta tools. Do not "fix" that.
4. **No extra edit limit:** reuse `AGENT_COMMIT_SCOPE` unchanged. Do not add a power-widening check.
5. **`create_agent`** starts from the same catalog template "New agent" uses, plus optional ordered operations in the same call.
6. **Four new ops.** Do not touch `read_config` or `commit_revision`.
7. **Attribution in the commit message only.** No new column, no metadata field, no new history UI.
8. **Small defaults** (design D8): targets by id or slug; refuse unknown, archived, non-`is_agent`, static and self targets; edit the latest saved revision; never deploy; same stale-revision rule as self-edit.

## Where the code is

All paths are on `release/v0.122.3`.

| Area | File | What to do |
|---|---|---|
| Op catalog | `sdks/python/agenta/sdk/agents/platform/op_catalog.py` | Four handler-mode `PlatformOp`s next to `read_config` (`:1558`) and `commit_revision` (`:1973`). Add their call refs to `_HANDLER_CALL_REFS`. Bind caller identity with `context_bindings` (`$ctx.workflow.artifact.id`, `$ctx.workflow.variant.id`, `$ctx.session.id`); bound fields are stripped from the model schema automatically. Reuse the ordered-operations delta schema from `_COMMIT_REVISION_INPUT_SCHEMA`. Gate the config ops on the same ordered-operations flag as `read_config`. |
| Handlers | `api/oss/src/core/tools/platform_handlers.py` | Model the new handlers on `handle_read_config` and `handle_commit_revision` (`:763`). Register them in `PLATFORM_TOOL_HANDLERS`. Keep the fail-closed style of `_bound_variant_id` (`:677`). |
| Commit path | `api/oss/src/core/workflows/service.py` (`commit_workflow_revision_checked`, derived message at `:2963`) | Call it with `scope_policy=AGENT_COMMIT_SCOPE` and `agent_context=True`, exactly like self-edit. |
| Message | `api/oss/src/core/workflows/commit_support.py:146` (`derive_commit_message`) | Add an attribution suffix built only from bound values: `(by agent "<name>" <id>, session <id>)`. The write tools are offered only to a run with a session (see design D8). |
| Scope | `api/oss/src/core/workflows/change_set.py:571` | Read only. Reuse `AGENT_COMMIT_SCOPE`. |
| New agent default | `web/packages/agenta-entities/src/workflow/state/appUtils.ts:172` | Read to see which catalog template the web app uses. Build the same default on the server for `create_agent`. |
| Build kit | `api/oss/src/core/workflows/build_kit.py:35` | Add the four ops to `DEFAULT_BUILD_KIT_OPS`. `build_kit_op_access` derives read or write from `read_only`. |
| Agenta tools | `sdks/python/agenta/sdk/agents/tools/models.py:261`, `:280`; `web/packages/agenta-entities/src/workflow/agentaTools.ts:8` | Add to `AGENTA_TOOLS` and `DEFAULT_AGENTA_TOOLS` (`allow`). Keep web and SDK defaults equal. |
| Build kit UI | `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/buildKitDescriptors.tsx:38` | Copy for the four ops, plus a capability grouping (one toggle per capability, per-op controls inside). |
| Agenta tools UI | `.../agentTemplate/AgentaToolsSection.tsx:71` | The same grouping, inside the existing Write and Read-only layout and presets. |
| Chat | `web/packages/agenta-chat/src/model/approvalDescribers/` | Describers for `create_agent` and `edit_agent_config` that name the target agent and reuse the operations preview from `describeCommitRevision.ts`. |

## Tests to extend or add

- API unit: `api/oss/tests/pytest/unit/tools/test_config_handlers.py` (handler patterns), `api/oss/tests/pytest/unit/applications/test_build_kit_overlay.py`, `api/oss/tests/pytest/unit/workflows/test_agenta_tools_catalog.py`.
- Web unit: `web/packages/agenta-entities/tests/unit/agentaTools.test.ts`, `agentaToolsLoader.test.ts`, `web/packages/agenta-entity-ui/tests/unit/buildKitDescriptors.test.ts`, `web/packages/agenta-chat/tests/unit/model/describeCommitRevision.test.ts`.
- Cover every scenario in `specs/`. Required: self-target refused, cross-project invisible, archived/static refused, stale revision refused, scope parity with self-edit, template parity between `create_agent` and "New agent", and attribution that the model cannot forge.
- Follow the root `AGENTS.md`: `ruff format` then `ruff check --fix` for API/SDK, `pnpm lint-fix` in `web`.

## Live QA (required before calling it done)

On a throwaway stack, never on a shared or personal production instance:

1. In the playground, ask agent A: "Create an agent called Invoice helper whose instructions say it answers invoice questions."
2. Confirm "Invoice helper" exists and its first revision message starts with `Created by agent "A"`.
3. Ask A to add one line to Invoice helper's instructions. Confirm the new revision and that the message ends with `(by agent "A" …, session …)`.
4. Turn Agent config off in A's build kit. Confirm the model is no longer offered the three tools.
5. Save a screenshot or short recording of steps 2 and 3 for the PR.

## Delivery rules

- Branch from the latest `release/v*` branch and open the PR against it, ready for review (not a draft).
- One PR for the implementation. Link this change folder in the description.
- Keep public GitHub text generic: no environment names, IDs, customer data or log excerpts.
- Do not merge. Do not deploy to staging or production.
- When done, tick `tasks.md`, then report: PR link, head SHA, test results, QA evidence, and anything you could not do.
