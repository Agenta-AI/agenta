# Tasks

Nothing is implemented. The tasks assume the recommended option for each decision in [design.md](design.md).

## 1. Entry type and resolution (SDK)

- [ ] 1.1 List the Agenta tools in `sdks/python/agenta/sdk/agents/platform/`, and the default entry (`default: "off"`, `get_current_session` and `rename_session` set to `allow`).
- [ ] 1.2 Add `AgentaToolsConfig` (`type: "agenta_tools"`, `policy.permissions` with `default` and `tools`, values `allow`, `ask`, `off`, no top-level `permission`) to the `ToolConfig` union in `sdks/python/agenta/sdk/agents/tools/models.py`, following `GatewayConnectionToolConfig`. Update the agent configuration schema.
- [ ] 1.3 In `sdks/python/agenta/sdk/agents/tools/resolver.py`, expand the entry into platform tools whose value is not `off`, with that permission. Skip any tool the run already has a platform entry for. Skip the session tools without a session ID. Skip the entry, with a warning, without an API address. Warn on unknown names.
- [ ] 1.4 Rewrite the `get_current_session` description in `op_catalog.py` (when to share, share only with people who can open it, say it needs Agenta access).
- [ ] 1.5 Unit tests: parsing, `default` and per-tool values, `deny` refused, unknown name, expansion, author entry wins, build kit entry wins, a build kit tool deactivated there falls back to the entry, no session ID, no API address, no entry means no Agenta tools.

## 2. API and service

- [ ] 2.1 Leave `DEFAULT_BUILD_KIT_OPS` in `api/oss/src/core/workflows/build_kit.py` unchanged. Add a test that pins its list.
- [ ] 2.2 Add the default entry to the default agent template (`services/oss/src/agent/config.py` and its `agent.json`) and to the built-in agent templates.
- [ ] 2.3 Serve the Agenta tools list with each tool's `read_only` flag, from the SDK list, for the settings UI.
- [ ] 2.4 In `current_session_response` (`api/oss/src/apis/fastapi/sessions/utils.py`), build the `/m` session link, add `?agent=` when present, and drop `agent_reference_missing`. Update `test_current_session_tool.py`.

## 3. Web

- [ ] 3.1 Add the Agenta tools section in the Advanced drawer, before Build kit, rendering the entry with the gateway connection permission component, grouped into write and read-only tools, in `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/`. Shared by `/w` and `/m`.
- [ ] 3.2 Make its choices edit the entry in the draft. Deactivate writes `off`; the kit-level Deactivate keeps the entry with every tool `off`.
- [ ] 3.3 In `workflowQueryAtomFamily` (`web/packages/agenta-entities/src/workflow/state/store.ts`), add the default entry to a loaded revision whose `tools` have none. One small function, no dirty-state change, no commit.
- [ ] 3.4 Mark rows whose tool is also in the build kit: "In the playground, the Build kit setting applies."
- [ ] 3.5 Write the Agenta tools copy, and the Build kit copy only if Mahmoud confirms it may change (design, Open Points).
- [ ] 3.6 Add `get_current_session` to `PLATFORM_OPS` in `web/packages/agenta-chat/src/skin/registry.ts` so its transcript row reads plainly.
- [ ] 3.7 Unit tests for the section, its draft edits, and the loader function (adds the entry once, leaves an existing entry alone, does not mark the draft dirty). Run `pnpm lint-fix` in `web`.

## 4. Live QA

- [ ] 4.1 Create a new agent and ask it for its link from `/w`, `/m`, the API, a Slack thread, a Telegram chat and a schedule fire. Each reply carries a `/m` link, and each session gets a name.
- [ ] 4.2 Open an agent saved before this change: the section shows the defaults, the draft is clean, and no version is created. Slack runs have no Agenta tools. Edit something, let the playground save, deploy: Slack runs have the two defaults.
- [ ] 4.3 Set `create_schedule` to Ask, commit, deploy, and ask for a schedule from Slack: an approval card appears.
- [ ] 4.4 Set `rename_session` to Deactivate: Slack, API and schedule runs stop naming their sessions, and a playground run still follows the build kit.
- [ ] 4.5 Open the link as a member with Classic mode on and off, on a phone, signed out (sign-in page, then the session), and as a non-member (refused).
- [ ] 4.6 A Slack agent bound by application reference returns a working link.

## 5. Docs

- [ ] 5.1 Release notes: the Agenta tools section and its defaults, that existing agents get it only after they are opened and saved in the playground, and that older SDK versions cannot read agents saved with the new entry.
- [ ] 5.2 Close the `docs/agenta-tools-kit` draft as replaced by this change.
