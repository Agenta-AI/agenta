# automations-run-history: notes for implementers

These notes belong to `spec.md` in this folder. They hold the words the requirements use, today's behavior on `origin/main` with `path:line`, the other places that mount the changed components, backend work, states that are described but not drawn, and the text. They are not part of the requirements.

## Words used in this file

- **View**, **container**, **root**, **unsaved edits**, **dirty**: as defined in the `agent-panel` capability. A view of one automation is the "automation view".
- **Test run**: a delivery that captured a test event and did not run the agent (`is_test`; label at `AU/runModel.ts:142`). The word keeps this meaning. A run that "Run now" starts is a normal session started in the browser; it is not a delivery and does not show in the run history (DECIDED).
- **Automation**: a saved rule that runs an agent by itself. Its start condition is a **trigger**: a "Scheduled trigger" (a time rule, stored as a trigger schedule) or an "App trigger" (an event from a connected app, stored as a trigger subscription).
- **Run**: one time an automation ran. The server stores it as a **delivery** (a row of `trigger_deliveries`). A delivery that invoked the agent carries the id of the session it produced (`data.session_id`).
- **Run history**: the list of runs of one automation, newest first.
- **Full run history page**: the Automations page view of one automation's runs, at `/w/{workspace}/p/{project}/automations/{automation_id}?view=runs`. It keeps the filters.
- **Session view, read only**: the normal conversation view of a session with no composer.
- **Status dot**: the small colored dot on a row. Green: succeeded or active. Red: failed. Orange: running. Gray: skipped, or paused.

Text marks: text in quotes comes from the canvas or from production. Text marked "(not confirmed)" is in HANDOFF section 5 and needs Mahmoud's approval.

## Today's behavior on origin/main (5d783fec)

Paths start at the repo root. `SC/` means `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/`. `AU/` means `web/packages/agenta-automation-ui/src/`. `MA/` means `web/mobile/src/features/automations/`.

- The agent config region "Automations" has a "+" with "Create with AI" (puts "I want an automation that" in the agent's own chat composer) and "Create manually" ("Run on a schedule or an event"), which opens a schedule-shaped draft (`SC/AgentOperationsSections.tsx:137-166`). The kind is switched inside the form by chips under "Runs when" (`AU/AutomationRunsWhenField.tsx:18-31`). The three-entry menu with "App trigger", "Scheduled trigger" and "Create with AI" exists as `AddTriggerDropdown`, where "Create with AI" is disabled with "Coming soon" (`SC/triggerManagement/AddTriggerDropdown.tsx:43-82`). Only a Storybook story mounts it (`web/storybook/stories/entity-ui/AddTriggerDropdown.stories.tsx:49`).
- The list today shows app triggers grouped by app, then schedules, with no group headings (`SC/TriggerManagementSection.tsx:338-366`). The empty text is "No automations yet" (`:375`).
- Row menus in the agent config today: an app trigger has Run history, Edit, Refresh, Revoke and Delete, and no Run now (`SC/TriggerManagementSection.tsx:153-230`). A schedule has Run now, Run history, Edit, Deactivate or Activate, and Delete (`:256-324`). Delete acts at once with no question (`:215`, `:313`). On the Automations page, Delete already asks with "Delete this automation?" (`MA/AutomationActionsMenu.tsx:96-108`).
- Edits open the 640 px `AutomationDrawer` (`AU/AutomationDrawer.tsx:132`). Run history opens the 960 px `AutomationRunHistoryDrawer` (`AU/AutomationRunHistoryDrawer.tsx:83`) through `automationRunHistoryDrawerAtom` (`web/mobile/src/features/chat/ConfigPane.tsx:53-61`).
- The automation screen today (`AU/AutomationDetailBody.tsx`) has a failure banner (`:115`), the fields, and a run history card (`:140`). The Automations page puts "Run now" beside it (`MA/AutomationDetailScreen.tsx:179`). The panel view has no "Run now" and no "Delete" today.
- **The "Run now" path today** is client side. `runNowText` builds the message from the stored instruction; for an app trigger it reads the deliveries and fills the fields from the newest recorded event (`MA/runNowText.ts:19-42`). `AutomationTestRunButton` then starts a normal new session with that text and navigates to it (`MA/AutomationTestRunButton.tsx:64-72`; `web/mobile/src/features/chat/useStartTaskSession.ts:35`). The row menu does the same (`MA/AutomationActionsMenu.tsx:79-93`). In the session config, a schedule's Run now writes `simulatedAgentRunAtomFamily` (`SC/TriggerManagementSection.tsx:127-146`) and `useTriggerTestRun` starts the new session (`web/mobile/src/features/chat/useTriggerTestRun.ts:17-41`). None of these paths writes a delivery, so the run does not show in the run history. The blocked reasons are in `MA/AutomationTestRunButton.tsx:94-108`.
- **A run has a session URL.** The dispatcher mints the session id before it runs (`api/oss/src/tasks/asyncio/triggers/dispatcher.py:328`) and stores it on the delivery (`api/oss/src/core/triggers/dtos.py:386`). The UI reads it with `runSessionId`, which returns nothing for test captures and for refused runs (`AU/runModel.ts:232-236`). The session route is `/w/{workspace}/p/{project}/sessions/{session_id}` (`web/mobile/src/pages/w/[workspace_id]/p/[project_id]/sessions/[session_id].tsx`, helper `sessionRoutePath` in `web/packages/agenta-sessions/src/link/sessionDeepLink.ts:15`).
- **The deliveries query.** `POST /triggers/deliveries/query` takes a filter (status, subscription_id, schedule_id, event_id) and optional `windowing` (`api/oss/src/apis/fastapi/triggers/models.py:175-178`; handler `api/oss/src/apis/fastapi/triggers/router.py:1603-1622`). The DAO orders by `created_at` descending and pages only when windowing is given (`api/oss/src/dbs/postgres/triggers/dao.py:777-784`). Windowing pages by `next` (the last id) and `limit` (`sdks/python/agenta/sdk/models/shared.py:203-213`). The response has no next cursor; the client takes the last id.
- **The frontend store loads one request only.** The run history view reads `triggerDeliveriesAtomFamily`, which sends no windowing (`web/packages/agenta-entities/src/gatewayTrigger/hooks/useTriggerDeliveries.ts:32`). The server then returns every delivery of the automation in one response. The paginated store used by `TriggerDeliveriesDrawer` also sends no cursor and always reports `hasMore: false` (`web/packages/agenta-entities/src/gatewayTrigger/state/deliveriesPaginatedStore.ts:64-74`). The list rows read a capped query of 101 (`useTriggerDeliveries.ts:41-61`).
- The split of list and run is decided by a window media query `(min-width: 700px)` (`AU/AutomationRunHistoryView.tsx:70`), not by the view width. In a 440 px panel on a wide window it would show the split. The design needs a width check on the view.
- The panel's filter menu today sits in the run history header (`AU/AutomationRunHistoryView.tsx:123`).
- Delete is a soft delete (`deleted_at`) for both kinds (`api/oss/src/dbs/postgres/triggers/dao.py:256-283`, `:1030-1056`). Delivery rows cascade only on a hard purge (`api/oss/src/dbs/postgres/triggers/dbes.py:94-102`), and the only purge refuses real automations (`api/oss/src/core/triggers/service.py:1362-1366`). So past runs stay stored. Not verified: whether the full run history page still opens for a deleted automation.

## Every place that mounts the changed components (re-verified)

- `TriggerManagementSection`: `SC/AgentOperationsSections.tsx:171`, mounted by `AgentBuildPanel` (`web/packages/agenta-playground-ui/src/components/AgentBuildPanel.tsx:110`) in the session config pane, and by the classic app (`web/oss/src/components/Playground/Components/PlaygroundVariantConfig/index.tsx:364`).
- `AutomationRunHistoryView`: `MA/AutomationDetailScreen.tsx:138` and `AU/AutomationRunHistoryDrawer.tsx` (via `MA/AutomationRunHistoryDrawerHost.tsx:26`, mounted in `web/mobile/src/features/chat/SessionWorkspaceDrawers.tsx:51` and `web/mobile/src/features/sessions/SessionAutomationDrawers.tsx:33`).
- `AutomationDetailBody` and `AutomationCreateBody`: `MA/AutomationDetailScreen.tsx:161`, `MA/AutomationDraftScreen.tsx:61`, `AU/AutomationDrawer.tsx:190, 279`.
- `AutomationDrawer`: `web/mobile/src/features/chat/SessionWorkspaceDrawers.tsx:48`, `web/mobile/src/features/sessions/SessionAutomationDrawers.tsx:32`.
- `TriggerDeliveriesDrawer`: `SC/TriggerManagementSection.tsx:384`, `web/mobile/src/features/sessions/SessionAutomationDrawers.tsx:34`, `web/oss/src/components/pages/sessions/components/SessionAutomationDrawers.tsx:16`.
- `AutomationTestRunButton`: `MA/AutomationDetailScreen.tsx:179`. `runNowText`: `MA/AutomationActionsMenu.tsx:88`, `MA/AutomationTestRunButton.tsx:67`. `useTriggerTestRun`: `web/mobile/src/features/chat/SessionWorkspace.tsx:173`.
- Automations pages: `web/mobile/src/pages/w/[workspace_id]/p/[project_id]/automations/index.tsx`, `[automation_id].tsx`, `new.tsx`.
- Agent overview card `AgentAutomationsCard` (`web/mobile/src/features/agents/AgentAutomationsCard.tsx:18`, at `AgentOverviewBody.tsx:140`) shows automations; it does not mount these views.
- Phone: the Automations tab and the "Add automation" sheet are in the `phone-layout` capability (canvas M10, M11).

## Duplicate implementations to merge

- Run history: `AutomationRunHistoryView` and `TriggerDeliveriesDrawer` (with `deliveriesPaginatedStore`). Keep the view; the drawer and its store go.
- "Run now" client paths: `AutomationTestRunButton` plus `runNowText` (new session in the browser) and the config rows' `simulatedAgentRunAtomFamily` plus `useTriggerTestRun`. Both become one client hook (task 21.4) that checks `testRunBlockedReason` and keeps the browser path (`runNowText` and the browser session start).
- Drawer hosts: `SessionWorkspaceDrawers` and `SessionAutomationDrawers` mount nearly the same drawers. With views in the panel, both lose the automation drawers.
- Add menus: `CreateWithAIAddMenu` (used) and `AddTriggerDropdown` (Storybook only). The new "Add automation" menu replaces both for automations.

## Backend work and scope

- **No backend work.** "Run now" stays exactly as today (DECIDED by Mahmoud): the browser path starts a new session, and the run is not listed in the run history. No server routes. Run history paging and the width split are frontend only.
- **Run history paging (small, frontend only):** send `windowing` with `limit` and `next` from `useTriggerDeliveries` and the run history view; it reads the existing deliveries route (`api/oss/src/apis/fastapi/triggers/router.py:1603-1622`). Keep the 30-day count from a separate capped query.
- **View width split (small, frontend only).**
- **Delete keeps runs:** no backend work.

## Cross-package dependencies

- The views live in two packages: `@agenta/automation-ui` (`AU/`: list rows, forms, automation view, run history view) and `@agenta/entity-ui` (`web/packages/agenta-entity-ui/src/gatewayTrigger/`, and `SC/TriggerManagementSection.tsx` with `SC/triggerManagement/`).
- Three hosts mount them: the Automations pages in `web/mobile` (`MA/`, and the pages under `web/mobile/src/pages/w/[workspace_id]/p/[project_id]/automations/`), the session automation drawers (`SessionWorkspaceDrawers`, `SessionAutomationDrawers`) until the release milestone deletes them, and the playground build panel (`SC/AgentOperationsSections.tsx:171`, through `AgentBuildPanel`).
- The delete dialog ("Delete this automation?", F06 f4) lives in the automations package, not in the view stack package. Today it is in `MA/AutomationActionsMenu.tsx:96-108`.
- The leave guard: today `useUnsavedGuard` (`MA/useUnsavedGuard.ts:25`, used at `MA/AutomationDetailScreen.tsx:81`) stops a route change while the automation form is dirty. In the agent layout it registers with the one leave guard `confirmLeave(reason)` of the agent layout host, as the agent draft and the Files draft guard do. The playground and test set guards also use `useUnsavedGuard` (`web/mobile/src/features/playground/usePlaygroundLeaveGuard.ts:38`, `web/mobile/src/features/testsets/detail/useTestsetLeaveGuard.tsx:38`); they stay as they are.
- Tasks: section 21 of `tasks.md` (21.4 merges the two client paths only if the merge changes no behavior).

## States described and not drawn

- Empty list ("No automations yet"), cron cadence, event filters open, "What the agent gets" open, a running run, the full-page filters (HANDOFF section 2).
- The automation view of an app trigger, the view with no run yet.
- Where the user goes after "Run now": to the new session, as production (`web/mobile/src/features/chat/useStartTaskSession.ts:34-35`).
- "Run now" on a paused automation: the browser path does not check the paused state (`MA/AutomationTestRunButton.tsx:94-108`), so it starts the session.
- "Run now" on an app trigger with no recorded event: `runNowText` renders the instruction with no event values (`MA/runNowText.ts:38-42`).
- The request in flight and a failed session start are described and not drawn.

## Text

Not confirmed (HANDOFF section 5): the group names "Runs" and "Settings", "See all runs", "did not finish".

New text from the canvas that is not in the production locale files: "Scheduled triggers" and "App triggers" (production has the singular menu entries only), "Open run history in a new tab", "Open this run in a new tab", "edited 2d ago", "last run 2m ago". The count line "12 runs in 30 days" is production (`automations.editor.runsIn30Days`); the run history view today uses "12 runs in the last 30 days" (`automations.model.runCount`). Pick one.

Production texts with a dash that the "no dash" rule would change: `automations.screens.blockedDirty` ("Save your changes first" plus a dash clause) and `automations.editor.noFilters`. Mahmoud decides whether to rewrite them.

Not written: none for "Run now".

Open questions:
- With the server option: which principal a manual run uses (the stored principal of the automation, or the person who clicked).
