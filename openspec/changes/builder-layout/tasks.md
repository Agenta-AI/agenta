## How to read this file

- Sections follow the milestones of the program. A milestone is a set of tasks that ships on its own: after it merges, the product works.
- Each task names the capability spec it implements (`Spec:`), the main files or folders (`Files:`), and its acceptance check (`Check:`).
- `[parallel: <group>]` marks tasks that can run at the same time as other tasks with the same group name. Tasks without the mark run in the listed order inside their section.
- `Needs:` names what must exist before the section starts. "Merged" means the PR is in the program base. "Contract final" means the spec file is final and the code that settles it works in the first slice.
- Every milestone PR targets the program base branch `feat/builder-layout`.
- The order: section 1 (setup), then the first slice (sections 2, 3, 4, 7 and 8, built by the two foundation sessions). There are no sections 5, 6, 36, 37 and 38. Sections 9 and 30 to 35 are the builder agent work: the builder architecture session owns them, and this program's frontend milestones that need them wait for them. This program writes no backend code (API, SDK, runner or record), except two backend tasks that Mahmoud asked for: the configuration default of section 10 (personal accounts on by default) and the MCP account name of task 39.1. Only the frontend flows that mount views in the panel wait for the first slice (task 8.4). Every other milestone starts on day one from its spec: the personal accounts default (section 10), the MCP account name backend (39.1), the QA harness, the sidebars, the bench, the choice form and the hero engine; the builder agent work starts on its own schedule. Each section says "Starts now" or "Waits for the first slice". Sections 55 (speed) and 56 (release) close the program. Every section belongs to the release.
- Path prefixes: `ET/` is `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/`. `M/` is `web/mobile/src/`. `P/` is `web/packages/`.
- Every task that adds user-facing text adds it to a namespace that its owning package or feature owns (`P/agenta-i18n/locales/<lang>/<namespace>.json` plus `P/agenta-i18n/src/catalogs/<namespace>.ts` with `defineCatalog`, design.md D9) in all 7 languages, and lists new text that Mahmoud has not confirmed in the PR body.
- Every task that changes a screen adds or updates a Storybook story with fixture data for one representative state set of its frames (QA plan, section 1).
- No task adds a dependency. A change to a package export map is allowed.
- Section conversion: the first slice converts only its three flows (Instructions, Model, Integrations; tasks 4.1 to 4.3). Each flow milestone converts its own sections so that their rows and "+" open views: Subagents (17.1), MCP servers (17.2), Skills (19.1), Secrets (20.1), Permissions and Advanced (20.4). Until then a section keeps today's drawer inside the new panel.

## 1. Program setup and reviews before build

- [ ] 1.1 Create the program base branch `feat/builder-layout` from `main` and push it. Spec: none. Files: none. Check: `git ls-remote --heads origin feat/builder-layout` shows the branch.
- [x] 1.2 [parallel: review] Design review of this change with the review loop in design mode (simplify and naming lenses). Spec: all. Check: round 1 ran (simplicity rated Medium, naming and interfaces rated High because of one field name in the builder tools); the accepted findings are in the files.
- [x] 1.3 [parallel: review] Independent architecture review by Codex. Spec: all. Check: the verdict and the accepted changes are in the files (first slice before the panel flows; change card contract; conversation lifetime).
- [ ] 1.4 Delta round of the design review (simplify and naming) on the changed files. Spec: all. Check: the record in this folder shows every rating Low, or each open item has a reason that the orchestrator accepted.
- [ ] 1.5 Publish the decision page for Mahmoud's later review: the one open choice (`OPEN-QUESTIONS.md` group 1, the hero animation variant), the decisions of group 2, and the text list (`TEXT-TO-CONFIRM.md`) as used (proposed texts marked). The build does not wait for it. Check: the page is published; `npx @fission-ai/openspec validate builder-layout --strict` passes; `DECISIONS-LOG.md` exists.
- [ ] 1.6 Copy this change folder to `openspec/changes/builder-layout/` on the program base. Check: the folder is on `feat/builder-layout` and validates.

## 2. First slice, step 1 · Mechanical split

Owner: Foundation A. Needs: 1.1. One PR; it merges first.

- [ ] 2.1 Split `ET/AgentTemplateControl.tsx` (section descriptors at lines 1140 to 1352, drawers at lines 1381 to 1677 on `origin/main` 5d783fec) into one file per configuration section under `ET/agentTemplate/sections/` (model, instructions, integrations, subagents, MCP servers, skills, secrets, permissions, Advanced). Split `ET/agentTemplate/useModelHarness.tsx` the same way (model picker, permissions, secrets, Advanced bodies) and `ET/agentTemplate/itemKinds.tsx` into one file per item kind (`ET/agentTemplate/itemKinds/tool.tsx`, `mcp.tsx`, `skill.tsx` and an index that only imports them). `AgentTemplateControl.tsx` keeps only the section list and the drawer mounts. No visual change, no text change, no behavior change. Spec: agent-panel. Files: `ET/AgentTemplateControl.tsx`, `ET/agentTemplate/useModelHarness.tsx`, `ET/agentTemplate/itemKinds.tsx`, new `ET/agentTemplate/sections/*`. Check: `pnpm --filter @agenta/entity-ui run test:unit` passes; types and lint pass; story captures of the Agent tab before and after the split are identical; no section body is left in `AgentTemplateControl.tsx`; an Opus reader confirms with `git diff --color-moved=zebra` that moved code is unchanged.

## 3. First slice, step 2 · View stack, panel host, session header and phone path

Owner: Foundation A. Needs: 2.1 merged; agent-panel and session-screen specs final.

- [ ] 3.1 View stack primitive (shared-contract PR): `ViewDef` with `apply: "on_save" | "immediate"`, `ViewTarget` (`{kind: "agent_draft", revisionId} | {kind: "project"}`), `ConfigItemRef`, `useViewTitle`, `open` and `push` that return `Promise<boolean>`, guarded back separate from Cancel, a saving state that blocks a second submit and navigation, at most two levels, one editable form at a time, an explicit target on every `open` and `push` (one target per view), the stack dirty when any view in it is dirty (a picker on top does not hide a dirty parent), and the generic unsaved-changes dialog (F06 f1) whose description comes from the view, with text keys in the namespace `ui.viewStack`. Domain dialogs are not in this package. Spec: agent-panel. Files: new `P/agenta-ui/src/view-stack/`, the export map of `@agenta/ui`. Check: unit tests for open, push with a target other than the parent's, the third-level refusal, Cancel without a question, guarded back with each of the three answers, Save pending (second click ignored, navigation held), a failed save keeps the view, the title from `useViewTitle`, and a closeAll that asks while a picker covers a dirty parent.
- [ ] 3.2 Right panel host in `/m` and the leave guard: one content at a time (Files, Configuration, Builder), 440 px default, drag 360 to 640 px, 760 px for a wide view, overlay under 1100 px, Escape goes back then closes, state remembered under `agenta:agent-panel:${userId}:${projectId}`. Files keeps production width rules. The agent layout host owns `confirmLeave(reason)` and its registration API (shared-contract PR); the view stack registers with it. Stable test selectors `data-testid="agent-panel"` and `data-testid="panel-view"`. Spec: agent-panel. Files: new `M/features/agent-layout/`. Check: unit tests for the width rules, the overlay breakpoint, the remembered state with and without browser storage and with a second user on the same browser, `confirmLeave` asking each registered source; story captures of S02 and S05 shells; both selectors present.
- [ ] 3.3 Session header in place of the old layout (agent name and its menu, session menu, Share, Files, Configuration, Builder) with `data-testid="session-header"`. The left configuration pane, the session tab row and the old top bar leave `SessionWorkspace.tsx` in the same PR; there is no layout switch. Spec: session-screen. Files: `M/features/agent-layout/`, `M/features/chat/SessionWorkspace.tsx`, `M/features/chat/SessionTopBar.tsx`, `M/features/chat/SessionTabs.tsx`, `M/features/chat/ConfigPane.tsx`. Check: the header matches the Main frame; unit tests of the header menus; `SessionWorkspace.tsx` mounts no left pane and no tab row.
- [ ] 3.4 Phone path for the new layout: below 768 px a panel content opens full screen with a back arrow, and a view inside it opens full screen with a back arrow to its root (phone chrome of the view stack). Spec: phone-layout ("Panels open full screen with a back arrow", "Phone shared contract"; the redrawn phone screens are sections 49 to 54). Files: `M/features/agent-layout/`. Check: browser capture at 390 x 844 of a session, the Configuration content and one view; touch targets 44 px or more; the back arrow returns to the session.
- [ ] 3.5 The Configuration content shows the four tabs Agent, Automations, Channels and Access (configuration-draft spec). The sections keep today's bodies and drawers; this task converts no section (the first slice converts its three in section 4, each flow milestone converts its own). Create the seams that later milestones fill: the builder content slot of the panel, the Channels tab body (filled by task 23.3). Spec: agent-panel, configuration-draft. Files: `M/features/agent-layout/`. Check: story captures of the four tabs in the panel container; one section that is not converted still opens its drawer.

## 4. First slice, step 3 · One complete configuration slice

Owner: Foundation A. Needs: section 3 merged. This slice is the working contract that the panel flows copy. Auto-save stays as production (`P/agenta-playground/src/state/execution/agentAutoCommit.ts:27`); the slice does not change it.

- [ ] 4.1 Instructions view (F01 f3): AGENTS.md editor edge to edge, Cancel and Save (`apply: "on_save"`, target `agent_draft`); the 920 px drawer with tips goes away. Spec: agent-panel, configuration-draft. Files: `ET/agentTemplate/sections/InstructionsSection.tsx`, `ET/agentTemplate/views/instructionsView.tsx`, `ET/MarkdownEditor.tsx`, `ET/InstructionsDrawer.tsx`. Check: story capture; unit tests for Save applying the form to the agent configuration (auto-save then saves the version, as production) and Cancel discarding the form; SKILL.md in the skill editor still renders (regression).
- [ ] 4.2 Model pick as a view with `apply: "immediate"`: a pick changes the agent configuration at once, auto-save saves it as today, and the view has Done. The list stays today's list; the model providers milestones redraw it. Spec: model-providers ("Model picker as one grouped list", the pick behavior only). Files: `ET/agentTemplate/sections/ModelSection.tsx`, `ET/agentTemplate/views/modelView.tsx`. Check: unit test that a pick changes the configuration with no Save in the view.
- [ ] 4.3 One nested flow: integrations "Add integration" (F02 f4, target `agent_draft`) opens "Connect" (F02 f5) at depth 2 with its own target `project`, and a row opens the integration view (F02 f6) with the account and permissions parts as today. "Connect" creates the project connection, which applies at once; when it returns, "Add integration" adds the integration to the agent configuration as a separate write, and auto-save saves it (design.md D2, "Create, then attach"). Items are addressed by `ConfigItemRef`. Remove from the agent asks with the domain dialog F06 f2 in `@agenta/entity-ui`. Spec: integrations-accounts ("Add integration view", "Connect form as a view", "Integration view"). Files: `ET/agentTemplate/sections/IntegrationsSection.tsx`, `ET/agentTemplate/views/integration*View.tsx`, `ET/agentTemplate/itemKinds/tool.tsx`, `ET/agentTemplate/useAgentConfigWriter.ts`. Check: story captures of F02 f4 to f6; unit tests for add with one click, the connect step at depth 2 that writes the project only, the attach to the agent after the connect returns, a later removal from the agent that keeps the project connection, removal by key after the list changed under the open view.
- [ ] 4.4 Mount the slice in a second container that keeps a drawer: Settings › Integrations (`M/features/settings/IntegrationsTab.tsx`, which mounts `GatewayToolsSection`). The connect view replaces the body of `ConnectDrawer` at `P/agenta-settings-ui/src/tools/GatewayToolsSection.tsx:564`, inside `DrawerViewChrome`, with the target `project`. The `/m` playground does not host agent sections (`M/features/playground/AppPlaygroundScreen.tsx:45-46` sends an agent to its agent page). Spec: agent-panel, integrations-accounts. Files: `P/agenta-settings-ui/src/tools/GatewayToolsSection.tsx` (the `ConnectDrawer` mount only), new `DrawerViewChrome`. Check: Connect in Settings creates a connection and adds nothing to an agent; story capture in the drawer chrome; the guarded back asks when the name field has text.

## 7. First slice, step 4 · Two conversations and the conversation lifetime

Owner: Foundation B. Starts now (it needs no view of the panel; it merges after section 3 for the panel host file `SessionWorkspace.tsx`).

- [ ] 7.1 Conversation role as a context value (`"page"` or `"embedded"`) in one component tree; shortcuts act only on the focused conversation (today Escape, `Alt+G` and the approval keys act on any conversation on screen: `M/features/chat/LiveConversation.tsx:854-874`, `P/agenta-chat/src/components/ApprovalCard.tsx:190-210`); no code counts the whole history. Spec: session-screen. Files: `M/features/chat/LiveConversation.tsx`, `M/features/chat/ChatScreen.tsx`, `P/agenta-chat/src/components/ApprovalCard.tsx` (the key binding only), new conversation controller files in `M/features/chat/`. Check: unit tests for focus ownership of Escape, Stop and the approval keys; a test that changes the role and finds the composer text and the scroll position kept.
- [ ] 7.2 Conversation state survives every move (design.md D6): the composer text, the scroll position and an open quick action come back, and a running answer continues; a remount that restores this state is allowed. The session screen stays one page file for every session, and the agent pages are views of the agent route (`?view=configuration&tab=...`); a move between the two page files remounts the panel, and the conversation restores its state by session id and reconnects to a running answer. Spec: session-screen, agent-sidebar-pages ("Agent pages have their own address"). Files: `M/features/chat/`, the agent route file `M/pages/w/[workspace_id]/p/[project_id]/agents/[agent_id].tsx`. Check: a test that leaves the agent and comes back with text in the composer and finds it; a browser check that a running answer continues after the return.

## 8. First slice, step 5 · One builder edit end to end

Owners: Foundation A (the panel side, 8.1 and 8.2) and Foundation B (the follow side, 8.3). Needs: sections 4 and 7 merged; 9.3, 9.4 and 9.6 merged (the builder agent work: the result shape and the server preview).

- [ ] 8.1 Minimal builder content in the panel: it opens the newest chat of this agent from the browser link (PROPOSED key `agenta:builder:chats:${userId}:${projectId}`, written when a chat starts in the panel or names an agent) or a new chat. Every message carries the page context (`agent` and, on Configuration, `page: {kind: "configuration", tab, item?}`) as one context line in the text the model reads, with `metadata.display_content` set to the person's own text, the existing path that the SDK and the runner keep (`sdks/python/agenta/sdk/agents/adapters/vercel/messages.py:67-72`, `services/runner/src/server.ts:1134-1142`); snapshotted when the message is queued (shared-contract PR for `PageContext`, the line format and `pageContextAtom`). Spec: builder-panel ("Which chat opens"), page-context. Files: new `M/features/builder/`, the builder slot seam. Check: unit tests for the line and `display_content` on the session screen and on Configuration; a round trip of the line format; the browser link written and read per user and project; a queued message retried after navigation keeps its snapshot.
- [ ] 8.2 Minimal change card: the describer returns `changes?: ApprovalChange[]` (shared-contract PR in `P/agenta-chat/src/skin/types.ts`); the card shows the old and new values of the server preview (task 9.4); Approve saves; the result row shows "Saved as v{revision.version}". Spec: change-cards ("Three card parts", "Four forms of detail", "States after the answer"). Files: `P/agenta-chat/src/skin/types.ts`, `P/agenta-chat/src/model/approvalDescribers/`, `P/agenta-chat/src/components/ApprovalCard.tsx`. Check: unit tests of the describer with a recorded `edit_agent_config` part, with and without a preview.
- [ ] 8.3 Session follow in the browser: when a builder tool result with `status: "committed"` arrives in this browser, and on window focus and on `visibilitychange` to visible, the browser clears that agent's caches and runs the existing latest-version check (`P/agenta-playground/src/state/execution/latestVersionCheck.ts`); no server change; production adoption stays, and a session does not adopt while an open view form has edits (it offers the update). Spec: session-screen. Files: `P/agenta-playground/src/state/execution/latestVersionCheck.ts`, `M/features/chat/useAgentEntity.ts`, the tool result handler in `M/features/builder/`. Check: unit tests for each adoption condition, for the "Update to vN" offer, and that a builder commit does not adopt while the Instructions form has a local edit.
- [ ] 8.4 End-to-end check on the QA stack: in the panel of a session of Support triage, ask the builder for one change to the instructions, approve the card, and see "Saved as v5"; a second open session of the agent in the same browser adopts v5 when nothing is dirty (a session in another browser finds it on its next focus), and offers "Update to v5" while it has a local form edit. Spec: builder-panel, change-cards, session-screen. Check: the B cell passes with an MP4; the state-transition tests T1, T3, T4 and T5 of the QA plan section 2.4 pass on the merged base.

## 9. Depends on the builder agent work · Builder stack on the program base

Owner: the builder architecture session (not a program session). Starts now. Needs: nothing. [parallel: builder-agent-work]

- [ ] 9.1 Retarget PR 8341 to `feat/builder-layout` and bring it up to date with the base; keep 7409 on 8341 and 8345 on 7409; retarget 8346 onto 8345 (its old base merged). Spec: builder-backend. Files: the PR branches. Check: each PR shows only its own diff against its base; CI green on each head.
- [ ] 9.2 Fix the Medium correctness finding on 8341 (500 on some malformed values). Spec: builder-backend. Check: a test that sends the malformed value gets 422.
- [ ] 9.3 In PR 7409, `edit_agent_config` and `create_agent` return `revision: {id, version}` (the new revision), the same shape as `read_agent_config`, and no top-level `version`; `base_revision_id` in a result means only "send this with your next edit". Spec: builder-backend ("Frontend reads the agent tool results"). Check: unit tests of both results; the describer test of 8.2 reads `revision.version`.
- [ ] 9.4 DECIDED (server preview): when the approval gate of `edit_agent_config` opens, the server runs `apply_change_set` (`api/oss/src/core/workflows/change_set.py:1894`) on the base revision with the proposed operations, saves nothing, and attaches a bounded preview (old and new value per changed path) to the approval payload. Spec: builder-backend, change-cards. Check: an API test reads the preview of a recorded call with an `edit_text` operation that edits text an earlier operation created.
- [ ] 9.5 Add `request_input` (it exists on `main`, `api/oss/src/core/workflows/static_catalog.py:253`) to the builder tool list `BUILDER_AGENT_TOOLS` in PR 8345. Spec: builder-backend. Check: the catalog entry unit tests pass and a builder run can call `request_input`.
- [ ] 9.6 Merge the stack into the program base, bottom first (8341, 7409, 8345, 8346), each with a ship record. Check: `__ag__builder` answers a run on the QA stack.

## 10. Configuration default · Personal accounts on by default

Owner: the personal-accounts-default session (Sonnet, one small PR). Starts now. Needs: nothing. This is a configuration default, not new backend logic. [parallel: alongside]

- [ ] 10.1 Change the default of `AGENTA_ACCESS_PERSONAL_ACCOUNTS_ENABLED` to true (`api/oss/src/utils/env.py:216-217`, today `_parse_bool_env("AGENTA_ACCESS_PERSONAL_ACCOUNTS_ENABLED", False)`), and update the comment above it and the module docstring of `api/oss/src/core/account_choices/policy.py:1-6` ("off by default" becomes "on by default; an installation can set it to false"). Spec: integrations-accounts, mcp-subagents. Check: `ruff format` and `ruff check`; the unit tests of `api/oss/tests/pytest/unit/account_choices/`, `agent_requirements/`, `gateways/`, `tools/`, `vault/` and the acceptance test `api/oss/tests/pytest/acceptance/workflows/test_workflow_requirements_user_items.py` pass; every test that assumes the switch is off sets it to false itself.
- [ ] 10.2 Update every doc and example that states the default: add the variable with the default `true` to the self-host configuration reference (`docs/docs/self-host/reference/01-configuration.mdx`), and change "off" to "on" in `docs/design/accounts-package/contract.md:41, 403` and `docs/design/accounts-package/spec.md:588, 695` where they state the default. A search of `hosting/` and `docs/docs/` on `origin/main` finds no other mention. Check: `git grep -n AGENTA_ACCESS_PERSONAL_ACCOUNTS_ENABLED -- docs hosting` shows only the new default.

## 11. Alongside the slice · QA harness

Owner: the QA harness session. Starts now. Needs: nothing. [parallel: alongside]. No capability; it supports the QA plan.

- [ ] 11.1 Story folder and fixture factory for the builder layout: `web/storybook/stories/builder-layout/` and `web/storybook/fixtures/builderLayout/`, one fixture file per milestone, using the existing `parameters.agenta` data seam. Check: one sample story renders a configuration section with fixture data in light and dark.
- [ ] 11.2 Capture specs with the existing Playwright dependency of `web/tests` (no new dependency, no stored baseline): one spec that screenshots a list of story ids at a given size, one spec that opens a list of app routes with a signed-in account, runs the listed clicks, and screenshots the page or one element. Both read a recipe file and write PNG files to a folder given by an environment variable. Files: new `web/tests/visual/`. Check: the story spec captures the sample story; the route spec captures the login page of a running stack.

## 12. Alongside the slice · Sidebars

Owner: the sidebars session. Needs: agent-sidebar-pages spec final. [parallel: alongside]. Starts now: it touches only the sidebar files, so it does not wait for the slice.

- [ ] 12.1 Remove the 220 ms hold before a session row opens; a double click renames the session that is now open. Spec: agent-sidebar-pages, speed-budgets. Files: `P/agenta-sessions-ui/src/SessionRowActions.tsx` and its test. The old desktop app mounts the same row (`web/oss/src/components/Sidebar/dynamic/sessionRowWrapper.tsx:26`); it gets the change with no edit, and `web/oss` (abandoned) must still pass its type check. Check: unit test that the first click navigates at once; the `web/oss` type check passes; the session switch measurement drops by about 220 ms.
- [ ] 12.2 Main sidebar: one section per agent with its 4 latest sessions, "+" and the open button on hover. Spec: agent-sidebar-pages. Files: `M/features/nav/`. Check: story and browser captures of the Main frame sidebar.
- [ ] 12.3 Agent sidebar (A01): Back, switcher, fold, New session, Configuration, Channels, Analytics, "Sessions 42", groups by day, "Show N older sessions". Spec: agent-sidebar-pages. Files: new `M/features/agent-sidebar/`. Check: browser capture of A01; unit test that a shared link opens the main sidebar.

## 13. Parallel flows · Model picker and provider list

Waits for the first slice. Needs: section 8 passed. [parallel: flows]

- [ ] 13.1 Model picker view (F01 f2): one list grouped by connection, readable name with the raw id, "Manage model providers" fixed at the bottom, a pick changes the agent configuration at once (the behavior of 4.2). Also used by the composer "/model" and the playground. Spec: model-providers. Files: `ET/agentTemplate/sections/ModelSection.tsx`, `ET/agentTemplate/views/modelView.tsx`, `ET/agentTemplate/ModelPickerControl.tsx`, `P/agenta-ui/src/SelectLLMProvider/`. Check: story captures of F01 f2; unit tests for grouping and hidden built-in models; regression captures of the composer "/model" menu.
- [ ] 13.2 Model provider list and "Add a provider or subscription" (F09 f1 to f3) as views; the Agenta built-in card lists its three models with no switches (decided: on and off per project is not part of this work). Spec: model-providers. Files: `P/agenta-entity-ui/src/secretProvider/` (list and add), `P/agenta-settings-ui/src/providers/`. Check: story captures of F09 f1 to f3; Settings › AI providers mounts the same views.

## 14. Parallel flows · Provider key forms

Waits for the first slice. Needs: section 8 passed; 13.2 merged for the list that opens the forms. [parallel: flows]

- [ ] 14.1 Key form with the automatic key check (F09 f4 to f7, F11 f1 to f7): check on paste or blur, Stop, models loaded with the recommended ones checked, "Check again", Name first and pre-filled, Azure, Bedrock with two sign-in ways, Vertex, OpenAI-compatible, typed model id, "Show all" above 60 models. Spec: model-providers. Files: `P/agenta-entity-ui/src/secretProvider/ProviderConnectionCard.tsx`, `ProviderDrawer.tsx`. Check: story captures of each frame; unit tests for the check trigger, Stop, and the Bedrock value keeping.
- [ ] 14.2 Key check plumbing: use `POST /providers/probe` with the saved connection id for an existing connection (no key resent), and add an abort signal to the probe call for "Stop". A provider that the probe cannot test shows the `unknown` state; no backend change. Spec: model-providers. Files: `P/agenta-entities/src/secret/` (the probe call). Check: a unit test that Stop aborts the request; an API test that probes a saved connection by id.
- [ ] 14.3 Mount the key view in the run error drawer, the onboarding key form (with the key check), the connect-model strip and the credit strip. Delete `ProviderCredentialsSectionView.tsx` if it still has no caller. Spec: model-providers. Files: `M/features/chat/RunErrorProviderDrawer.tsx`, `M/features/chat/ConnectModelStrip.tsx`, `M/features/onboarding/OnboardingKeyForm.tsx`, `M/features/wallet/CreditAlertStrip.tsx`. Check: regression captures of each place.

## 15. Parallel flows · Subscriptions

Waits for the first slice. Needs: section 8 passed; 13.2 merged. [parallel: flows]

- [ ] 15.1 Subscriptions (F11 f8 to f10): ChatGPT device code with "Copied" and the waiting block, Claude token. Spec: model-providers. Files: the subscription forms in `P/agenta-entity-ui/src/secretProvider/`. Check: story captures; unit test for the token prefix rule.

## 16. Parallel flows · Integrations and account choice

Waits for the first slice. Needs: section 8 passed (the slice built the add, connect and integration views). [parallel: flows]

- [ ] 16.1 Integrations section and list with tags (F02 f1 to f3): "Needs setup" with its reason, "New", "Edited", "old format", the unsaved dot, the "+" menu with "Create with AI". Spec: integrations-accounts. Files: `ET/agentTemplate/sections/IntegrationsSection.tsx`, `ET/agentTemplate/ToolManagementList.tsx`, `CatalogListRow.tsx`. Check: story captures of F02 f1 to f3.
- [ ] 16.2 The integration catalog view of 4.3 replaces the other copies (`IntegrationCatalog`, the `CatalogDrawer` list); the connect form shows "Who can use it" only when personal accounts are on. Spec: integrations-accounts. Files: `P/agenta-entity-ui/src/gatewayTool/`, `P/agenta-settings-ui/src/tools/`. Check: Settings › Tools, playground, prompts, revisions and automations callers mount the one view; regression captures of the 6 connect form callers with personal accounts on and off.
- [ ] 16.3 Per-tool permissions in the integration view (F02 f6). Spec: integrations-accounts. Files: `ET/agentTemplate/IntegrationPermissionDrawer.tsx` (the view part). Check: unit tests for "Custom", presets, 25 tools then "Show N more".
- [ ] 16.4 Account switch "Each person's own" or "One shared account" (F10 f1 to f6), hidden when personal accounts are off, with the warning only when the agent has a channel or an automation created with an API key (DECIDED; text PROPOSED in TEXT-TO-CONFIRM). This component is reused by MCP servers (17.4). Spec: integrations-accounts. Files: `ET/agentTemplate/accounts/` (except `McpAccountBlock.tsx`), `P/agenta-entity-ui/src/accounts/useAccountChoice.ts`. Check: story captures of F10 f1 to f6; unit tests for "Use my default".
- [ ] 16.5 Onboarding accounts card and `AccountRow` use the new connect form. Spec: integrations-accounts. Files: `P/agenta-entity-ui/src/onboarding/PersonalAccountsCard.tsx`, `AccountRow.tsx`. Check: regression captures.

## 17. Parallel flows · Subagents and MCP servers

Waits for the first slice. Needs: section 8 passed; for 17.4, the account switch contract of 16.4. [parallel: flows]. Cross-package and backend dependencies: the MCP views live in `@agenta/entity-ui` (`mcpEndpoint/`) and are mounted by `@agenta/settings-ui` (Settings › MCP) and `@agenta/chat` (the notice card, a `TurnRow.tsx` mount that the builder panel milestone owns); the per-person sign-in reads `api/oss/src/core/gateways/mcps/` and exists only for `custom` servers, so the views offer each person's own sign-in only for project servers, as the canvas draws it. The account name is section 39.

- [ ] 17.1 Subagents (F03 f1 to f3): add with one click, remove with a second click, view with "Open agent", "Show full instructions", load error with Retry. Spec: mcp-subagents. Files: `ET/agentTemplate/sections/SubagentsSection.tsx`, `ET/agentTemplate/AddSubagentDrawer.tsx`, `SubagentDrawerContainer.tsx`, `SubagentHeader.tsx`, `ET/ReferenceToolFormView.tsx`. Check: story captures; unit tests for add and remove.
- [ ] 17.2 MCP server list as one view used by the agent section and Settings › MCP (merge of the two lists). Spec: mcp-subagents. Files: `ET/agentTemplate/McpServersSectionBody.tsx`, `P/agenta-settings-ui/src/mcp/`, `P/agenta-entity-ui/src/mcpEndpoint/McpAddServerDrawer.tsx`. Check: story captures of F03 f4; Settings › MCP mounts the same view.
- [ ] 17.3 Connect server (F03 f5) and server view with expired sign-in and "Reconnect" (F03 f6). Spec: mcp-subagents. Files: `P/agenta-entity-ui/src/mcpEndpoint/McpConnectJourney.tsx`, `McpPermissionDrawer.tsx`. Check: story captures; regression captures of its 6 callers including the chat notice card.
- [ ] 17.4 Server with each person's own sign-in (F03 f7), reusing the account switch of 16.4, for `custom` servers only; the scope of the other server kinds is a note in the spec. Spec: mcp-subagents. Files: `ET/agentTemplate/accounts/McpAccountBlock.tsx`, `P/agenta-entity-ui/src/accounts/McpSignIn.tsx`. Check: story capture; the spec note exists.

## 18. Parallel flows · Skill editor

Waits for the first slice. Needs: section 8 passed. [parallel: flows]

- [ ] 18.1 Skill editor as one view (F07 f1 to f10, K01) that replaces the 960 px and 760 px drawers: file menu, search, row actions, unsaved dots, add a file with folders, the duplicate path check, Advanced, expanded editor, both "…" menus. Spec: skills. Files: `ET/SkillFormView.tsx`, `ET/agentTemplate/views/skillView.tsx`, `P/agenta-skills-ui/src/SkillDetailDrawer.tsx`. Check: story captures of each frame; the Skills page mounts the same view.
- [ ] 18.2 Upload with "Add" (default) or "Replace the whole skill"; non-text files are skipped and listed. Check first whether the skill save accepts a partial file set; if it does not, the browser sends the merged full file set (no backend change). Spec: skills. Files: `ET/skillUpload.ts` and its callers. Check: unit tests for add and replace.

## 19. Parallel flows · New skill flows

Waits for the first slice. Needs: section 8 passed. [parallel: flows]

- [ ] 19.1 Skills "+" menu and "Add skills" (F04 f1, f2). Spec: skills. Files: `ET/agentTemplate/sections/SkillsSection.tsx`, `ET/agentTemplate/itemKinds/skill.tsx`. Check: story captures.
- [ ] 19.2 New skill: choose how, write, upload, import (F07 f12 to f15). Spec: skills. Files: `ET/agentTemplate/views/skillNewView.tsx`, `P/agenta-skills-ui/src/SkillCreateDrawer.tsx`, `M/features/skills/`. Check: story captures; "Create skill" stays off until the name and text are valid.

## 20. Parallel flows · Secrets, Permissions, Advanced

Waits for the first slice. Needs: section 8 passed. [parallel: flows]

- [ ] 20.1 Secrets as its own section after Skills (F04 f3), with "Not found in this project". Spec: secrets-permissions-advanced. Files: `ET/agentTemplate/sections/SecretsSection.tsx`, `ET/agentTemplate/AgentSecretsSection.tsx`. Check: story capture.
- [ ] 20.2 Attach a secret (F04 f4 to f7) with scope tags "Everyone" and "Only me", and a new secret with "Who can use it"; an attach saves a version as production does. The remove dialog F06 f3 lives next to the secret views. Spec: secrets-permissions-advanced. Files: `P/agenta-entity-ui/src/secret/`. Check: story captures; the secret request dock in the chat still works (regression capture).
- [ ] 20.3 Merge the two secret create forms (Settings `SecretFormSheet` and the package `SecretForm`) into one view. Spec: secrets-permissions-advanced. Files: `M/features/settings/SecretFormSheet.tsx`, `P/agenta-entity-ui/src/secret/SecretForm/`, `P/agenta-settings-ui/src/secrets/`. Check: Settings › Secrets mounts the one view; regression capture.
- [ ] 20.4 Permissions policy (F04 f8) and Advanced with Agenta tools (F04 f9, f10). Spec: secrets-permissions-advanced. Files: `ET/agentTemplate/sections/PermissionsSection.tsx`, `AdvancedSection.tsx`, `PermissionPolicySelect.tsx`, `AgentaToolsSection.tsx`. Check: story captures.

## 21. Parallel flows · Automations and run history

Waits for the first slice. Needs: section 8 passed. [parallel: flows]. Cross-package and backend dependencies: the views live in `@agenta/automation-ui` and `@agenta/entity-ui` (`gatewayTrigger/`) and are mounted by the Automations pages in `web/mobile`, the session automation drawers and the playground build panel (`ET/AgentOperationsSections.tsx:171`); run history paging reads the existing deliveries routes (`api/oss/src/apis/fastapi/triggers/router.py`); "Run now" stays exactly as today (DECIDED).

- [ ] 21.1 Automations tab list with the row menu and the "Add automation" menu (F05 f1, f2); groups "Scheduled triggers" and "App triggers"; delete asks first with F06 f4 in the automations package. Spec: automations-run-history. Files: `ET/TriggerManagementSection.tsx`, `ET/triggerManagement/`, `P/agenta-automation-ui/src/`. Check: story captures.
- [ ] 21.2 Scheduled trigger and app trigger forms (F05 f3, f4) and the automation view (F05 f5). The Automations page mounts the same views. Spec: automations-run-history. Files: `P/agenta-automation-ui/src/`, `M/features/automations/`. Check: story captures; regression captures of the Automations page.
- [ ] 21.3 Run history: list, a run open, the 760 px split, no runs (F05 f6 to f9); paging in the frontend (today one page only). The split depends on the width of the view's container, not the window (today a window media query, `P/agenta-automation-ui/src/AutomationRunHistoryView.tsx:70`). Merge `TriggerDeliveriesDrawer` into the one run history view. Spec: automations-run-history. Files: `P/agenta-automation-ui/src/AutomationRunHistoryView.tsx`, `P/agenta-entity-ui/src/gatewayTrigger/`. Check: unit test that a second page loads; unit test that a 440 px container on a 1440 px window shows one column; story captures.
- [ ] 21.4 DECIDED: "Run now" stays exactly as today (the browser path starts a new session; the run is not listed in the run history). Merge `AutomationTestRunButton` and `useTriggerTestRun` into one client hook only if the merge changes no behavior; "Run now" in the empty run history starts the session as today. Spec: automations-run-history. Files: `M/features/automations/AutomationTestRunButton.tsx`, `M/features/chat/useTriggerTestRun.ts`. Check: if merged, unit tests that both entry points call the one hook and that the behavior is unchanged; the production blocks ("Save your changes first") still apply.

## 22. Parallel flows · Agent tab and dialogs

Waits for the first slice. Needs: section 8 passed. [parallel: flows]

- [ ] 22.1 Agent tab section list in today's order (F01 f1, S02) with "Saved as vN" in the footer. Spec: agent-panel, configuration-draft. Files: `ET/AgentTemplateControl.tsx` (the thin list left after 2.1), `ET/agentTemplate/AgentTemplateSectionList.tsx`. Check: story capture of F01 f1.
- [ ] 22.2 QA of the five confirmation dialogs in their flows (F06 f1 to f5): the generic dialog in `@agenta/ui`, the domain dialogs in their packages. Spec: agent-panel. Check: story captures of each dialog.

## 23. Parallel flows · Agent pages

Waits for the first slice. Needs: section 8 passed. [parallel: flows]

- [ ] 23.1 Configuration page with tabs Agent, Automations, Access (A04 to A06) at `?view=configuration&tab=<tab>` on the agent route, reusing the section views. Spec: agent-sidebar-pages. Files: new `M/features/agent-pages/`. Check: browser captures of A04 to A06.
- [ ] 23.2 Sessions page and Analytics locked to one agent (A02, A09, A10). Each locked page keeps its own filter state and never writes the shared filter atoms (`M/features/sessions/SessionFilterMenu.tsx:6`, `P/agenta-observability-ui/src/analytics/AnalyticsPage.tsx:74`). Spec: agent-sidebar-pages. Files: `M/features/sessions/SessionListScreen.tsx`, `M/features/sessions/SessionFilterMenu.tsx`, `M/features/settings/AnalyticsTab.tsx`. Check: browser captures; unit test that a change on a locked page leaves the shared atoms unchanged; the unlocked pages are unchanged (regression).
- [ ] 23.3 Channels page and Slack manage view (A07, A08). The same view is the Channels tab of the right panel (S02). Spec: agent-sidebar-pages, configuration-draft. Files: `P/agenta-settings-ui/src/channels/`, `M/features/agents/useAgentPublishPanel.tsx`. Check: browser captures of the page and of the panel tab; Settings › Channels unchanged.
- [ ] 23.4 Access tab: Private or Shared with project, Owner, "Transfer ownership". Spec: agent-sidebar-pages. Files: `M/features/chat/AgentPrivacyHost.tsx`, `M/features/chat/ShareMenu.tsx`. Check: browser capture of A06; Share in the header shares the conversation only.

## 24. Parallel flows · Builder panel

Waits for the first slice. Needs: section 8 passed. [parallel: flows]

- [ ] 24.1 Builder content in the panel: the 2-day rule, new chat with quick actions and ready requests, 3 recent chats, "View all", Chat history with search, title menu, "+", "Open in the builder" (S07, S08, S09). Spec: builder-panel. Files: `M/features/builder/`. Check: browser captures of S07, S08, S09; unit tests for the 2-day rule.
- [ ] 24.2 Same-agent switch keeps the panel state (chat, scroll, composer text, quick action, running answer); only the chip changes. Spec: builder-panel, speed-budgets. Check: a render test that the composer text, the scroll position and an open quick action survive a same-agent switch and a running answer continues (a remount that restores them passes), and that a switch inside one page file causes no builder render outside the chip; streaming updates are allowed.
- [ ] 24.3 Page context chip: reads the page session id itself, shows what is sent, remove and "Add this page as context"; the chip shows on unsent and live messages; task 44.2 rebuilds it on a sent message after a reload. Spec: page-context. Files: `M/features/builder/`, `M/features/chat/TurnRow.tsx`. Check: unit tests for the payload with and without the chip; story captures.

## 25. Parallel flows · Change card data and detail forms

Waits for the first slice. Needs: section 8 passed. [parallel: flows]

- [ ] 25.1 The three card parts (header, path, footer) and the four detail forms for the operations that exist (`set`, `edit_text`, list add and remove) from `ApprovalChange.detail`; old and new values from the server preview (task 9.4; when one call has no preview, the card shows the proposed values with a label); the title-only fallback for an operation the card cannot render; "Saves as v{base + 1}" with the conflict state shown before a click when the latest version is newer than the base. Spec: change-cards. Files: `P/agenta-chat/src/components/ApprovalCard.tsx`, `P/agenta-chat/src/model/approvalDescribers/`, `P/agenta-entity-ui/src/changes/ChangeSections.tsx`. Check: story captures of the first-release cards of C01; describer unit tests per operation.
- [ ] 25.2 Warning lines from the operation: a permission set to "Allow" and a new MCP server URL (`risks`); the cost and "stops working" lines are section 47. Spec: change-cards ("Warning lines only for risk"). Check: describer unit tests for both and for no warning on other operations.

## 26. Parallel flows · Change card states and results

Waits for the first slice. Needs: 25.1 merged. [parallel: flows]

- [ ] 26.1 States after the answer derived in one function from the interaction status and the result status: "Saved as vN" with View and Revert, denied, not saved, conflict row with "Try again", "Waiting for the agent", "Only the owner can approve". Spec: change-cards. Files: `P/agenta-chat/src/components/ApprovalCard.tsx`, `M/features/chat/ApprovalDock.tsx`. Check: story captures of the 5 result rows; unit tests of the state function.
- [ ] 26.2 Several pending calls share "Deny all" and "Approve all" in one grouped card "Saved together as vN" (the other groups are section 46); each call keeps its own result row. Spec: change-cards. Check: a unit test with two approved calls on one base where one saves and one conflicts, and both rows show.
- [ ] 26.3 The same card shows tool approvals in an agent's own chat. Spec: change-cards. Check: regression capture of a tool approval in a session.

## 27. Parallel flows · Builder page

Waits for the first slice. Needs: section 8 passed; 24.1 contract final. [parallel: flows]

- [ ] 27.1 Builder page new chat (B01) and Browse ideas (B02). Spec: builder-page. Files: new `M/features/builder-page/`, a route shell under `M/pages/`. Check: browser captures.
- [ ] 27.2 The agent tab of the pane for the agent the chat is about (from the page context of the chat, the browser link, or the latest typed `create_agent` or `edit_agent_config` result), with its pane tabs; the active tab in `?tab=agent:<id>`. Section 40 adds the strip of builder tabs. Spec: builder-page. Check: unit tests for the derivation; browser capture of the pane after a builder edit.

## 28. Parallel flows · Choice form

Starts now: 28.2 builds the story from a recorded call; 28.1 merges after 9.5. [parallel: flows]

`request_input` exists on `main` (`api/oss/src/core/workflows/static_catalog.py:253`), and today's elicitation form shows it (`P/agenta-chat/src/components/ElicitationDock.tsx`). The work is to port the instructions and to prove the form.

- [ ] 28.1 Port the optimized builder instructions into the builder catalog entry; they ask "Decisions for you" as one `request_input` form (one single choice per decision, recommended first and default, one free-text field). Owner: the behaviors and optimization session. Spec: builder-backend. Check: the bench gate score of the ported text equals the best measured kit.
- [ ] 28.2 Check that today's elicitation form shows such a form: a story with a recorded `request_input` call (two single choices and one `multiline` field) and a unit test of the answer payload. Build a new card only if the check finds a gap. Spec: builder-backend. Files: `web/storybook/stories/builder-layout/choice-form/`. Check: story capture; unit test of the answer payload.

## 29. Parallel flows · Bench for the product builder

Owner: the bench session (private bench repository). Starts now; needs 9.6 merged for runs on the QA stack. [parallel: flows]

- [ ] 29.1 Static slug mode: the bench runs `__ag__builder` by slug, not a copied proof-of-concept agent. Spec: builder-backend. Check: one scenario runs against the QA stack.
- [ ] 29.2 Answering approvals: the bench answers `ask` approvals by a rule per scenario. Check: a scenario with `edit_agent_config` reaches the saved version.

## 30. Depends on the builder agent work · Session origin "builder"

Owner: the builder architecture session (not a program session), with the test run tool of section 31 that writes it. [parallel: builder-agent-work]

- [ ] 30.1 `SessionOrigin` gets the value `builder` (`api/oss/src/core/sessions/types.py:49-51`); a session that a builder tool starts carries `origin` "builder" and the reserved tag `ag.builder.session_id` with the id of the builder chat. Only the server writes both; a client write of `ag.origin` or `ag.builder.session_id` sets nothing. A builder chat itself keeps `manual`. Spec: builder-backend ("Session origin \"builder\""). Files: `api/oss/src/core/sessions/`, `api/oss/src/dbs/postgres/sessions/streams/mappings.py`. Check: API tests for the server write, the refused client write, and a builder chat that stays `manual`.
- [ ] 30.2 Decode and filter: session responses carry `origin: "builder"` and the decoded builder chat id; `POST /sessions/query` filters by `origins: ["builder"]`; the reserved tags stay stripped from `tags`. Spec: builder-backend. Files: `api/oss/src/apis/fastapi/sessions/`, `mappings.py`. Check: API tests of the read, the filter and the stripped tags; a reader who cannot open the builder chat still reads `origin` "builder".
- [ ] 30.3 The frontend session type gains the origin value and the builder chat id (a frontend change; the spark session does it in task 43.1). Spec: builder-backend, session-screen. Files: `P/agenta-entities/src/session/`. Check: unit test of the parsed session.

## 31. Depends on the builder agent work · Test run of another agent

Owner: the builder architecture session. Starts now on the builder stack branches (it builds on PR 8345); merges after 9.6 and 30.1. [parallel: builder-agent-work]

- [ ] 31.1 A builder tool that runs another agent of the project as the person (PROPOSED name `run_agent`): it starts a session of the named agent, writes `origin` "builder" and `ag.builder.session_id` through 30.1, returns the session id at once and streams progress. It asks for approval with a change card, because a run costs money (PROPOSED). It refuses an agent the person cannot run. Spec: builder-backend ("Builder tool that runs another agent"). Check: API test that a builder chat starts a run of another agent and reads its session id and origin; a refusal test for an agent the person cannot run. First step: answer OPEN-QUESTIONS 3.27 (how the tool starts the session as the person).
- [ ] 31.2 The builder instructions in the catalog entry say when to test and how to report the result, with the behaviors and optimization session. Spec: builder-backend. Check: one bench scenario reaches a test run.
- [ ] 31.3 Ship record and merge into the program base. Check: `__ag__builder` starts a test run on the QA stack.

## 32. Depends on the builder agent work · Read a session and read traces

Owner: the builder architecture session. Starts now on the builder stack branches; merges after 9.6. [parallel: builder-agent-work]

- [ ] 32.1 A builder tool that reads one session with the rights of the person (PROPOSED name `read_session`): its turns and its revision; it refuses a session the person may not read. Spec: builder-backend ("Builder tools read a session and traces"). Check: API tests for a read and a refusal.
- [ ] 32.2 A builder tool that reads traces with filters (PROPOSED name `read_traces`), behind its own permission (OPEN-QUESTIONS 3.27). Spec: builder-backend. Check: API tests for a read, a filter and a refusal.
- [ ] 32.3 The builder instructions use the page context parts `session`, `sessions` and `analytics` to choose what to read. Spec: page-context, builder-backend. Check: one bench scenario reads the session that the page context names.

## 33. Depends on the builder agent work · User steps

Owner: the builder architecture session. Starts now on the builder stack branches; merges after 9.6. [parallel: builder-agent-work]

- [ ] 33.1 Add `request_connection` and `request_secret` (static client tools on `main`, `api/oss/src/core/workflows/static_catalog.py:127, 201`) to `BUILDER_AGENT_TOOLS`. The builder never sees a secret value; it gets only the name. The builder continues after the step, and after "Not now". Spec: builder-backend ("Builder asks for steps only the person can do"), change-cards. Check: catalog unit tests; a builder run calls both tools and continues after each answer.
- [ ] 33.2 The builder instructions say when to ask for a connection or a secret instead of failing. Spec: builder-backend. Check: one bench scenario asks for a connection.

## 34. Depends on the builder agent work · Changes that apply at once

Owner: the builder architecture session. Starts now on the builder stack branches; merges after 9.6. [parallel: builder-agent-work]

- [ ] 34.1 Attach a secret to the agent through the agent configuration (versioned, one operation of `edit_agent_config` or a PROPOSED tool `attach_secret`). Spec: builder-backend ("Builder tools for changes that apply at once"), change-cards. Check: API test that an approved attach saves a version with the secret reference and no value.
- [ ] 34.2 Connect a channel (PROPOSED `connect_channel`), `effect: "immediate"`, with an approval. Spec: builder-backend, change-cards. Check: API test with an approval and with a denial.
- [ ] 34.3 Create an automation (PROPOSED `create_automation`), `effect: "immediate"`, with an approval and the next run time on the card. Spec: builder-backend, change-cards. Check: API test that an approved call creates the automation and a denied call creates nothing.
- [ ] 34.4 Change who can see the agent (PROPOSED `set_agent_access`), `effect: "immediate"`, with an approval; only the owner may approve. Spec: builder-backend, change-cards. Check: API tests for the owner and for a member.

## 35. Depends on the builder agent work · Risk data on the server preview

Owner: the builder architecture session. Starts now on the branch of task 9.4; merges after 9.4. [parallel: builder-agent-work]

- [ ] 35.1 The preview carries a `cost` risk when a model change raises the price per token, with the ratio from the API price map (`api/oss/src/core/tracing/utils/pricing.py:146`, `resolve_pricing_model`). First step: OPEN-QUESTIONS 3.28 (price coverage of harness model ids). Spec: builder-backend ("Risk data on the server preview"), change-cards. Check: API test with a model change from Sonnet to Opus.
- [ ] 35.2 The preview carries a `breakage` risk when a removed integration or MCP server is named in the text of an attached skill (a scan of the skill files on the server). Spec: builder-backend, change-cards. Check: API test with two skills that mention Gmail.
- [ ] 35.3 The preview of a new MCP server carries its tool count, read with a short timeout; when the read fails, the card shows no "Tools" line. Spec: builder-backend, change-cards. Check: API tests with a reachable and an unreachable server.

## 39. MCP sign-in account name

Owner: the MCP account name session (backend, task 39.1, its own PR, starts now and does not wait for the first slice); the MCP and subagents session (frontend, task 39.2, after 17.4 merged). DECIDED by Mahmoud. [parallel: alongside]

- [ ] 39.1 For project servers connected by address (`custom`): at a person's OAuth sign-in, read the account name from the token response when it carries one, else from the server's user info endpoint when its metadata names one; store it with the person's grant; return it as a new optional field of `MCPUserSignIn` next to `is_ready` (`api/oss/src/apis/fastapi/gateways/mcps/models.py:37-41`, PROPOSED name `account_name`). A token sign-in stores no name. A failed or slow read stores nothing and does not fail the sign-in. First step: OPEN-QUESTIONS 3.26. Spec: mcp-subagents ("Account name of an own sign-in"). Files: `api/oss/src/core/gateways/mcps/oauth/`, `api/oss/src/apis/fastapi/gateways/mcps/`, the generated client. Check: API tests with a name in the token response, with a user info read, with no name, with a failed read, with a token sign-in; the field reaches only its owner; `ruff format` and `ruff check`.
- [ ] 39.2 "Your sign-in" shows "Your sign-in: {{name}}" with "Sign out", or "Signed in" when the server gave no name. Spec: mcp-subagents. Files: `ET/agentTemplate/accounts/McpAccountBlock.tsx`, `P/agenta-entity-ui/src/accounts/McpSignIn.tsx`, the Settings "Yours" table. Check: story captures with and without a name.

## 40. Builder page · Builder tabs

Owner: the builder page session. Waits for the first slice: needs section 27 merged. [parallel: builder-page]

- [ ] 40.1 Builder tabs: one tab per agent, automation, tool or app that the chat touched; chips in the chat open their tab; "+" ("Open an item"); the pane mounts only the active tab; the active tab in `?tab=<kind>:<id>` with replace. First step: OPEN-QUESTIONS 3.24 (the view of a tool tab and an app tab). Spec: builder-page ("Builder tabs open what the chat touched", "Content of a builder tab"). Files: `M/features/builder-page/`. Check: unit tests for each kind; browser capture of B03.
- [ ] 40.2 Tabs fit in one row ("2 more" with its tooltip); the tabs and the active tab are stored per chat in this browser (PROPOSED key `agenta:builder:tabs:${sessionId}`); at most 50 tabs, the oldest tab that is not active goes first; a closed tab does not reopen by itself in that chat ("Close {{name}}"). Spec: builder-page ("Builder tabs fit in one row", "Builder tabs are kept per chat and in the address", "Close a builder tab"). Check: unit tests for the cap, the closed-tab memory, a reload and another chat.
- [ ] 40.3 A result that saves a version of an agent with no open tab opens its tab with a dot, unless the person closed it in that chat. Spec: builder-page ("Tabs follow the saved version"). Check: unit test with two agents in one chat.

## 41. Builder page · Follow the builder

Owner: the builder page session. Waits for the first slice. Needs: section 40 merged. [parallel: builder-page]

- [ ] 41.1 When the builder changes the agent of the active tab, the tab moves to Agent; when it starts a test of that agent, to Sessions; a click in the pane in the last 10 seconds keeps the view and marks the other tab with a dot (change) or a spinner (test). Spec: builder-page ("Follow the builder with the 10 second rule"). Check: unit tests with a fake clock at 9 and 11 seconds.
- [ ] 41.2 "Changed by the builder" on each changed row, from the first segment of each operation target; it stays until the person opens that row or closes the tab (PROPOSED). Spec: builder-page ("Changed rows are marked"). Check: unit tests; browser capture of B03.
- [ ] 41.3 The builder chat writes chips for the things it touched (how: the question in the builder-page notes, answered by the builder architecture session before 40.1). Spec: builder-page. Check: render test of the chips of B03.

## 42. Builder page · Test tab

Owner: the builder page session. Waits for the first slice. Needs: section 41 merged; section 31 merged (the test run tool). [parallel: builder-page]

- [ ] 42.1 While the builder tests an agent, its Sessions tab shows the test session read only with "The builder is testing Email writer.", the state "Writing" and no composer; "Reply" opens the message box of that session. Spec: builder-page ("Test tab with a read-only session"). Check: browser capture of B04; unit test that "Reply" opens the composer.
- [ ] 42.2 When the test ends, the line and the state go away, and the session stays in Sessions with the spark. Spec: builder-page. Check: browser cell on the QA stack with a real test run.

## 43. Builder spark

Owner: the spark session. Waits for the first slice. Needs: sections 30 and 31 merged (the builder agent work); sections 12 and 23 merged (files under a lock in `STATUS.md`). [parallel: builder-page]

- [ ] 43.1 The spark after the name of a session the builder started, with the tooltip "Started by the builder", in the main and agent sidebars, the session menu and the Sessions page; no spark for a session with no origin; a running session keeps its spinner. Spec: session-screen ("Spark on sessions the builder started"), agent-sidebar-pages ("Builder spark in the agent sidebar and the agent pages"). Files: `M/features/nav/`, `M/features/agent-sidebar/`, `P/agenta-sessions-ui/src/`. Check: story captures; unit tests per origin.
- [ ] 43.2 The session menu of a builder-started session links to the builder chat; a reader with no access to that chat sees the no-access state. Spec: session-screen ("Session origin comes from the server"). Check: unit test; browser cell.

## 44. Page context parts and the chip after a reload

Owner: the builder panel session. Waits for the first slice. Needs: section 24 merged; section 32 merged (the builder agent work: read tools). [parallel: builder-panel]

- [ ] 44.1 The page context parts `session` (session id, name, revision), `sessions` and `analytics` (the active filters; the `filters` shape decided here) join the union; the chip labels "{{agent}} · {{session name}}" and the labels of the Sessions page and Analytics (to write). Spec: page-context ("Session part", "Sessions and Analytics parts", "The chip shows what is sent"). Files: `M/features/builder/`, the page context atom. Check: unit tests of the payload on each page.
- [ ] 44.2 A sent message keeps its chip after a reload, rebuilt in the browser from the context line in the stored message (the history rebuild restores `display_content`, `P/agenta-chat/src/assets/transcriptToMessages.ts:460-461, 898`); a message with no stored context shows no chip and no error. Spec: page-context ("A sent message keeps its chip"), builder-panel. Files: `M/features/chat/TurnRow.tsx`. Check: unit test with a stored and a missing field; browser cell with a reload.
- [ ] 44.3 QA flow: on a session page, ask the builder why a turn went wrong; the builder reads that session. Check: B cell with an MP4.

## 45. Change cards · User steps

Owner: the change card states session. Waits for the first slice. Needs: section 26 merged; section 33 merged. [parallel: cards]

- [ ] 45.1 The card for a `request_connection` call ("Connect Stripe", "Needs you", "It will be able to", "The builder continues after you connect", "Not now", "Connect Stripe") with the connected and "Not now" results; it reuses the connect flow of `ConnectRequestWidget` (`P/agenta-entity-ui/src/clientTools/registry.tsx:57-69`). Spec: change-cards ("Steps only the user can do happen in the card"). Files: `P/agenta-chat/src/components/`, `approvalDescribers/`. Check: story captures; unit tests of both results.
- [ ] 45.2 The card for a `request_secret` call ("Environment variable", "Value", "Paste the secret", "Stored in the project vault", "Save & attach"): the value goes from the browser to the project vault and never to the builder. Spec: change-cards. Check: unit test that the tool answer holds only the name; story capture.

## 46. Change cards · All groups and the cards that apply at once

Owner: the change card states session. Waits for the first slice. Needs: section 45 merged; section 34 merged. [parallel: cards]

- [ ] 46.1 The grouped card with the groups "Saved together as vN", "Needs you first" and "Applies at once, not part of a version"; an empty group is hidden; "Approve all" is disabled while a "Needs you first" step is open (PROPOSED), with a line that names the step (text to write). Spec: change-cards ("Grouped card"). Check: unit tests of the grouping; story capture of the C01 grouped card.
- [ ] 46.2 The cards for an attached secret, a channel, an automation and access, with the footer "Applies at once. Not part of a version." where the canvas draws it, and their result rows (text to write). Spec: change-cards ("Changes that apply at once"). Check: story captures of each C01 card.
- [ ] 46.3 The app connection rows inside the grouped card ("Stripe", "Not connected", "Connect"). Spec: change-cards. Check: story capture.

## 47. Change cards · Cost and "stops working" warnings

Owner: the change card states session. Waits for the first slice. Needs: section 46 merged; section 35 merged. [parallel: cards]

- [ ] 47.1 Warning lines for the risk kinds `cost` and `breakage` from the server preview ("Each session will cost more. The larger model is about 5 times the price.", "2 skills mention Gmail. They will stop working."). Spec: change-cards ("Warning lines only for risk"). Check: describer unit tests; story captures.
- [ ] 47.2 The "Tools" line of a new MCP server ("12 tools, asks before each use") from the preview; no line when the preview has no count. Spec: change-cards ("Four forms of detail"). Check: describer unit tests.

## 48. Hero animation

Owner: the hero session. The component (48.1) starts now; its mount waits for section 27 merged. The variant (48.2) waits for Mahmoud's pick (OPEN-QUESTIONS 1.1); until then the hero shows the current ring. [parallel: hero]

- [ ] 48.1 A hero component around the current ring with one state input (`idle`, `typing`, `thinking`, `done`), one still frame with `prefers-reduced-motion`, a pause when the browser tab is hidden or the hero is off screen, mounted in the B01 new chat with `next/dynamic` and fed the page state (typing in the composer, a run in flight, a run done) once section 27 merged. No new dependency. Spec: builder-page ("Hero animation"). Files: a new folder in `M/features/builder-page/` (PROPOSED). Check: unit tests of the state input and the reduced-motion frame; story captures of the four states in light and dark.
- [ ] 48.2 When Mahmoud picks the variant: port its engine and variant from the design gallery into the component, with the still "Three dots" fallback when WebGL is missing (the design session recommends "Soft shape"). Check: `speed:check` flat; story captures of the four states; browser capture of B01.

## 49. Phone · Session, sidebar and Files

Owner: Foundation A. Waits for the first slice: needs 8.4 passed and section 12 merged. [parallel: phone]

- [ ] 49.1 Phone shared contract (SC9): the phone chrome of the view stack, the sidebar sheet (300 px, 44 px rows), the bottom-sheet menu with "Cancel", the full-width primary action at the bottom, and a `readOnly` input that a phone container passes to a view. Spec: phone-layout ("Phone shared contract"). Files: `P/agenta-ui/src/view-stack/`, `M/features/agent-layout/`. Check: unit tests; story captures at 390 x 844.
- [ ] 49.2 Session header in two rows and the session bottom sheet (M01), and the agent menu as a bottom sheet (PROPOSED). Spec: phone-layout ("Session header has two rows on a phone", "Session bottom sheet"). Check: browser capture of M01; touch targets 44 px or more.
- [ ] 49.3 Sidebar sheet with the agent sidebar inside (M02). Spec: phone-layout ("Sidebar sheet"). Files: `M/features/nav/`, `M/features/agent-sidebar/` (under a lock). Check: browser capture of M02.
- [ ] 49.4 Files full screen and read only (M03). Spec: phone-layout ("Files are read only on a phone"). Check: browser capture of M03.

## 50. Phone · Builder

Owner: the builder panel session. Waits for the first slice. Needs: sections 24 and 26 merged; 49.1 merged. [parallel: phone]

- [ ] 50.1 Builder full screen with new chat and quick actions (M04), no "Open in the builder". Spec: phone-layout ("Builder full screen on a phone"). Check: browser capture of M04.
- [ ] 50.2 Change card full width with 44 px "Deny" and "Approve", "View full diff" full screen (M05). Spec: phone-layout ("Change card on a phone"). Check: browser capture of M05.
- [ ] 50.3 Chat history in the full-screen builder (M06). Spec: phone-layout ("Chat history on a phone"). Check: browser capture of M06.

## 51. Phone · Configuration and agent pages

Owner: the agent pages session. Waits for the first slice. Needs: sections 22 and 23 merged; 49.1 merged. [parallel: phone]

- [ ] 51.1 Configuration page with three tabs, rows with the current value and "Saved as v4" at the end of the tab row (M07), and Version history (read and revert). Spec: phone-layout ("Configuration page on a phone", "Version history on a phone"). Check: browser capture of M07.
- [ ] 51.2 Channels page and its connect steps full screen (M13); Channels only in the sidebar. Spec: phone-layout ("Channels page on a phone"). Check: browser capture of M13.
- [ ] 51.3 Read-only views: Instructions, the skill view and its files, Advanced, Add MCP server, Add subagent (files of other flows under a lock in `STATUS.md`). Spec: phone-layout ("Read-only views on a phone"). Check: story captures at 390 x 844 with no edit control.
- [ ] 51.4 Access, the Sessions list and Analytics (read only, one column). Spec: phone-layout ("Access, Sessions and Analytics on a phone"). Check: browser captures.

## 52. Phone · Integrations

Owner: the integrations session. Waits for the first slice. Needs: section 16 merged; 51.1 merged. [parallel: phone]

- [ ] 52.1 Integrations list with the full-width "Add integration" (M08) and the integration view with the account switch in one column (M09). Spec: phone-layout ("Integrations list on a phone", "Integration account switch on a phone"). Check: browser captures of M08 and M09.

## 53. Phone · Automations

Owner: the automations session. Waits for the first slice. Needs: section 21 merged; 51.1 merged. [parallel: phone]

- [ ] 53.1 Automations tab with the groups and the full-width "Add automation" (M10), and the "Add automation" bottom sheet with "Cancel" (M11). Spec: phone-layout ("Automations tab on a phone", "\"Add automation\" bottom sheet"). Check: browser captures of M10 and M11.
- [ ] 53.2 Run history in one column. Spec: phone-layout ("Run history on a phone"). Check: browser capture.

## 54. Phone · Model providers

Owner: the provider keys session. Waits for the first slice. Needs: sections 14 and 15 merged; 49.1 merged. [parallel: phone]

- [ ] 54.1 Model providers list with the full-width "Add a provider or subscription" (M12), and the provider form full screen. Spec: phone-layout ("Model providers on a phone"). Check: browser capture of M12; touch targets.

## 55. Closing · Speed project

Needs: sections 13 to 54 merged. Measure first, then fix.

- [ ] 55.1 Session switch timing spec (`web/tests/visual/switch.spec.ts`), ported from the method in the speed-budgets notes: click a sidebar session row, record click to URL and click to done in the target conversation only, long tasks, and every API request with method and payload, warm and cold cases. It runs only on demand against a production build, never in CI. Spec: speed-budgets. Check: one run writes a JSON file with the three cases.
- [ ] 55.2 Measure in a production build; establish the run-to-run variability; fix the largest cost first. Spec: speed-budgets. Check: the measurement report with medians and spread; the budgets of the speed-budgets spec (PROPOSED numbers) are met or each miss has a cause.
- [ ] 55.3 Candidates, each only when the measurement supports it: keep more than one conversation mounted, prefetch on hover, read the last page of history, remove duplicate requests on a cold switch. Spec: speed-budgets (notes, "Candidates"). Check: each change comes with a before and after measurement.

## 56. Release

Needs: the full scope passed QA (desktop and phone); the release path is decided: one program branch, released once.

- [ ] 56.1 Delete the old drawers and drawer hosts that no container uses (for example `SessionWorkspaceDrawers`, `SessionAutomationDrawers`, `SectionDrawer`, `InstructionsDrawer`, `ConfigItemDrawer`, `AgentIntegrationDrawer`) and the i18n keys no file reads. The old desktop app `web/oss` imports `SkillDetailDrawer`, `SkillCreateDrawer`, `TriggerDeliveriesDrawer` and the session row; it is abandoned but must still compile, so keep the shells it imports or remove those imports from `web/oss`. Spec: all. Check: types (including `web/oss`), lint and unit tests pass; the deletion list in the review plan is done.
- [ ] 56.2 Docs and changelog. Spec: all. Check: the docs pages that describe the agent screens match the new screens; the release notes describe the new panel, the builder and the redrawn flows.
- [ ] 56.3 Run the integration checks again on the real release merge (the program branch merged into the release branch), reusing the earlier evidence for what did not change. Spec: all. Check: the QA plan section 7 release row passes on the merge commit.
