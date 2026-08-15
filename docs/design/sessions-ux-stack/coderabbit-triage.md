# CodeRabbit triage — sessions-UX stack (#5873–#5894)

128 review comments across 18 PRs (four more carry none). Written 2026-08-15, before any
of them were actioned, so the work can be scoped before it is started.

**Every referenced file still exists** — no finding was invalidated by a later move.
That is a weak signal though: a live path says nothing about whether the claim still holds.
All three Critical findings were verified and they split three ways — one real, one already
fixed, one an artifact of how the stack is ordered. Treat everything still marked
*unverified* as a claim, not a defect.

## Critical (3)

### #5876 · `web/packages/agenta-entities/package.json:82`

> Commit the lockfile for the new runtime dependencies.

**STALE at the tip — real for the lane.** `pnpm-lock.yaml` carries a
`packages/agenta-entities:` block and every dependency it names
(`@tanstack/query-persist-client-core`, `openapi-json-schema`, `jotai-scheduler` all
resolve), so nothing is missing at the top of the stack. It is real *within #5876* only
because the lock is first touched at #5885 while app code imports the packages from #5865
— the known `ERR_PNPM_OUTDATED_LOCKFILE` that reds every intermediate lane. That is the
recorded, deliberate shape of this stack, not a defect to patch here.

### #5879 · `web/oss/src/components/AgentChatSlice/AgentConversation.tsx:750`

> Address the missing `CopiedToast` definition and hook state before rendering the toast.

**STALE.** `CopiedToast` is imported at line 46 and rendered at 744 on current code. Fixed after the review ran.

### #5882 · `web/mobile/src/features/chat/SessionWorkspace.tsx:103`

> `chat` and `pane` mount twice, so the conversation runs two engines.

**REAL.** Confirmed. The below-md container is `md:hidden` and the md+ container is `hidden md:block` — both are CSS-hidden, neither unmounts, so `{chat}` and `{pane}` each mount twice. Two chat engines at every viewport.

## Counts by PR

| PR | what it does | Critical | Major | Minor | total |
|---|---|---|---|---|---|
| #5885 | @agenta/settings + settings-ui — the settings spine | 0 | 11 | 7 | 18 |
| #5894 | the sessions-UX stack — docs | 0 | 13 | 1 | 14 |
| #5879 | agent page chrome + session tab rail into packages | 1 | 2 | 10 | 13 |
| #5890 | Tools and Triggers into @agenta/settings-ui | 0 | 7 | 5 | 12 |
| #5892 | Audit Log, Usage & Billing, /m write paths | 0 | 6 | 6 | 12 |
| #5893 | DataTable at phone widths, /m writable, drill-in bridge | 0 | 5 | 6 | 11 |
| #5882 | mobile: agents, templates, settings, tabbed workspace | 1 | 1 | 5 | 7 |
| #5889 | Members, Orgs, Access Controls, Domains, SSO | 0 | 5 | 2 | 7 |
| #5873 | agent-path playground chrome off antd | 0 | 3 | 3 | 6 |
| #5875 | @agenta/observability — analytics query/range/transform | 0 | 3 | 3 | 6 |
| #5880 | @agenta/home-ui — home overview, templates, roster | 0 | 3 | 3 | 6 |
| #5884 | ONE agent overview — body, actions menu, rail | 0 | 2 | 2 | 4 |
| #5886 | DataTable — the antd-free table | 0 | 3 | 1 | 4 |
| #5876 | @agenta/entities/drive — headless layer | 1 | 1 | 1 | 3 |
| #5883 | ONE agent-overview arrangement (@agenta/entity-ui) | 0 | 0 | 2 | 2 |
| #5874 | global stylesheets into @agenta/ui | 0 | 0 | 1 | 1 |
| #5878 | SidebarShell + logo into @agenta/navigation-ui | 0 | 0 | 1 | 1 |
| #5888 | organization + workspace APIs into @agenta/entities | 0 | 1 | 0 | 1 |

## Counts by category

| category | count |
|---|---|
| 🎯 Functional Correctness | 54 |
| 📐 Maintainability & Code Quality | 30 |
| 🗄️ Data Integrity & Integration | 23 |
| 🩺 Stability & Availability | 16 |
| 🔒 Security & Privacy | 4 |
| 🚀 Performance & Scalability | 1 |

## Every finding, by PR

### #5873 — agent-path playground chrome off antd

| sev | file:line | claim |
|---|---|---|
| Major | `web/oss/src/components/Playground/Components/MainLayout/index.tsx:379` | Disable division resizing and size bounds while the config pane is collapsed. |
| Minor | `web/oss/src/components/Playground/Components/Modals/DeployVariantModal/assets/DeployVariantModalContent/index.tsx:46` | Align the modal loading state with the environment rows. |
| Minor | `web/oss/src/components/Playground/Components/Modals/RefinePromptModal/assets/InstructionsPanel.tsx:164` | Guard the Enter handler against IME composition. |
| Major | `web/oss/src/components/Playground/Components/PlaygroundGenerations/assets/GatewayToolExecuteButton.tsx:110` | Block the dropdown action while a tool call is in flight. |
| Major | `web/oss/src/components/Playground/Components/PlaygroundHeader/index.tsx:676` | Use a supported theme color token. |
| Minor | `web/oss/src/components/Playground/Components/PlaygroundHeader/index.tsx:696` | (no title) |

### #5874 — global stylesheets into @agenta/ui

| sev | file:line | claim |
|---|---|---|
| Minor | `web/packages/agenta-ui/src/styles/code-editor-styles.css:221` | Use theme-aware scrollbar colors. |

### #5875 — @agenta/observability — analytics query/range/transform

| sev | file:line | claim |
|---|---|---|
| Minor | `web/oss/src/services/tracing/types/index.ts:13` | Reduce this comment to one short line. |
| Major | `web/packages/agenta-observability/src/core/analytics.ts:128` | Fix the `failure_rate` percentage rendering. |
| Major | `web/packages/agenta-observability/src/core/presets.ts:50` | Return a UTC timestamp from `toISOString()` and define an explicit start for all time. |
| Minor | `web/packages/agenta-observability/src/core/types.ts:40` | Correct the public `environment` field name. |
| Major | `web/packages/agenta-observability/src/state/index.ts:22` | Keep the UTC designator in `sorted`. |
| Minor | `web/packages/agenta-observability/src/state/index.ts:67` | `loading` stays true while the query is disabled. |

### #5876 — @agenta/entities/drive — headless layer

| sev | file:line | claim |
|---|---|---|
| Critical | `web/packages/agenta-entities/package.json:82` | Commit the lockfile for the new runtime dependencies. |
| Major | `web/packages/agenta-entities/src/drive/driveMedia.ts:11` | Route mount binary downloads through `@agenta/sdk/resources`. |
| Minor | `web/packages/agenta-entities/src/drive/driveTypes.ts:20` | Update the ownership note for `previewUrl`. |

### #5878 — SidebarShell + logo into @agenta/navigation-ui

| sev | file:line | claim |
|---|---|---|
| Minor | `web/packages/agenta-navigation/src/dynamic/useSidebarDynamicChildren.ts:104` | Do not treat ungrouped entries as a separate labelled group. |

### #5879 — agent page chrome + session tab rail into packages

| sev | file:line | claim |
|---|---|---|
| Critical | `web/oss/src/components/AgentChatSlice/AgentConversation.tsx:750` | Address the missing `CopiedToast` definition and hook state before rendering the toast. **[STALE]** |
| Minor | `web/oss/src/components/Playground/Components/PlaygroundHeader/index.tsx:672` | The header title and name flash the non-agent state while the root revision loads. |
| Major | `web/oss/src/components/Playground/Components/PlaygroundVariantConfig/assets/PlaygroundVariantConfigHeader.tsx:213` | Restore the OSS commit host adapter for the agent header. |
| Minor | `web/packages/agenta-chat/src/state/panelLayout.ts:8` | Persist the selected chat layout mode. |
| Minor | `web/packages/agenta-playground-ui/src/components/AgentConfigHeader.tsx:47` | Replace the legacy raw color token. |
| Minor | `web/packages/agenta-playground-ui/src/components/AgentPageHeader/AgentPageHeader.tsx:60` | Replace the prohibited color token. |
| Major | `web/packages/agenta-playground-ui/src/components/CommitVariantChanges/CommitVariantChangesButton.tsx:69` | Enforce the dirty-state disable guard for every trigger. |
| Minor | `web/packages/agenta-playground-ui/src/components/CommitVariantChanges/CommitVariantChangesModal.tsx:132` | Add `onAfterCommit` to the `handleSubmit` dependency list. |
| Minor | `web/packages/agenta-sessions-ui/src/controls/SessionFilterControls.tsx:155` | Use `role="group"` with a label instead of `<nav>`. |
| Minor | `web/packages/agenta-sessions-ui/src/SessionFiltersBar.tsx:90` | Add visible hover and keyboard-focus states. |
| Minor | `web/packages/agenta-sessions-ui/src/SessionFiltersBar.tsx:127` | Do not clear a hidden agent filter. |
| Minor | `web/packages/agenta-sessions-ui/src/SessionTabDragItem.tsx:88` | Clear `pressTimer` on unmount. |
| Minor | `web/packages/agenta-sessions/src/state/waitingByAgent.ts:46` | Ignore placeholder rows when calculating waiting counts. |

### #5880 — @agenta/home-ui — home overview, templates, roster

| sev | file:line | claim |
|---|---|---|
| Major | `web/oss/src/components/pages/agent-home/StripHome.tsx:212` | /node_modules/ |
| Minor | `web/oss/src/components/TemplateStrip/assets/constants.ts:22` | Use the required storage-key prefix. |
| Minor | `web/oss/src/components/TemplateStrip/components/CopiedToast.tsx:37` | Use a semantic theme color for the icon. |
| Major | `web/packages/agenta-home-ui/src/HomeTaskComposer.tsx:65` | Fall back to the default agent when the selected agent leaves the list. |
| Minor | `web/packages/agenta-home-ui/src/HomeTaskComposer.tsx:89` | Handle rejected `onSubmit` in `ChatComposer`. |
| Major | `web/packages/agenta-home-ui/src/useCreateAgent.ts:51` | Narrow or share the create-agent re-entry latch. |

### #5882 — mobile: agents, templates, settings, tabbed workspace

| sev | file:line | claim |
|---|---|---|
| Minor | `web/mobile/src/features/agents/useNewAgentAction.ts:54` | Always clear the creation state. |
| Minor | `web/mobile/src/features/chat/ChatScreen.tsx:63` | Run `pnpm lint-fix` to fix the formatting failure. |
| Minor | `web/mobile/src/features/chat/ChatScreen.tsx:199` | Gate the read-only notice on `agentId`. |
| Major | `web/mobile/src/features/chat/LiveConversation.tsx:72` | Key the sent-guard by session id, or a pending task is dropped after a session switch. |
| Minor | `web/mobile/src/features/chat/SessionsPane.tsx:52` | Add a visible focus state to the new-session button. |
| Critical | `web/mobile/src/features/chat/SessionWorkspace.tsx:103` | `chat` and `pane` mount twice, so the conversation runs two engines. **[REAL]** |
| Minor | `web/mobile/src/pages/w/[workspace_id]/p/[project_id]/sessions/[session_id].tsx:27` | Validate the `agent` parameter shape. |

### #5883 — ONE agent-overview arrangement (@agenta/entity-ui)

| sev | file:line | claim |
|---|---|---|
| Minor | `web/packages/agenta-entity-ui/src/agent/AgentOverviewLayout.tsx:40` | Use the Tailwind-aware `cn` helper for `AgentOverviewLayout`. |
| Minor | `web/packages/agenta-entity-ui/src/agent/AgentOverviewLayout.tsx:38` | Keep host-page scrolling below `lg`. |

### #5884 — ONE agent overview — body, actions menu, rail

| sev | file:line | claim |
|---|---|---|
| Major | `web/mobile/src/features/agents/AgentComposer.tsx:51` | Handle a failed `router.push` in `start`. |
| Minor | `web/mobile/src/features/agents/AgentOverviewScreen.tsx:76` | Render `AgentActionsMenu` only after the agent record resolves. |
| Minor | `web/oss/src/components/pages/overview/agent/AgentOverview.tsx:92` | Avoid passing an empty `sessionsHref`. |
| Major | `web/packages/agenta-sessions-ui/src/SessionListCard.tsx:65` | Preserve `agentId` in `linkScope`. |

### #5885 — @agenta/settings + settings-ui — the settings spine

| sev | file:line | claim |
|---|---|---|
| Minor | `web/mobile/src/features/settings/SettingsScreen.tsx:141` | /node_modules/ |
| Major | `web/oss/src/components/Layout/ThemeContextProvider.tsx:83` | Make `system` mode react to OS preference changes. |
| Minor | `web/oss/src/components/pages/settings/Projects/index.tsx:58` | Reset `createForm` when the dialog closes, not only on cancel. |
| Major | `web/packages/agenta-entities/src/profile/index.ts:8` | /generated/ |
| Major | `web/packages/agenta-entities/src/profile/index.ts:36` | Move the profile query to a validated shared query atom. |
| Major | `web/packages/agenta-entities/src/webhook/api.ts:20` | Migrate webhook API calls to `WebhooksClient`. |
| Minor | `web/packages/agenta-settings-ui/src/AccountPage.tsx:161` | Fix the Prettier formatting failure. |
| Minor | `web/packages/agenta-settings-ui/src/index.ts:16` | Prettier was not run on the new `agenta-settings-ui` sources. |
| Major | `web/packages/agenta-settings-ui/src/projects/ProjectsPage.tsx:98` | Replace `error: any` with a typed error and share one error formatter. |
| Minor | `web/packages/agenta-settings-ui/src/secrets/NamedSecretTable.tsx:91` | Both secret tables style the format tag with the raw `--ag-c-0517290F` literal. |
| Major | `web/packages/agenta-settings-ui/src/secrets/NamedSecretTable.tsx:159` | `mutate` is used directly as an `onClick` handler in both secret tables. |
| Major | `web/packages/agenta-settings-ui/src/secrets/NamedSecretTable.tsx:230` | Remove the `as unknown as LlmProvider` cast. |
| Major | `web/packages/agenta-settings/src/api/apiKeys.ts:35` | Use the Fern Keys client for API-key operations. |
| Minor | `web/packages/agenta-settings/src/index.ts:5` | Format this export file. |
| Major | `web/packages/agenta-settings/src/useApiKeys.ts:115` | Move API-key listing to a workspace- and project-scoped query atom. |
| Minor | `web/packages/agenta-shared/src/utils/dateTime/index.ts:45` | Use a valid strict default format for `parseDate`. |
| Major | `web/packages/agenta-ui/src/theme/useThemeMode.ts:18` | /node_modules/ |
| Major | `web/packages/agenta-ui/src/theme/useThemeMode.ts:57` | Update the resolved theme after an OS appearance change. |

### #5886 — DataTable — the antd-free table

| sev | file:line | claim |
|---|---|---|
| Major | `web/mobile/src/features/settings/SettingsScreen.tsx:70` | Pass the active workspace ID to `useApiKeys`. |
| Major | `web/mobile/src/features/settings/SettingsScreen.tsx:107` | Provide project data before rendering `ProjectsPage`. |
| Major | `web/packages/agenta-settings-ui/src/secrets/NamedSecretTable.tsx:146` | Reload buttons forward the click event to `mutate`. |
| Minor | `web/packages/agenta-ui/src/components/ui/data-table.tsx:162` | Add keyboard activation for clickable rows. |

### #5888 — organization + workspace APIs into @agenta/entities

| sev | file:line | claim |
|---|---|---|
| Major | `web/packages/agenta-entities/src/organization/api.ts:10` | Use Fern resource accessors and validate API responses. |

### #5889 — Members, Orgs, Access Controls, Domains, SSO

| sev | file:line | claim |
|---|---|---|
| Major | `web/mobile/src/features/settings/SettingsScreen.tsx:134` | Move the page-level API queries into query atoms. |
| Major | `web/mobile/src/features/settings/SettingsScreen.tsx:161` | Complete the flag-save lifecycle. |
| Major | `web/mobile/src/features/settings/SettingsScreen.tsx:286` | Render loading and error states for the organization query. |
| Minor | `web/packages/agenta-settings-ui/src/access/DomainsSection.tsx:10` | /node_modules/ |
| Minor | `web/packages/agenta-settings-ui/src/access/DomainsSection.tsx:134` | Gate the `actions` prop on the available callbacks in the four shared settings views. |
| Major | `web/packages/agenta-settings-ui/src/access/SettingToggleRow.tsx:52` | Wrap the tooltip in `TooltipProvider` and make its trigger keyboard-accessible. |
| Major | `web/packages/agenta-settings-ui/src/access/SsoProvidersSection.tsx:29` | /node_modules/ |

### #5890 — Tools and Triggers into @agenta/settings-ui

| sev | file:line | claim |
|---|---|---|
| Major | `web/mobile/src/features/app/ContextSync.tsx:23` | Clear the active-user preference scope when authentication ends. |
| Major | `web/mobile/src/features/chat/Composer.tsx:91` | Guard `submit` against concurrent sends. |
| Minor | `web/oss/src/components/pages/settings/Triggers/Triggers.tsx:9` | The comment and the class list disagree about the section gap. |
| Major | `web/packages/agenta-entities/src/profile/index.ts:18` | Use the Fern users resource accessor. |
| Minor | `web/packages/agenta-settings-ui/src/tools/ConnectionsList.tsx:49` | Handle a rejected refresh request. |
| Major | `web/packages/agenta-settings-ui/src/tools/ConnectModal.tsx:110` | Popup poll intervals are never cleared on unmount. |
| Minor | `web/packages/agenta-settings-ui/src/tools/ConnectModal.tsx:133` | Report the create failure to the user. |
| Major | `web/packages/agenta-settings-ui/src/tools/GatewayToolsSection.tsx:155` | The new `confirm` prop is captured but missing from both dependency arrays. |
| Minor | `web/packages/agenta-settings-ui/src/tools/IntegrationGrid.tsx:50` | Give the search input an accessible name. |
| Minor | `web/packages/agenta-settings-ui/src/tools/IntegrationGrid.tsx:88` | Add a visible focus state to the integration card button. |
| Major | `web/packages/agenta-settings-ui/src/triggers/TriggerSchedulesSection.tsx:217` | Require confirmation before a schedule is deleted. |
| Major | `web/packages/agenta-settings-ui/src/triggers/TriggerSubscriptionsSection.tsx:114` | Add a confirmation step before delete and revoke. |

### #5892 — Audit Log, Usage & Billing, /m write paths

| sev | file:line | claim |
|---|---|---|
| Minor | `web/ee/src/components/pages/settings/Billing/Modals/AutoRenewalCancelModal/index.tsx:59` | Reset `inputOption` after close. |
| Major | `web/ee/src/components/pages/settings/Billing/Modals/PricingModal/index.tsx:70` | Keep checkout navigation in the user action. |
| Major | `web/mobile/src/features/settings/BillingTab.tsx:68` | `window.open` runs after an await, so mobile browsers can block it. |
| Major | `web/mobile/src/features/settings/CancelSubscriptionSheet.tsx:49` | The collected cancellation reason is discarded. |
| Major | `web/mobile/src/features/settings/MembersTab.tsx:58` | `canWrite` checks for identifiers, not for permission. |
| Major | `web/mobile/src/features/settings/ProjectsTab.tsx:71` | Clearing the rename field restores the old name. |
| Minor | `web/mobile/src/features/settings/settingsTabs.ts:60` | Wait for the router before resolving the tab. |
| Minor | `web/packages/agenta-settings-ui/src/audit/AuditEventDrawer.tsx:46` | Make the sheet width responsive. |
| Minor | `web/packages/agenta-settings-ui/src/audit/AuditLogPage.tsx:14` | Reduce the new multi-line implementation comments. |
| Major | `web/packages/agenta-settings-ui/src/billing/api.ts:71` | Replace raw axios calls with validated Fern resource accessors. |
| Minor | `web/packages/agenta-settings-ui/src/billing/PricingPlans.tsx:19` | Guard against a missing `base` amount. |
| Minor | `web/packages/agenta-settings-ui/src/billing/UsageProgressBar.tsx:63` | Do not warn when the limit is zero or unknown. |

### #5893 — DataTable at phone widths, /m writable, drill-in bridge

| sev | file:line | claim |
|---|---|---|
| Major | `web/mobile/src/features/settings/ProviderKeySheet.tsx:44` | Both edit sheets seed a form field from a stored credential. |
| Minor | `web/mobile/src/features/settings/SettingsScreen.tsx:134` | Reset pending confirmations when `tab` changes. |
| Minor | `web/mobile/src/features/settings/SettingsScreen.tsx:216` | Enforce the tools access gate at the render boundary. |
| Major | `web/mobile/src/features/settings/WebhookFormSheet.tsx:63` | Editing a subscription discards every event type except the first. |
| Major | `web/mobile/src/features/settings/WebhookFormSheet.tsx:109` | /node_modules/ |
| Minor | `web/mobile/src/features/settings/WebhookFormSheet.tsx:120` | Validate the endpoint URL before enabling submit. |
| Major | `web/mobile/src/features/settings/WebhooksTab.tsx:123` | The copy button reports success even when nothing was copied. |
| Minor | `web/packages/agenta-chat/package.json:43` | ' --glob '!package.json' \\\n  '(`@agenta/`(chat\|sessions)\|agenta-chat\|agenta-sessions)' \\\n  web/packages/agenta-home-ui web/packages/agenta-sessions-ui \|\| true\n\nprintf '%s\\n' 'Provider source imports:'\nrg -n --glob '!node_modules/ |
| Minor | `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentOperationsSections.tsx:30` | Replace the legacy color literal. |
| Major | `web/packages/agenta-shared/package.json:53` | Raise the Jotai peer floor to `>=2.9.0`. |
| Minor | `web/packages/agenta-ui/src/components/ui/data-table.tsx:169` | Reduce this source comment to one short line. |

### #5894 — the sessions-UX stack — docs

| sev | file:line | claim |
|---|---|---|
| Major | `docs/design/sessions-ux-stack/execute-stacked-prs.md:68` | Do not identify the session commits by position. |
| Major | `docs/design/sessions-ux-stack/execute-stacked-prs.md:131` | Avoid creating branches with names that already exist. |
| Major | `docs/design/sessions-ux-stack/execute-stacked-prs.md:107` | Make the TypeScript gate fail when `tsc` fails. |
| Major | `docs/design/sessions-ux-stack/execute-stacked-prs.md:144` | Replace the failing `gh pr edit` command. |
| Major | `docs/design/sessions-ux-stack/execute-stacked-prs.md:238` | Restore untracked files from `stash^3`. |
| Minor | `docs/design/sessions-ux-stack/handoff-audit-log-billing.md:75` | Fix the handoff validation gate. |
| Major | `docs/design/sessions-ux-stack/handoff-audit-log-billing.md:134` | Make both TypeScript validation gates fail closed. |
| Major | `docs/design/sessions-ux-stack/plan-settings-nav-takeover.md:66` | Keep a drawer trigger in takeover mode on phones. |
| Major | `docs/design/sessions-ux-stack/plan.md:98` | ",\n        "web/mobile/src/features/context/ |
| Major | `docs/design/sessions-ux-stack/restack-onto-112.md:20` | Mark this file as a historical plan or update it to the final state. |
| Major | `docs/design/sessions-ux-stack/restack-onto-112.md:57` | Correct the `pkg/settings-spine` commit list. |
| Major | `docs/design/sessions-ux-stack/restack-onto-112.md:89` | Use the same backup reference in both runbooks. |
| Major | `docs/design/sessions-ux-stack/restack-onto-112.md:101` | Create a new upper-lane commit instead of amending the lower lane. |
| Major | `docs/design/sessions-ux-stack/restack-onto-112.md:166` | Align the TypeScript validation package list. |

## Status — 2026-08-15

Worked on `obs/wp6-mobile-observability` in nine commits (`b47f736`..`f6c64d7`). Roughly 60 of
the 128 are addressed. Gates after each batch: OSS and EE `tsc` clean, mobile `tsc` + lint clean,
every touched package builds, lints and tests.

Two new regression tests, both verified to FAIL against the code they describe:
`SplitPaneSingleMount.render.test.tsx` (mount-once + no remount across the breakpoint) and
`rangePresets.test.ts` (the timezone skew, which fails with "expected 180 to be less than 2" —
180 minutes being exactly UTC+3).

### Closed as NOT a defect

| finding | why |
|---|---|
| #5875 `analytics.ts` failure_rate | Correct as a 0..1 fraction; the only consumer multiplies. Documented the unit rather than changing behaviour. |
| #5875 `types.ts` `enviornment` | The misspelled field is never produced or read. Deleted it and three equally dead siblings instead of renaming. |
| #5879 `AgentConversation` CopiedToast | Already fixed after the review ran. |
| #5876 lockfile | Present at the tip. Real only inside its own lane, which is the stack's deliberate red-intermediate shape. |
| #5893 `ProviderKeySheet` seeds a credential | The desktop's `ConfigureProviderModal` does exactly the same. Product-wide question about the vault returning plaintext, not a mobile regression — changing one surface would only create divergence. |
| #5892 cancellation reason discarded | `POST /billing/subscription/cancel` takes no reason, and the desktop discards it too (its own `TODO: add posthog here`). Needs a packaged analytics seam or a backend field; not a frontend fix. |

### Knowingly partial

- **#5892 MembersTab `canWrite`** — renamed to `scopeKnown`, which is what it tests. A real gate
  needs the desktop's `useWorkspacePermissions` (RBAC + entitlements), which lives in `oss/src`
  and has no packaged equivalent. Gating optimistically on org-owner would have removed the
  affordance from admins and from every OSS deployment, where the desktop allows all.

### Live verification (2026-08-15, EE dev stack)

Compile-clean on every route that carries these changes: `/w` and `/w/:w/p/:p/settings` on the
desktop, `settings` / `sessions` / `observability` / `agents` on `/m`. No module or type errors.

The analytics timezone bug was reproduced end to end, and the live probe **narrowed the claim**.
`POST /spans/analytics/query` echoes `2026-08-14T19:25:45Z` for BOTH the bare and the
`Z`-suffixed input, so the backend always read it as UTC — the queried window was never wrong,
and adding the designator carries no wire risk (200 either way).

What WAS wrong is entirely client-side. `fetchDashboardAnalytics` reparses `sorted` with a bare
`dayjs()` to derive `durationMin`, and in UTC+3 that read 1620 minutes for the 24-hour preset
instead of 1440. That figure picks the bucket width and the tick format:

| | duration | bucket | tick format |
|---|---|---|---|
| before | 1620 min | 60 min | `7_days` |
| after | 1440 min | 30 min | `24_hours` |

So the "24 hours" dashboard drew hour-wide bars with week-scale tick labels. Real, but a
rendering-granularity bug rather than the wrong data.

The two migrated endpoints were exercised against the live API with a minted account:
`GET /keys` returns the array shape `ApiKeyRecord` expects, and the live `/profile` payload
parses against the new zod schema (it carries `username`, which the schema requires — a mismatch
there would have logged every user out).

### Left

The bulk is #5894 (14 doc findings against the stack runbooks), #5889, and the remaining
query-atom moves in #5885. Nothing left is Critical.

## How to read this

- **Severity is CodeRabbit's, not mine.** It has been wrong in both directions today: a
  Critical that was already fixed, and a Major (`importNames` missing namespace imports on
  #5915) that an ESLint probe disproved outright.
- **Verify before fixing.** Of the reviews actioned on this stack so far, roughly one in
  four was stale or wrong. Reading the file first costs a minute and has repeatedly
  changed the answer.
- **Landing is the harder half.** These are 18 lanes of a linear 30-PR stack. A fix
  belongs on the lane that owns the file, and every lane above it has to be cascaded.
  Fixing on the tip is faster but leaves each PR's own review visibly unaddressed.
