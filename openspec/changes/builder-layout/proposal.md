## Why

The agent screens of the main app (`web/mobile`, served at `/m`) grew one drawer at a time. Today a session screen shows the configuration in a pane on the left (`web/mobile/src/features/chat/SessionWorkspace.tsx:417`), Files in a second pane on the right (`SessionWorkspace.tsx:445`), and every configuration flow in its own drawer with its own width and its own host (`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentTemplateControl.tsx:1381-1677`, `web/mobile/src/features/chat/SessionWorkspaceDrawers.tsx:33-55`). Eleven screens exist twice with different code. Every edit to an agent saves a new version 1500 ms after the last key press (`web/packages/agenta-playground/src/state/execution/agentAutoCommit.ts:27`); this auto-save stays.

The product builder (the platform agent `__ag__builder`) now exists as an open PR stack, but nothing in `/m` opens it. When the builder saves a new version of an agent, an open session of that agent learns of it only on the next visibility change or session switch (`web/packages/agenta-playground/src/state/execution/latestVersionCheck.ts:13-16`), because the server publishes the `workflow-changed` event only when the agent itself is renamed or moved (`api/oss/src/core/workflows/service.py:2265-2277`).

The final design (approved on 19 November 2026) puts Files, Configuration and the builder into one right panel, opens every configuration flow as a view inside that panel, adds the builder chat in the panel and on its own page with builder tabs, and redraws the phone screens. The whole approved design is the release scope. One point differs from the canvas: the agent configuration keeps today's auto-save, so the header shows the save status and the version, not a "Save as vN" button. This program changes only the frontend. The builder PR stack and the builder tools are the builder agent work, a dependency owned by the builder architecture session.

## What Changes

- One right panel on the session screen. It holds one content at a time: Files, Configuration or the builder chat. Configuration in the panel has four tabs: Agent, Automations, Channels and Access, as the approved canvas draws them. The left configuration pane, the session tab row and the configuration drawers go away. The program branch replaces the layout in place; there is no switch between the old and the new layout.
- A view stack: every configuration flow becomes a view that does not know where it is shown. A container (the panel, the Configuration page, a Settings page, a drawer shell, a dialog) shows a root, and the root opens views on top of it. A view can open one child view. One editable form is open at a time.
- `AgentTemplateControl.tsx`, `agentTemplate/useModelHarness.tsx` and `agentTemplate/itemKinds.tsx` are split into one file per configuration section, one file per item kind and one file per view. The split is its own PR and merges first. Then one working slice (the view stack and panel, Instructions, a model pick, one nested integration flow, two conversations on one screen, and one builder edit whose save reaches an open session) settles the contracts before the frontend flows that mount views in the panel are built in parallel. The QA harness, the sidebars, the bench, the choice form and the hero engine start on day one from their specs; the builder agent work runs alongside.
- The agent configuration keeps today's auto-save: a change is saved as a new version shortly after the edit. The header shows the save status and the version ("Saved as v4"). A view with Cancel and Save applies its form on Save, and auto-save then saves the version. The unsaved-changes dialog asks only for an open form with edits.
- An open session moves to a newer saved version when it follows its agent and nothing is unsaved or running (an open form with edits counts); otherwise it offers the update. The browser runs the existing latest-version check when a builder tool result says that a version was saved, and when the window gets focus or becomes visible. No server event changes.
- The builder chat in the panel: the last chat about this agent (2-day rule, from a link between agents and builder chats kept in browser storage), new chat with quick actions, chat history, and the page context (the agent, and the part of the page: Configuration, a session, the Sessions page or Analytics). Each message carries it as one context line in the text the builder reads, with `display_content` set to the person's own text, through the path that the SDK and the runner already keep; a sent message keeps its chip after a reload.
- Change cards for every card of the approved design: one card per tool call, with old and new values from the server preview (DECIDED, provided by the builder agent work), "Saves as vN" and one result per call; user-step cards (connect an app, paste a secret); the grouped card with the groups "Saved together", "Needs you first" and "Applies at once"; the cards for secrets, channels, automations, access and app connections; the cost and "stops working" warnings. "Approve" saves the version. The same card shows tool approvals in an agent's own chat.
- The agent sidebar and pages: Configuration page (tabs Agent, Automations, Access), Sessions and Analytics locked to one agent (the lock does not write the shared filters of the unlocked pages), Channels page. A session that the builder started shows the builder spark.
- The builder page as drawn: new chat with the hero animation, Browse ideas, and a pane with builder tabs (one per agent, automation, tool or app the chat touched; "+"; "2 more"; kept per chat; closed tabs not reopened; at most 50), the follow rule with the 10 second wait, "Changed by the builder", and the test tab with a read-only session and "Reply".
- Every configuration flow is redrawn (model picker, model providers, integrations and accounts, subagents, MCP servers, skills, secrets, permissions, Advanced, automations, run history). Each flow changes in every place that mounts it. "Run now" stays exactly as today (DECIDED). An own MCP sign-in shows the account name, "Your sign-in: {{name}}" (DECIDED, one backend task).
- Backend: two tasks Mahmoud asked for and nothing else: personal accounts on by default (a configuration default) and the MCP account name read at sign-in. Built-in models on and off per project comes later as its own backend change; the "Agenta" card lists its models with no switches. The builder agent work (a dependency, owned by the builder architecture session) provides the builder PR stack on the program branch, the result shape `revision: {id, version}`, the server preview on the approval payload with its risk data, `request_input`, `request_connection` and `request_secret` in the builder tool list, the session origin `builder` with the tag `ag.builder.session_id`, and new tools that run another agent, read a session, read traces, attach a secret, connect a channel, create an automation and change access.
- Packages: the program builds on the existing `@agenta/*` package architecture. Data access stays in `@agenta/entities`; views live in the existing domain UI packages; only the generic view host goes to `@agenta/ui`; the DrillIn schema controls are split, not rewritten.
- Phone: the 13 redrawn phone screens (M01 to M13) and the phone screens the phone scope names, each paired with its desktop flow. Panel contents and views open full screen with a back arrow.
- The 220 ms wait before a session row opens is removed (`web/packages/agenta-sessions-ui/src/SessionRowActions.tsx:196-219`; it is the largest cost of a warm session switch in our measurements). The old desktop app `web/oss` mounts the same row, so the change reaches it too; `web/oss` is abandoned and must still compile.
- Speed: the speed project measures session switching first, then fixes the largest costs.

## Capabilities

### New Capabilities

- `agent-panel`: the one right panel (Files, Configuration, Builder), its width, overlay and remembered state, the view stack inside it, the one leave guard, and the stable test selectors.
- `session-screen`: the session header, two conversations on one screen, and a session that follows the saved version.
- `configuration-draft`: the Configuration tabs of the panel, the Agent tab sections, the save status and version in the header with today's auto-save, and the unsaved-changes rules of open forms.
- `builder-panel`: the builder chat in the panel, the link to its agent in browser storage, the 2-day rule, quick actions, recent chats and chat history.
- `page-context`: the context chip and the context line that carries the page context (the agent, and the Configuration, session, Sessions and Analytics parts) in the message, with the chip rebuilt from the stored message.
- `change-cards`: the card that shows a proposed change, its detail forms, its states and results, and "Approve".
- `model-providers`: the model picker and the model provider list, add and key forms.
- `integrations-accounts`: integrations, the connect form, permissions and the account choice.
- `mcp-subagents`: subagents and MCP servers.
- `skills`: add a skill, a new skill, and the skill editor.
- `secrets-permissions-advanced`: secrets, the permission policy and the Advanced view.
- `automations-run-history`: the automation list, create and edit, and the run history.
- `agent-sidebar-pages`: the main and agent sidebars, the Configuration page, Sessions, Analytics and Channels pages.
- `builder-page`: the builder page, Browse ideas, the builder tabs, the follow rule, the test tab and the hero animation.
- `builder-backend`: what the frontend reads from the builder agent work (a dependency): the builder stack, the agent tool results and the approval preview with its risk data, the choice form, the session origin `builder`, and the builder tools that run another agent, read sessions and traces, ask for user steps and make changes that apply at once.
- `phone-layout`: the 13 redrawn phone screens (M01 to M13), the phone screens the phone scope names, and the shared phone contract.
- `speed-budgets`: bundle size, session switch timing and the rules that keep them flat.

### Modified Capabilities

None. No OpenSpec capability for these screens exists in the repo today.

## Impact

**Frontend packages** (under `web/packages/`):
- `agenta-ui`: the new view stack primitive (types, host, the generic unsaved-changes dialog).
- `agenta-entity-ui`: the split of `AgentTemplateControl.tsx` into section and view files; the MCP, integration, secret, provider, account and skill form views.
- `agenta-playground`: no change to auto-save (`agentAutoCommit.ts`) or to the request builder; the latest-version check also runs on a committed builder tool result and on window focus.
- `agenta-playground-ui`: `AgentRevisionStatus` (today's save status, "Saved as vN", "Update to vN"), `AgentBuildPanel`.
- `agenta-chat`: the change card data (`changes` on the approval preview) and skin, the page context on send, the context chip.
- `agenta-entities`: the session origin `builder` in the session type.
- `agenta-sessions`, `agenta-sessions-ui`: the session row click and the builder spark.
- `agenta-settings-ui`, `agenta-skills-ui`, `agenta-automation-ui`: the Settings and page containers that mount the shared views.
- `agenta-i18n`: new keys in all 7 languages after Mahmoud confirms the new text.

**App** (`web/mobile/src/features/`): `chat` (session screen), new `agent-layout` (panel host), new `agent-pages` (Configuration, Channels, locked Sessions and Analytics), new `agent-sidebar`, new `builder` and `builder-page` feature folders, `nav` (sidebars), `settings`, `onboarding`, `automations`, `skills`. The classic app `web/oss` is abandoned. It keeps auto-save, it gets the session row without the 220 ms hold, and it must still compile.

**API areas:** this program changes no backend logic except two tasks: the default of `AGENTA_ACCESS_PERSONAL_ACCOUNTS_ENABLED` becomes true (`api/oss/src/utils/env.py:216-217`, a configuration default) and the MCP account name is read at sign-in and returned with `user_sign_in` (`api/oss/src/core/gateways/mcps/`, `api/oss/src/apis/fastapi/gateways/mcps/`). The page context uses the existing `display_content` path: the SDK keeps it (`sdks/python/agenta/sdk/agents/adapters/vercel/messages.py:67-72`) and the runner persists it with the user message (`services/runner/src/server.ts:1134-1142`). One backend item waits for Mahmoud's approval: built-in models on and off per project (a project vault row of a new kind with a read and a write route, PROPOSED).

**Builder agent work (dependency, owned by the builder architecture session):** `revision: {id, version}` in the results of `edit_agent_config` and `create_agent` (PR 7409), the server preview from the change-set engine on the approval payload with its risk data (price ratio, skill text scan, MCP tool count), `request_input`, `request_connection` and `request_secret` in the builder tool list (PR 8345), the session origin `builder` with the tag `ag.builder.session_id`, the new tools of tasks 31 to 34, and the optimized instructions. The program's frontend milestones that need a part wait for it.

**Builder PR stack:** PRs 8341, 7409, 8345 and 8346 must be rebased onto the program base before the first builder edit of the first slice can work. The new builder tools of the builder agent work build on these branches from day one. Their bases are stale today (8341 targets a release branch that shipped; 8346 targets a branch that merged).

**Tests:** Vitest unit tests per touched package and for `web/mobile`. There is no Playwright suite for `/m`. A QA harness milestone adds story and fixture folders and two Playwright capture specs in `web/tests/visual/` (existing dependency, never in CI); the speed project adds the session switch timing spec. Foundation A adds stable `data-testid` selectors on the panel, the current view and the session header. QA runs on the merged program base: executable state-transition tests, design comparison on representative states (desktop and phone at 390 x 844), a regression pass over every shared screen, and speed.

**Bundle budget:** `speed:check` must stay inside `web/mobile/scripts/speed/budget.json`. The session route `/w/[workspace_id]/p/[project_id]/agents/[agent_id]` has a budget of 1,869,151 gzip bytes. Panel contents and views load with `next/dynamic`, so they do not count in the first load. Only Mahmoud can raise a budget.

**i18n:** every new string goes to a namespace of its owning package or feature (for example `ui.viewStack`, `chat.changeCard`, `builder.panel`) in all 7 languages. New text that Mahmoud has not confirmed is listed for him first. No user-facing text is invented.
