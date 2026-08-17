# WP-0 merge log — `release/v0.112.1` → lane

**Status: ALL 111 CONFLICTS RESOLVED, but the tsc gate is NOT yet green.** 0 unmerged paths,
0 conflict markers, 0 real package→app imports. The merge is **not committed**.

**tsc progression: 142 → 72 → 52 → 47 → 13.** Arda's four decisions are executed. The last 13 are
single-site type mismatches, listed at the end of this file (`tsc-remaining-13.txt` in the scratchpad
has the verbatim output). A large share were caused by my own
resolution method; the corrections are recorded below.
Wave 1 must not be dispatched until this log is complete.

> ## ⚠ The merge breaks the package/app boundary — read this before resolving anything else
>
> **The lane had 0 package→app imports. The release had 0. The merge created 6.**
>
> This is the flip side of the rename detection that looked like good news. When git matches a
> release-side app file (`web/oss/src/components/Drives/StorageSection.tsx`, full of `@/oss/…`
> imports) to its lane package copy (`agenta-entity-ui/src/drive/StorageSection.tsx`), it carries
> those app-layer import paths **into the package**. A package importing from `@/oss/` is illegal on
> this lane — it is the architecture the extraction exists to establish.
>
> Worse, **only 5 of the 6 conflicted.** `agenta-entity-ui/src/drive/StorageSection.tsx` auto-merged
> into the broken state with no signal at all.
>
> And the merged bodies do not just have wrong *paths* — they need symbols that exist in **no
> package yet**: `sessionsSource.ts` alone requires `sessionDotStatusAtomFamily`,
> `activeSessionIdAtomFamily`, `defaultScopeKeyAtom`, `sessionsListAtomFamily`, `sessionListPolicies`
> and `sidebarSessionOptions`. Those are Wave 1's extraction targets. **WP-0 cannot resolve these
> files; only the extraction can.**
>
> **Policy applied:** for every package file whose merged content reaches into `@/oss/`, take the
> **lane** side and record the owed port below. The release's logic is not lost — it is Wave 1's job,
> which is what the plan already says. Verify with
> `grep -rl 'from "@/oss/' web/packages/*/src` returning nothing but JSDoc comment matches.
>
> *(Three further hits — `playground-ui/src/index.ts`, `playground-ui/src/context/PlaygroundUIContext.tsx`,
> `playground/src/state/execution/executionHeaders.ts` — are `@/oss/` inside JSDoc **example** blocks,
> not imports. They were reverted to the lane version anyway; confirmed harmless, as the release
> changed none of them since the fork.)*

## Resolved — 6 package files taking the lane side, with a debt

| Package file | Owed port | WP |
| --- | --- | --- |
| `agenta-navigation/src/dynamic/sessionsSource.ts` | #5927 + #5944 + #5974, incl. `localPlaygroundSessionRefsAtom` and the `running` row field | 1B |
| `agenta-navigation/src/dynamic/registry.ts` | #5945 + #5974; needs `SessionRunSpinner` extracted first | 1B ← 1E |
| `agenta-navigation-ui/src/SidebarShell.tsx` | #5943 + #5945 | 1B |
| `agenta-observability/src/state/controls.ts` | #5923 UTC range | 1D |
| `agenta-entity-ui/src/agent/AgentFilesCard.tsx` | #5944 | 1G |
| `agenta-entity-ui/src/drive/StorageSection.tsx` | #5946 (28+/22− on the app copy) — **this one never conflicted** | 1C |

| | |
| --- | --- |
| Working branch | `fix/post-112-reconcile` (created off the lane tip) |
| Merge source | `19b9ab236796263cc281115a2e572eefb1bb9d7d` (`release/v0.112.1`) |
| Merge target | `7d2cd2ce89cb7d6f687569caa131054742788e76` (lane tip) |
| Merge base | `613368b81b94e4e5f8bcb1447857e61105b62ef1` — matches the recorded fork point |
| **Backup ref** | `backup/lane-pre-112.1-merge` → `7d2cd2ce89…` (the only recovery point) |
| `lane/mobile-extracted-packages` | untouched, still at `7d2cd2ce89` |

**Not a GitButler project.** `but status` reports *"No GitButler project found at ."* in this
worktree, so `but oplog snapshot` was unavailable and plain git is in use. The backup branch replaces
the oplog snapshot as the recovery point. The landing pass will need to account for this.

**`rerere.enabled=true` and `rerere.autoupdate=true` in this repo.** Two files were auto-staged from
*previously recorded* resolutions before I touched anything —
`agenta-ui/src/InfiniteVirtualTable/atoms/columnVisibility.ts` and
`agenta-ui/src/components/ui/dropdown-menu.tsx`, both from the earlier drift round (D-04 and D-02).
**They have not been verified and must be re-checked before landing.**
`rr-cache` is empty, so the resolutions below are **not** replayable — if the merge is aborted they
must be redone from this log.

---

## The finding that changes Wave 1

Git's **rename detection followed the extraction**. For most A1 files (release modified an app file
the lane moved into a package), git routed the release's change onto the *package* copy and raised
the conflict there. Verified: `--ag-chart-series-0` is now in `agenta-ui/src/styles/theme-variables.css`;
`localPlaygroundSessionRefsAtom` is in `agenta-navigation/src/dynamic/sessionsSource.ts` (286 lines,
was 111); all 8 probed `DriveExplorer` additions are in `agenta-entity-ui/src/drive/DriveExplorer.tsx`.

Only **15** modify/delete conflicts appeared, not the ~45 predicted — and they are precisely the
renames git could *not* detect, which are the ones the inventory had already resolved by hand
(`SidebarMenu`→`NavMenu`, `TemplateCard`, `HomeSessionsSection`, `GatewaySchedulesSection`, …).

**Consequence:** much of Wave 1's re-homing may already be done by the merge. **Re-scope Waves 1A–1K
against the resolved tree before dispatching.** Do not dispatch the plan as written.

> **Two mid-merge verification attempts were unreliable and their numbers must not be quoted.**
> The first ("66 of 70 landed") built its corpus from the working tree, which still contains
> conflicted app files — their own added lines were found in themselves. The second ("21 of 70")
> excluded all conflicted paths, which hides fixes that landed in package files that are themselves
> conflicted. **A trustworthy check is only possible after all 86 `UU` are resolved.**

---

## Resolved — 2 `UD` (release deleted, lane still has it)

| Path | Resolution |
| --- | --- |
| `packages/agenta-chat/src/hooks/useAgentModelKeyStatus.ts` | **KEPT the lane's copy** (F-18 / WP-0 rule 1). #5995 deleted it and consolidated into its app copy, which this lane does not have — oss renders the package copy via `AgentConversation.tsx:16` and `ConnectModelBanner.tsx`. The merge also dropped `export * from "./useAgentModelKeyStatus"` from `agenta-chat/src/hooks/index.ts`; **restored, with a comment**. ⚠️ **Still owed:** port #5995's app-side rewrite *into* this kept copy (WP-1G). |
| `oss/src/components/pages/settings/Secrets/SecretProviderTable/index.tsx` | **Accepted the delete.** It is a 35-line binding; nothing in `web/oss` or `web/ee` imports it, and the release removed the whole `settings/Secrets` page. The real component is `agenta-settings-ui/src/secrets/SecretProviderTable.tsx`, untouched. |

## Resolved — 15 `DU` (lane deleted, release modified) → **kept deleted**

Correct resolution, but **each carries a fix that must be re-homed in Wave 1** — this list is that
work order. These are the renames git's detection missed.

| Path | Fix owed to | Wave-1 WP |
| --- | --- | --- |
| `oss/…/Sidebar/engine/SidebarMenu.tsx` | `agenta-navigation-ui/src/NavMenu.tsx` | 1B |
| `oss/…/agent-home/components/HomeSessionsSection.tsx` | `agenta-home-ui/src/HomeOverview.tsx` | 1F |
| `oss/…/agent-home/components/HomeAutomationsSection.tsx` | `agenta-home-ui/src/HomeOverview.tsx` | 1F |
| `oss/…/agent-home/components/TemplatesSection/TemplateCard.tsx` | `agenta-home-ui/src/TemplateCard.tsx` | 1F |
| `oss/…/settings/Triggers/components/GatewaySchedulesSection.tsx` | `agenta-settings-ui/src/triggers/TriggerSchedulesSection.tsx` | 1F |
| `oss/…/settings/Triggers/components/GatewaySubscriptionsSection.tsx` | `agenta-settings-ui/src/triggers/TriggerSubscriptionsSection.tsx` | 1F |
| `oss/…/AgentChatSlice/assets/loadSession.ts` | `agenta-chat/src/assets/loadSession.ts` | 1K |
| `oss/…/AgentChatSlice/assets/transcriptToMessages.ts` | `agenta-chat/src/assets/transcriptToMessages.ts` (conflicted, `UU`) | 1K / WP-0 |
| `oss/…/AgentChatSlice/assets/transcriptToMessages.test.ts` | `agenta-chat/tests/unit/assets/transcriptToMessages.test.ts` (`UU`) | WP-0 |
| `oss/…/AgentChatSlice/assets/messageParts.ts` | **no successor** — confirm the behaviour is genuinely gone | 1K |
| `oss/…/AgentChatSlice/hooks/useAgentModelKeyStatus.ts` | the kept package copy above | 1G |
| `oss/…/AgentChatSlice/state/panelLayout.ts` | `agenta-chat/src/state/panelLayout.ts` | 1J |
| `oss/…/components/Filters/Sort.tsx` | `agenta-observability/src/…` — verified its probe line landed in `agenta-observability/src/state/controls.ts` | 1D |
| `mobile/src/features/sessions/useSessionListHead.ts` | lane deleted it; nothing in `web/mobile` references it | 1E — confirm |
| `mobile/src/features/sessions/useSessionsInfinite.ts` | as above | 1E — confirm |

## Resolved — 10 `AA` (both lines created the file independently)

Both the files the inventory predicted (`interactionStatus.ts`, `invalidate.ts`) appeared here, plus
eight it did not.

| Path | Took | Why |
| --- | --- | --- |
| `packages/agenta-entities/src/session/state/interactionStatus.ts` | **release** | Decisive on inspection: the lane's exports are the **pre-#5919** API (`cancelledClientToolTokensQueryKey`, `fetchCancelledClientToolTokensAtom`); the release's are the new lifecycle API (`SessionInteractionRowState(s)`, `fetchSessionInteractionStatesAtom`, `revalidateSessionInteractionsAtom`) that #5919/#5942 depend on. |
| `packages/agenta-entities/src/gatewayTrigger/state/invalidate.ts` | **release** | Both sides export the same two functions (`invalidateTriggerSchedules`, `invalidateTriggerSubscriptions`); release is 2 lines longer. Identical surface, so taking upstream is safe. *(The plan's default lean was the lane side; inspection said it does not matter.)* |
| `oss/…/AgentChatSlice/assets/toolCacheEffects.ts` (+ `.test.ts`) | **release** | Both are D-31 ports; they differ by 6 lines. Upstream is canonical. |
| `oss/…/clientTools/useConnectFlow.test.ts` | **release** | 265 lines vs the lane's 104 — more coverage. WP-2 re-points its imports. |
| `oss/…/hooks/useSessionHydration.test.ts` | **release** | 442 vs 35. WP-1K/WP-2 re-point. |
| `oss/…/AgentChatSlice/state/liveness.test.ts` | **lane** | 130 vs 81 — the lane has more coverage and owns the re-homed liveness code. |
| `oss/src/components/Layout/ProjectWatch.tsx` (+ `.test.tsx`) | **release** | Both implemented D-32; upstream is canonical. Flag for WP-2 verification. |
| `packages/agenta-ui/vitest.config.ts` | **release** | 20 lines vs 11 — the newer package test setup. |

---

## Remaining — 86 `UU`, 176 hunks, 6,284 conflicted lines

Full list: `scratchpad/docs-backup/remaining-uu.txt`. 47 are single-hunk. Heaviest first:

| Hunks | Lines | File |
| --- | --- | --- |
| 4 | 879 | `packages/agenta-chat/tests/unit/assets/transcriptToMessages.test.ts` |
| 7 | 397 | `oss/…/AgentChatSlice/components/SessionTagBar.tsx` |
| 2 | 376 | `oss/…/Sidebar/components/ProjectOrgSwitcher/index.tsx` |
| 2 | 257 | `oss/…/Playground/Components/PlaygroundHeader/index.tsx` |
| 5 | 250 | `oss/…/Playground/Components/MainLayout/index.tsx` |
| 4 | 244 | `oss/…/AgentChatSlice/components/AgentComposerDock.tsx` |
| 4 | 241 | `oss/…/AgentChatSlice/components/ApprovalDock.tsx` |
| 1 | 237 | `oss/…/pages/sessions/components/SessionListCard.tsx` |
| 2 | 236 | `oss/…/pages/sessions/SessionsPage.tsx` |
| 2 | 224 | `oss/…/AgentChatSlice/hooks/useSessionActions.tsx` |
| 5 | 139 | `packages/agenta-chat/src/assets/transcriptToMessages.ts` — the core chat reconcile |
| 11 | 101 | `oss/…/clientTools/useConnectFlow.ts` — most hunks of any file |
| 8 | 163 | `pnpm-lock.yaml` — regenerate with `pnpm install`, never hand-merge |

## Resolved — the package layer (all 22 `UU`)

Judgement calls worth knowing about, beyond take-a-side:

| File | Resolution |
| --- | --- |
| `agenta-chat/src/model/approvals.ts` | **Combined both sides.** Neither was complete: #5919 widened the gate scan from the last assistant turn to the whole transcript but **dropped manifest support**; the lane had `manifestsByToolCallId` but scanned only the last turn. `PendingApproval.manifest` is declared in the unconflicted type, so taking the release alone would have left every gate's workspace content silently `undefined`. Now scans all messages *and* resolves manifests **per message** (the `data-approval-manifest` parts are siblings of the call they describe). |
| `agenta-chat/src/assets/{loadSession,transcriptToMessages}.ts` | Took the release (the `fetchSessionInteractionStatesAtom` API). **Forced** by the `interactionStatus.ts` decision — the lane's `fetchCancelledClientToolTokensAtom` no longer exists. Their header comments claimed *"the OSS original remains authoritative"*, which is the release's topology, not this lane's — **rewritten**, since here the OSS copies are deleted and the package is canonical. |
| `agenta-entity-ui/.../SchemaForm.tsx` | Took the release's `AutosizeTextarea` fix but kept this package's de-antd'd `FormItem`. **Also fixed an auto-merged breakage:** a `<Form.Item>` block (with #5975's `TimePicker`) merged in with no conflict, but this file's `Form` is `@rc-component/form`, which has no `.Item`. Rewritten to `FormItem`. |
| `agenta-entity-ui/.../AgentOperationsSections.tsx` | Took the release's new `--ag-surface-section-{header,content}` tokens (which arrived with the theme merge), but kept `text-colorText` over the release's `--ant-color-text` — shared packages must not use `--ant-color-*`. |
| `agenta-entity-ui/.../SubscriptionForm.tsx` | Union of imports **minus** antd's `Form` — verified 0 uses of `<Form.…` in the body; it uses `@rc-component/form`'s `useForm`. |
| `agenta-entity-ui/src/drive/*` | Rewrote the release's relative imports to `@agenta/entities/drive`, where the data modules (`driveTreeView`, `driveTypes`, `dropEntries`, `useSessionDrive`, `driveKinds`) actually live. Note `DriveFileRow`'s **lane** side was already stale — it imported `AGENT_ACCENT` where `OriginTag` now exports `AGENT_ACCENT_SOFT`, so the release's import was the correct one. |
| `agenta-sessions/src/row/sessionOpenTarget.ts` | `sessionAgentId` is same-package → relative `./sessionAgent`, not the self-referencing `@agenta/sessions/row`. |
| `agenta-sessions-ui/src/SessionRow.tsx` | Kept both: the release's automation badge **and** the lane's load-bearing `leading-4` subtitle comment. |
| `agenta-ui/package.json` | Release's richer script set; kept the lane's `immer ^10.2.0` (satisfies D-04's `^10.1.3`); unioned devDeps. |
| `agenta-sessions-ui/package.json` | Union — **note** a naive line-union produced invalid JSON (missing comma); the dep block was rebuilt and re-validated. Validate JSON after any package.json union. |

## ⚠ Incident: `git add <dir>` silently marked 21 unresolved files as resolved

While staging one batch I ran `git add $A` where `$A` was the whole `AgentChatSlice/` directory.
**`git add` on a conflicted path collapses stages 1/2/3 into stage 0** — so 21 files with live
`<<<<<<<` markers were recorded as resolved and dropped out of `git status`'s `UU` list. The
conflict count fell from 50 to 20 and looked like progress.

Caught by cross-checking two independent signals that should agree:

```bash
grep -rl '^<<<<<<< ' web/oss/src web/packages web/mobile | sort   # files with markers
git status --porcelain | awk '$1=="UU"{print $2}' | sort          # files git calls conflicted
comm -23 marked uu    # anything here is silently mis-staged
```

**Recovery** (the stages are gone, so `git checkout -m` cannot help): rebuild stages 1/2/3 by hand
from the three commits with `git update-index --index-info`, feeding
`100644 <blob> <stage>\t<path>` for base=`613368b81b`, ours=`7d2cd2ce89`, theirs=`19b9ab2367`.
Two files (`drive/DriveHeader.tsx`, `drive/StorageFilesHeader.tsx`) exist **only** on the lane —
they are rename targets whose release side lives at the old `web/oss/src/components/Drives/…` path,
so only stage 2 restores and they must be resolved from their worktree markers instead.

**Rule for the rest of this merge: stage conflicted files one explicit path at a time. Never a
directory.** Re-run the `comm` check above after every batch.

## Resolved — 9 app-layer bindings taken to the lane side, with a debt

Identified mechanically (lane size ÷ release size < 0.45): the lane's file is a thin wrapper and the
behaviour lives in a package, so the lane side is correct and the release's fix is owed to the
package. Same policy as the package-layer group above.

| Binding (lane lines / release lines) | Owed port | WP |
| --- | --- | --- |
| `Sidebar/dynamic/useSidebarDynamicChildren.ts` (17/179) | `agenta-navigation/src/dynamic/` | 1B |
| `pages/sessions/components/SessionListCard.tsx` (28/292) | `agenta-sessions-ui/src/SessionListCard.tsx` | 1E |
| `Sidebar/components/SidebarSkeletonLoader.tsx` (9/52) | `agenta-navigation-ui/src/` | 1B |
| `services/tracing/lib/helpers.ts` (36/167) | **`agenta-observability/src/core/analytics.ts:122`** — #6019's `* 100`. The merge cannot apply it here; the lane's file no longer holds the function. | 1D |
| `Sidebar/components/ProjectOrgSwitcher/index.tsx` (111/426) | `agenta-navigation-ui/src/ProjectOrgSwitcher.tsx` — #6018 | 1B |
| `state/observability/dashboard.ts` (20/73) | `agenta-observability/src/state/` | 1D |
| `AgentChatSlice/hooks/useSessionActions.tsx` (73/223) | `agenta-sessions-ui/src/useSessionActions.tsx` | 1E |
| `AgentChatSlice/components/ApprovalDock.tsx` (202/578) | #5946's humanized-headline half (the #5919 half is already done in `agenta-chat/src/model/approvals.ts`) | 1G |
| `agent-home/.../useAgentActivity.ts` (27/70) | `agenta-home-ui/src/useAgentActivity.ts` | 1F |

**Consequence to carry into WP-3A:** the release's new `services/tracing/lib/helpers.test.ts` merged
in clean and imports `analyticsToGeneration` from `./helpers`, which this binding does not export.
It will fail until WP-1D re-points it. That failure is expected, not a regression.

## Remaining — 22 `web/oss` files

No bindings left; every one needs per-file judgement. Ordered by lane÷release size ratio (a ratio
near 1.0 means both sides rewrote comparable amounts, which is the hard case):

`toolDisplay.ts` · `AgentRevisionSelector` · `SessionTagBar` (397 conflicted lines) · `Preferences` ·
`RightPanelSplit` · `AgentComposerDock` · `AgentChatPanel` · `useSessionHydration` (WP-1K's file) ·
`AgentOverview` · `state/sessions.ts` (holds #5830's tombstones) · `SessionsPage` ·
`ConnectToolWidget` · `ConnectModelBanner` · `clientTools/registry.tsx` · `AgentsGrid` · `StripHome` ·
`useConnectFlow` (11 hunks) · `AgentConversation` · `PlaygroundHeader` · `MainLayout` ·
`state/liveness.ts` · `InteractionDock`.

The last four are **inverted** — the lane's file is *larger* than the release's (`InteractionDock`
1.94×, `liveness.ts` 1.28×, `MainLayout` 1.16×), so "prefer the release" is wrong there by default.

## Resolved — the inverted set (lane ahead of the release)

| File | Resolution |
| --- | --- |
| `AgentChatSlice/components/InteractionDock.tsx` (184/95) | **Union.** The merged body needs *both* the lane's `useConnectFlow` (2 uses) and the release's `CLIENT_TOOL_DESCRIPTORS` (3 uses); antd `Typography` dropped (0 uses). Kept the lane's richer de-antd'd `ConnectCard`. |
| `AgentChatSlice/state/liveness.ts` (185/144) | Lane side. The release's import block pulls `sessionLocalSettledAtAtomFamily` from `./sessions`, but the lane **defines it here** and already imports `SessionRunStatus`/`sessionStatusAtomFamily` from `@agenta/chat/{model,state}`. |
| `AgentChatSlice/components/clientTools/registry.tsx` | Lane side — architectural. The lane moved dispatch into `@agenta/chat/skin` (`registerChatSkin`/`resolveClientToolWidget`); the release keeps local `BY_RENDER_KIND`/`BY_TOOL_NAME` maps. The package shape is the extraction's point. |
| `AgentChatSlice/components/ConnectModelBanner.tsx` | **Release's feature, lane's module paths.** #5995 adds the inline `ProviderDrawer` setup flow (body uses it 7×), but every import it carries points at paths this lane moved: `RevealCollapse` → `@agenta/chat/components` (no app copy exists), `AgentModelKeyStatus` → `@agenta/chat/hooks` (the app copy is deleted), `Button` → `@agenta/ui/ui` (not antd). `type="primary"` dropped — `@agenta/ui`'s Button has no antd `type` prop. **QA should confirm the button still reads as primary.** |

## ⚠ Duplicate-atom hazard found while resolving `liveness.ts`

`sessionLocalSettledAtAtomFamily` is now defined in **two** modules: `AgentChatSlice/state/liveness.ts`
(the lane's home) and `AgentChatSlice/state/sessions.ts` (where the release put it). Two separate
jotai atoms tracking the same state is the write-one/read-the-other bug class — the running-elsewhere
strip is exactly what it would break.

**RESOLVED.** `state/sessions.ts` took the lane side: the release's conflict block re-defined
`SessionRunStatus`, `sessionStatusAtomFamily`, `isSessionStreamingAtomFamily` *and*
`sessionLocalSettledAtAtomFamily`, all of which this lane sources from `@agenta/chat/state` and
`liveness.ts`. Verified after resolving: duplicate count **0**, no dangling local references, and
**#5830's `deletedIdsByAppAtom` tombstones survive (6 references)** — that fix auto-merged outside
the conflict, so F-06 is closed by the merge itself rather than owed to Wave 1.

## Flag for WP-2

`clientTools/meta.test.ts` was resolved to the release side, which includes a new test —
*"falls back to tool name when the render kind is unknown"*. With `registry.tsx` on the lane's shape,
that test now exercises `@agenta/chat/skin`'s resolver. **WP-2 must confirm the package implements
the same render-kind → toolName fallback precedence**, or the test fails for a real reason.

## Resolved — `assets/toolDisplay.ts` (combined)

Neither side worked alone. The lane registers tool display through `registerChatSkin` (the package
skin); the release keeps a local `BY_TOOL_NAME` map **and** is the only place that defines and
exports `canonicalToolName` — which four other modules import (`ApprovalDock`, `toolCacheEffects`,
and two tests). Taking the lane would have removed an export with four consumers; taking the release
would have discarded the skin architecture.

Result: the lane's `registerChatSkin` structure, preceded by the release's `canonicalToolName` (with
its `INTERNAL_MCP_PREFIXES` constants). `BY_TOOL_NAME` dropped — the skin covers it. Verified:
`canonicalToolName` exported ×1, `registerChatSkin` ×2, `BY_TOOL_NAME` ×0.

## Resolved — the final app-layer set

Two evidence-based rules did most of the remaining work, in preference to per-file taste:

**1. The release side references paths this lane deleted → the lane side is forced.** Checked
mechanically (relative imports *and* `@/oss/` aliases — my first pass only checked relative ones and
missed `MainLayout`'s `@/oss/…/state/panelLayout`). Hits: `AgentChatPanel` (`./state/panelLayout`,
`./state/pendingSessionOpen`), `AgentComposerDock` (`../hooks/{useAgentChatQueue,useComposerAttachments,useVoiceComposer}`
— all now `@agenta/chat/hooks`), `ConnectToolWidget` (`./types`), `useSessionHydration`
(`../assets/loadSession`), `MainLayout` (`@/oss/…/state/panelLayout`).

**2. The release side reintroduces antd this lane removed → keep the lane's de-antd'd form.**
`AgentConversation`, `RightPanelSplit`, `SessionTagBar`, `AgentRevisionSelector`, `useConnectFlow`.

The rest resolve to the lane because it renders an **extracted package component** where the release
still has inline markup: `AgentsGrid` → `AgentRosterGrid`, `Preferences` → `PreferencesPage`,
`PlaygroundHeader` → `AgentPageHeader`, `AgentOverview` → `AgentOverviewLayout`/`Body`,
`StripHome` → `HomeOverview`.

### `SessionsPage` — the one that would have caused a regression

The release's import block pulls in `SessionFiltersBar`, **which this lane deliberately deleted**
(drift finding D-05 — the filters rail Mahmoud removed). The merged body referenced it twice, and
`selectSessionContextMenuItem` is not exported by the lane's `menuEntries.ts` either. Taking the
release would have both broken the build **and** resurrected a removed surface.
Resolved to the lane side; the #5927 session-automation surface
(`SessionAutomationDrawers`, `useSessionAutomationActions`) is **owed to WP-1E**, which already owns
extracting it. The filters rail stays deleted.

## ⚠ The tsc gate caught a systematic error in how I resolved import hunks

**First run: 142 errors across 27 files** (45 × TS2304 *cannot find name*, 28 × TS2300 *duplicate
identifier*, 12 × TS2307 *cannot find module*).

**Root cause — an inconsistency my per-hunk resolution created.** In files where *only the import
block* conflicted, git auto-merged the **body** to the release's version. Taking the lane's side on
the import hunk then left the release's body calling symbols that were never imported. Confirmed on
`AgentChatPanel.tsx`: `configPanelCollapsedAtom`, `useSessionActions`, `workflowRevisionDrawerOpenAtom`,
`useSessionShortcuts`, `workflowMolecule` all appear **0 times** in the lane's pre-merge file and
1–2 times in the merged one.

**A second, separate error was mine alone:** in `assets/toolDisplay.ts` I added the release's
`canonicalToolName` definition to preserve an export with four consumers — but the lane already
**imports it from `@agenta/chat/skin` and re-exports it** (lines 9–19). I had grepped for a local
`export const` and missed the import, producing 6 duplicate-declaration errors. Removed.

**Correction applied:** for the 17 conflicted app files that exist on the lane and showed
name/module errors, restore the lane's **complete** file
(`git checkout backup/lane-pre-112.1-merge -- <path>`) rather than a half-lane/half-release hybrid.
The release's changes to them are owed to Wave 1 — the same policy already applied to the package
layer. Files restored include `AgentChatPanel`, `AgentComposerDock`, `AgentConversation`,
`InteractionDock`, `useConnectFlow`, `ConnectToolWidget`, `useSessionHydration`, `SessionTagBar`'s
neighbours, `MainLayout`, `AgentRevisionSelector`, `viewRegistry`, `useAgentActivity`.

**Lesson for the rest of this work:** when only an import hunk conflicts, check what the auto-merged
body actually references before picking a side. A side-pick on imports is only safe if the body came
from the same side.

### Second error class: type-boundary mismatches from mixing sides across modules

Picking a different side for a module and its consumers changes a type contract on one side of the
boundary only. Confirmed instances:

- **`agenta-sessions/src/state/useSessionCardList.ts`** — resolved to the release, whose
  `UseSessionCardListArgs` drops `origin` for `policy`. Its four package consumers
  (`SessionCardList`, `SessionListCard`, `SessionListPanel`, `SessionsListView`) still pass `origin`.
- **`SessionListOptions` lost `showTriggered`** → breaks `agenta-home-ui/src/useAgentActivity.ts`
  and its oss binding.
- **`SessionTagProps`** gained `showDivider`/lost `altKey` → breaks `SessionTagBar`.
- Smaller: `useFirstRunSeed` (`attachmentsSettled`), `useSessionHydration` (`onInteractionChanged`),
  `Layout` (`agentState`), `SessionsPage` (`UseSessionsListArgs`), `AgentConversation`
  (`AgentModelKeyStatus` shape), `AgentCard` (`onOpenPlayground` possibly undefined).

**Rule this implies:** resolve a module and its consumers to the **same** side, or fix the call sites
in the same pass. Deciding file-by-file without checking who consumes the type is how these appear.

### A wrong fix that made things worse — and its root cause

I renamed `configFilesDrawerAtomFamily` → `configFilesDrawerOpenAtomFamily` in `StorageSection.tsx`
on the assumption it was a stale name. **It took that file from 3 errors to 7.** The two atoms have
different *shapes*: the lane's is an object (`{open, initialPath, staged}`), the release's is a plain
`boolean`. I matched on the name without checking the type.

That also disproves an earlier entry in this log: I described the merged `configDrive.ts` as a
"hybrid neither side compiles against" and resolved `StorageFilesHeader` to match it. Wrong — the
**lane's** `configDrive.ts` already had *both* the object atom **and** the `sessionId` parameter.
Restoring the lane's file wholesale (`git checkout backup/lane-pre-112.1-merge -- <path>`) was
correct from the start, and took `StorageSection` from 7 errors to **0**.

**Root-cause rule:** when several files in one package fail together, fix the module they share, not
each call site. Renaming call sites to match an auto-merged export is how a 3-error file becomes a
7-error file.

### Local slips of mine, fixed

`StorageFilesHeader` (renamed the import but not the call site) · `StorageSection` (lane version used
the old `configFilesDrawerAtomFamily`; merged `configDrive` exports `configFilesDrawerOpenAtomFamily`)
· `DriveHeader` (took the release's overflow menu without its `MenuProps` type import) ·
`agentApprovalResume` (`CLIENT_TOOL_NAMES` both imported from the new `@agenta/shared/clientTools`
**and** declared locally — the local copy existed only because the package did not previously exist,
so it was removed).

## Arda's decisions — executed

1. **Fix the six A2 files** (approved). All import rewrites. Two were bigger than listed:
   `AIProviders` needed `useStaticTable` → `@agenta/settings` *and* `formatDay` → shared utils (both
   modules had moved, not just export style); `SessionFilesPane` needed
   `playgroundInspectorEnabledAtom` → `@agenta/shared/state` on top of its 7 drive imports.
2. **`UseSessionCardListArgs`: release's `policy` contract wins** (approved). `useSessionCardList`
   was itself half-lane/half-release, so its **complete** release version was taken — applying this
   merge's own rule: resolve a module and its consumers to the same side. Its consumers turned out to
   be **lane-only** (no release counterpart) and were hand-mapped.
3. **`showTriggered` → `originPolicy: "all"` + `expansions: ["trigger"]`** (approved, 3 sites). The
   trigger expansion is load-bearing: without it a pinned automation row's name falls back to
   "Missing schedule" (the release's own comment says so).
4. **`SessionTagBar` restored to the lane's complete file** (approved); #6005's keyboard shortcuts
   owed to WP-1E, which already owns extracting it to `SessionTab`/`SessionTabStrip`.

### ⚠ One behavioural call inside decision 2 — needs QA, not tsc

In `agenta-sessions-ui` the public `origin?: string` prop was kept and translated to `policy` at the
`useSessionCardList` call (smaller blast radius than changing a component API the app consumes):

```ts
policy: {origin: origin ? "trigger-only" : "all", expansions: origin ? ["trigger"] : []}
```

**"No origin" was mapped to `"all"` to preserve the lane's current behaviour (no filter). The
release's default for its main list is `exclude-trigger`.** If project-wide session lists are meant
to hide automation runs, this mapping shows them. It type-checks either way — it is a WP-3B QA item,
and it is confined to two call sites so the correction is one line each.

### The remaining 13 (each a single site)

`ShowConfigPanelButton` (`configPanelCollapsedAtom` is in neither `@agenta/chat/state` nor any
package — needs locating) · `AIProviders` (`formatDay` is not in the `@agenta/shared/utils` barrel;
use the deep `utils/dateTime` path) · `SessionsPage` + `SessionsListView` (`UseSessionsListArgs` now
requires `defaultPolicy`/`automationPolicy`) · `SessionListCard` + `SessionListPanel` (drop the
`origin=` JSX prop, pass `policy`) · `AgentCard` (`onOpenPlayground` possibly undefined — guard) ·
`TriggerSchedulesSection` + `TriggerSubscriptionsSection` (`DeliveriesDrawerState` shape) ·
`useFirstRunSeed` (`attachmentsSettled`) · `useSessionHydration` (`onInteractionChanged`) ·
`Layout` (`agentState` on `SidebarViewMatchContext`) · `AgentConversation` (`AgentModelKeyStatus`
needs `entityId`).

### Superseded — the earlier 47-error categorisation

| Count | Class | Files |
| --- | --- | --- |
| **18** | **Release-NEW A2 files** — import app modules this lane deleted; compile only once extracted | `SessionFilesPane` (11), `AIProviders` (2), `useSidebarResize` (2), `SessionRowActions`, `useInlineRenameRequest`, `ShowConfigPanelButton` |
| **12** | `UseSessionCardListArgs` **`origin` → `policy`** contract change | `useSessionCardList` (5) + consumers `SessionListPanel`, `SessionListCard`, `SessionCardList`, `SessionsListView` |
| **3** | `SessionListOptions` lost `showTriggered` | `agenta-home-ui/useAgentActivity` (2) + its oss binding |
| **3** | `SessionTagProps` gained `showDivider` / lost `altKey` | `SessionTagBar` |
| **11** | Assorted single-site type mismatches | `SessionsPage`, `Layout`, `useSessionHydration`, `useFirstRunSeed`, `AgentConversation`, `StorageFilesHeader` (2), `TriggerSchedulesSection`, `TriggerSubscriptionsSection`, `waitingByAgent`, `AgentCard` |

Classes 2–4 are all the **same decision repeated**: which side's type contract wins for a module,
then make its consumers agree. They are not mechanical — each needs the call sites updated in the
same pass.

### Original note — 6 release-NEW files (expected)

These are A2 files the release added that import app modules this lane deleted. They are Wave 1
extraction targets and **will not compile until extracted**:
`Drives/SessionFilesPane.tsx` (11 errors), `pages/settings/AIProviders/AIProviders.tsx`,
`Sidebar/hooks/useSidebarResize.ts`, `Sidebar/dynamic/SessionRowActions.tsx`,
`AgentChatSlice/hooks/useInlineRenameRequest.ts`, `AgentChatSlice/components/ShowConfigPanelButton.tsx`.

**WP-0 cannot close the tsc gate on its own** — these six need their extraction (WP-1C/1E/1F) to
compile. Either accept a known, enumerated error set as WP-0's exit criterion, or fold their import
rewrites into WP-0. **This is a decision for Arda.**

### Guard to add before landing

`grep -rln 'from "@/oss/' web/packages/*/src` must return nothing (JSDoc example blocks aside).
This is a **new** lint-style invariant this merge proved is needed — nothing enforced it, and the
merge violated it in six files, one of them silently. Worth a CI check independent of this lane.

### To resume

The merge is live: `MERGE_HEAD` = `19b9ab2367`, index holds the 25 resolutions above.

```bash
cd <this worktree>            # on fix/post-112-reconcile
git status --porcelain | awk '$1=="UU"{print $2}'    # the remaining 86
```

Resolve, `git add`, then commit. **Do not `git merge --abort`** without first re-reading this log —
`rr-cache` is empty, so the 25 resolutions are not replayable.

### Rules for the remaining 86

1. `pnpm-lock.yaml` — take either side, then `pnpm install` and commit the regenerated file.
2. `packages/agenta-entity-ui/src/gatewayTrigger/drawers/subscription/SubscriptionForm.tsx` —
   resolve **toward the release** (222+/342− vs the lane's 3+/3−), then re-apply the lane's 3 lines.
   Part of #5975, which is taken wholesale.
3. Package-copy conflicts created by rename detection (`agenta-navigation/.../sessionsSource.ts`,
   `agenta-entity-ui/src/drive/*`, `agenta-ui/.../theme-variables.css`) are the **A1 fixes arriving
   in the right place** — resolve to keep *both* sides' intent, not by picking one.
4. Everything else: read both sides. The lane frequently rewrote what the release patched.
