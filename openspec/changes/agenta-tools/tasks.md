# Tasks

Nothing is implemented. The tasks assume the recommended option for each decision in [design.md](design.md).

## 1. Kit and run-time step (SDK)

- [ ] 1.1 Add the Agenta tools definition in `sdks/python/agenta/sdk/agents/platform/`: the tool list and each tool's default (`allow` for `get_current_session` and `rename_session`, `off` for the rest).
- [ ] 1.2 Add the optional `agenta_tools` field (tool name to `allow`, `ask` or `off`) to the agent configuration and its schema. Ignore unknown names.
- [ ] 1.3 In `sdks/python/agenta/sdk/agents/handler.py`, before tools are resolved, add each tool set to `allow` or `ask` with that permission, unless the run already has an entry for it. Add the session tools only with a session ID. Add nothing without an API address.
- [ ] 1.4 Rewrite the `get_current_session` description in `op_catalog.py` (when to share, share only with people who can open it, say it needs Agenta access).
- [ ] 1.5 Unit tests: defaults, each setting, missing block, unknown name, author entry wins, build kit entry wins, no duplicate from an old overlay, no session ID, no API address, saved configuration unchanged.

## 2. API

- [ ] 2.1 Remove `get_current_session` and `rename_session` from `DEFAULT_BUILD_KIT_OPS` in `api/oss/src/core/workflows/build_kit.py`. Update `test_build_kit_overlay.py`.
- [ ] 2.2 Serve the Agenta tools list with each tool's default and `read_only` flag, from the SDK definition, for the settings UI.
- [ ] 2.3 In `current_session_response` (`api/oss/src/apis/fastapi/sessions/utils.py`), build the `/m` session link, add `?agent=` when present, and drop `agent_reference_missing`. Update `test_current_session_tool.py`.

## 3. Web

- [ ] 3.1 Add the Agenta tools section in the Advanced drawer, before Build kit, reusing the build kit's permission body, in `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/`. Shared by `/w` and `/m`.
- [ ] 3.2 Make its choices edit the draft `agenta_tools` block, writing only choices that differ from the default.
- [ ] 3.3 Mark rows whose tool is also in the build kit: "In the playground, the Build kit setting applies."
- [ ] 3.4 Update the copy of both sections once Mahmoud approves it.
- [ ] 3.5 Add `get_current_session` to `PLATFORM_OPS` in `web/packages/agenta-chat/src/skin/registry.ts` so its transcript row reads plainly.
- [ ] 3.6 Unit tests for the section, its defaults, and its draft edits. Run `pnpm lint-fix` in `web`.

## 4. Live QA

- [ ] 4.1 With no settings changed, ask one agent for its link from `/w`, `/m`, the API, a Slack thread, a Telegram chat and a schedule fire. Each reply carries a `/m` link, and each session gets a name.
- [ ] 4.2 Turn `create_schedule` on with Ask, commit, deploy, and ask for a schedule from Slack: an approval card appears.
- [ ] 4.3 Turn `rename_session` off: no run names its session, including the playground.
- [ ] 4.4 Open the link as a member with Classic mode on and off, on a phone, signed out (sign-in page, then the session), and as a non-member (refused).
- [ ] 4.5 A Slack agent bound by application reference returns a working link.

## 5. Docs

- [ ] 5.1 Changelog: the Agenta tools section, its defaults, and that existing agents gain the session link and session naming everywhere.
- [ ] 5.2 Close the `docs/agenta-tools-kit` draft as replaced by this change.
