# Proposal

## Why

Some Agenta tools reach an agent only when someone runs it from the playground. Today Mahmoud asked a staging agent in Slack for the link to its session. It answered that it had no access. The tool exists (`get_current_session`, PR #7140), but it lives in the playground build kit, and the build kit reaches only playground runs. The same is true for naming the session, renaming the agent, and setting up schedules and triggers: the agent can do them in the playground and nowhere else.

The build kit is the right home for tools the assistant needs while someone builds the agent. It is the wrong home for tools the agent needs in production.

Status: Draft for Mahmoud's review. Nothing here is implemented. This change replaces the earlier draft on branch `docs/agenta-tools-kit` (`openspec/changes/agenta-tools-kit/`) and reuses what fits from it.

## What Changes

- Add a second section to the agent's tool settings, **Agenta tools**, beside **Build kit**. It uses the same controls as the build kit: a kit-level choice and, per tool, Allow, Ask or Deactivate, with write tools and read-only tools listed in separate groups.
- Agenta tools reach every run of the agent: the playground (`/w` and `/m`), the API, Slack, Telegram, WhatsApp and automations. Build kit tools stay playground-only. The copy of each section says this.
- The Agenta tools are `get_current_session`, `rename_session`, `rename_agent`, `create_schedule`, `create_subscription`, `remove_schedule`, `remove_subscription`, `list_schedules`, `list_subscriptions`, `discover_triggers`, `commit_revision`, `read_config` and `apply_skill_update`. Design decision 1 recommends adding `list_deliveries`, `test_subscription` and `check_skill_updates`, which pair with tools already in the list. `search_skills` stays in the build kit.
- **Defaults (decided by Mahmoud):** `get_current_session` and `rename_session` are on (Allow). Every other Agenta tool is off (Deactivate), including `rename_agent`, `commit_revision` and `read_config`.
- Save the Agenta tools choices in the agent's configuration, so they are part of each version and ship and roll back with it. The build kit choices stay in the browser, as today.
- Add the Agenta tools to each run in the SDK agent handler, in the same place PR #7134 adds the channel tools, but for every agent, not only agents with a connected bot. The tools are never written into the agent's `tools` list.
- The build kit keeps its building tools, so building in the playground works as it does today. It drops `get_current_session` and `rename_session`, which are not building tools and are now on everywhere. When a tool is on in both sections, a playground run has it once, and the build kit's choice applies there.
- Point the session link at the session's page in `/m`, the default app. People who use Classic mode are sent to the classic playground by the existing gate. A session with no agent reference still gets a link.
- Keep the link private to signed-in project members. The agent shares it when asked, and at the end of long work in a chat app or automation.
- The channel tools are out of scope. They stay automatic for agents with a connected bot, controlled by the bot's settings.

## Capabilities

### New Capabilities

- `agenta-tools`: which tools the section holds, their defaults, which runs get them, and how they combine with the build kit and the author's own tools.
- `agenta-tools-settings`: where the choices are saved, their shape, and how the tool settings show and edit them.
- `session-link`: what the `get_current_session` link points to, who can open it, and when the agent shares it.

### Modified Capabilities

None. No baseline specification covers the build kit or the platform tools. The build kit permissions change (`openspec/changes/configure-build-kit-permissions/`) is not archived, and this change leaves its behavior as it is.

## Impact

- **SDK**: a kit definition with each tool's default, a new optional `agenta_tools` field on the agent configuration, a step in `sdks/python/agenta/sdk/agents/handler.py` that adds the tools, and a new `get_current_session` description.
- **API**: a read-only listing of the Agenta tools for the settings UI, the build kit loses `get_current_session` and `rename_session`, and `current_session_response` builds the `/m` link.
- **Web**: an Agenta tools section beside Build kit in the agent's tool settings, shared by `/w` and `/m`, and new copy for the Build kit section.
- **Existing agents**: on their next run, in every surface, they get the two default tools. Nothing else changes for them until an author turns a tool on.
