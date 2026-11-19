# integrations-accounts: notes for implementers

These notes belong to `spec.md` in this folder. They hold the words the requirements use, today's behavior on `origin/main` with `path:line`, the other places that mount the changed components, backend work, states that are described but not drawn, and the text. They are not part of the requirements.

## Words used in this file

- **View**, **container**, **root**, **right panel**: as defined in the `agent-panel` spec. **Draft**: the production draft store of the agent configuration (`workflowDraftAtomFamily`); auto-save commits it as a new version about 1500 ms after a change (`web/packages/agenta-playground/src/state/execution/agentAutoCommit.ts:27`), as production does. A container shows a root (its base screen, not in the stack) and up to two views on top of it (depth 1 and depth 2).
- **`apply`** and **`target`**: the two settings of a view (design.md D2). `apply: "immediate"`: a change reaches the target at once and the view has "Done". `apply: "on_save"`: the view has "Cancel" and "Save", and only Save writes. `target: {kind: "agent_draft", revisionId}` writes the agent configuration through the production draft store, and auto-save saves it as a new version; `target: {kind: "project"}` writes a project resource on the server.
- **`ConfigItemRef`**: the address of one configuration item, `{list, key}`, the same shape as the target segment of a builder operation (design.md D2). An integration is in the list `tools`.
- **`useViewTitle`**: the hook a view calls to put its own title in the breadcrumb.
- **Integration**: an app (for example Zendesk) that the agent uses through its tools.
- **Connection**: one signed-in account of an app, stored in Agenta. A connection belongs to the project, to the organization, or to one person.
- **Account source**: the setting on an integration of the agent that says whose connection a run uses. `agent` means one project connection, named by its slug. `user` means the **run person**'s own connection.
- **Run person**: the person a run is for. A run from the app has the person who sent the message. An automation runs as the person who last saved it. A channel run, a run from an API key and a subagent's run have no run person.
- **Account choice**: a person's pick of one of their own connections for one agent. It is stored per person and per agent, outside the agent's versions.
- **Default account**: the one connection of an app that a person marked as their default. Their first connection of an app becomes the default.
- **Personal accounts switch**: the deployment setting `AGENTA_ACCESS_PERSONAL_ACCOUNTS_ENABLED`. While it is off, no person has own connections and `user` items are left out of runs.
- **Tool permission**: Allow, Always ask, Deny, or Follow agent policy, set per tool or by a preset for the whole integration.

## Milestones and views

- First configuration slice, task 4.3 (`tasks.md`): builds "Add integration" (F02 f4), "Connect" at depth 2 (F02 f5) and the integration view (F02 f6) with the account and permission parts as they are today. Items are addressed by `ConfigItemRef`. "Remove from agent" asks with the domain dialog F06 f2. Task 4.4 mounts the connect view in a second container, Settings › Integrations (`web/mobile/src/features/settings/IntegrationsTab.tsx`, through `GatewayToolsSection`, in place of the `ConnectDrawer` body at `web/packages/agenta-settings-ui/src/tools/GatewayToolsSection.tsx:564`), inside `DrawerViewChrome` with the target `project`. The `/m` playground hosts no agent sections: it sends an agent to its agent page (`web/mobile/src/features/playground/AppPlaygroundScreen.tsx:45-46`). These three views are the working contract that the parallel flows copy.
- Integrations milestone, section 16 (tasks 16.1 to 16.5): does the rest. The section rows and tags with the "+" menu (16.1); the merge of the three catalogs into the view of 4.3 and the connect form callers (16.2); the per-tool permissions redraw (16.3); the account switch, "Your account", "Shared account" and the warning (16.4, reused by MCP servers in 17.4); the onboarding accounts card and `AccountRow` (16.5).

| View | `apply` | `target` in the agent | `target` in Settings | What Save or a change writes |
|---|---|---|---|---|
| Add integration | `immediate` | `agent_draft` | `project` | in the agent: the agent configuration, including the attach after a connect, saved by auto-save; in Settings: nothing |
| Connect (depth 2) | `on_save` ("Connect" is the save) | `project` (its own target, not the parent's) | `project` | only the project's connection on the server, at once |
| Integration view | `immediate` | `agent_draft` | not mounted | the agent configuration (permissions, account source), saved by auto-save; the "Your account" pick saves at once on the server, outside the agent configuration |

- Create, then attach (design.md D2). A view has one target. The connect view writes only the project connection. When it returns, "Add integration" adds the integration to the agent configuration as its own write, and auto-save saves it. Production does the same in two steps: the connect drawer reports success, and the add drawer adds the integration once the connection is valid (`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/AgentIntegrationDrawer.tsx:540-553, 722-726`). "Add integration" has no form, so the connect form is the one editable form of the stack; the stack is dirty while that form is dirty.
- Item key. The change-set engine computes the key of a `tools` entry in `item_key` (`api/oss/src/core/workflows/change_set.py:477-504`). For a whole-integration entry (`type: "gateway_connection"`) the key is `gateway_connection:{provider}:{integration}` (`change_set.py:440-458`); for an older per-action entry it is the entry `name`, or `{integration}__{action}` (`change_set.py:459-469`). The frontend must compute the same key with one shared function, so a view and a builder operation address the same item.
- Dialogs. The generic unsaved-changes dialog lives in `@agenta/ui` (keys `ui.viewStack.*`); its description comes from the view. The integration views in the agent use the production text "Save your changes to this agent draft, or discard them?" (`web/packages/agenta-i18n/locales/en/entityUi.configItems.json:31`). The connect view stores a connection on the server, so its description is not written; listed for Mahmoud. The remove dialog F06 f2 ("Remove Zendesk from this agent?") is a domain dialog in `@agenta/entity-ui` next to the agent sections, not in the view stack package.
- A host that keeps a drawer (playground, create prompt, revision drawer, automation run conversation, onboarding, and Settings › Integrations for the connect view) wraps the views in `DrawerViewChrome`.

## Today's behavior (origin/main 5d783fec, v0.129.0)

- Section rows: `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/ItemRow.tsx`. Tag texts: "New" and "Edited" (`web/packages/agenta-i18n/locales/en/entityUi.agentTemplate.json:18, 20`), "old format" and "No integrations yet" (`entityUi.configItems.json:16-17`), the six reasons (`entityUi.needsSetup.json:6-11`).
- "+" menu: `CreateWithAIAddMenu` (`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/CreateWithAIAddMenu.tsx`), mounted at `AgentTemplateControl.tsx:1204-1212`. "Create with AI" writes `composerPrefillRequestAtom`, which fills the agent's own chat composer today. The starter text is "I want to connect" (`entityUi.agentTemplate.json:39`). The new target is the builder composer; the `builder-panel` spec owns that composer.
- Add integration: `AgentIntegrationDrawer` (`agentTemplate/AgentIntegrationDrawer.tsx:733`, mounted at `AgentTemplateControl.tsx:1632`). Texts in `entityUi.integrationDrawer.json`.
- Connect form: a 480 px modal (`web/packages/agenta-entity-ui/src/gatewayTool/drawers/ConnectDrawer.tsx:221-244`). "Who can use it" shows only when more than one owner is allowed (`:282-291`). "Auth Method" depends on the app's auth schemes (`:54-60, 120`). Texts in `entityUi.connectForm.json:3-13`.
- Permissions: `IntegrationPermissionDrawer` with `GROUP_PAGE_SIZE = 25` (`agentTemplate/IntegrationPermissionDrawer.tsx:79, 398, 478-481`). Texts in `entityUi.permissionDrawer.json`.
- Account part: `IntegrationAccountBlock` (`agentTemplate/accounts/IntegrationAccountBlock.tsx:61-112`, mounted at `AgentTemplateControl.tsx:1664`). Today it is one select ("Each person's default {name}" or a project connection, `accounts/accountOptions.ts:49-81`) and, for `user`, one line "When you run it: …" with "Change" (`IntegrationAccountBlock.tsx:114-241`). The new switch and select are a new layout of the same data.
- "Make it my default for every agent" is in the "Change" menu today (`IntegrationAccountBlock.tsx:227-231`). The new control has no place for it. The orchestrator chose to keep it in Settings (SHAPE section 6); Settings › Integrations already calls the same API (`web/packages/agenta-settings-ui/src/tools/GatewayToolsSection.tsx:8`).

## Personal accounts switch, verified

- It is a deployment setting, not a project setting: `AGENTA_ACCESS_PERSONAL_ACCOUNTS_ENABLED`. Today it is off by default (`api/oss/src/utils/env.py:216-217`, `api/oss/src/core/account_choices/policy.py:1-22`); task 10.1 turns it on by default (DECIDED by Mahmoud, a configuration default). So the account switch shows by default; the "switch off" state stays for an installation that sets it to false. The canvas says "off for the project"; the code has no per-project value.
- The browser learns it from the person's own secrets read: a 403 means "off" (`web/packages/agenta-entities/src/secret/state/personalSecrets.ts:37-48`). A caller who is no person also gets "off". A failed read gives "error", and production then hides the person's part (`:37-40`).
- While it is off, no route reads person rows and runs leave `user` items out (`policy.py:3-5`; `api/oss/src/core/account_choices/claims.py:55-64, 79-80`).

## Account choices, verified

- Routes: `POST /account-choices/` (store), `/query`, `/resolve`, `GET` and `DELETE /account-choices/{id}` (`api/oss/src/apis/fastapi/account_choices/router.py:78-116`). The frontend has `deleteAccountChoice` (`web/packages/agenta-entities/src/accountChoice/api.ts:79-90`), which is how "Use my default" clears a choice. No backend work.
- Resolution at run start: per `user` integration, the run person's chosen connection, else their default; ready when active and valid; only the person's own rows in the agent's organization; only the `composio` provider (`api/oss/src/dbs/postgres/account_choices/dao.py:44-80`).

## What a run with no person does with `account_source: "user"`, verified

1. Who is the run person: `run_person_id` returns the principal's id only for a human. It returns none for an API key, a channel installation and a child (subagent) run (`api/oss/src/core/account_choices/items.py:13-26`).
2. An automation runs as the principal of the request that created or last edited it (`api/oss/src/apis/fastapi/triggers/router.py:123-151`; `api/oss/src/core/triggers/service.py:981, 1159`; `api/oss/src/core/access/principals.py:174-196`). From the app that is a person. The app already tells the editor so: "This automation will run as you" and "When you save, it runs with your own accounts for the items that use each person's own account." (`web/packages/agenta-i18n/locales/en/automations.editor.json:65-66`, shown by `web/packages/agenta-automation-ui/src/AutomationRunPersonNotice.tsx`).
3. A channel run's principal is the channel installation, which is not a human (`api/oss/src/core/account_choices/items.py:17-19`; `api/oss/src/core/access/principals.py:185-195` keeps only the installation's linked user for its role, not as a run person). So it has no run person.
4. With no run person, the account read is skipped and every `user` item is left out of the run's claim (`claims.py:67-100`).
5. At run start the SDK resolves tools with `omit_unavailable: true` (`sdks/python/agenta/sdk/agents/platform/gateway.py:254-258`). The `user` integration has no connection, so it is left out and named in `unavailable_connections`; the run starts without that integration's tools (`api/oss/src/core/tools/service.py:791-863`). It never falls back to a project connection (`service.py:729-765`).
6. So the canvas warning (F10 frame 6) is right for channels, API-key automations and subagents, and wrong for automations saved in the app. The requirement follows the code. The canvas sentence "This agent has 1 trigger. A run from a trigger has no person, so it has no Zendesk account. Choose one shared account for those runs." cannot ship as it is ("trigger" is not the product word, and it is wrong for automations saved in the app). The spec states only when the warning shows and that it points to one shared account. The text is not written; listed for Mahmoud.
7. The browser can tell the case apart: a subscription and a schedule carry their `principal` in the API response (`api/oss/src/core/triggers/dtos.py:284-286, 350-352`). Which query lists the agent's channel bindings for this check: not verified.
8. `tasks.md` task 16.4 says the warning shows "when the agent has an automation or a channel". The spec is narrower: an automation saved in the app does not trigger it, because it runs as the person who saved it (point 2).

## Backend work

- None is needed for the switch, the selects, "Use my default", "No account yet" or "Connect another shared account".
- The warning needs no backend work if the panel reads the agent's automations and channels with existing queries (channel query not verified). Small.
- A project default connection does not exist (research Part B 2). The design does not need one.

## Other places that mount the changed components

Verified on origin/main.
- `ConnectDrawer`: `AgentIntegrationDrawer.tsx:380`; `IntegrationAccountBlock.tsx:166`; `web/packages/agenta-entity-ui/src/gatewayTool/drawers/CatalogDrawer.tsx:121`; `web/packages/agenta-entity-ui/src/onboarding/AccountRow.tsx:128` (in `AgentSetupCard.tsx:200`); `web/packages/agenta-entity-ui/src/onboarding/PersonalAccountsCard.tsx:139`; `web/packages/agenta-settings-ui/src/tools/GatewayToolsSection.tsx:564`.
- `CatalogDrawer`: `web/mobile/src/features/chat/SessionWorkspaceDrawers.tsx:48`; `web/mobile/src/features/automations/AutomationRunConversation.tsx:77`; `web/mobile/src/features/playground/PlaygroundWorkspace.tsx:119`; `web/mobile/src/features/prompts/CreatePromptDrawer.tsx:49`; `web/mobile/src/features/revisions/EditableRevisionDrawerHost.tsx:76`.
- `IntegrationCatalog`: `GatewayToolsSection.tsx:507`, mounted by `web/mobile/src/features/settings/IntegrationsTab.tsx:35`.
- `IntegrationPermissionDrawer`: `AgentTemplateControl.tsx:1646`; `web/packages/agenta-entity-ui/src/mcpEndpoint/McpPermissionDrawer.tsx:570`. A change here changes the MCP server view too.
- `PersonalAccountsCard` (the "Connect your accounts" card in chat and in the automation editor): `web/mobile/src/features/chat/LiveConversation.tsx:1051`; `web/packages/agenta-automation-ui/src/AutomationRunPersonNotice.tsx:91`.
- `useAccountChoice` (`web/packages/agenta-entity-ui/src/accounts/useAccountChoice.ts:16`): the account part, `SecretRequestDock`, `PersonalAccountsCard` and `AgentSecretAttachmentModal`.
- `CreateWithAIAddMenu`: `AgentTemplateControl.tsx:1204` (Integrations) and `:1284` (another section). Its target changes for every section that uses it.
- Phone: M08 (Integrations list) and M09 (the account switch) use the same views; see the `phone-layout` spec.

## Duplicate implementations to merge

- Three integration catalogs that each build their own list from `useToolCatalogIntegrations`: `IntegrationCatalog` (Settings), `CatalogDrawer` (chat, playground, prompts, revisions, automation runs) and `AgentIntegrationDrawer` (agent configuration). Merge into the one "Add integration" view.
- Two account UIs for the same data: `IntegrationAccountBlock` in the integration view and `AccountRow` and `PersonalAccountsCard` in onboarding and chat. The `PersonalAccountsCard` is a different job (set up all missing items at once) and can stay; its connect form becomes the new connect view.

## States described but not drawn

Loading and error of the catalog; the finish step of a pending connection; the OAuth wait; "Show N more"; personal accounts switch off (switch hidden); no project connection in "Shared account"; a saved slug that is gone; pick failed; the warning for a channel; the connect in flight; the removed state of an integration view whose key left the list. The connect error text, the empty "Shared account" text, the removed state text, the connect view's unsaved-changes description and the warning text are not drawn and not in production; they need text before release.

## Text that is not confirmed (HANDOFF section 5)

- Connect form: "Only your own runs use it.", "Agents in this project can use it."
- Account part: "Each person's own", "Everyone uses their own Zendesk account.", "One shared account", "Everyone uses the account you pick.", "Your account", "The Zendesk account your own runs use", "Shared account", "Every run uses this account, whoever starts it", "Use my default", "Connect another shared account". Mahmoud approved the control, not each string.
- Warning: "This agent has 1 trigger. A run from a trigger has no person..." It must say "automation" or "channel", and it is wrong for automations saved in the app (see above).
- New canvas text not in production and not in that list: "Choose whose {app} account the agent uses", "No account yet", "Connect {app}" as a button label, the count line "1 skill mentions Zendesk." in the remove dialog.

## Open questions

- The text of the warning, and whether it should also name the automation's person ("runs as Lena").
- "Make it my default for every agent": kept in Settings by the orchestrator; Mahmoud can overturn it.
