# Post-v0.112 reconcile inventory

Phase 1 deliverable for [`POST-112-RECONCILE-HANDOFF.md`](POST-112-RECONCILE-HANDOFF.md).
**Analysis only. No branch, no commit, no `.tsx` edit.**

**Status: Segments A and B both classified.** Segment A: 19 of 25 PRs (6 are api/docs-only).
Segment B: 11 of 26 PRs carry `web/` changes; the rest are api/svc/sdk/docs/chore.
Remaining gaps are named in [Not yet examined](#not-yet-examined--explicit-gaps).

## Decisions taken (2026-08-16)

1. **The provider work is in scope** for this lane — see [F-11](#f-11--the-provider-work-is-one-172-file-pr-not-478).
2. **A2 defaults to extraction, not app-layer.** The lane exists so mobile reaches parity with OSS
   through packages instead of a second implementation; anything OSS grew after the fork gets
   extracted rather than left behind. Per-file the question is *which* package, not *whether*.
   Placement proposals are in [the A2 table](#a2--new-app-files-needing-extraction).

## Refs used

| Ref | SHA |
| --- | --- |
| `FORK` | `613368b81b94e4e5f8bcb1447857e61105b62ef1` |
| `REL` (`release/v0.112.1`) | `19b9ab236796263cc281115a2e572eefb1bb9d7d` |
| `LANE` (PR #6065 tip) | `7d2cd2ce89cb7d6f687569caa131054742788e76` |

Method: `git diff <merge>^1 <merge>` per PR (never `gh pr view --json files`), each changed `web/`
path bucketed by the handoff's three questions, then twin resolution by **exported-symbol index**
over the lane's 3,176 package sources — not by basename. Evidence for "absent on the lane" is a
per-line miss against a normalised line-set of the lane's whole `web/{oss,ee,packages,mobile}` tree,
**then** confirmed by reading the successor. Working artefacts are in the session scratchpad
(`pr/*.cls`, `idx/evidence.txt`).

---

# The structural finding that reframes the job

The handoff assumed the danger is A1 volume (45 modify/delete conflicts) plus nine silent files.
The per-PR pass says the split is sharper than that, and it is **not** predictable from the bucket:

> **The release maintains a package twin for some of these files and not others — and where it
> does, a merge brings the fix across on its own.**

Nine packages exist **only on the lane** (created by the extraction):

`agenta-auth` · `agenta-auth-ui` · `agenta-home-ui` · `agenta-navigation` · `agenta-navigation-ui`
· `agenta-observability` · `agenta-observability-ui` · `agenta-settings` · `agenta-settings-ui`

The release cannot have fixed a twin it does not have. **Every release fix whose lane home is one
of those nine is a guaranteed silent loss**, whether git flags the app file or not.

The converse does **not** hold. `agenta-chat`, `agenta-entities`, `agenta-entity-ui`,
`agenta-sessions`, `agenta-sessions-ui`, `agenta-shared`, `agenta-ui` exist on both lines, but the
release only *sometimes* updates the twin:

| PR | app copy | package twin | merge outcome on the lane |
| --- | --- | --- | --- |
| #5919 interaction-card lifecycle | fixed | **also fixed** | conflict, visible, resolvable |
| #5932 transcript parity | fixed | **also fixed** | conflict, visible, resolvable |
| #5942 adoption guard | fixed | **not touched** | **silent loss** |
| #5946 Drives (14 files) | fixed | **not touched** | **silent loss** |
| #5944 Drives + sidebar | fixed | **not touched** | **silent loss** |

So per-PR, per-file is the only safe granularity. A rule like "chat merges fine" is wrong: #5942
sits in the same three files as #5919 and behaves the opposite way.

**Why:** on the release line the OSS desktop app still renders the **app** copy — nothing in
`web/oss/src` imports `@agenta/chat`; only `web/mobile` does. The package copies exist there for
mobile. On the lane the app copies are deleted and OSS renders the package. Measured drift inside
the release's own two copies today:

| file | shared lines | app-only | pkg-only |
| --- | --- | --- | --- |
| `assets/loadSession.ts` | 18 | **10** (all of #5942) | 5 |
| `assets/transcriptToMessages.ts` | 267 | 6 | 5 |

---

# Two corrections to this document's own first pass

**C-rest was not safe to accept on the bucket rule alone.** The first pass classified 116 Segment A
files as "exists on the lane, no twin → normal merge, nothing to do" without opening them. Checking
PR #6018 exposed the hole: `Sidebar/components/ProjectOrgSwitcher/index.tsx` is a **111-line binding**
onto `@agenta/navigation-ui` (426 lines at `REL`), and it escaped detection twice — the shim test
because it is longer than 12 lines, the symbol match because `export default memo(ProjectOrgSwitcher)`
is not an exported identifier. Re-scanned with two better rules; results in
[F-16](#f-16--c-rest-contains-at-least-23-more-misroutes).

**"478 files" for the provider work is a ~3× overcount** of one PR. See
[F-11](#f-11--the-provider-work-is-one-172-file-pr-not-478).

# Segment A totals

19 PRs carried `web/` changes. 6 (#5929, #5930, #5931 api; #5926, #5916, #5599 docs) are out of
scope per the brief and were not opened.

| Bucket | Files (unique, non-test) | Merge behaviour | Verdict |
| --- | --- | --- | --- |
| **A1** app file the lane moved into a package | **41** | modify/delete conflict | 36 need re-homing; 5 covered by a twin the release also fixed |
| **A2** new app file the release created | **20** | clean add | placement call each |
| **B / C-dual** lane app file is a shim or has a twin | **12** | **clean** | fix lands in dead code |
| C-rest | 116 | clean | **not all safe — see F-16** |
| PKG (release also has the package) | 145 | 32 collide, 43 are new files | see below |
| `web/mobile` | 5 | clean | verified no loss |

**53 files (A1 + B/C-dual) carry a release fix that will not reach the code the lane renders**, and
twelve of those merge **clean** with no signal at all. Adding Segment B and the F-16 rescan of
C-rest, the working figure is **~70–76 files needing a decision rather than a merge**.

---

# Findings, ranked by user impact

## F-01 · The lane's design-token layer is 27 tokens and 577 lines behind — invisible to a merge

**Class** A1 · **Source** #5943 `feat/warm-recolor-and-playground-ux` (286 added lines) and
PR #5973 `chore/palette-cleanup` (33) · **Should now live in** `@agenta/ui/src/styles/theme-variables.css`
· **User-visible** yes, everywhere at once · **Confidence** high

The release changed `web/oss/src/styles/theme-variables.css`. The lane deleted that path and moved
the file into `@agenta/ui`, so the merge sees delete-vs-modify and the reflexive resolution keeps it
deleted. Both apps then render the pre-recolor token set.

Evidence — tokens **present at `REL`, absent from the lane's `@agenta/ui` copy**:

```
--ag-chart-series-0..4  --ag-chart-grid  --ag-chart-axis-line  --ag-chart-axis-text
--ag-chart-reference    --ag-chart-track
--ag-run-status-{success,processing,default,error,warning}
--ag-hero-action-{bg,hover-bg,text}
--ag-shell-selected-{bg,border,text}
--ag-status-warning-{bg,border,text}
--ag-surface-{paper,section-content,section-header}
```

27 tokens, 0 in the other direction, 577 differing lines total. Spot value: `--ag-ref-app-border` is
`rgba(17,57,85,0.22)` at `REL` (via #5973's `outlinedTagTone`) and `#b2ddff` on the lane — the lane's
value predates even the audit-time tip.

This is D-01's shape at ~30× the size.

## F-02 · The token generator's write path on the lane points at a file the lane deleted

**Class** A1 side-effect · **Source** `web/scripts/generate-tailwind-tokens.ts` · **Confidence** high

`theme-variables.css` is generated from `styles/theme/palette.ts`, so F-01 looks like "merge
palette.ts, then regenerate". It is not, yet: the lane's generator still has

```ts
const CURRENT_CSS = pathResolve(OSS, "src/styles/theme-variables.css")   // line 30 — deleted on the lane
const cssTarget = WRITE ? CURRENT_CSS : pathResolve(OUT, "theme-variables.generated.css")  // line 544
```

so `GEN_WRITE=1` writes to a path that no longer exists, while the file's own doc comment says the
target moved to `packages/agenta-ui/src/styles`. **Fix this before F-01**, or the regeneration step
silently produces nothing. `palette.ts` itself is C-rest (920 lines at `REL`, 602 on the lane, 790
differing) — it merges, with substantial conflicts.

## F-03 · The sidebar sessions source lost three PRs of work — 111 lines vs 275

**Class** A1 · **Source** #5927, #5944, #5974 · **Should now live in**
`@agenta/navigation/src/dynamic/sessionsSource.ts` · **User-visible** yes · **Confidence** high

`@agenta/navigation` is lane-only, so nothing on the release side updates the twin. Missing added
lines: 7 (#5927), 20 (#5944), 37 (#5974).

Read on the successor — `localPlaygroundSessionRefsAtom` is **absent** from the lane copy, as is the
`running` field on the row type. That atom is #5974's fix for a named repro: switching tabs
mid-first-turn drops the running session's sidebar row and its spinner until the turn completes,
because a client-created session has no server row yet. #5974 also stops `name` falling back to
`"Untitled session"` so the row menu's rename prefills the real name.

Same package, same cause:

| file | `REL` | lane | missing added lines |
| --- | --- | --- | --- |
| `dynamic/sessionsSource.ts` | 275 | 111 | 7 + 20 + 37 |
| `dynamic/registry.ts` | 166 | 143 | 9 (#5945) + 5 (#5974) |
| `dynamic/types.ts` | 87 | 84 | 4 (#5945) + 2 (#5974) |
| `lib/atoms/sidebar.ts` → `navigation/src/state.ts` | 108 | 80 | 20 (#5943) |
| `engine/SidebarShell.tsx` → `navigation-ui/src/SidebarShell.tsx` | 360 | 295 | 10 (#5943) + 8 (#5945) |
| `engine/SidebarMenu.tsx` → `navigation-ui/src/NavMenu.tsx` (**rewrite**) | 357 | 388 | 1 (#5943) + 2 (#5945) + 2 (#5974) |

`SidebarMenu`/`SidebarShell` were **missed by both the basename match and the symbol match** —
`SidebarMenu` became `NavMenu`. Resolved by hand here; see [Renames](#renames-the-automated-match-missed).

## F-04 · The Drives surface: 17 files fixed on the release, none of it reaching the package

**Class** A1 · **Source** #5946 `feat/build-mode-files-pane` (14 files), #5944 (3), #5943 (3) ·
**Should now live in** `@agenta/entity-ui/src/drive/*` and `@agenta/entities/src/drive/*` ·
**User-visible** yes · **Confidence** high

The twins live inside packages that exist on both lines, but the release **did not touch them** —
zero `web/packages/agenta-entity-ui/src/drive/**` or `agenta-entities/src/drive/**` paths in any of
the three PRs. Every fix is app-copy-only, and the lane deleted the app copy.

Per-file missing added lines (release → lane successor):

| app file | missing / added | successor |
| --- | --- | --- |
| `Drives/useSessionDrive.ts` | **34 / 35** | `agenta-entities/src/drive/useSessionDrive.ts` (630→565) |
| `Drives/useDriveTreePane.ts` | 13 / 16 | `agenta-entities/src/drive/useDriveTreePane.ts` (116→100) |
| `Drives/DriveExplorer.tsx` | 12 / 13 | `agenta-entity-ui/src/drive/DriveExplorer.tsx` (456→433) |
| `Drives/StorageSection.tsx` | 12 / 13 | `agenta-entity-ui/src/drive/StorageSection.tsx` |
| `Drives/DriveHeader.tsx` | 10 / 12 + 2 / 6 | `agenta-entity-ui/src/drive/DriveHeader.tsx` |
| `Drives/DriveToolbar.tsx` | 6 / 6 | `agenta-entity-ui/src/drive/DriveToolbar.tsx` |
| `Drives/DriveTreePane.tsx` | 5 / 5 | `agenta-entity-ui/src/drive/DriveTreePane.tsx` |
| `Drives/OriginTag.tsx` | 4 / 4 + 1 / 1 | `agenta-entity-ui/src/drive/OriginTag.tsx` |
| `Drives/driveIcons.tsx` | 4 / 4 | `agenta-entity-ui/src/drive/driveIcons.tsx` |
| `DriveFileContentViewer` · `DriveFileRow` · `FilesDrawer` · `SessionFilesDrawer` · `StorageFilesHeader` · `configDrive` · `driveTreeView` · `quickLook` | 1 each | as mapped |

Plus two A2 companions with no package home yet: `Drives/SessionFilesPane.tsx` and
`AgentChatSlice/components/OpenFilesPaneButton.tsx` (#5946) — the build-mode files pane itself.

## F-05 · #5942's adoption guard reaches the lane's dead app copy, not `@agenta/chat`

**Class** A1 · **Source** #5942 `fix/adoption-guard-waiting-card` · **Confidence** high

PR #5942 threads `interactionRows?: SessionInteractionRowStates` through `loadSession`'s return so the
adoption guard can tell a card still awaiting the user (`pending`) from one that has ended. It
changed **only** `web/oss/src/components/AgentChatSlice/assets/loadSession.ts` — the package copy is
untouched at `REL`, and all 10 of its added lines are app-only there.

The lane renders `@agenta/chat/src/assets/loadSession.ts` (80 lines, no `interactionRows`). So this
fix reaches nothing on the lane, and it merges **clean** because the file it edits is already gone.

Contrast **#5919** and **#5932**, which fixed the package copy too — those bring their own fix
across (with conflicts, since the lane also edited both). #5919's shape:
`fetchCancelledClientToolTokensAtom` → `fetchSessionInteractionStatesAtom`, a new
`settleClientToolPart` lifecycle join, `anyPendingInteraction` folded into `messageHasPendingHitl`
from `@agenta/playground`, and `showWaiting` painted on the turn that **holds** the gate rather than
the newest one. It also adds `@agenta/shared/src/clientTools/index.ts` and
`@agenta/entities/src/session/state/interactionAnswer.ts` — both new, both clean adds.

## F-06 · #5830's deleted-session tombstones are absent (community fix for issue #5543)

**Class** C-dual · **Source** #5830 `fix/5543-deleted-session-resurrects` · **User-visible** yes ·
**Confidence** high

Adds `deletedIdsByAppAtom` (`atomWithStorage`, key `agenta:agent-chat:deleted-sessions`) so a
deleted session cannot be resurrected by a later list refresh. 16 of 20 added lines missing;
**`deletedIdsByAppAtom` and the storage key appear nowhere in the lane's entire `web/` tree.**

`AgentChatSlice/state/sessions.ts` still exists on the lane (732 lines vs 1,010 at `REL`), so this
one merges as an ordinary 3-way conflict rather than vanishing — but the 278-line gap means the
conflict is large and the fix is easy to lose during resolution. Treat as needing an explicit
post-merge assertion, not a silent trust.

## F-07 · Twelve files merge clean into a shim or a stale twin

**Class** B / C-dual · **Confidence** high (each successor read, not just grepped)

Confirmed shims/bindings on the lane — the release's fix lands in the binding, the behaviour lives
in the package:

| app file (lane size) | what it is now | release fix | successor |
| --- | --- | --- | --- |
| `pages/sessions/components/SessionListCard.tsx` (28) | binding: wires `useSessionCardVerbs` + `projectURL` into `@agenta/sessions-ui` | #5927, 28/31 missing | `agenta-sessions-ui/src/SessionListCard.tsx` (122 vs 292 at `REL`) |
| `Sidebar/dynamic/useSidebarDynamicChildren.ts` (17) | binding: injects `projectURL` + `kindIcon` | #5945 (2), #5974 (1) | `agenta-navigation/src/dynamic/useSidebarDynamicChildren.ts` |
| `Sidebar/components/SidebarSkeletonLoader.tsx` (9) | pure re-export shim | #5943, 5/6 missing | `agenta-navigation-ui/src/SidebarSkeletonLoader.tsx` |
| `state/observability/dashboard.ts` (20) | binding: scopes to `routerAppIdAtom` | #5923 (1) | `agenta-observability/src/state/*` |
| `pages/agent-home/.../useAgentActivity.ts` (27) | binding | #5927, 4/4 missing | `agenta-home-ui/src/useAgentActivity.ts` (67) |
| `AgentChatSlice/hooks/useSessionActions.tsx` (73) | partial binding | #5974, 5/5 missing | `agenta-sessions-ui/src/useSessionActions.tsx` (189 vs 223) |
| `AgentChatSlice/assets/sessionMotion.ts` (18) | binding | #5943 (3) | `agenta-sessions-ui/src/assets/motion.ts` |
| `AgentChatSlice/state/sessions.ts` (732) | real file, diverged | #5830 (16), #5974 (10) | — see F-06 |
| `AgentChatSlice/AgentConversation.tsx` | real file, twin exists | #5946 (5), #5919 (4), #5974 (0 — **already present**) | `agenta-chat/src/hooks/useAgentConversation.ts` |
| `DrillInView/DrillInFieldHeader.tsx` | real file, twin exists | #5973 (3) — **twin also fixed** | `agenta-ui/src/drill-in/core/DrillInFieldHeader.tsx` |
| `EvalRunDetails/.../useRunMetricData.ts` | real file | #5943 (2) | `agenta-entities/src/workflow/core/evaluatorResolution.ts` (weak match — verify) |
| `lib/helpers/colors.ts` | real file | #5943 — **twin also fixed** | `agenta-ui/.../avatar/utils.ts` |

## F-08 · Observability UTC range (#5923) splits across three lane-only packages

**Class** A1 + C-dual · **User-visible** yes (wrong time window on charts) · **Confidence** high

Four small files, four different destinations, none of which the release can have fixed:
`state/newObservability/atoms/controls.ts` → `agenta-observability/src/state/controls.ts`
(409→349, 22 symbols matched); `components/Filters/Sort.tsx` → `agenta-observability/src/core/`;
`lib/helpers/dateTimeHelper/index.ts` → `agenta-shared/src/utils/dateTime/index.ts` (both 67 lines,
2 added lines missing); `state/observability/dashboard.ts` → the shim in F-07. Small diffs, high
blast radius, easy to skip precisely because each hunk is one or two lines.

## F-09 · Home + settings renames the automated match could not see

**Class** A1 · **Source** #5927 · **Confidence** high (successors located by reading, see below)

`HomeSessionsSection.tsx` and `HomeAutomationsSection.tsx` (1 added line each) have **no
same-named successor** — they were folded into `agenta-home-ui/src/HomeOverview.tsx`.
`settings/Triggers/components/GatewaySchedulesSection.tsx` and `GatewaySubscriptionsSection.tsx`
(1 each) became `agenta-settings-ui/src/triggers/TriggerSchedulesSection.tsx` and
`TriggerSubscriptionsSection.tsx`.

Also `pages/agent-home/assets/templates.ts` — **28 of 28** added lines missing, successor
`agenta-entities/src/workflow/agentTemplates.ts` (1,490 lines vs 1,475). And #5943 deleted
`settings/Tools/components/AgentaToolsPlaceholder.tsx`; the lane still carries
`agenta-settings-ui/src/tools/AgentaToolsPlaceholder.tsx`, so the **deletion** needs porting too.

## F-10 · #5817's slash-command animations exist only in the OSS Tailwind config

**Class** C-rest with a cross-app gap · **Confidence** medium (mobile side inferred from the token
bridge, not from a render)

PR #5817 puts `SlashCommandPlugin` and `slashCommands.ts` in `@agenta/ui` (both lines have that
package, so they merge), but its `command-panel-in` / `-fade` / `-swap` keyframes and animations go
into `web/oss/tailwind.config.ts`. On the lane the plugin is shared, and `web/mobile` runs a
Tailwind v4 bridge that will not have those animation names — the panel would render unanimated
there. Worth a placement decision, not a port.

**Not a finding:** the lane's `web/oss/tailwind.config.ts:288` still has
`xs: ["13px", {lineHeight: "18px"}]`, so drift finding D-01 is genuinely closed. And
`web/mobile/src/styles/theme.generated.css` has 28 tokens the release lacks and **zero** the other
way — no mobile token loss.

---

# Segment B findings

11 of the 26 PRs carry `web/` changes. Totals: **11 A1**, **2 C-dual**, **13 A2** (non-test),
**166 PKG**, 26 C-rest. The same structural rule holds — the lane-only nine are the guaranteed
losses, and twin coverage is per-file.

| PR | branch | A1 / C-dual | verdict |
| --- | --- | --- | --- |
| #5995 | `feat/provider-connections-api` | 3 | 1 silent (settings nav), 1 covered, 1 = F-01 |
| #5975 | `code/schedule-trigger-drawer-arch` | 2 | both → `agenta-settings-ui` renames (F-09) |
| #5993 | `fix/web-session-openability` | 2 | twin also fixed — merges |
| #6005 | `feat/age-4109-session-keyboard-shortcuts` | 2 | both silent |
| #6016 | `fix/drive-files-pane-chrome` | 3 | all silent — F-04 continues |
| #6018 | `fix/sidebar-rail-alignment` | 0 (but see F-13) | misroutes via a binding |
| #6019 | `fix/5967-usage-failure-rate` | 0 (but see F-12) | worst single finding in Segment B |
| #6024 | `fix/rel112-harness-command-and-phantom-subscriptions` | 0 | revises #5817's A2 files |
| #6008 / #6009 | chat file links | 0 | C-rest, low risk |
| #6002 | `fix/age-4108-elicitation-textarea-resize` | 0 | package-only, merges |

## F-11 · The provider work is one 172-file PR, not 478

**Class** scoping correction · **Confidence** high

The scope doc lists #5995, #5994 and #6001 as three PRs totalling 478 files. They are **one stack**:
both `4da9581b90` (#5994) and `9b88ddeae7` (#6001) are ancestors of `3bc76b209d^2` (#5995's merged
branch), and only #5995 sits on `release/v0.112.1`'s first-parent line. The union of all three merge
diffs is **exactly 172 files — identical to #5995 alone**. This is the promotion-merge overcount the
handoff warns about, applied to a stack.

What it is: the **LLM provider credentials** layer — OpenAI/Anthropic/Azure/Bedrock/Vertex/SageMaker/
AlephAlpha/custom endpoints. #5995 is the connection model (`agenta-entities/src/secret/**`:
`providerCatalog`, `providerFields`, `connections`, `litellmModelId`, `promptModelGroups`, `probe`),
PR #5994 the runner subscription/credential status, #6001 the **Settings → AI Providers** page plus
`ConnectModelBanner` and `useAgentModelKeyStatus` in the composer.

Weight: 87 `web/packages` (mostly `agenta-entities/src/secret/**` — a package **both lines have**,
so it merges with visible conflicts), 20 `web/oss/src`, 53 api/sdk/runner. Materially cheaper than
the doc implies. Two of the 20 oss files are already-known hazards (`styles/theme-variables.css` and
`styles/theme/palette.ts` → F-01), and one is a silent loss:

**`pages/settings/assets/navigation.ts` → `agenta-settings/src/navigation.ts`** (lane-only package,
15 symbols matched, 230 vs 229 lines). Verified: the lane's copy has **no AI Providers entry**. So
even once `AIProviders.tsx` merges into the app layer, the page has no route into it.

> **Superseded by [F-18](#f-18--the-package-layer-adjudicated-per-file-276-files-one-real-break).**
> This section originally called `useAgentModelKeyStatus.ts` "the good case — twin also fixed".
> That was wrong: #5995 **deleted** the package copy. It is the one genuine build break in the
> whole reconcile. See F-18.

## F-12 · The usage failure rate stays 100× wrong, and #6019's new test breaks the build

**Class** C-rest misroute · **Source** #6019 `fix/5967-usage-failure-rate` (community) ·
**User-visible** yes · **Confidence** high

A two-file, one-line community fix. `analyticsToGeneration` reported `failure_rate` as a fraction
where the UI renders a percentage:

```diff
-        failure_rate: totalCount ? errorCount / totalCount : 0,
+        failure_rate: totalCount ? (errorCount / totalCount) * 100 : 0,
```

On the lane `web/oss/src/services/tracing/lib/helpers.ts` is a **36-line re-export shim** (167 at
`REL`) and does not contain `analyticsToGeneration` at all. Its own comment says why: *"The dashboard
transform … moved to @agenta/observability so mobile renders the same usage figures."*

The real function is at **`web/packages/agenta-observability/src/core/analytics.ts:122`**, and it
still reads `failure_rate: totalCount ? errorCount / totalCount : 0`. `agenta-observability` is
lane-only, so the release could never have fixed it. A failure rate of 16.67% renders as 0.17% — on
**both** desktop and mobile, since the shim's comment confirms they share the transform.

Second-order: #6019 also adds `helpers.test.ts`, which `import {analyticsToGeneration} from
"./helpers"`. That file merges clean onto the lane, where `./helpers` no longer exports it — a
failing test the merge introduces on its own.

## F-13 · #6018 does not duplicate D-15/16/17, but its geometry lands in a binding

**Class** C-rest misroute · **Source** #6018 `fix/sidebar-rail-alignment` · **Confidence** high

The handoff asked whether #6018 supersedes, duplicates or contradicts drift findings D-15/D-16/D-17.
Answer: **none of the three.** D-15/16/17 are the collapse-toggle pill, the wordmark box and nav-row
`w-[94%]`. #6018 is a different set of elements — it aligns the switcher panel and the rail banners
onto the nav rows' **12px icon column** and makes the rail full-width instead of a fixed 215/220px,
plus a dark-mode pass (`bg-[var(--ag-c-F5F7FA)]` → `bg-colorBgElevated`, `text-gray-900` →
`text-colorText`, `hover:bg-black/5` → `hover:bg-colorFillTertiary`).

It **depends on** D-17 rather than conflicting with it: its alignment math assumes full-width nav
rows. Verified the lane already satisfies that — `agenta-navigation-ui/src/NavMenu.tsx:364` uses
`w-full`, so D-17 is closed and #6018's premise holds.

The catch is placement. Two of its four files misroute:

- `Sidebar/components/ProjectOrgSwitcher/index.tsx` — a binding on the lane; the `PANEL_CLASS`,
  `w-full`/`box-border` popup and `px-3` avatar column all belong in
  **`agenta-navigation-ui/src/ProjectOrgSwitcher.tsx`**, which is where `ROW_CLASS` lives.
- `Sidebar/scopes/mainScope.tsx` — the `mx-auto` → `w-full` hunk needs checking against the lane's
  shell.

`SidebarBanners/*` genuinely stays app-layer, but note the lane carries **two** copies
(`web/oss` and `web/ee`) and #6018 only touched the oss one.

## F-14 · Drives keeps taking fixes the package never sees

**Class** A1 · **Source** #6016 `fix/drive-files-pane-chrome` · **Confidence** high

Three more app-only Drives fixes on top of F-04's seventeen: `DriveExplorer.tsx`, `DriveHeader.tsx`,
and `DriveExplorerStates.tsx` — all → `@agenta/entity-ui/src/drive/`, none touched on the release
side. It also modifies `Drives/SessionFilesPane.tsx`, the A2 file #5946 created, so that file's
extraction must take the **#6016 state**, not #5946's.

## F-15 · Session keyboard shortcuts land in two bindings

**Class** C-dual + A2 · **Source** #6005 `feat/age-4109-session-keyboard-shortcuts` ·
**User-visible** yes · **Confidence** high

Both C-dual files are known bindings: `AgentConversation.tsx` → `agenta-chat/src/hooks/useAgentConversation.ts`
and `useSessionActions.tsx` → `agenta-sessions-ui/src/useSessionActions.tsx` (189 vs 223 lines,
already behind by #5974 — see F-07). Its three new files (`useSessionShortcuts.ts`,
`useInlineRenameRequest.ts`, `state/uiRequests.ts`) are the shortcut engine itself and want
extracting alongside, or the shortcuts exist on desktop only.

## F-16 · C-rest contains at least 23 more misroutes

**Class** method correction · **Confidence** high for the listed files, medium for the boundary

Re-scanned every C-rest file with two rules the first pass lacked:

1. *Binding shape* — the lane's copy imports from `@agenta/*` **and** is materially smaller than the
   release's. **18 files at ≥25% shrink.**
2. *Vanished target* — none of the lines the release's diff **replaced** exist in the lane's copy,
   i.e. the hunk has nothing to attach to. **23 files.**

The two sets overlap; the union is the set that needs opening. Worst by size:

| app file | `REL` → lane | lane imports | PR |
| --- | --- | --- | --- |
| `services/tracing/lib/helpers.ts` | 167 → **36** | `@agenta/entities` | #6019 — F-12 |
| `Sidebar/components/ProjectOrgSwitcher/index.tsx` | 426 → **111** | `@agenta/navigation-ui` | #6018 — F-13 |
| `AgentChatSlice/components/ApprovalDock.tsx` | 578 → **202** | `@agenta/chat` | #5919, #5946 (21 replaced lines absent) |
| `pages/sessions/assets/menuEntries.ts` | 60 → **25** | `@agenta/sessions-ui` | #5927 |
| `Playground/.../AgentRevisionSelector/index.tsx` | 149 → **68** | 4 packages | #5943 (7 absent) |
| `AgentChatSlice/components/SessionTagBar.tsx` | 620 → **329** | `@agenta/sessions-ui` | #5943 |
| `pages/settings/Preferences/Preferences.tsx` | 101 → **56** | `@agenta/settings-ui` | #5995 (3 absent) |
| `AgentChatSlice/components/AgentComposerDock.tsx` | 562 → **362** | `@agenta/chat` | #5817, #6024 (13 absent) |
| `AgentChatSlice/AgentChatPanel.tsx` | 457 → **295** | 4 packages | #5943, #6005 |
| `hooks/useLLMProviderConfig.tsx` | 155 → **107** | `@agenta/entities` | #5995 |
| `AgentChatSlice/hooks/useSessionHydration.ts` | 493 → **347** | `@agenta/chat` | #5919 |
| `Sidebar/scopes/viewRegistry.ts` | 93 → **64** | `@agenta/navigation` | #5945 |
| `pages/overview/agent/AgentOverview.tsx` | 169 → **119** | `@agenta/entity-ui` | #5927, #5943 |
| `AgentChatSlice/hooks/useFirstRunSeed.ts` | 182 → **127** | `@agenta/entities` | #5974 |
| `Layout/ThemeContextProvider.tsx` | 208 → **148** | `@agenta/ui` | #5943 |
| `AgentChatSlice/components/RightPanel/RightPanelSplit.tsx` | 164 → **103** | `@agenta/ui` | #5946, #6016 |

Shrink is a signal, not proof — `AgentComposerDock` at 362 lines is still a real component that
merges partly correctly. But "all replaced lines absent" does mean the hunk has no anchor, and that
set was previously reported as needing nothing.

## F-17 · The F-16 union, closed: 27 files, five verdicts

Every file in the union was opened and its anchorless hunks traced to a destination. **Shrink alone
was a poor predictor** — only 7 of the 27 are true re-homings. The dominant case is a file that is
still the right home but whose markup the lane rewrote (de-antd/Radix), so the hunk cannot auto-apply.

**Final count: 27 files, of which 4 need no action.** Total needing a decision rather than a merge:
**53 (A1 + B/C-dual) + 23 = 76.**

### (a) MOVE — the behaviour now lives in a package (7)

| App file | Destination | Which hunk |
| --- | --- | --- |
| `services/tracing/lib/helpers.ts` | `agenta-observability/src/core/analytics.ts:122` | #6019 — F-12 |
| `Sidebar/components/ProjectOrgSwitcher/index.tsx` | `agenta-navigation-ui/src/ProjectOrgSwitcher.tsx` | #6018 — F-13 |
| `AgentChatSlice/components/ApprovalDock.tsx` | `agenta-chat/src/hooks/useApprovalDock.ts` | **#5919 only** — the gate scan changed from "last assistant message" to *all* messages in transcript order |
| `AgentChatSlice/components/SessionTagBar.tsx` | `agenta-sessions-ui/src/{SessionTab,SessionTabStrip}.tsx` | #5943 label masks, #6005 `aria-keyshortcuts` |
| `pages/overview/agent/AgentOverview.tsx` | `agenta-entity-ui/src/agent/{AgentOverviewLayout,AgentOverviewBody}.tsx` | #5927 column scroll, #5943 rail tint |
| `pages/settings/Preferences/Preferences.tsx` | `agenta-settings-ui/src/PreferencesPage.tsx` | #5995 |
| `pages/sessions/assets/menuEntries.ts` | adapter stays app-side; the **verbs** go to `agenta-sessions-ui/src/useSessionActions.tsx` | #5927 |

The lane's `menuEntries.ts` is a 25-line antd→`SessionMenuEntry` adapter whose own comment names
`useSessionActions.menuItems` as the single source of the verbs — so new entries belong there, not here.

### (b) RE-APPLY IN PLACE — right file, rewritten surroundings (9)

No package move. The hunk must be re-expressed against the lane's markup, by hand.

`AgentChatSlice/components/ApprovalDock.tsx` (**#5946 half** — the humanized-headline copy, against
the lane's `resolveApprovalRenderer`) · `AgentChatSlice/AgentChatPanel.tsx` ·
`AgentChatSlice/components/RightPanel/RightPanelSplit.tsx` + `state/rightPanel.ts` (**split-aware**:
the lane moved the Inspector's open/scope/lens to `components/Inspector/state.ts` and left only the
persisted width here) · `AgentChatSlice/components/AgentTranscript.tsx` + `assets/conversationLayout.ts`
(#5943's `BOTTOM_FADE_OVERLAY_STYLE` / `BOTTOM_FADE_HOVER_HIDE` are additive and land, but the button
they restyle was rewritten) · `Playground/Components/PlaygroundHeader/index.tsx` (3 hunks across
PR #5943/#5946/#5973, incl. `SHOW_MODE_SWITCH = false` hiding the Build/Chat switch) ·
`Playground/Components/AgentRevisionSelector/index.tsx` (#5943 replaced the antd Tooltip
draft/saved pill with a `@agenta/ui/ui` dropdown + `handleRevertChanges`) · `pages/agents/AgentsGrid.tsx`
· `AgentChatSlice/components/Inspector/InspectSessionButton.tsx` (one `placement="left"`).

**The hard one:** `AgentChatSlice/hooks/useSessionHydration.ts` (493→347). #5942's adoption guard
(`interactionRows`, `TERMINAL_PART_STATES`, `isTerminalRow`) replaces a pending/settled reconciler
built on `buildRenderMap`/`isPendingClientToolInteraction` that the lane **no longer contains** — and
no package holds it either. The lane's own comment at line 248 says it *"reproduces the package-side
stamp without reaching into `@agenta/chat`"*. So this is a semantic re-expression against a different
mechanism, not a port. It is the app-side half of F-05 and the single riskiest item in the union.

### (c) EXTRACT WHOLESALE — the feature is simply absent (1 + its A2 files)

`AgentChatSlice/components/AgentComposerDock.tsx`. Verified: `slash.picker`, `PickerPanel` and
`useChatSlashCommands` return **zero** hits in the lane's copy — the lane predates #5817 entirely, so
PR #6024's 13 anchorless lines are not drift but a missing feature. The slash-command work lands as one
unit (`@agenta/ui` for the plugin/panels, `@agenta/chat` for the hook) at its **#6024 net state**.

### (d) GENERATED — regenerate, never resolve by hand (2)

`styles/theme/palette.ts` (920→602; 197 replaced lines, only 6 anchorless — it merges, with large
conflicts) and — **new, not previously caught** — `styles/theme/antd-overrides.generated.ts`.

That second file is a **third artifact of F-01/F-02**: 168 lines at `REL`, **38** on the lane, and the
values have diverged (`colorLink: "#8ccfff"` vs the lane's `"#58a6ff"`). It sits at the same path on
both lines, so it merges cleanly and silently keeps a stale antd dark theme. It comes out of the same
generator as `theme-variables.css`, so it inherits F-02's broken write path. **Fix F-02, merge
`palette.ts`, regenerate both outputs** — treat any hand-resolution of these two as a defect.

### (e) OK — anchors exist, ordinary merge (4)

`hooks/useLLMProviderConfig.tsx` (26 replaced, 0 anchorless) · `AgentChatSlice/hooks/useFirstRunSeed.ts`
(6/0) · `Layout/ThemeContextProvider.tsx` (1/0) · `Sidebar/scopes/viewRegistry.ts` (3/0). Each shrank
because the lane hoisted code into a package, but every hunk the release touches still has its anchor.

### (f) Tests — follow their subject, do not merge independently (3)

`AgentChatSlice/hooks/useSessionHydration.test.ts` (442→**35** on the lane),
`components/clientTools/useConnectFlow.test.ts` (265→104), `components/clientTools/meta.test.ts`
(170→103). All three are pure-addition diffs that merge clean onto gutted files. Same failure shape as
F-12's new test: they will compile against symbols the lane's app layer no longer exports.

## F-18 · The package layer, adjudicated per file: 276 files, one real break

**Correction to this document:** the figure was **276** unique package files, not 311 — the earlier
number double-counted files touched in both segments.

| Class | Files | Verdict |
| --- | --- | --- |
| Exists on the lane, **release-only** change | 130 | clean merge, take the release side. No action. |
| **New** on the release, absent on the lane | 105 | clean adds. 15 belong to one unit — see #5975 below. |
| **Collisions** — both lines changed it | 41 | 22 produce real conflicts, 19 auto-merge |
| Release **deleted** it, lane still has it | 8 | 7 are one coherent replacement; **1 is a build break** |

Conflict counts are from a real 3-way (`git merge-file --diff3` on `FORK`/`REL`/`LANE` blobs), not
from the earlier collision heuristic.

### The one genuine break: `agenta-chat/src/hooks/useAgentModelKeyStatus.ts`

**This reverses what F-11 says about that file** — it is not "the good case". #5995 **deleted** the
package copy and dropped `export * from "./useAgentModelKeyStatus"` from the hooks barrel,
consolidating the provider work into the app copy the lane does not have.

The lane still has the file (112 lines), still exports it, and its **app layer imports it**:

- `oss/src/components/AgentChatSlice/AgentConversation.tsx:16` — `import {useAgentModelKeyStatus} from "@agenta/chat/hooks"`
- `oss/src/components/AgentChatSlice/components/ConnectModelBanner.tsx`
- plus `agenta-chat/src/hooks/{useAgentConversation,index}.ts` internally

Accept the deletion and the lane fails to build; the model-key composer gate disappears with it.
The merge WP must **keep the lane's package copy** and port #5995's app-side rewrite *into* it.

### The 7 other deletions are safe — they are #5975's replacement, not losses

`code/schedule-trigger-drawer-arch` re-architects the trigger drawers inside `agenta-entity-ui`:
**7 deletes + 15 new files + 20 modifies**, one unit. Verified all 15 new files are absent on the
lane and all 7 deleted ones are still present *and still wired* (`TriggerScheduleDrawer.tsx` →
`ScheduleDrawerContent.tsx` → `SchedulesList.tsx` → `MasterDetailRail.tsx`). Because the lane barely
touched that tree, the whole replacement applies atomically — **take it wholesale, do not
cherry-pick**, or the lane keeps dangling imports into deleted files.

It also brings 4 new `agenta-ui` primitives the lane lacks (`calendar`, `date-picker`,
`date-time-picker`, `time-picker`) and 2 new `DrillInView/SchemaControls/triggerManagement` files.
Its one collision is `subscription/SubscriptionForm.tsx` (release 222+/342−, lane 3+/3−, 1 conflict)
— resolve toward the release, then re-apply the lane's 3 lines.

### The 22 conflicting collisions, ranked

| Conflicts | rel+ / lane+ | File | Note |
| --- | --- | --- | --- |
| 4 | 209 / 133 | `agenta-chat/src/assets/transcriptToMessages.ts` | #5919+#5932 vs the lane's extraction. The core chat reconcile. |
| 4 | 13 / 11 | `agenta-chat/src/assets/loadSession.ts` | plus F-05's app-only #5942 hunk, which is *not* in this file |
| 4 | 9 / 8 | `agenta-chat/tests/unit/assets/loadSession.test.ts` | follows its subject |
| 3 | 8 / 41 | `agenta-entity-ui/src/agent/AgentCard.tsx` | lane rewrote 5× more than the release |
| 3 | 10 / 40 | `agenta-ui/package.json` | dependency/export surface — resolve by union |
| 2 | 9 / 23 | `agenta-chat/src/model/approvals.ts` | pairs with `useApprovalDock` (F-17a) |
| 2 | 64 / 48 | `agenta-sessions/src/state/useSessionCardList.ts` | both sides rewrote heavily |
| 1 | 86 / 62 | `agenta-entities/src/session/state/interactionStatus.ts` | **both created it independently** post-fork |
| 1 | 18 / 16 | `agenta-entities/src/gatewayTrigger/state/invalidate.ts` | same — independent creation |
| 1 | 566 / 613 | `agenta-chat/tests/unit/assets/transcriptToMessages.test.ts` | biggest by volume, but it is a test |
| 1 | 222 / 3 | `agenta-entity-ui/.../subscription/SubscriptionForm.tsx` | part of #5975, above |
| 1 each | — | `agenta-sdk/src/resources.ts` · `agenta-playground/.../agentApprovalResume.ts` · `agenta-entities/src/session/index.ts` · `agenta-entity-ui/src/gatewayTool/components/SchemaForm.tsx` · `AgentOperationsSections.tsx` · `agenta-sessions-ui/src/SessionRow.tsx` · `agenta-ui/vitest.config.ts` · `agenta-shared/package.json` · `agenta-sessions-ui/package.json` · `useAgentConversation.test.ts` | routine |

**The two "independent creation" files deserve a flag**: `interactionStatus.ts` and
`gatewayTrigger/state/invalidate.ts` did not exist at `FORK` and were written *separately* on each
line for the same purpose. A 3-way merge has no useful base, so it will interleave two implementations
of the same thing. Both need a deliberate pick-one-side decision, not a resolution.

### The 19 that auto-merge

They still merge *silently*, so the lane's side wins or loses by line position, not by intent. The
ones worth an assertion afterwards are those where the lane changed far more than the release —
`agenta-chat/src/hooks/useAgentConversation.ts` (6 vs **106**),
`agenta-sessions-ui/src/index.ts` (8 vs 27), `agenta-ui/src/components/ui/index.ts` (4 vs 23) — and
the inverse, where the release changed far more and a clean merge could still drop intent:
`agenta-entity-ui/src/DrillInView/index.ts` (53 vs 3), `agenta-ui/src/RichChatInput/RichChatInput.tsx`
(54 vs 5), `agenta-sessions/src/state/useSessionList.ts` (35 vs 1),
`agenta-entities/src/gatewayTrigger/hooks/useTriggerDeliveries.ts` (32 vs 1).

# A2 — new app files needing extraction

Non-test, non-fixture. Each merges clean into `web/oss/src`. Per the decision above, **the default
is extraction**; the column below is the proposed destination, not an option.

Two sequencing rules the per-PR view hides:

- **Extract the net state at `REL`, not each PR's state.** #6024 *deletes* `SlashCommand/HarnessPickerPanel.tsx`
  that #5817 added, and revises `PermissionsPickerPanel.tsx` + `useChatSlashCommands.tsx`; #6016
  revises #5946's `Drives/SessionFilesPane.tsx`; #5939 revises #5927's `lib/sessionListPolicies.ts`.
  Extracting per-PR would resurrect deleted files and land superseded versions.
- **`sessionListPolicies` already exists three times at `REL`** — `web/oss/src/lib/`,
  `agenta-sessions/src/state/sessionListPolicy.ts` and `web/mobile/src/features/sessions/sessionListPolicy.ts`.
  That is the duplication this lane exists to remove: collapse to the package copy, delete the other two.

Segment A (20 files):

| File | PR | Proposed package home |
| --- | --- | --- |
| `AgentChatSlice/components/SlashCommand/{HarnessPickerPanel,PermissionsPickerPanel,useRovingList}.tsx/ts` + `README.md` | #5817 | `@agenta/ui` (the plugin already is) |
| `AgentChatSlice/hooks/useChatSlashCommands.tsx` | #5817 | `@agenta/chat` |
| `AgentChatSlice/assets/clientToolAnswer.ts` | #5919 | `@agenta/chat` or `@agenta/shared/clientTools` (which #5919 creates) |
| `AgentChatSlice/state/projectSessionsQuery.ts` | #5927 | `@agenta/sessions` |
| `AgentChatSlice/components/SessionRunSpinner.tsx` | #5974 | `@agenta/sessions-ui` |
| `AgentChatSlice/components/ShowConfigPanelButton.tsx` | #5943 | `@agenta/chat` |
| `AgentChatSlice/components/OpenFilesPaneButton.tsx` | #5946 | `@agenta/entity-ui/drive` |
| `Drives/SessionFilesPane.tsx` | #5946 | `@agenta/entity-ui/drive` |
| `Sidebar/dynamic/SessionRowActions.tsx` | #5974 | `@agenta/navigation-ui` |
| `Sidebar/dynamic/sessionOptions.ts` | #5927 (+#5944) | `@agenta/navigation` |
| `Sidebar/hooks/useSidebarResize.ts` | #5943 | `@agenta/navigation` |
| `pages/sessions/assets/sessionAutomationActions.ts` | #5927 | `@agenta/sessions` |
| `pages/sessions/components/SessionAutomationDrawers.tsx` | #5927 | `@agenta/sessions-ui` |
| `pages/sessions/hooks/useSessionAutomationActions.ts` | #5927 | `@agenta/sessions` |
| `lib/sessionListPolicies.ts` | #5927 (+#5939) | `@agenta/sessions` — **note** the release put the same policy in `agenta-sessions/src/state/sessionListPolicy.ts` *and* `web/mobile/src/features/sessions/sessionListPolicy.ts`; three copies |
| `lib/helpers/chartPalette.ts` | #5943 (+#5973) | `@agenta/ui` — pairs with F-01 |
| `lib/hooks/useChartSeries.ts` | #5943 | `@agenta/ui` |

Segment B (13 files):

| File | PR | Proposed package home |
| --- | --- | --- |
| `pages/settings/AIProviders/AIProviders.tsx` | #5995 | `@agenta/settings-ui` — **and** add its entry to `agenta-settings/src/navigation.ts` (F-11) |
| `AgentChatSlice/assets/onboardingModelSwitch.ts` | #5995 | `@agenta/chat` |
| `AgentChatSlice/hooks/useOnboardingProviderSetup.ts` | #5995 | `@agenta/chat` |
| `AgentChatSlice/hooks/useChatSlashCommands.tsx` | #5995, #6024 | `@agenta/chat` — same file as the Segment A row; take the #6024 state |
| `AgentChatSlice/hooks/useSessionShortcuts.ts` | #6005 | `@agenta/sessions` |
| `AgentChatSlice/hooks/useInlineRenameRequest.ts` | #6005 | `@agenta/sessions` |
| `AgentChatSlice/state/uiRequests.ts` | #6005 | `@agenta/sessions` |
| `pages/settings/Triggers/components/useAgentNameById.ts` | #5975 | `@agenta/settings` |
| `Drives/SessionFilesPane.tsx` | #5946, #6016 | `@agenta/entity-ui/drive` — take the #6016 state |
| `SlashCommand/PermissionsPickerPanel.tsx` + `README.md` | #5817, #6024 | `@agenta/ui` — take the #6024 state |
| `SlashCommand/HarnessPickerPanel.tsx` | #5817, **deleted by #6024** | do not extract; port the delete |

Plus 25 test/fixture files (`__fixtures__/*.json`, the two `generate/*.py` scripts, `goldenSessions.ts`)
which follow whichever way `transcriptToMessages` goes; the release already duplicated
`abandonedFormSession.json` into `agenta-chat/tests/unit/assets/__fixtures__/`.

# Package-layer files (145 touched, 32 collide, 43 new)

`web/packages` exists on both lines, so most of this merges normally. Two sub-sets need attention:

- **43 new package files** created by the release that the lane lacks — clean adds, but several
  import through paths the lane reorganised. Highest risk: `agenta-shared/src/clientTools/index.ts`
  (#5919), `agenta-entities/src/session/state/{interactionAnswer,invalidate}.ts` (#5919, #5974),
  `agenta-sessions-ui/src/{SessionAutomationKind.tsx,automationMenu.ts}` (#5927),
  `agenta-sessions/src/state/sessionListPolicy.ts` (#5939), `agenta-ui/src/RichChatInput/{assets/slashCommands.ts,plugins/SlashCommandPlugin.tsx}` (#5817),
  `agenta-entity-ui/src/gatewayTrigger/drawers/*` (#5927), plus new `vitest.config.ts` in
  `agenta-sessions-ui` and `agenta-ui`. None existed at `FORK`, so none is a lane deletion.
- **32 collisions** (both lines changed the same package file). Verified list in the scratchpad;
  the ones that matter are `agenta-chat/src/assets/{loadSession,transcriptToMessages}.ts`,
  `agenta-chat/src/hooks/useAgentConversation.ts`, `agenta-chat/src/model/approvals.ts`,
  `agenta-entities/src/session/{index.ts,state/interactionStatus.ts}`,
  `agenta-sessions{,-ui}/src/**` (7 files), `agenta-playground/src/state/execution/agentApprovalResume.ts`,
  `agenta-ui/src/RichChatInput/RichChatInput.tsx`.

# Renames the automated match missed

The handoff warned the silent set is a floor. Re-derived by symbol, then by hand where the symbol
also changed. New entries for the move map:

| App path at `REL` | Successor on the lane |
| --- | --- |
| `Sidebar/engine/SidebarMenu.tsx` | `agenta-navigation-ui/src/NavMenu.tsx` (rewrite) |
| `Sidebar/engine/SidebarShell.tsx` | `agenta-navigation-ui/src/SidebarShell.tsx` |
| `pages/agent-home/components/HomeSessionsSection.tsx` | folded into `agenta-home-ui/src/HomeOverview.tsx` |
| `pages/agent-home/components/HomeAutomationsSection.tsx` | folded into `agenta-home-ui/src/HomeOverview.tsx` |
| `pages/settings/Triggers/components/GatewaySchedulesSection.tsx` | `agenta-settings-ui/src/triggers/TriggerSchedulesSection.tsx` |
| `pages/settings/Triggers/components/GatewaySubscriptionsSection.tsx` | `agenta-settings-ui/src/triggers/TriggerSubscriptionsSection.tsx` |
| `pages/settings/Tools/components/AgentaToolsPlaceholder.tsx` (**deleted** by #5943) | `agenta-settings-ui/src/tools/AgentaToolsPlaceholder.tsx` — port the delete |
| `styles/code-editor-styles.css` | `agenta-ui/src/styles/code-editor-styles.css` (612→624) |
| `lib/atoms/sidebar.ts` | `agenta-navigation/src/state.ts` |
| `state/newObservability/atoms/controls.ts` | `agenta-observability/src/state/controls.ts` |
| `state/observability/dashboard.ts` | `agenta-observability/src/state/*` (oss path is a binding) |
| `lib/helpers/dateTimeHelper/index.ts` | `agenta-shared/src/utils/dateTime/index.ts` |
| `AgentChatSlice/assets/sessionMotion.ts` | `agenta-sessions-ui/src/assets/motion.ts` |
| `AgentChatSlice/state/pendingSessionOpen.ts` | `agenta-sessions/src/state/pendingSessionOpen.ts` |
| `AgentChatSlice/state/panelLayout.ts` | `agenta-chat/src/state/panelLayout.ts` |
| `pages/agent-home/assets/templates.ts` | `agenta-entities/src/workflow/agentTemplates.ts` |

# Verified present / no action

- **D-01 is closed** — `web/oss/tailwind.config.ts:288` on the lane has `xs: ["13px", …]`.
- **`web/mobile` loses nothing in Segment A.** 5 files touched; `theme.generated.css` has 28 tokens
  the release lacks and none missing.
- **`web/ee/src`** — zero files touched by any Segment A PR.
- **#5974's `AgentConversation.tsx` hunk** — 1 added line, 0 missing: already on the lane.
- **#5973's `DrillInFieldHeader` and #5943's `lib/helpers/colors.ts`** — the release fixed the
  package twin in the same PR; the merge carries them.
- **#5522, #5938, #5941, #5966** — package/config-only, no app-layer surface, nothing to re-home.
- **#5928** — 21 files, all generated `agenta-api-client` types; clean adds.
- **#5919 / #5932** — app *and* package copies both fixed; visible conflicts, no silent loss.
  (Their app-copy conflicts should still be resolved as "keep deleted".)

# Not yet examined — explicit gaps

1. *(closed — see [F-17](#f-17--the-f-16-union-closed-27-files-five-verdicts))* All 27 files opened
   and adjudicated. The total is now firm at **76**. Two things F-17 surfaced that were not in the
   original scan: `antd-overrides.generated.ts` is a third stale generated token artifact (F-01/F-02),
   and `useSessionHydration.ts` needs a semantic re-expression rather than a port.
2. *(closed — see [F-18](#f-18--the-package-layer-adjudicated-per-file-276-files-one-real-break))*
   All 276 package files classified, with real 3-way conflict counts. **Still open inside it:** the
   105 clean adds were not opened, so whether each one's *imports resolve* against the lane's
   reorganised trees is untested — that is a `tsc` gate at merge time, not an analysis task.
3. **The two independently-created files** (`agenta-entities/src/session/state/interactionStatus.ts`,
   `gatewayTrigger/state/invalidate.ts`) need a pick-one-side decision. Both sides wrote them from
   scratch post-fork for the same purpose; neither implementation was read.
4. **`useRunMetricData.ts` → `evaluatorResolution.ts`** is a one-symbol match and may be a false
   positive. Verify before acting.
5. **`AgentChatSlice/state/sessions.ts` (F-06)** — the 278-line gap between `REL` and the lane was
   not attributed. Some of it is the lane moving code into `@agenta/sessions`; how much is unknown.
6. **No render-time verification of anything.** Every claim here is a tree comparison. The lane may
   implement a behaviour differently in a place neither the symbol index nor the successor read
   reached — the trap the original audit named. The bindings in F-07/F-12/F-13 were read in full;
   the ~50 A1 successors were size-compared and spot-read, not read end to end.
7. **The Segment B PRs skipped as non-frontend were taken on the scope doc's word** (#5991, #5992,
   #6006, #6014, #6017 and the docs/chore rows). Their merge diffs were not run.
8. *(closed)* `web/ee/src` — **zero** files touched across both segments. But F-13 surfaced that the
   lane carries an ee `SidebarBanners` copy the release never updates; whether the lane's ee tree has
   other such orphans was not swept.
