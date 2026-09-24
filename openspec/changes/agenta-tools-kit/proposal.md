# Proposal

## Why

Some Agenta tools only work in the playground today, although people need them everywhere. The build kit adds `rename_session` and the automation tools (`create_schedule` and the rest) to a run only when the playground sends it. So when someone in Slack asks a connected agent to "remind the team every Monday", the agent has no tool to set up the schedule. The same agent could do it from the playground a minute earlier. The channel tools planned in `openspec/changes/channel-agent-tools/` (list destinations, send, read, search) need the same always-on treatment, and that draft proposed a separate way to add them.

Mahmoud wants "something like agenta-tools, like the build kit, but things that are always active (and can be deactivated)".

Status: Draft for Mahmoud's review. Nothing here is implemented. The implementation plan is in [plan.md](plan.md).

## What Changes

- Add a second kit, **Agenta tools**. It is on for every run of an agent: the playground (classic and `/m`), the API, Slack and Telegram turns, and automation runs.
- Move these tools out of the build kit into Agenta tools:
  - `rename_session`.
  - The automation tools: `discover_triggers`, `create_schedule`, `create_subscription`, `list_schedules`, `list_subscriptions`, `list_deliveries`, `test_subscription`, `remove_schedule`, `remove_subscription`.
  - The four channel tools from the channel-tools draft: `list_channel_destinations`, `send_channel_message`, `read_channel_messages`, `search_channel_messages`. They are active only while the agent is connected to an active bot.
- Keep the authoring tools in the build kit, which stays playground-only: `commit_revision`, `read_config`, `test_run`, `rename_agent`, the skills tools (`search_skills`, `check_skill_updates`, `apply_skill_update`), `discover_tools`, `create_app`, `list_starters`, and the three request cards (`request_connection`, `request_input`, `request_secret`). The request cards need the playground to draw a form, and Slack and Telegram can only draw an approval card.
- Save the on/off switch on the agent. A new optional block in the agent configuration, `agenta_tools: {enabled, disabled_tools}`, is committed with the revision like any other setting. When the block is missing, every Agenta tool is on. The tools themselves are never written into the configuration.
- Add the tools on the agent service, in the SDK agent handler, just before tools are resolved. This is the one place every run passes through. It replaces the separate channel-tools hook that the channel-tools draft proposed.
- Let the author's own entry win. If the author already listed one of these tools, the run keeps the author's entry and its permission, and the kit does not add a second copy.
- Give each tool a default permission that applies only when the author set none and the agent-wide mode is the default. Automation writes ask. Channel send allows (Mahmoud's decision). Reads and `rename_session` allow.
- Leave the write tools out of runs where they would cause harm. Test runs started by `test_run` and evaluation runs get only the read tools. Automation runs do not get the tools that create or remove automations.
- Show the Agenta tools in the playground configuration, next to the build kit, as read-only rows with a switch each and one master switch. Changing a switch edits the draft, and a commit saves it.
- Move the automation guidance in the platform instructions so that it follows the automation tools, not `commit_revision`. Add a short channel section that follows the channel tools.

## Capabilities

### New Capabilities

- `agenta-tools-kit`: Which tools the kit holds, which runs get them, how duplicates and permissions work, and which tools are left out of test, evaluation, and automation runs.
- `agenta-tools-switch`: The saved on/off block, its defaults, and how the playground shows and edits it.
- `agenta-tools-instructions`: Which parts of the platform instructions follow the Agenta tools.

### Modified Capabilities

None. No baseline specification describes the build kit or the platform tools. The channel-tools draft is not archived, so this change records how it plugs in (design decision 8) instead of editing it.

## Impact

- **SDK**: a new kit definition (`sdks/python/agenta/sdk/agents/platform/agenta_tools.py`), a new `agenta_tools` field on the agent template and its schema, an optional default permission on platform operations, a step in `sdks/python/agenta/sdk/agents/handler.py` that adds the tools, and a split of `platform_instructions.py`.
- **API**: a smaller build kit (`api/oss/src/core/workflows/build_kit.py`), a read-only `__ag__agenta_tools` static workflow so the playground can list the kit, and a run-kind marker on automation and evaluation runs.
- **Web**: a new Agenta tools block in the agent configuration (`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/`), shared by the classic playground and `/m`.
- **Behavior for existing agents**: every existing agent gets the Agenta tools on its next run. Slack, Telegram, API, and automation runs gain `rename_session` and the automation tools. In the playground, a build-kit switch someone turned off for a moved tool no longer applies, because that switch lived in the browser.

This change adds no new endpoints for the tools themselves. Every tool calls a route that exists today, or one the channel-tools change adds.
