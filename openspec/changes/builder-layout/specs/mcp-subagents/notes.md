# mcp-subagents: notes for implementers

These notes belong to `spec.md` in this folder. They hold the words the requirements use, today's behavior on `origin/main` with `path:line`, the other places that mount the changed components, backend work, states that are described but not drawn, and the text. They are not part of the requirements.

## Words used in this file

- **View**, **container**, **root**, **right panel**: as defined in the `agent-panel` spec. **Draft**: the production draft store of the agent configuration (`workflowDraftAtomFamily`); auto-save commits it as a new version about 1500 ms after a change (`web/packages/agenta-playground/src/state/execution/agentAutoCommit.ts:27`), as production does. A container shows a root (its base screen, not in the stack) and up to two views on top of it (depth 1 and depth 2).
- **`apply`** and **`target`**: the two settings of a view (design.md D2). `apply: "immediate"`: a change reaches the target at once and the view has "Done". `apply: "on_save"`: the view has "Cancel" and "Save", and only Save writes. `target: {kind: "agent_draft", revisionId}` writes the agent configuration through the production draft store, and auto-save saves it as a new version; `target: {kind: "project"}` writes a project resource on the server.
- **`ConfigItemRef`**: the address of one configuration item, `{list, key}`, the same shape as the target segment of a builder operation (design.md D2).
- **`useViewTitle`**: the hook a view calls to put its own title in the breadcrumb.
- **Subagent**: another agent of the project that this agent can call as a tool. The parent agent stores a reference to it with a description. With no pinned version, the reference runs the subagent's latest version.
- **MCP server**: a server that speaks the Model Context Protocol and gives the agent tools. A server that a user connects by URL is a **project server** (in the code, the `custom` namespace). Agenta's own servers are in the `builtin` namespace.
- **Sign-in**: the credential Agenta uses to call a project server: an OAuth grant or a pasted token. The project holds one sign-in per server. With personal accounts on, each person can hold one own sign-in per server.
- **Account source**, **run person**, **personal accounts switch**: as defined in the `integrations-accounts` spec.
- **Tool permission**: as defined in the `integrations-accounts` spec.

## Milestones and views

- Subagents and MCP servers, section 17 of `tasks.md`: subagents (17.1), the one MCP server list for the agent and Settings (17.2), "Connect server" and the server view with "Reconnect" (17.3), each person's own sign-in for `custom` servers (17.4, after the account switch contract of 16.4).
- "Your sign-in" shows "Your sign-in: {{name}}", or "Signed in" when the server gives no name (requirement "Account name of an own sign-in"; DECIDED by Mahmoud; backend task 39.1, frontend task 39.2). It is part of task 17.4.

| View | `apply` | `target` in the agent | `target` in Settings | What Save or a change writes |
|---|---|---|---|---|
| Add subagents | `immediate` | `agent_draft` | not mounted | the agent configuration; auto-save saves it |
| Subagent view | `on_save` | `agent_draft` | not mounted | the agent configuration (the description only); auto-save saves it |
| Add MCP server | `immediate` | `agent_draft` | `project` (the Settings list is the root) | in the agent: the agent configuration; auto-save saves it |
| Connect server (depth 2, or depth 1 in Settings) | `on_save` ("Connect" is the save) | `project` (its own target, not the parent's) | `project` | only the project's server on the server side; adding it to the agent is a separate change by "Add MCP server" (design.md D2, "Create, then attach") |
| MCP server view | `immediate` | `agent_draft` | `project` | in the agent: the agent configuration (permissions, account source), saved by auto-save; in Settings: as production (`McpServersSection.tsx:536`) |

- Stack depth. A click on a server that is not added calls `open` for its server view, so the server view replaces "Add MCP server" at depth 1 ("Agent › docs-search"). "Connect server" opens at depth 2 from "Add MCP server". "Reconnect" opens the connect step at depth 2 from the server view and goes back to it after the sign-in. After a new server connects from "Add MCP server", its server view opens with `open` in the same way.
- Item keys. The change-set engine computes item keys in `item_key` (`api/oss/src/core/workflows/change_set.py:477-504`). A subagent is a `tools` entry of type `reference`; its key is the entry `name`, else its `slug` (`change_set.py:470-471`). An MCP server is an `mcps` entry; its key is the entry `name` (`KEY_FIELDS`, `change_set.py:230-235`). That `name` is a label that is frozen at save and unique on one agent, not the connection slug (`sdks/python/agenta/sdk/agents/mcp/models.py:205-226`); the connection slug lives in `connection` (`mcp/models.py:79-96`). design.md D2 shows `{list: "mcps", key: row.slug}` in its example. The view must use the key the engine uses (the entry `name`), so a view and a builder operation address the same server. Not verified: whether the entry `name` always equals the connection slug when the agent configuration UI adds a server.
- Dialogs. The generic unsaved-changes dialog lives in `@agenta/ui` (keys `ui.viewStack.*`); its description comes from the view. The subagent view uses the production text "Save your changes to this agent draft, or discard them?" (`web/packages/agenta-i18n/locales/en/entityUi.configItems.json:31`). "Connect server" stores a server in the project, so its description is not written; listed for Mahmoud. The remove dialogs for a subagent and an MCP server (canvas F06 f2) are domain dialogs in `@agenta/entity-ui` next to the agent sections, not in the view stack package. `McpPermissionDrawer` has its own remove confirmation today (`McpPermissionDrawer.tsx:282-299`); the new server view uses the F06 f2 dialog.
- A host with no view stack (the chat MCP notice card, the gateway connect tool widget) shows the connect step in its own container, a dialog as today or `DrawerViewChrome`.

## Cross-package and backend dependencies

- Personal accounts are on by default after task 10.1 (DECIDED by Mahmoud, a configuration default of `AGENTA_ACCESS_PERSONAL_ACCOUNTS_ENABLED`, `api/oss/src/utils/env.py:216-217`), so the MCP account switch and each person's own sign-in show by default; the "switch off" state stays for an installation that sets it to false.

The MCP work spans three packages and one backend area. The milestone owner plans for these before it starts.

- The views live in `@agenta/entity-ui`, folder `web/packages/agenta-entity-ui/src/mcpEndpoint/` (`McpConnectJourney.tsx`, `McpPermissionDrawer.tsx`, `McpAddServerDrawer.tsx`, `McpConnectionDetail.tsx`).
- `@agenta/settings-ui` mounts them for Settings › MCP (`web/packages/agenta-settings-ui/src/mcp/McpServersSection.tsx:515, 536`, mounted by `web/mobile/src/features/settings/McpServersTab.tsx:17`). The list merge of task 17.2 edits this package.
- `@agenta/chat` mounts the connect step in `McpServerNoticeCard` (`web/packages/agenta-chat/src/components/McpServerNoticeCard.tsx:79`), and `web/mobile/src/features/chat/TurnRow.tsx:329` mounts the card. The builder panel milestone (task 24.3) owns `TurnRow.tsx`. The MCP milestone changes only the card's import of the connect step; any change in `TurnRow.tsx` goes through that owner with a dated hand-off.
- `@agenta/entity-ui` `clientTools/GatewayConnectToolWidget.tsx:87` (the chat tool widget) mounts the connect step too.
- Backend. Each person's own sign-in exists only for `custom` (project) servers, in `api/oss/src/core/gateways/mcps/` (`service.py:1165-1192`, `oauth/sign_ins.py`) and the routes in `api/oss/src/apis/fastapi/gateways/mcps/router.py:704-760`. The SDK and the gateway refuse `account_source: "user"` on every other namespace (`sdks/python/agenta/sdk/agents/mcp/models.py:90-91`, `service.py:1178-1179`). Each person's own sign-in for the other server kinds (`builtin`, `standard`) does not exist today. The approved canvas draws each person's own sign-in only for a project server (F03 f7, "linear"), so it is not part of the approved design. The switch stays hidden for the other kinds (requirement "MCP account switch").
- Backend work: none for the switch and the sign-in states. The account name is one backend task (39.1), its own PR, which starts on day one.

## Today's behavior (origin/main 5d783fec, v0.129.0)

- Add subagents: `AddSubagentDrawer` (`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/AddSubagentDrawer.tsx`), mounted by `SubagentDrawerContainer.tsx:130`, mounted at `AgentTemplateControl.tsx:1617`. Texts in `web/packages/agenta-i18n/locales/en/entityUi.addSubagent.json` (load error and "Retry", empty and no-match texts).
- Subagent view: `ReferenceToolFormView` (`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/ReferenceToolFormView.tsx:91-130`), mounted by `ToolFormView.tsx:302` through the item kinds (`agentTemplate/itemKinds.tsx:90`). Texts in `entityUi.toolForm.json` (description hint, "Configuration", "Read-only", "Show full instructions", "Hide instructions", the empty texts). "Open agent" is in the footer today (`entityUi.configItems.json` key `openAgent`); the design moves it to the Configuration title. "No subagents yet" and "not an agent" are in `entityUi.configItems.json`.
- A reference with no `version` runs the latest revision (`sdks/python/agenta/sdk/agents/tools/models.py:423-454`).
- MCP add list: `McpAddServerDrawer` (`web/packages/agenta-entity-ui/src/mcpEndpoint/McpAddServerDrawer.tsx:57`), mounted at `agentTemplate/McpServersSectionBody.tsx:239`. Texts in `entityUi.mcpConnect.json`.
- Connect step: `McpConnectJourney` (`web/packages/agenta-entity-ui/src/mcpEndpoint/McpConnectJourney.tsx:287`), a 480 px modal with two steps today. Texts in `entityUi.mcpConnect.json` ("Reachable · signs in with OAuth", "Detected", "Advanced", "Callback URL", "Scopes") and `entityUi.mcpJourney.json` (errors, OAuth wait, cancel).
- Server view: `McpPermissionDrawer` (`web/packages/agenta-entity-ui/src/mcpEndpoint/McpPermissionDrawer.tsx:304`). It shows the expired sign-in as a banner "{{name}} needs a new sign-in." with "Its tools fail until someone in the project reconnects. Permissions below are kept." (`:200-201`, `entityUi.mcpPermissions.json`). It already has "Remove from agent" with a confirmation (`:282-299`). It mounts the integration permission list (`:570`).
- Account part: `McpAccountBlock` (`agentTemplate/accounts/McpAccountBlock.tsx:21-97`, mounted at `McpServersSectionBody.tsx:299`). Today it is one select, "Each person's own sign-in" or "The project's sign-in" (`entityUi.accounts.json:4-5`). The user option shows only when personal accounts are on and the server takes a sign-in (`agentTemplate/accounts/accountOptions.ts:13-27`). The person line uses "When you run it: signed in as you", "Sign out", "When you run it: not signed in", "When you run it: your sign-in expired", "Sign in" (`entityUi.accounts.json:11-12, 17-19`). The line is hidden when the viewer may not edit the agent (`McpAccountBlock.tsx:45-51`).

## Per-person MCP sign-in, verified

What exists:
- A sign-in is a vault row at a slug derived from the server id and its auth mode: an OAuth grant or a token (`api/oss/src/core/gateways/mcps/oauth/sign_ins.py:1-35`, `oauth/storage.py:60-82`). The project holds one; each person may hold their own in their own rows. A person's sign-in serves every agent of the project (`sign_ins.py:1-7`).
- A person signs in with `POST /endpoints/{id}/connect` and owner kind `user` (`api/oss/src/apis/fastapi/gateways/mcps/router.py:225-232`). The same route starts an OAuth attempt, or stores the token from the body for an API key server (`_connect_person`, `router.py:704-760`). Any project member who may see the servers may add their own sign-in (`router.py:712-724`). The OAuth callback refuses a person's sign-in when the switch is off (`router.py:1034-1050`).
- The server list carries the caller's own state as `user_sign_in` (`router.py:283-295`; `api/oss/src/apis/fastapi/gateways/mcps/models.py:37-50`).
- The agent config can set `account_source: "user"` on an MCP gateway route (`sdks/python/agenta/sdk/agents/mcp/models.py:84-91`).
- At run time the gateway reads the run person's sign-in from the run's claim (`api/oss/src/core/gateways/mcps/service.py:1165-1192`) and renews an OAuth grant when it is due (`service.py:1193-1224`).

Exact limits:
- Project servers only. The SDK refuses `user` on any other namespace (`mcp/models.py:90-91`). The gateway refuses it too (`service.py:1178-1179`). The person route refuses a server that is not a project server or takes no sign-in (`router.py:731-742`).
- One sign-in per person per server: the slug comes from the server id (`oauth/storage.py:60-82`).
- No fallback: with no run person, no claim entry, or a deleted row, the call is refused with `MCPSignInMissingError`, never answered with the project's sign-in (`service.py:1166-1192, 1203-1212`).
- No run person: a channel run, an API-key automation and a subagent's run (`api/oss/src/core/account_choices/items.py:13-26`). An automation saved in the app runs as that person (see the `integrations-accounts` notes.md).
- Switch off: no person route works, and the run reads no claim (`api/oss/src/apis/fastapi/shared/personal.py:1-60`, `api/oss/src/core/account_choices/claims.py:55-64`).
- Whether a run that starts without the person's sign-in leaves the server out at start (as integrations do) or fails on the first call: the call path is verified above; the start path is not verified.

Missing for the design:
- The account name after a sign-in. `MCPUserSignIn` has only `is_ready` (`models.py:37-41`). An OAuth grant does not always carry an identity, and a pasted token never does. The view shows the signed-in state with no name (PROPOSED); the backend option is below.
- Per-person sign-in for Agenta's own servers (`builtin`, for example the broker of app tools) does not exist. The canvas does not draw it; it is not part of the approved design.
- The warning for runs without a person on an MCP server is not drawn. Same rule and same frontend check as integrations. Small.

## The account name (task 39.1, backend, DECIDED)

Scope: project servers connected by address (`custom`), the only kind with each person's own sign-in.
- How the name is read, per server type. An OAuth server: after the callback stores a person's grant (`api/oss/src/apis/fastapi/gateways/mcps/router.py:1034-1050`; token exchange at `api/oss/src/core/gateways/mcps/oauth/client.py:611`), take the name from the token response when it carries one (for example an `id_token` with a `name` or `email` claim), else read the server's user info endpoint when its metadata names one. A token (API key) server: no read; a pasted token carries no name (`api/oss/src/core/gateways/mcps/oauth/service.py:709`).
- Store the name with the person's grant (the grant slug comes from `api/oss/src/core/gateways/mcps/oauth/storage.py:60-82`) and return it as a new optional field of `MCPUserSignIn` next to `is_ready` (`api/oss/src/apis/fastapi/gateways/mcps/models.py:37-41`; PROPOSED name `account_name`), which the list carries as `user_sign_in` (`router.py:283-295`).
- No name, a failed read or a timeout: store nothing, do not fail the sign-in; the screen shows "Signed in".
- Tests: an OAuth sign-in with a name in the token response, one with a user info read, one with no name, a failed read, a token sign-in; the list returns the field only to its owner.
- Not verified: which OAuth servers in use put a name in the token response or offer user info (OPEN-QUESTIONS 3.26), and whether the grant row needs a new field or can hold it in its stored data.

## Backend work

- None is needed for the switch, "Your sign-in", sign-in, sign-out or the expired state; production already has the routes and the `user_sign_in` field.
- Account name after sign-in: task 39.1 (above), medium.
- Subagents: none.

## Other places that mount the changed components

Verified on origin/main.
- `McpConnectJourney`: `web/packages/agenta-settings-ui/src/mcp/McpServersSection.tsx:515`; `McpServersSectionBody.tsx:321, 336`; `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/McpServerFormView.tsx:244`; `web/packages/agenta-entity-ui/src/clientTools/GatewayConnectToolWidget.tsx:87`; `web/packages/agenta-chat/src/components/McpServerNoticeCard.tsx:79` (mounted at `web/mobile/src/features/chat/TurnRow.tsx:329`).
- `McpPermissionDrawer`: `McpServersSection.tsx:536`; `McpServersSectionBody.tsx:254`; `McpServerFormView.tsx:227`.
- `McpServerFormView` is the MCP item form in the item kinds (`agentTemplate/itemKinds.tsx:132`), used by the generic `ConfigItemDrawer`.
- `McpSignIn` (OAuth or token sign-in for a person): `McpAccountBlock.tsx:79`; `web/packages/agenta-entity-ui/src/onboarding/PersonalAccountsCard.tsx:207`.
- `McpTokenSignInDialog`: `web/packages/agenta-settings-ui/src/mcp/McpYoursTable.tsx:198`, mounted at `McpServersSection.tsx:496`.
- `McpServersSection` (Settings list): `web/mobile/src/features/settings/McpServersTab.tsx:17`.
- `IntegrationPermissionDrawer` is shared with integrations (`McpPermissionDrawer.tsx:570`); changes in the `integrations-accounts` spec show here too.
- `ReferenceToolFormView` and `AddSubagentDrawer` are mounted only from the agent configuration (`ToolFormView.tsx:302`, `SubagentDrawerContainer.tsx:130`).
- Phone: adding an MCP server or a subagent is read only on a phone (`phone-layout` spec).

## Duplicate implementations to merge

- Two MCP server lists: `McpServersSection` (Settings) and `McpServersSectionBody` with `McpAddServerDrawer` (agent configuration). The connect step and the permission view are already shared. Merge the list into the one "Add MCP server" view where the jobs match (Settings also manages and deletes servers).
- Two token sign-in forms: `McpTokenSignInDialog` (Settings "Yours" table) and the token form inside `McpSignIn`. Both use the same hook. Keep one.
- Two MCP item forms: the server view and `McpServerFormView` inside `ConfigItemDrawer`. The new server view replaces the drawer form.

## States described but not drawn

Empty subagent list; configuration load failure; OAuth wait; API key step; healthy server; tools not loaded; not connected; no access; token sign-in; own sign-in expired; sign out; the warning on an MCP server; switch hidden; the connect in flight; the removed state of a view whose key left the list. The configuration load error, the warning, the removed state and the connect step's unsaved-changes description are not in production; they need text before release.

## Text that is not confirmed (HANDOFF section 5)

- "One shared sign-in", "Everyone uses the sign-in of the project.", "Your sign-in", "Not signed in yet", "Sign in to linear".
- New canvas text not in production and not in that list: "Choose whose linear sign-in the agent uses", "Each person's own" (as a switch label), "Everyone uses their own linear sign-in.", "Shared sign-in", "Every run uses this sign-in, whoever starts it", "The linear sign-in your own runs use", "Write · 5" with "asks first".
- The canvas note of F03 f7 says "After the sign-in, this place shows the account name." The release shows "Your sign-in: {{name}}" (text from Mahmoud), or "Signed in" when the server gives no name.
- The canvas drew F03 from a written summary of the code (HANDOFF section 7, inventory section 5). Help texts on F03 that are not in production should be checked against the production files before they ship.

## Open questions

- OPEN-QUESTIONS 3.26 (which OAuth servers give a name) before task 39.1.
- Should a server with each person's own sign-in fall back to the project's sign-in for runs without a person? The code says no today; the design does not ask for it.
