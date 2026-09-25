# Tasks

Nothing is implemented. The tasks assume the recommended option for each decision in [design.md](design.md).

## 1. Entry type and resolution (SDK)

- [x] 1.1 List the Agenta tools in `sdks/python/agenta/sdk/agents/platform/`, and the default entry (`get_current_session` and `rename_session` set to `allow`, nothing else). Done in `sdks/python/agenta/sdk/agents/tools/models.py` instead: the resolver in `tools/` cannot import the `platform/` package without an import cycle.
- [x] 1.2 Add `AgentaToolsConfig` (`type: "agenta_tools"`, a flat `tools` map with values `allow` or `ask`, no top-level `permission`) to the `ToolConfig` union in `sdks/python/agenta/sdk/agents/tools/models.py`, following `GatewayConnectionToolConfig`. Update the agent configuration schema.
- [x] 1.3 In `sdks/python/agenta/sdk/agents/tools/resolver.py`, expand the entry into one platform tool per listed tool, with its value as the permission. Skip any tool the run already has a platform entry for. Skip the session tools without a session ID. Skip the entry, with a warning, without an API address. Warn on unknown names.
- [x] 1.4 Unit tests: parsing, `allow` and `ask`, unlisted tools off, an empty map, `deny` and `off` refused, unknown name, expansion, author entry wins, build kit entry wins, a build kit tool deactivated there falls back to the entry, no session ID, no API address, no entry means no Agenta tools.

## 2. API and service

- [x] 2.1 Leave `DEFAULT_BUILD_KIT_OPS` in `api/oss/src/core/workflows/build_kit.py` unchanged. Add a test that pins its list.
- [x] 2.2 Add the default entry to the default agent template (`services/oss/src/agent/config.py` and its `agent.json`) and to the built-in agent templates. Done in the one builder every new agent comes from, `build_agent_v0_default()` in `sdks/python/agenta/sdk/utils/types.py`, which the service `/inspect` default, the catalog template and the built-in templates all use. `services/oss/src/agent/config.py` and `agent.json` stay unchanged: they fill a run whose saved config omits `tools`, so adding the entry there would be the run-time fallback this change rules out.
- [x] 2.3 Serve the Agenta tools list with each tool's `read_only` flag, from the SDK list, for the settings UI.

## 3. Web

- [x] 3.1 Add the Agenta tools section in the Advanced drawer, before Build kit, rendering the entry with the gateway connection permission component, grouped into write and read-only tools, in `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/`. Shared by `/w` and `/m`.
- [x] 3.2 Make its choices edit the entry in the draft. Show every Agenta tool. Allow or Ask adds the tool to the map, Deactivate removes it, and the kit-level Deactivate leaves an empty map.
- [x] 3.3 In `workflowQueryAtomFamily` (`web/packages/agenta-entities/src/workflow/state/store.ts`), add the default entry to a loaded revision whose `tools` have no `agenta_tools` entry. Never change an existing entry, even an empty one. One small function, no dirty-state change, no commit.
- [x] 3.4 Mark rows whose tool is also in the build kit: "In the playground, the Build kit setting applies."
- [x] 3.5 Write the Agenta tools copy, and the Build kit copy only if Mahmoud confirms it may change (design, Open Points).
- [x] 3.6 Unit tests for the section, its draft edits, and the loader function (adds the entry when missing, leaves an existing entry alone, including an empty map, does not mark the draft dirty). Run `pnpm lint-fix` in `web`.

## 4. Live QA

- [ ] 4.1 Create a new agent and ask it for the link to its session from `/w`, `/m`, the API, a Slack thread, a Telegram chat and a schedule fire. Each reply carries the link the tool returns today, and each session gets a name.
- [ ] 4.2 Open an agent saved before this change: the section shows the defaults, the draft is clean, and no version is created. Slack runs have no Agenta tools. Edit something, let the playground save, deploy: Slack runs have the two defaults.
- [ ] 4.3 Set `create_schedule` to Ask, commit, deploy, and ask for a schedule from Slack: an approval card appears.
- [ ] 4.4 Set `rename_session` to Deactivate: Slack, API and schedule runs stop naming their sessions, and a playground run still follows the build kit.

## 5. Docs

- [ ] 5.1 Release notes: the Agenta tools section and its defaults, that existing agents get it only after they are opened and saved in the playground, and that older SDK versions cannot read agents saved with the new entry.
- [ ] 5.2 Close the `docs/agenta-tools-kit` draft as replaced by this change.
