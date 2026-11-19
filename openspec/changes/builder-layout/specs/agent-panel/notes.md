# agent-panel: notes for implementers

These notes belong to `spec.md` in this folder. They hold the words the requirements use, today's behavior on `origin/main` with `path:line`, the other places that mount the changed components, backend work, states that are described but not drawn, and the text. They are not part of the requirements. The code contract is design.md D2 (the view stack contract); this file does not repeat the types.

## Words used in this file

- **Agent screen**: a screen that shows one agent. These are a session, the Configuration page, the Analytics page and the Sessions page of one agent.
- **Right panel**: the one panel at the right edge of an agent screen. It shows one content at a time.
- **Content**: one of three things the right panel can show: Files, Configuration or Builder. The word means only these three.
- **Container**: a place on screen that shows views: the right panel, the Configuration page, a Settings page, a drawer shell, a dialog, or the phone full screen.
- **Root**: the base screen of a container, for example the Agent tab body or a Settings list. A root is not a view and is not in the view stack.
- **View**: a screen that a root opens on top of itself, for example a skill, an MCP server, the AGENTS.md editor or the model picker. Views sit in the view stack at depth 1 or depth 2. "A view of one item" is a view for one configuration item.
- **Wide view**: a view whose definition sets `wide`. Only the panel reads it (760 px).
- **Chrome**: the frame a container draws around the top view (breadcrumb, Cancel and Save, Done, back arrow). Each container has its own chrome: panel, page, Settings, drawer (`DrawerViewChrome`) and phone.
- **Item**: one configuration item: an integration, a subagent, an MCP server, a skill, a secret attachment. Addressed by `ConfigItemRef = {list, key}`.
- **Dirty**: a value with edits that are not saved: an open view form, a Files edit, an automation form. The code uses this one word for every source of unsaved work. The agent configuration is never dirty for the leave guard, because the automatic save saves it.
- **Overlay mode**: the right panel lies over the conversation and does not make it narrower.

## Which rule won (contradictions from the design inventory, section 6)

- Files width (contradiction 12): the canvas board S05 draws Files at 620 px, and its note says "as in production today". BEHAVIOR 2.2 says all three contents are 440 px. The canvas won. Files keeps 620 px, 420 to 1600 px, and no close button.
- Where the panel state is stored (contradiction 3): BEHAVIOR 1.6 and 2.2 say "per user". Storage (design.md D11, the panel state store): browser storage keyed by user id and project id, key `agenta:agent-panel:${userId}:${projectId}`, holding `{content, width, configTab}`. It does not follow the user to another device.
- Leave dialog (contradiction 16): BEHAVIOR 2.6 and the canvas F06 f1 have "Keep editing", "Discard" and "Save changes". The prototype had "Cancel" and "Leave". The canvas won.
- Configuration tabs (contradiction 1) are in the configuration-draft capability.
- The leave guard `confirmLeave` is specified here (requirement "One leave guard at the agent layout host"), because the panel host builds it (task 3.2). The configuration-draft capability says what an open form does when it asks ("Leaving with an open form with edits"). The agent configuration does not register: the production automatic save saves every change about 1500 ms after the edit (`web/packages/agenta-playground/src/state/execution/agentAutoCommit.ts:27`).

## Today's behavior on `origin/main` (5d783fec)

- The session screen is `web/mobile/src/features/chat/SessionWorkspace.tsx`. The configuration pane is on the LEFT of the conversation (`paneSide="start"`, line 417). The Files pane is on the right (`paneSide="end"`, line 445). Both can be open at the same time when the window is wide enough (`useCanPanesCoexist`, line 254; the rules at lines 256 to 273 close one when they cannot fit).
- The configuration pane width is stored in browser storage under `agenta:agent-chat:right-panel-width`, default 460 px, limits 360 to 900 px (`web/packages/agenta-chat/src/state/panelLayout.ts:144-151`). It is per browser, not per user. The new key does not migrate it (design.md D9).
- The Files pane width is stored under `agenta:agent-chat:files-pane-width`, default 620 px, limits 420 to 1600 px (`panelLayout.ts:155-157`). Files keeps this key.
- Open or closed for the configuration pane is stored under `agenta:chat:config-panel-collapsed` and a separate phone key (`panelLayout.ts:60-76`).
- The Files pane scope is the agent, not the session (`SessionWorkspace.tsx:197`). On a wide screen the Files pane has no close control; the header icon closes it (`SessionWorkspace.tsx:484`).
- The configuration pane stays mounted and hidden after first use, because unmounting the form cost about 100 ms (`SessionWorkspace.tsx:348-352`). Keep this for the new panel.
- No configuration pane is mounted for a hidden agent (`SessionWorkspace.tsx:216`). A user without `edit_workflows` gets a disabled form (`web/mobile/src/features/chat/ConfigPane.tsx:56,69`).
- Configuration items open drawers today: `SectionDrawer` (720 px, `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/SectionDrawer.tsx:45`), `ConfigItemDrawer`, and `InstructionsDrawer` (920 px with a tips rail, `InstructionsDrawer.tsx:124`). The unsaved-changes dialog is in `SectionDrawer.tsx:94-127`, with texts in `web/packages/agenta-i18n/locales/en/entityUi.configItems.json:27-31`. The view stack does not reuse that namespace; it gets its own keys under `ui.viewStack`.
- Item drawers address an item by its position (`openEdit("mcp", index, item)`, `AgentTemplateControl.tsx:1267`). The view stack uses `ConfigItemRef`, the same shape as the target segment of a builder operation (`api/oss/src/core/workflows/change_set.py:919`, `_find_item`).
- The loading skeleton of the configuration pane is `web/mobile/src/features/chat/states/ConfigPaneLoading.tsx`.
- Leave guards today: the Files draft guard `useDriveDirtyGuard` (`web/packages/agenta-entities/src/drive/useDriveFileEditor.ts:213`, with its own `beforeunload` at line 220) and the automation guard `useUnsavedGuard` (`web/mobile/src/features/automations/useUnsavedGuard.ts:25`, also used by `web/mobile/src/features/playground/usePlaygroundLeaveGuard.ts:38`). Each guards on its own. The agent layout host gathers them in `confirmLeave`.
- Escape today: a streaming run stops on Escape when its conversation is on screen (`web/mobile/src/features/chat/LiveConversation.tsx:854-866`), and an open approval card denies on Escape (`web/packages/agenta-chat/src/components/ApprovalCard.tsx:190-210`). Neither checks focus. The session-screen capability sets the focus rule.

## Other places that mount the changed parts

- `DrillInBridgeProvider` (the configuration bridge) is mounted in `ConfigPane.tsx:66` and in the evaluator drawer, the evaluator playground, the playground, the create-prompt drawer and the revision drawer host. A view that leaves the drawer must still work in those hosts.
- `AgentBuildPanel` (`web/packages/agenta-playground-ui/src/components/AgentBuildPanel.tsx:63`) and `PlaygroundConfigSection` also render in `ConfigPanel` and `RevisionConfigView`.
- `SessionFilesPane` is rendered only by `SessionWorkspace.tsx:477`. `DriveExplorer` is also in `FilesDrawer`.
- `SessionWorkspaceDrawers` (`SessionWorkspace.tsx:530`) and `SessionAutomationDrawers` mount drawers that the new views replace. The release milestone deletes them when no container uses them (task 31.1).
- `DrawerViewChrome` is only for hosts that really keep a drawer: the prompt playground, the run error drawer, onboarding, and Settings screens where the design does not move a flow. Converting every shared surface to a non-drawer container is not a condition for the release.

## Foundation A work in this capability

The program branch replaces the session layout in place. There is no switch between the old and the new layout, and no "old layout matches main" check; a comparison with the old layout uses the production stack (design.md D10). Foundation A follows `tasks.md`:

- Section 2 (task 2.1): the mechanical split of `AgentTemplateControl.tsx`, `agentTemplate/useModelHarness.tsx` and `agentTemplate/itemKinds.tsx` (design.md D4). It moves code only.
- Section 3: the view stack primitive in `web/packages/agenta-ui/src/view-stack/` with the generic unsaved-changes dialog (F06 f1) only (task 3.1); the right panel host, the remembered state and `confirmLeave` (task 3.2); the session header in place of the old layout (task 3.3); the phone path (task 3.4, phone-layout capability); the four tabs and the seams, with no section converted (task 3.5). Each flow milestone converts its own sections.
- Section 4: the first configuration slice: Instructions (`apply: "on_save"`), the model pick (`apply: "immediate"`), one nested integration flow, and a second container: Settings › Integrations mounts the connect view through `DrawerViewChrome` in place of the `ConnectDrawer` body (`web/packages/agenta-settings-ui/src/tools/GatewayToolsSection.tsx:564`, mounted by `web/mobile/src/features/settings/IntegrationsTab.tsx`) (tasks 4.1 to 4.4).
- Section 7: the conversation role and the conversation lifetime (session-screen capability).
- The domain dialogs F06 f2 to f5 are not in the view stack. F06 f2 ships with the integration flow (task 4.3), the others with their flows; task 22.2 checks all five.

## Backend work

None for this capability.

## States described but not drawn

Overlay under 1100 px, the drag, the 760 px widen, the loading skeleton, the load error, the read-only form, the keyboard focus after close, the save pending state, the failed save in a view, the "removed" state of a view of one item, Escape at the root of a page. The canvas draws the panel closed (Main), Configuration open (S02), Builder open (S07, S08, S03, S09), a view with its breadcrumb (K01) and Files (S05).

## Text

- From the canvas, new: "Widen the panel" (button title), "Close" (button label of the Configuration panel).
- From production: "You have unsaved changes", "Save your changes to this agent draft, or discard them?", "Keep editing", "Discard", "Save changes", "Expand files pane", "Try again". The view stack copies them into its own namespace `ui.viewStack` for all 7 languages.
- Text not written; listed for Mahmoud: the dialog description for a view with the target `project` (each view gives its own; Settings MCP, secret, provider and automation views), the "removed" state of a view of one item, the failed save line in a view.
