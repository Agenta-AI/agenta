# Proposal

## Why

Some Agenta tools reach an agent only when someone runs it from the playground. Today Mahmoud asked a staging agent in Slack for the link to its session. It answered that it had no access. The tool exists (`get_current_session`, PR #7140), but it lives in the playground build kit, and the build kit reaches only playground runs. The same is true for naming the session, renaming the agent, and setting up schedules and triggers: the agent can do them in the playground and nowhere else.

The build kit is the right home for tools the assistant needs while someone builds the agent. It is the wrong home for tools the agent needs in production.

Status: Draft for Mahmoud's review. Nothing here is implemented. This change replaces the earlier draft on branch `docs/agenta-tools-kit` (`openspec/changes/agenta-tools-kit/`) and reuses what fits from it.

## What Changes

- Add a new tool entry type, `agenta_tools`, saved in the agent's `tools` list like a `gateway_connection` entry: `{"type": "agenta_tools", "tools": {"get_current_session": "allow", "rename_session": "allow"}}`. The values are `allow` and `ask`. A tool that is not listed is off and left out of the run.
- At resolve time, the tool resolver expands the entry into one platform tool per Agenta tool in the map, with that permission. The op catalog still owns the descriptions and schemas. Because the entry is part of the saved configuration, it reaches every run of that version: the playground (`/w` and `/m`), the API, Slack, Telegram, WhatsApp and automations.
- The Agenta tools are `get_current_session`, `rename_session`, `rename_agent`, `create_schedule`, `create_subscription`, `remove_schedule`, `remove_subscription`, `list_schedules`, `list_subscriptions`, `discover_triggers`, `commit_revision`, `read_config` and `apply_skill_update`. Design decision 1 recommends adding `list_deliveries`, `test_subscription` and `check_skill_updates`, which pair with tools already in the list. `search_skills` stays in the build kit.
- **Defaults (decided by Mahmoud):** `get_current_session` and `rename_session` are on (Allow). Every other Agenta tool is off, including `rename_agent`, `commit_revision` and `read_config`.
- New agents get the entry from the agent template. Existing agents get it when the playground (`/w` or `/m`) loads them: the loader adds the default entry to the loaded configuration, not as an unsaved change, and the next save stores it. Nothing is committed on open. Outside the playground there is no fallback: an agent that nobody opens and saves has no Agenta tools until its next save. This is an accepted limit.
- Add an **Agenta tools** section beside **Build kit** in the agent's tool settings, in `/w` and `/m`. It renders the entry with the same component as a gateway connection, grouped into write and read-only tools. An agent with no saved entry gets no Agenta tools.
- The build kit does not change. It keeps all its tools, including `get_current_session` and `rename_session`, its choices stay in the browser, and it still reaches only playground runs. An explicit platform entry for a tool, the author's or the build kit's, wins over the `agenta_tools` entry, and the tool appears once. The one build kit change proposed is its copy, which says it is playground-only. Whether even that copy should change is an open point in the design.
- `get_current_session` itself does not change: same description, endpoint and link. This change only makes it available through the `agenta_tools` entry.
- The channel tools are out of scope. They stay automatic for agents with a connected bot, controlled by the bot's settings.

## Capabilities

### New Capabilities

- `agenta-tools`: which tools the entry holds, their defaults, how the entry expands into a run, and how it combines with the build kit and the author's own tools.
- `agenta-tools-settings`: the entry's shape, how new and existing agents get it, and how the tool settings show and edit it.

### Modified Capabilities

None. No baseline specification covers the build kit or the platform tools. The build kit permissions change (`openspec/changes/configure-build-kit-permissions/`) is not archived, and this change leaves its behavior as it is.

## Impact

- **SDK**: a new `AgentaToolsConfig` in the `ToolConfig` union (`sdks/python/agenta/sdk/agents/tools/models.py`), its expansion in the tool resolver, and the list of Agenta tools.
- **API and service**: the entry in the default agent template and the built-in templates, and a read-only listing of the Agenta tools for the settings UI.
- **Web**: an Agenta tools section beside Build kit in `/w` and `/m`, one function that adds the default entry where the playground loads a revision, and new copy for the Build kit section.
- **Compatibility**: older API or SDK code cannot parse the new entry type. Accepted and documented in the release notes.
- **Existing agents**: after their next save from the playground, every run of that version gets the two default tools.
