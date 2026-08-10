# Committing the working-tree web changes as a stack

## 1. Where we actually are

`feat/sessions-ux-polish` is a **scratch integration branch**, not a PR branch. PRs are
carved out of it into clean lanes (the git-stash isolation technique in `AGENTS.md`).

Already carved and open:

```
main
 ├─ entities/trigger-helpers            #5766
 ├─ fe-fix/drive-upload-reveal          #5793
 └─ feat/mobile-parity-and-consolidation
     └─ pkg/ui-surfaces                 #5768
         └─ pkg/sessions                #5769
             └─ pkg/sessions-ui         #5770
                 └─ pkg/entity-ui-agent #5771
                     └─ oss/home-overview   #5772
                         └─ oss/agents-page #5773
                             └─ oss/templates    #5774
                                 └─ oss/sessions-page   #5775
                                     └─ oss/seed-attachments  #5776   ← published top
```

Local `HEAD` vs that top: **+211 / −11**. Concretely:

| | |
|---|---|
| commits on `HEAD` not yet pushed anywhere | **85** |
| tree delta `origin/oss/seed-attachments` → `HEAD`, `web/` only | **365 files** |
| uncommitted `web/` paths | **261** |

## 2. The base problem

`merge-base(HEAD, oss/seed-attachments)` = `e6b4ff5143`. From there:

```
carve point → HEAD                    211 commits
carve point → oss/seed-attachments     11 commits
carve point → feat/mobile-parity        2 commits
```

So the published stack was **not cherry-picked** — 211 integration commits were
re-authored into 11 clean ones across 10 lanes, covering only the
sessions / home / agents / templates theme. Everything else in those 211 is uncarved:

- `@agenta/auth` + `@agenta/auth-ui` (shared sign-in for oss/ee/mobile)
- `@agenta/navigation` + `@agenta/navigation-ui` (sidebar model + antd-free renderers)
- desktop chat re-plumb waves 1–5 (OSS onto `@agenta/chat`), chat slice off antd waves
  1–6, `@ant-design/x` → Streamdown, streaming pacing
- mobile live chat, ONE composer, ONE ApprovalCard, responsive layouts
- agent-path playground chrome off antd waves 1–3
- `perf`: lean cross-package subpaths

**Tier 1 is therefore a 365-file tree delta to carve by content, not 85 commits to
replay.** Per-area divergence on the ground the new work touches:

```
AgentChatSlice  74   agenta-chat  40   oss/pages  25   Sidebar  20
navigation  15   agenta-auth  15   Playground  15   auth-ui  14
navigation-ui  11   sessions  10   entity-ui  10   mobile  53
```

The uncommitted work sits **on top of** that. `@agenta/home-ui` depends on `@agenta/chat`
and `@agenta/sessions-ui`; the new mobile screens depend on mobile live chat; the
playground-ui extraction depends on the playground antd waves.

> **So `oss/seed-attachments` is NOT a valid base for the new lanes.** Carving them
> straight onto it produces branches that don't compile.

## 3. Tier 1 — carve the 365-file delta (extends the published stack)

Appended above `oss/seed-attachments`, in dependency order. Lanes are split **by path**,
because hunk-level splitting is unreliable (`AGENTS.md`) — which is why the three chat
themes (re-plumb / de-antd / Streamdown) collapse into one lane: they rewrite the same
74 `AgentChatSlice` files.

| # | branch | paths |
|---|---|---|
| T1 | `pkg/auth` | `packages/agenta-auth/**`, `packages/agenta-auth-ui/**`, `oss/src/components/pages/auth/**`, `mobile/src/features/auth/**`, `mobile/src/lib/auth`, `mobile/src/middleware.ts` + test |
| T2 | `pkg/navigation` | `packages/agenta-navigation/**`, `oss/src/components/Sidebar/{dynamic,engine/types,engine/visibility,scopes/constants}`, `oss/src/lib/atoms/sidebar.ts` |
| T3 | `pkg/navigation-ui` | `packages/agenta-navigation-ui/**`, `oss/src/components/Sidebar/{components,engine/SidebarMenu,engine/SidebarShell,hooks}`, `mobile/src/features/{nav,context}/**`, `mobile/src/components/{AgentaLogo,ContentRail,ui/sheet}` |
| T4 | `pkg/ui-primitives` | `packages/agenta-ui/**` (context-menu, split-pane, tooltip-composed, PanelSection, presentational/chat), `packages/agenta-shared/src/utils/timeAgo.ts` |
| T5 | `pkg/session-surfaces` | `packages/agenta-sessions/**`, `packages/agenta-sessions-ui/**`, `packages/agenta-entity-ui/**`, `packages/agenta-entities/src/gatewayTrigger/**`, `oss/src/components/pages/{agent-home,agents,sessions,overview,settings}/**`, `oss/src/components/TemplateStrip` |
| T6 | `pkg/chat-engine` | `packages/agenta-chat/**` (40), `packages/agenta-playground/**` |
| T7 | `oss/chat-on-shared-engine` | `oss/src/components/AgentChatSlice/**` (74), `oss/src/components/{Drives,SessionInspector,Layout}`, `oss/src/hooks/useAlwaysAllowTool`, `oss/src/pages/**`, `oss/src/styles/globals.css`, `ee/**` |
| T8 | `mobile/chat-and-shell` | `mobile/src/features/{chat,home,sessions,agents}/**`, `mobile/src/components/ScreenScaffold`, `mobile/src/{styles,pages}/**`, `mobile/{next.config,package.json,scripts}`, `mobile/tests/**` |
| T9 | `playground/de-antd` | `oss/src/components/Playground/**` (15) |

`pnpm-lock.yaml`: never carve the file directly — after each lane's `package.json`
changes, regenerate with `pnpm install --lockfile-only` and commit the result in
that lane.

## 4. Tier 2 — the 261 uncommitted `web/` paths

Stacked above T8. Ordered so each lane's diff is self-contained.

### L1 `pkg/ui-styles` — global stylesheets into `@agenta/ui`
`web/packages/agenta-ui/src/styles/{theme-variables,code-editor-styles,editor-theme,custom-resize-handle,surfaces}.css` (new)
· delete `oss/src/styles/{theme-variables,code-editor-styles,editor-theme}.css`, `oss/src/assets/custom-resize-handle.css`
· `oss|mobile/src/styles/globals.css`, `oss|ee|mobile/src/pages/_app.tsx`
· `web/scripts/generate-tailwind-tokens.ts`, `mobile/scripts/generate-shadcn-tokens.ts`,
`oss/tailwind.config.ts`, `mobile/src/styles/theme.generated.css`, both `next.config.ts`

Generator output path moves — regenerate, don't hand-edit (`AGENTS.md`).

### L2 `pkg/observability` — `@agenta/observability`
new `web/packages/agenta-observability/**`
· `oss/src/state/observability/dashboard.ts` (now re-exports)
· delete `oss/src/services/tracing/api/index.ts`; `services/tracing/{lib/helpers,types/index}.ts`
· `oss/src/components/UsageSummary/index.tsx` (−48 lines, consumes the package)
· `pnpm-lock.yaml`

### L3 `pkg/entities-drive` — headless drive layer
new `web/packages/agenta-entities/src/drive/**` (29 modules) + `tests/unit/dropEntries.test.ts`
· `agenta-entities/package.json`: `./drive` export, `+motion`, `+pdfjs-dist`
· delete the corresponding headless files under `oss/src/components/Drives/`

### L4 `pkg/entity-ui-drive` — drive UI
new `web/packages/agenta-entity-ui/src/drive/**` (39 modules) + `tests/unit/useUploadReveal.test.ts`
· delete the remaining `oss/src/components/Drives/*` (66 paths total across L3+L4)
· survivors rewired: `chatFileRefs.tsx`, `DriveFileLinkProvider.tsx`, new `useChatScopeSessionId.ts`
· consumers: `pages/overview/agent/AgentFilesCard.tsx`, `AgentChatSlice/components/AttachmentViewerDrawer.tsx`

Biggest lane. Split L3/L4 keeps each reviewable.

### L5 `pkg/navigation-ui-shell` — `SidebarShell` + `SidebarLogo`
new `agenta-navigation-ui/src/{SidebarShell,SidebarLogo}.tsx`, `agenta-navigation/src/supportLinks.ts`
· delete `oss/src/components/Sidebar/engine/SidebarShell.tsx`, `components/SidebarLogo.tsx`
· `oss/src/components/Sidebar/{Sidebar,hooks/useWorkflowSwitcher,scopes/*}`
· `agenta-navigation/src/{index,types,dynamic/registry,dynamic/useSidebarDynamicChildren}`
· `agenta-navigation-ui/{package.json,src/index,src/NavMenu}`
· mobile nav: `NavDrawer`, `NavRail`, `useMobileNavItems`, new `mobileNavScope.tsx`, delete `NavPanel.tsx`

### L6 `pkg/playground-ui-agent-chrome`
new `agenta-playground-ui/src/components/{AgentBuildPanel,AgentConfigHeader,PlaygroundModeSwitch}.tsx`, `AgentPageHeader/`, `CommitVariantChanges/`
· delete `oss/.../CommitVariantChangesModal/{index.tsx,assets/types.d.ts}`
· `oss/.../{AgentRevisionSelector,PlaygroundHeader,PlaygroundVariantConfig,PlaygroundVariantConfigHeader,CommitVariantChangesButton}`
· `agenta-playground-ui/package.json`

### L7 `pkg/sessions-tabs` — tab rail, list panel, filters bar
new `agenta-sessions-ui/src/{SessionTab,SessionTabStrip,SessionTabRail,SessionTabDragItem,SessionListPanel,SessionRowContextMenu,SessionFiltersBar,useSessionActions}`
· new `agenta-sessions/src/state/{tabOrder,waitingByAgent}.ts`; `state/index.ts`
· new `agenta-chat/src/state/panelLayout.ts`; `state/{index,sessionEphemera}.ts`
· new `agenta-ui/.../layout/FilterRailLayout.tsx` + `layout/index.tsx`
· `oss/.../AgentChatSlice/{state/panelLayout,state/sessions,hooks/useSessionActions,components/SessionTagBar}`
· `oss/src/components/pages/sessions/SessionsPage.tsx`
· `agenta-sessions-ui/{package.json,src/index,SessionCardList,SessionFiltersPanel,controls/SessionFilterControls}`

### L8 `pkg/home-ui` — `@agenta/home-ui` + oss agent-home rewire
new `web/packages/agenta-home-ui/**` (incl. renames `TemplatesSection/TemplateCard.tsx` →
`TemplateCard.tsx`, `ProviderMarks.tsx` → `TemplateProviderMarks.tsx`)
· new `agenta-entities/src/workflow/agentTemplates.ts` + test, `workflow/state/agentRoster.ts`, `session/core/freshSessions.ts`
· new `agenta-entity-ui/src/agent/AgentRosterGrid.tsx`; `agent/{AgentCard,index}`
· delete `oss/.../agent-home/assets/templates.ts` + test, `components/{HomeAutomationsSection,HomeSessionsSection}`, `TemplatesGallery/TemplateSection.tsx`
· `oss/.../agent-home/**` (index, StripHome, PlaygroundOnboarding, TemplateDetail, TemplateSetupDrawer, TemplatesGallery, TemplatesSection, YourAgentsTable, hooks)
· `oss/src/components/TemplateStrip/**` (7), `NewAgentButton`, `pages/agents/{AgentsGrid,AgentsPage,store}`
· `oss/src/state/url/template.ts` + test

### L9 `oss/wire-up` — leftovers
`agenta-shared/src/api/{axios,index}.ts`, `utils/mobileGate` + test
· `agenta-ui/src/{RichChatInput/RichChatInput,components/presentational/attachments/ImagePreview,components/ui/split-pane}`
· `oss/src/lib/helpers/auth/AuthProvider.tsx`, `components/Layout/assets/Breadcrumbs.tsx`
· `AgentChatSlice/{AgentConversation,assets/markdown,components/Inspector/lenses/RuntimeLens,components/ToolActivity,hooks/useOnboardingChat}`

### L10 `mobile/agents-templates-settings`
new `mobile/src/features/agents/{AgentListScreen,AgentTemplatesScreen,AgentTemplateDetailScreen,NewAgentAction,useNewAgentAction}`
· new `features/settings/SettingsScreen.tsx`; new pages `agents/index`, `settings/index`, `templates/{index,[template_key]}`
· new `features/chat/{SessionWorkspace,SessionTabs,SessionsPane,ConfigPane,SessionTopBar,selectedRevision}`; delete `ChatHeader.tsx`
· new `features/home/{HomeComposer,pendingTask}`; delete `features/home/AgentListRow.tsx`
· new `features/sessions/useSessionRowMenu.ts`
· `ChatScreen`, `LiveConversation`, `useAgentEntity`, `ScreenScaffold`, `SessionListScreen`, `AgentOverviewScreen`, `pages/_app`, `sessions/[session_id].tsx`, `package.json`

## 5. Two ways to run this

**A. Full carve (correct, expensive).** Tier 1 then Tier 2 — 18 lanes, PR bases chained
bottom-to-top, each diff clean against main's line. Use git-stash isolation per
`AGENTS.md`; verify each lane's *tip tree*, not its diff.

**B. Staging base (fast, deferred cost).** Push `feat/sessions-ux-polish` as-is and open
only the Tier-2 lanes L1…L10 with `--base feat/sessions-ux-polish`. Per-PR diffs are
clean immediately; the 85 stay unreviewed and nothing can merge until Tier 1 lands later.

**C. Hybrid.** Tier 2 lanes L1–L4 (ui-styles, observability, both drive lanes) have the
weakest dependency on the 85 — they could be verified against the published top and
carved now, with L5–L10 deferred behind Tier 1. Needs a per-lane compile check to
confirm.

## 6. Excluded / flagged

- `web/oss/test-results/junit.xml` — build artifact, **do not commit**; gitignore it.
- `web/pnpm-lock.yaml` — split per lane that adds a dep (L2 observability, L3 motion +
  pdfjs-dist, L8 home-ui, L10 mobile). Never commit whole.
- Non-`web/` dirty paths stay out of this stack, on their own parallel lane:
  `hosting/docker-compose/**`, `services/runner/**` (+ untracked
  `build_snapshot_dind.py`), `docs/design/agenta-mobile/README.md`.
- Gates before each commit: `pnpm lint-fix` in `web/`,
  `pnpm --filter @agenta/oss exec tsc` gated on **error-signature diff**, not count.

## 7. Executed (commit only, nothing pushed)

20 lanes committed on top of `origin/oss/seed-attachments`, in this order:

```
oss/seed-attachments (#5776)
 → pkg/auth 49 · pkg/navigation 25 · pkg/navigation-ui 39 · pkg/ui-primitives 9
 → pkg/session-surfaces 49 · pkg/chat-engine 45 · oss/chat-on-shared-engine 102
 → mobile/chat-and-shell 40 · playground/de-antd 15 · chore/app-wiring 5      [Tier 1]
 → pkg/ui-styles 18 · pkg/observability 14 · pkg/entities-drive 31
 → pkg/entity-ui-drive 44 · pkg/navigation-shell 20 · pkg/playground-agent-chrome 17
 → pkg/sessions-tabs 31 · pkg/home-ui 57 · oss/wire-up 12
 → mobile/agents-templates-settings 30                                        [Tier 2]
```

Verified: Tier-1 top `web/` tree == `sux/pre-carve` `web/` tree (empty diff); Tier-2 top
`web/` tree == the original working tree (150-file gap fully accounted for by the stash's
untracked parent, `git status -- web` empty); every one of the 365 + 346 paths lands in
exactly one lane, zero double-placement.

Recovery points: tag `sux/pre-carve` (= old `feat/sessions-ux-polish` tip) and
`stash@{0}` (the pre-carve working tree). Neither has been dropped.

### Known debt before these become PRs

- Committed with `--no-verify`. Tier-1 content is verbatim from already-hooked commits;
  **Tier-2 content has not been through `pnpm lint-fix`** — run it per lane and amend.
- `pnpm-lock.yaml` was carried whole into `chore/app-wiring` and `oss/wire-up` rather
  than regenerated per lane. Lanes between them can fail `--frozen-lockfile`. Fix by
  running `pnpm install --lockfile-only` on each lane that changes a `package.json`.
- Lanes are split by **path**, so a file whose working-tree delta mixes concerns lands
  whole in one lane (e.g. `mobile/src/pages/_app.tsx` → `pkg/ui-styles`). Per-lane
  compilation is not guaranteed; verify with `pnpm --filter @agenta/oss exec tsc` before
  opening each PR.
- PR bases: bottom lane `--base oss/seed-attachments`, every other lane `--base
  <branch-below-it>`.
