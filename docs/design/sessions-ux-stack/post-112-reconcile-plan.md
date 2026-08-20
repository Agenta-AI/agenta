# Remediation plan: reconciling the lane with v0.112.1

Phase 2 deliverable. Executes the findings in
[`post-112-reconcile-inventory.md`](post-112-reconcile-inventory.md) (F-01…F-18). Structure follows
[`mahmoud-112-drift-remediation-plan.md`](mahmoud-112-drift-remediation-plan.md), which is what let
the first round run nine agents in parallel.

## Decisions locked

| # | Decision |
| --- | --- |
| 1 | **Merge first, then re-home.** WP-0 merges `release/v0.112.1` into the lane; every other WP works on a tree already on 0.112.1. |
| 2 | **WP-0 is executed by Claude**, in this worktree, serially, before any other WP starts. |
| 3 | **A2 files get extracted into packages**, never left app-layer. The lane exists so mobile reaches parity through packages instead of a second implementation. |
| 4 | **The provider work (#5995, 172 files) is in scope.** |
| 5 | **The token layer must be fixed correctly and fully** — generator path, palette, and *both* generated outputs. WP-1A owns it end to end; partial is failure. |
| 6 | **Final step is browser QA, executed by Claude via gstack-browser.** |
| 7 | Landing target: `fix/post-112-reconcile`, stacked on `lane/mobile-extracted-packages` (#6065). |

## Ground truth

| Ref | SHA |
| --- | --- |
| `FORK` | `613368b81b94e4e5f8bcb1447857e61105b62ef1` |
| `REL` — merge source | `19b9ab236796263cc281115a2e572eefb1bb9d7d` |
| `LANE` — merge target | `7d2cd2ce89cb7d6f687569caa131054742788e76` |

`0.112.2` adds only 13 version-bump files over `0.112.1`; it follows for free.

---

## Why WP-0 is serial and everything else is parallel

Two independent constraints happen to point the same way.

**The merge is one atomic event.** It resolves ~45 modify/delete conflicts, 22 package conflicts and
8 deletions in one tree state. It cannot be split across agents.

**`but` cannot be run concurrently.** `but rub`, `but absorb` and `but commit --only` all route by
hunk dependency across the whole stack; two agents running them concurrently scramble it. This is
documented in `AGENTS.md` and has cost hours before. Therefore:

> **Agents author. They never run `git commit`, `but`, `gh`, or `pnpm lint-fix`.**
> WP-0 and the landing pass are the only places those run, and one operator does both.

After WP-0 the agents share **one worktree** and edit in parallel, disjoint by the lock table.

---

## File-lock table

An agent may start when every lock it needs is free and its dependencies are done. No two concurrent
agents may hold the same path.

| WP | Locks | Depends on |
| --- | --- | --- |
| **WP-0** merge | *everything* (exclusive) | — |
| **WP-1A** token layer | `web/scripts/generate-tailwind-tokens.ts`, `web/oss/src/styles/**`, `web/packages/agenta-ui/src/styles/**`, `web/oss/src/lib/helpers/chartPalette.ts`, `web/oss/src/lib/hooks/useChartSeries.ts`, `web/oss/src/components/Layout/ThemeContextProvider.tsx`, `web/mobile/src/styles/theme.generated.css` | 0 |
| **WP-1B** navigation | `web/packages/agenta-navigation/src/{state.ts,dynamic/*}`, `web/packages/agenta-navigation-ui/src/{SidebarShell,NavMenu,SidebarSkeletonLoader,ProjectOrgSwitcher}.tsx`, `web/oss/src/components/Sidebar/**`, `web/oss/src/lib/atoms/sidebar.ts` | 0 |
| **WP-1C** drives | `web/packages/agenta-entity-ui/src/drive/**`, `web/packages/agenta-entities/src/drive/**`, `web/oss/src/components/Drives/**`, `web/oss/src/components/AgentChatSlice/components/OpenFilesPaneButton.tsx` | 0 |
| **WP-1D** observability | `web/packages/agenta-observability/src/**`, `web/packages/agenta-shared/src/utils/dateTime/**`, `web/oss/src/state/{observability,newObservability}/**`, `web/oss/src/services/tracing/lib/helpers.{ts,test.ts}`, `web/oss/src/components/Filters/Sort.tsx`, `web/oss/src/lib/helpers/dateTimeHelper/**`, `web/oss/src/components/EvalRunDetails/components/views/OverviewView/hooks/useRunMetricData.ts` | 0 |
| **WP-1E** sessions | `web/packages/agenta-sessions/src/**`, `web/packages/agenta-sessions-ui/src/**`, `web/oss/src/components/pages/sessions/**`, `web/oss/src/lib/sessionListPolicies.ts`, `web/mobile/src/features/sessions/sessionListPolicy.ts`, `web/oss/src/components/AgentChatSlice/state/{sessions,pendingSessionOpen,uiRequests,projectSessionsQuery}.ts`, `.../hooks/{useSessionActions,useSessionShortcuts,useInlineRenameRequest,useFirstRunSeed}.ts(x)`, `.../assets/{sessionMotion,sessionOpenTarget}.ts(+test)`, `.../components/{SessionTagBar,SessionRunSpinner}.tsx` | 0 |
| **WP-1F** home + settings | `web/packages/agenta-home-ui/src/**`, `web/packages/agenta-settings/src/**`, `web/packages/agenta-settings-ui/src/**`, `web/packages/agenta-entities/src/workflow/agentTemplates.ts`, `web/oss/src/components/pages/{agent-home,settings}/**`, `web/oss/src/hooks/useLLMProviderConfig.tsx` | 0 |
| **WP-1G** chat + entity-ui | `web/packages/agenta-chat/src/hooks/{useApprovalDock,useAgentModelKeyStatus,useAgentConversation}.ts`, `web/packages/agenta-chat/src/model/approvals.ts`, `web/packages/agenta-entity-ui/src/agent/**`, `web/oss/src/components/AgentChatSlice/{AgentConversation.tsx,components/ApprovalDock.tsx,hooks/{useAgentModelKeyStatus,useOnboardingProviderSetup}.ts,assets/{clientToolAnswer,onboardingModelSwitch}.ts}`, `web/oss/src/components/pages/overview/agent/**` | 0 |
| **WP-1H** slash commands | `web/packages/agenta-ui/src/RichChatInput/**`, `web/packages/agenta-chat/src/hooks/useChatSlashCommands.tsx` (new), `web/oss/src/components/AgentChatSlice/components/{AgentComposerDock.tsx,SlashCommand/**}`, `web/oss/src/components/AgentChatSlice/hooks/useChatSlashCommands.tsx`, `web/oss/tailwind.config.ts` | 0 |
| **WP-1J** in-place re-applies | `web/oss/src/components/AgentChatSlice/{AgentChatPanel.tsx,assets/conversationLayout.ts,state/{rightPanel,panelLayout}.ts,components/{AgentTranscript,ShowConfigPanelButton,RightPanel/RightPanelSplit,Inspector/InspectSessionButton}.tsx}`, `web/oss/src/components/Playground/Components/{PlaygroundHeader,AgentRevisionSelector}/index.tsx`, `web/oss/src/components/pages/agents/AgentsGrid.tsx` | 0 |
| **WP-1K** adoption guard | `web/oss/src/components/AgentChatSlice/hooks/useSessionHydration.{ts,test.ts}`, `web/oss/src/components/AgentChatSlice/assets/loadSession.ts`, `web/packages/agenta-chat/src/assets/loadSession.ts` | 0 |
| **WP-2** orphaned tests | `web/oss/src/components/AgentChatSlice/components/clientTools/{useConnectFlow,meta}.test.ts` | 1G, 1K |
| **WP-3** verify + land | *everything* (exclusive) | all |

Schedule: **WP-0 → 1A…1K nine-wide in parallel → WP-2 → WP-3.**

**Coverage audit (run against the inventory, not by eye).** 113 app-layer files need action across
A1 + B/C-dual + A2 + the F-17 union. Of those, **109 map to exactly one Wave-1 WP, 4 are WP-0-only,
0 are unassigned, and 0 are claimed by more than one WP.**

The 4 that WP-0 closes on its own — the release fixed the package twin in the same PR, so the merge
carries them and there is nothing to re-home:
`AgentChatSlice/assets/transcriptToMessages.ts` (+ its test), `DrillInView/DrillInFieldHeader.tsx`,
`lib/helpers/colors.ts`.

Re-run this audit if any lock changes. The first draft of this table left 22 files unowned —
`SessionTagBar`, `clientToolAnswer`, `projectSessionsQuery`, `panelLayout` and 18 others — every one
of which would have been silently dropped by a nine-agent run.

---

# Wave 0 — the merge  *(serial, Claude, ~2–4 h)*

## WP-0 — merge `release/v0.112.1` into the lane

Take a `but oplog snapshot -m "pre-112.1-merge"` first. This is the only recovery point.

### Resolution rules, in priority order

**1. The one build break — do NOT accept the deletion.** (F-18)

`web/packages/agenta-chat/src/hooks/useAgentModelKeyStatus.ts`. #5995 deleted it and dropped
`export * from "./useAgentModelKeyStatus"` from `agenta-chat/src/hooks/index.ts`. The lane's app layer
imports it from `@agenta/chat/hooks` (`AgentConversation.tsx:16`, `ConnectModelBanner.tsx`).

→ **Keep the lane's file and its barrel export.** Then port #5995's app-side rewrite *into* the
package copy. Do not leave both.

**2. A1 — the ~45 modify/delete conflicts: keep deleted.**

Every one is "release changed an app file the lane moved into a package". Resolve as **keep deleted**
— that is correct — but **record each one in the log** with its destination WP. The fix is re-homed
in Wave 1, not here. Resolving these without logging them is exactly how the 45 fixes get lost.

**3. #5975 — take the trigger-drawer re-architecture wholesale.**

7 deletes + 15 new files + 20 modifies inside `agenta-entity-ui`. The lane still has the old wiring
live (`TriggerScheduleDrawer` → `ScheduleDrawerContent` → `SchedulesList` → `MasterDetailRail`).
Accept **all** of it, including the 4 new `agenta-ui` date/time primitives and the 2 new
`DrillInView/SchemaControls/triggerManagement` files. Do not cherry-pick — a partial take leaves
dangling imports into deleted files.

Its one collision, `gatewayTrigger/drawers/subscription/SubscriptionForm.tsx` (release 222+/342−,
lane 3+/3−), resolves **toward the release**, then re-apply the lane's 3 lines.

**4. The two independently-created files — pick one side, do not merge.**

`agenta-entities/src/session/state/interactionStatus.ts` and
`agenta-entities/src/gatewayTrigger/state/invalidate.ts` did not exist at `FORK` and were written
from scratch on **both** lines for the same purpose. A 3-way merge has no useful base and will
interleave two implementations.

→ Read both, pick whichever is more complete, justify the pick in the log, delete the other. Default
lean: the release side for `interactionStatus.ts` (86 lines vs 62, and #5919's lifecycle work depends
on its shape); the lane side for `invalidate.ts` unless reading says otherwise.

**5. The remaining 20 package conflicts.** Ordered hardest-first in F-18. The four `agenta-chat`
assets conflicts are the core chat reconcile and deserve the most care.

**6. The 19 auto-merging collisions — assert afterwards, do not trust.** They merge silently; the
winner is decided by line position, not intent. Check these seven by hand after the merge:
`agenta-chat/src/hooks/useAgentConversation.ts` (lane changed 106 lines vs the release's 6),
`agenta-sessions-ui/src/index.ts`, `agenta-ui/src/components/ui/index.ts`, and the inverse cases
`agenta-entity-ui/src/DrillInView/index.ts`, `agenta-ui/src/RichChatInput/RichChatInput.tsx`,
`agenta-sessions/src/state/useSessionList.ts`,
`agenta-entities/src/gatewayTrigger/hooks/useTriggerDeliveries.ts`.

**7. Everything else** — 130 release-only package files and ~120 C-rest app files take the release
side. 405 release-only files land untouched.

### Deliverable

`docs/design/sessions-ux-stack/post-112-merge-log.md` — one row per resolved conflict:
`path · resolution · owning WP · note`. **Wave 1 is dispatched against this log**, so an unlogged
A1 resolution is a lost fix.

### DoD

- `pnpm --filter @agenta/oss exec tsc --noEmit` — compare the **error signature**, not the count,
  against a pre-merge baseline captured on the lane tip. New signatures block; equal-or-fewer passes.
- Same for `@agenta/mobile`.
- `git grep -n "useAgentModelKeyStatus" web/packages/agenta-chat/src/hooks/index.ts` matches.
- No file in the tree imports from a path deleted by the merge (`tsc` catches this; do not skip it
  because the 105 new package files were never opened — this gate is what covers them).
- The merge log has a row for every A1 path in the inventory.

---

# Wave 1 — re-homing  *(nine agents in parallel)*

## WP-1A — the token layer  *(F-01, F-02, F-17d — highest blast radius)*

Four artefacts, one chain. **All four or none** — decision 5.

1. **Fix the generator first.** `web/scripts/generate-tailwind-tokens.ts:30` still has
   `const CURRENT_CSS = pathResolve(OSS, "src/styles/theme-variables.css")` — a path the lane
   deleted. Its own doc comment says the target moved to `packages/agenta-ui/src/styles`. Repoint
   `CURRENT_CSS` there. Until this is done, `GEN_WRITE=1` writes nothing and every later step is a
   no-op that looks like success.
2. **Reconcile `palette.ts`.** It merges in WP-0 with large conflicts (920 lines at `REL` vs 602 on
   the lane, 197 replaced lines). Verify the merged file has #5973's `outlinedTagTone`, `rgbChannels`,
   `TAG_OUTLINE_ALPHA` and the `chartSeries` export.
3. **Regenerate both outputs**, per `AGENTS.md`: `pnpm generate:tailwind-tokens` in `web/`, then
   commit `theme-variables.css` **and** `theme/antd-overrides.generated.ts`. Never hand-edit either.
4. **Port the two chart helpers**: `lib/helpers/chartPalette.ts` (now importing from `palette.ts`
   rather than holding its own hex arrays) and the new `lib/hooks/useChartSeries.ts`.

**DoD:** all 27 tokens from F-01 present in `agenta-ui/src/styles/theme-variables.css`
(`--ag-chart-series-0..4`, `--ag-chart-grid|axis-line|axis-text|reference|track`,
`--ag-run-status-*` ×5, `--ag-hero-action-*` ×3, `--ag-shell-selected-*` ×3, `--ag-status-warning-*`
×3, `--ag-surface-{paper,section-content,section-header}`); `--ag-ref-app-border` is
`rgba(17, 57, 85, 0.22)` not `#b2ddff`; `antd-overrides.generated.ts` is back to ~168 lines with
`colorLink: "#8ccfff"`; regenerating a second time is a no-op diff. `web/mobile`'s
`theme.generated.css` keeps its 28 extra tokens.

## WP-1B — navigation  *(F-03, F-13, part of F-07)*

`@agenta/navigation` and `@agenta/navigation-ui` are lane-only, so **nothing here merges — all of it
is re-homing.**

| Source | Destination | Content |
| --- | --- | --- |
| `Sidebar/dynamic/sessionsSource.ts` (275 lines at `REL` vs 111) | `agenta-navigation/src/dynamic/sessionsSource.ts` | #5927 (7), #5944 (20), #5974 (37). Core: `localPlaygroundSessionRefsAtom` + the `running` row field. Fixes the named repro — switching tabs mid-first-turn drops the running session's row and spinner. Also `name` stops falling back to `"Untitled session"` so rename prefills correctly. |
| `Sidebar/dynamic/{registry,types}.ts` | same names in `agenta-navigation/src/dynamic/` | #5945, #5974 |
| `Sidebar/dynamic/useSidebarDynamicChildren.ts` (**oss is a binding**) | `agenta-navigation/src/dynamic/useSidebarDynamicChildren.ts` | #5945 (2), #5974 (1) |
| `Sidebar/engine/SidebarShell.tsx` | `agenta-navigation-ui/src/SidebarShell.tsx` | #5943 (10), #5945 (8) |
| `Sidebar/engine/SidebarMenu.tsx` | `agenta-navigation-ui/src/NavMenu.tsx` (**renamed, rewritten**) | #5943, #5945, #5974 — re-express, do not copy |
| `Sidebar/components/SidebarSkeletonLoader.tsx` (**9-line shim**) | `agenta-navigation-ui/src/SidebarSkeletonLoader.tsx` | #5943 (5) |
| `lib/atoms/sidebar.ts` | `agenta-navigation/src/state.ts` | #5943 (20) |
| `Sidebar/components/ProjectOrgSwitcher/index.tsx` (**111-line binding**) | `agenta-navigation-ui/src/ProjectOrgSwitcher.tsx` | #6018 — `PANEL_CLASS`, the `w-full`/`box-border` popup, `px-3` avatar column. `ROW_CLASS` already lives there. |
| **A2, extract** | `agenta-navigation{,-ui}` | `Sidebar/dynamic/SessionRowActions.tsx`, `Sidebar/dynamic/sessionOptions.ts`, `Sidebar/hooks/useSidebarResize.ts` |

**#6018 context (F-13):** it does not duplicate D-15/16/17 — different elements. It *depends* on
D-17, already satisfied (`NavMenu.tsx:364` is `w-full`). Its `SidebarBanners/*` half genuinely stays
app-layer; note the lane has an **ee copy too** that the release never updates.

**DoD:** `localPlaygroundSessionRefsAtom` exists in the package; `sessionsSource.ts` is ~275 lines;
no `Sidebar/**` oss file gained logic that belongs in a package.

## WP-1C — drives  *(F-04, F-14 — 20 files, the largest single re-homing)*

`@agenta/entity-ui/drive` and `@agenta/entities/drive` exist on both lines, but the release **never
touched them** — every fix is app-copy-only. Sources: #5946 (14 files), #5944 (3), #5943 (3),
PR #6016 (3).

Largest: `useSessionDrive.ts` 34/35 added lines missing (630 at `REL` vs 565);
`useDriveTreePane.ts` 13/16; `DriveExplorer.tsx` 12/13; `StorageSection.tsx` 12/13;
`DriveHeader.tsx` 10/12 + 2/6. Then `DriveToolbar` (6), `DriveTreePane` (5), `OriginTag` (4+1),
`driveIcons` (4), and one line each in `DriveFileContentViewer`, `DriveFileRow`, `FilesDrawer`,
`SessionFilesDrawer`, `StorageFilesHeader`, `configDrive`, `driveTreeView`, `quickLook`.

**A2, extract into `@agenta/entity-ui/drive`:** `Drives/SessionFilesPane.tsx` and
`AgentChatSlice/components/OpenFilesPaneButton.tsx` — the build-mode files pane. **Take the #6016
state, not #5946's** (#6016 revises it).

New file from #6016: `DriveExplorerStates.tsx`.

## WP-1D — observability  *(F-08, F-12)*

**F-12 is the highest-confidence user-visible bug in the reconcile.**
`agenta-observability/src/core/analytics.ts:122` still reads
`failure_rate: totalCount ? errorCount / totalCount : 0`. #6019 fixed it to `* 100`. The UI renders a
percentage, so 16.67% shows as 0.17% — on **both** desktop and mobile, since the oss shim's own
comment says they share the transform.

Also: `web/oss/src/services/tracing/lib/helpers.test.ts` arrives with the merge and imports
`analyticsToGeneration` from `./helpers`, which the lane's 36-line shim no longer exports. **Re-point
the test at `@agenta/observability`** — do not delete it; it is the regression guard for this fix.

Then #5923's UTC-range work, four files, four destinations:
`state/newObservability/atoms/controls.ts` → `agenta-observability/src/state/controls.ts` (409 vs
349) · `components/Filters/Sort.tsx` → `agenta-observability/src/core/` ·
`lib/helpers/dateTimeHelper/index.ts` → `agenta-shared/src/utils/dateTime/index.ts` ·
`state/observability/dashboard.ts` is a **20-line binding** — its 1 line goes to the package.

**DoD:** `git grep -n "errorCount / totalCount" web/packages/agenta-observability` returns only the
`* 100` form; `helpers.test.ts` passes.

## WP-1E — sessions  *(F-06, F-07, F-15)*

| Item | Detail |
| --- | --- |
| **F-06 tombstones** | #5830's `deletedIdsByAppAtom` (`atomWithStorage`, key `agenta:agent-chat:deleted-sessions`) appears **nowhere** in the lane. Fixes issue #5543 — a deleted session resurrects on the next list refresh. `AgentChatSlice/state/sessions.ts` survives the merge as a large conflict (732 lines vs 1,010); assert the atom is present afterwards rather than trusting the resolution. |
| `SessionListCard.tsx` | oss is a **28-line binding**; #5927's 28/31 lines go to `agenta-sessions-ui/src/SessionListCard.tsx` (122 vs 292) |
| `useSessionActions.tsx` | oss is a partial binding; #5974 (5) and #6005 (2) → `agenta-sessions-ui/src/useSessionActions.tsx` (189 vs 223) |
| `SessionTagBar.tsx` (620→329) | → `agenta-sessions-ui/src/{SessionTab,SessionTabStrip}.tsx`: #5943's label masks (`LABEL_MASK_REST/HOVER`), #6005's `aria-keyshortcuts` |
| `menuEntries.ts` | the 25-line adapter **stays**; the new verbs go to `useSessionActions.menuItems`, which its own comment names as the single source |
| `sessionMotion.ts`, `pendingSessionOpen.ts` | → `agenta-sessions-ui/src/assets/motion.ts`, `agenta-sessions/src/state/pendingSessionOpen.ts` |
| **F-15 A2, extract** | `useSessionShortcuts.ts`, `useInlineRenameRequest.ts`, `state/uiRequests.ts` → `@agenta/sessions`; `SessionRunSpinner.tsx` → `@agenta/sessions-ui`; `projectSessionsQuery.ts`, `sessionAutomationActions.ts`, `useSessionAutomationActions.ts` → `@agenta/sessions`; `SessionAutomationDrawers.tsx` → `@agenta/sessions-ui` |
| **Dedup** | `sessionListPolicies` exists in **three** copies at `REL` — `web/oss/src/lib/`, `agenta-sessions/src/state/sessionListPolicy.ts`, `web/mobile/src/features/sessions/sessionListPolicy.ts`. Collapse to the package; delete the other two. This is the duplication the lane exists to remove. |

## WP-1F — home + settings  *(F-09, F-11)*

Renames the automated match could not see — resolved by hand, do not re-derive:

| App path at `REL` | Lane destination |
| --- | --- |
| `agent-home/components/HomeSessionsSection.tsx` | folded into `agenta-home-ui/src/HomeOverview.tsx` |
| `agent-home/components/HomeAutomationsSection.tsx` | folded into `agenta-home-ui/src/HomeOverview.tsx` |
| `settings/Triggers/components/GatewaySchedulesSection.tsx` | `agenta-settings-ui/src/triggers/TriggerSchedulesSection.tsx` |
| `settings/Triggers/components/GatewaySubscriptionsSection.tsx` | `agenta-settings-ui/src/triggers/TriggerSubscriptionsSection.tsx` |
| `settings/Tools/components/AgentaToolsPlaceholder.tsx` | **deleted** by #5943 — port the delete to `agenta-settings-ui/src/tools/AgentaToolsPlaceholder.tsx` |
| `agent-home/assets/templates.ts` (28/28 missing) | `agenta-entities/src/workflow/agentTemplates.ts` |
| `agent-home/.../TemplateCard.tsx`, `.../useAgentActivity.ts` (**binding**) | `agenta-home-ui/src/{TemplateCard,useAgentActivity}.ts(x)` |
| `settings/Preferences/Preferences.tsx` (**101→56 binding**) | `agenta-settings-ui/src/PreferencesPage.tsx` |

**F-11 — the provider surface.** `pages/settings/assets/navigation.ts` → `agenta-settings/src/navigation.ts`
(lane-only package, 15 symbols matched). Verified: **the lane's copy has no AI Providers entry**, so
the new page has no route into it. Extract `pages/settings/AIProviders/AIProviders.tsx` into
`@agenta/settings-ui` **and** add its navigation entry — either alone is a no-op.
Also extract `settings/Triggers/components/useAgentNameById.ts` → `@agenta/settings`.

## WP-1G — chat + entity-ui  *(F-17a, part of F-07)*

| Source | Destination |
| --- | --- |
| `ApprovalDock.tsx` **#5919 half** | `agenta-chat/src/hooks/useApprovalDock.ts` — the gate scan changes from "last assistant message" to **all** messages in transcript order |
| `ApprovalDock.tsx` **#5946 half** | stays in `web/oss/.../ApprovalDock.tsx` — humanized headline copy, re-expressed against the lane's `resolveApprovalRenderer`. Same file, two verdicts. |
| `pages/overview/agent/AgentOverview.tsx` (169→119) | `agenta-entity-ui/src/agent/{AgentOverviewLayout,AgentOverviewBody}.tsx` — #5927 column scroll, #5943 rail tint |
| `pages/overview/agent/AgentFilesCard.tsx` | `agenta-entity-ui/src/agent/AgentFilesCard.tsx` |
| `useAgentModelKeyStatus` | finish WP-0 rule 1: #5995's app-side rewrite ported **into** the kept package copy |

## WP-1H — slash commands  *(F-17c — a missing feature, not drift)*

Verified: `slash.picker`, `PickerPanel` and `useChatSlashCommands` return **zero** hits in the lane's
`AgentComposerDock.tsx`. The lane predates #5817 entirely, so #6024's 13 anchorless lines are an
absence, not a regression.

Land the whole feature at its **#6024 net state**:
`agenta-ui/src/RichChatInput/{assets/slashCommands.ts,plugins/SlashCommandPlugin.tsx}` (these merge —
both lines have the package) · extract `SlashCommand/PermissionsPickerPanel.tsx` + `README.md` +
`useRovingList.ts` into `@agenta/ui` · extract `useChatSlashCommands.tsx` into `@agenta/chat` ·
**do not extract `HarnessPickerPanel.tsx` — #6024 deleted it** · wire `AgentComposerDock.tsx`.

**F-10 cross-app gap:** #5817's `command-panel-in|fade|swap` keyframes live in
`web/oss/tailwind.config.ts`. The plugin is shared, and `web/mobile` runs a Tailwind v4 bridge that
will not have those names — the panel renders unanimated there. Either add the animations to the
mobile bridge or move them into the shared layer. **Do not leave it desktop-only.**

## WP-1J — in-place re-applies  *(F-17b — 9 files, no package moves)*

Right file, rewritten surroundings. Each hunk must be re-expressed by hand against the lane's markup;
none of them will auto-apply.

`AgentChatPanel.tsx` · `RightPanel/RightPanelSplit.tsx` + `state/rightPanel.ts` (**split-aware** — the
lane moved the Inspector's open/scope/lens into `components/Inspector/state.ts` and left only the
persisted width) · `AgentTranscript.tsx` + `assets/conversationLayout.ts` (#5943's
`BOTTOM_FADE_OVERLAY_STYLE` / `BOTTOM_FADE_HOVER_HIDE` are additive and land, but the button they
restyle was rewritten) · `Playground/Components/PlaygroundHeader/index.tsx` (3 hunks across
PR #5943/#5946/#5973, including `SHOW_MODE_SWITCH = false` which hides the Build/Chat switch) ·
`Playground/Components/AgentRevisionSelector/index.tsx` (#5943 replaced the antd draft/saved pill with
a `@agenta/ui/ui` dropdown + `handleRevertChanges`) · `pages/agents/AgentsGrid.tsx` (warm tint on the
dashed slot, light only) · `Inspector/InspectSessionButton.tsx` (one `placement="left"`).

## WP-1K — the adoption guard  *(F-05 — riskiest single item)*

**This is a semantic re-expression, not a port. Budget accordingly.**

PR #5942 threads `interactionRows?: SessionInteractionRowStates` through `loadSession`'s return so the
adoption guard can distinguish a card still awaiting the user (`pending`) from one that has ended,
adding `TERMINAL_PART_STATES` and `isTerminalRow`.

The catch: it replaces a pending/settled reconciler built on `buildRenderMap` /
`isPendingClientToolInteraction` that the lane **no longer contains in either the app layer or any
package**. The lane's `useSessionHydration.ts:248` says it *"reproduces the package-side stamp without
reaching into `@agenta/chat`"* — a different mechanism. So the guard has to be rebuilt against that
mechanism.

Second half: `agenta-chat/src/assets/loadSession.ts` needs the `interactionRows` threading. #5942
touched only the app copy, so the merge cannot supply it — verified, all 10 of its added lines are
app-only at `REL`.

**Read first:** the lane's `useSessionHydration.ts` end to end, and `@agenta/chat`'s
`loadSession.ts`/`state`. Do not start by diffing.

## WP-2 — orphaned tests  *(F-17f)* — depends on 1G, 1K

Three test files merge clean onto gutted app files and will fail to resolve their imports:
`AgentChatSlice/hooks/useSessionHydration.test.ts` (442 lines at `REL` vs **35** on the lane),
`components/clientTools/useConnectFlow.test.ts` (265→104), `components/clientTools/meta.test.ts`
(170→103). Re-point each at the package that now owns its subject. Same shape as WP-1D's
`helpers.test.ts`. **Re-point, never delete** — these are the only coverage the re-homed behaviour has.

---

# Wave 3 — verification and landing  *(serial, Claude)*

## WP-3A — static gates

1. `pnpm lint-fix` in `web/` (`AGENTS.md`).
2. `pnpm --filter @agenta/oss exec tsc --noEmit`, and the mobile equivalent. Gate on the **error
   signature diff** against the WP-0 baseline, never the count — a count gate masks new errors.
3. Package unit tests for every package Wave 1 touched.
4. Regenerating tokens a second time produces a no-op diff (proves WP-1A is idempotent).

## WP-3B — browser QA  *(Claude, gstack-browser)*

Nothing in the inventory is render-verified; it is all tree comparison. This is where that gets
closed. Minimum route list, one per user-visible finding:

| Check | Finding |
| --- | --- |
| Charts/usage: series colours, and **failure rate reads as a percentage** | F-01, F-12 |
| Dark mode across sessions / home / settings / rail | F-01, F-13 |
| Sidebar: start a session, switch tabs mid-first-turn — row and spinner **stay** | F-03 |
| Sidebar rename prefills the real session name | F-03 |
| Rail alignment: switcher panel and banners on the nav icon column | F-13 |
| Drives: build-mode files pane, session files drawer | F-04, F-14 |
| Delete a session, refresh — **it stays deleted** | F-06 |
| Settings → AI Providers is reachable from the nav | F-11 |
| Slash `/` palette opens, animates, harness picker **absent** | F-17c |
| Session keyboard shortcuts (`Alt+1…n`) and inline rename | F-15 |
| Approval dock: park a card several turns up, confirm the gate still counts | F-17a |
| Both light and dark, and once at mobile width | F-10 |

Run against the app the same way `/run` would; if a dev server is already up, use that URL.

## WP-3C — landing

One operator, serially: `but commit` per WP → verify each with `git show --stat --name-only` → `but
push` → confirm `git rev-parse` matches `git ls-remote`. Per `AGENTS.md`: `but push` prints nothing
on success and is not a confirmation.

---

# Risks

| Risk | Mitigation |
| --- | --- |
| WP-0 resolves an A1 conflict as "keep deleted" without logging it → the fix is lost with no trace | The merge log is a WP-0 deliverable and Wave 1 is dispatched **from** it. A missing row is a failed DoD, not a detail. |
| WP-1A is done partially (generator fixed, outputs not regenerated) | Decision 5 makes partial a failure. The idempotency check in WP-3A catches it. |
| The 105 new package files import paths the lane reorganised | They were never opened. `tsc` in WP-0's DoD is the gate; do not skip it. |
| Two agents both touch `AgentChatSlice/**` | The lock table splits it by subdirectory — 1C takes `components/OpenFilesPaneButton`, 1E takes `state/` + session hooks, 1G takes `ApprovalDock`, 1H takes `AgentComposerDock` + `SlashCommand/`, 1J takes the panel/transcript, 1K takes `useSessionHydration`. Verify before dispatch. |
| WP-1K's re-expression changes behaviour subtly | It is the one WP with no mechanical check. WP-3B's "park a card several turns up" route is its only real verification. |
| An auto-merged collision silently picks the wrong side | WP-0 rule 6 lists the seven to assert by hand. |

# Dispatch prompt template

```
You are working in <worktree>, on a tree already merged to release/v0.112.1 (WP-0 complete).

Read first, in order:
  1. docs/design/sessions-ux-stack/post-112-reconcile-inventory.md — the finding(s) named below
  2. docs/design/sessions-ux-stack/post-112-merge-log.md — your WP's rows
  3. docs/design/sessions-ux-stack/post-112-reconcile-plan.md — your WP section

Your WP: <WP-id>. Findings: <F-nn, …>.
Your locks: <paths>. You may not edit any path outside them. If a fix needs one, STOP and report —
a new WP is cheaper than a lock breach.

Rules:
  - You author only. Never run git commit, but, gh, or pnpm lint-fix.
  - Read the lane's successor in full before editing it. The lane often implements the same
    behaviour differently; a failed grep proves nothing.
  - Source of truth for the release side: git show 19b9ab2367:<path>. Never `gh pr view --json files`.
  - Where this plan says "re-express", do not copy the release's lines — the surrounding code differs.

DoD: <per-WP>. Report what you changed, what you could not, and anything you found that the
inventory missed.
```
