# Remediation plan: closing the v0.112 drift

Execution plan for [mahmoud-112-drift-inventory.md](mahmoud-112-drift-inventory.md). Structured so
independent agents can run in parallel without colliding.

Refs (unchanged from the audit): `FORK` `613368b81b`, `REL` `origin/release/v0.112.0` `4af155162b`,
`TIP` `origin/docs/sessions-ux-stack` `15c246b334`.

## Decisions locked

1. **Browse layout is env-controlled, defaulting to Mahmoud's toolbar. The rail work is kept, not
   deleted.** So D-05 / D-13 / D-25 become one flag work package (WP-1D) rather than three reverts.
   Both layouts stay in `@agenta/sessions-ui` and `@agenta/home-ui`; mobile keeps the rail
   unconditionally.
2. **Everything lands on one new lane, `fix/mahmoud-112-drift`, stacked on `docs/sessions-ux-stack`.**
   The 30 drafted PRs are not touched. Intermediate lanes keep their regressions — the same recorded
   decision as the CodeRabbit pass. This is what makes parallelism possible at all (see below).

## Pre-flight findings (run before dispatch — done, 2026-08-11)

Four facts discovered while preparing wave 0. Two of them change where execution starts.

1. **Two divergent lines exist; branch from the published one.** `origin/docs/sessions-ux-stack` is
   **not an ancestor** of the local working branch. The local line (`fix/oauth-callback-settle`,
   `079bc20be4`) is a **rebased/rewritten copy** of the same stack — same commit subjects, different
   SHAs (the audit's `067666a749` is `396a5acabd` locally) — plus a QueryClient lane. They have
   genuinely diverged: 82 commits local-only, 144 published-only.

   **Base the fix lane on `origin/docs/sessions-ux-stack`.** It is pushed, it is what the 30 drafted
   PRs sit on, and it is what the audit measured. The local branch is **not pushed**, so nothing
   could be PR'd against it. This is safe because **48 of the 53 locked files are byte-identical
   across the two lines** — the fix content applies the same either way. The five that differ are
   `agenta-ui/package.json`, `web/pnpm-lock.yaml`,
   `agenta-navigation/src/dynamic/useSidebarDynamicChildren.ts`,
   `TemplateStrip/components/CopiedToast.tsx` (WP-1E deletes it anyway) and
   `agenta-home-ui/src/UsageCard.tsx`; for those, trust the published tip, which is what every
   finding was verified against.

   Findings also reproduce on the local line (D-01, D-02, D-08, D-14, D-15, D-19 all spot-checked),
   so whoever eventually reconciles the two lines gets the same fixes either way. Line numbers in the
   census are from the published tip; match on content, not position.
2. **Do not execute in this worktree.** It carries **118 uncommitted files** from a separate
   in-flight workstream (`@agenta/observability` extraction + oauth-callback-settle). A landing pass
   that commits "in WP order" here would sweep them in. Cut a clean worktree from the local line.
   Only **one** of those dirty paths collides with a WP lock —
   `packages/agenta-sessions-ui/src/index.ts` (WP-1D), a staged additive barrel export for
   `SessionListPanel`/`SessionTab*`/`useSessionActions`. Benign, but rebase it out or land it first.
3. **The tsc baseline could not be captured in advance** — this worktree is neither at `TIP` nor
   clean, so a number from it would describe the wrong tree. Capture it as **step 0 of execution**,
   in the clean worktree, before any WP edits: `pnpm --filter @agenta/oss exec tsc --noEmit
   > /tmp/tsc-baseline.txt 2>&1`. Gate on the error **signature** diff, never the count.
4. **Toolchain gotcha, learned the hard way.** `set -- $pair` inside a `for` loop silently
   misbehaves in this zsh; it inverted the first pre/post-fork classification so that all 30 PRs came
   back "POST-FORK". Use `while read -r a b; do … done <<'EOF'`. Related: `git show "$REF:web/…"`
   must be **quoted** — unquoted, zsh eats part of the path and git reports a bogus "unknown
   revision".

## Why the landing model dictates the parallelism model

`but rub`, `but absorb` and `but commit --only` all operate on the **stack's** assigned-change set
and route by hunk dependency. Two agents running `but` concurrently will scramble the stack — this is
documented in `AGENTS.md` and has cost hours before. Therefore:

> **Agents author. They never run `git commit`, `but`, `gh`, or `pnpm lint-fix`.**
> One serial landing pass at the end does all of it.

Because everything lands on a single lane, agents can share **one worktree** and edit in parallel, as
long as their file sets are disjoint. That is cheaper and safer than per-agent worktrees (no merge
step, no lockfile duplication). The file-lock table below is the contract that makes it safe.

---

## File-lock table

An agent may start when **every lock it needs is free** and its dependencies are done. No two
concurrent agents may hold the same path. Paths are relative to the repo root.

| WP | Locks | Depends on |
| --- | --- | --- |
| **WP-0A** type-scale foundation | `web/oss/tailwind.config.ts` | — |
| **WP-0B** #5850 census (read-only) | *none* | — |
| **WP-1A** ui primitives | `web/packages/agenta-ui/src/components/ui/dropdown-menu.tsx`, `web/packages/agenta-ui/src/InfiniteVirtualTable/atoms/columnVisibility.ts`, `web/packages/agenta-ui/package.json`, `web/pnpm-lock.yaml`, `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/PromptSchemaControl.tsx` | — |
| **WP-1B** nav chrome | `web/packages/agenta-navigation-ui/src/{SidebarToggleButton,SidebarLogo,NavMenu,ProjectOrgSwitcher}.tsx` | 0B |
| **WP-1C** nav dynamic children | `web/packages/agenta-navigation/src/dynamic/{registry,types,useSidebarDynamicChildren}.ts` | — |
| **WP-1D** browse-layout flag | `web/oss/src/components/pages/sessions/SessionsPage.tsx`, `web/oss/src/components/pages/sessions/components/SessionFiltersBar.tsx` (delete), `web/oss/src/components/pages/agents/AgentsPage.tsx`, `web/oss/src/components/pages/agent-home/components/TemplatesGallery/index.tsx`, `web/oss/src/components/pages/agent-home/assets/constants.ts`, `web/oss/src/lib/helpers/dynamicEnv.ts`, `web/packages/agenta-sessions-ui/src/index.ts`, `web/packages/agenta-home-ui/src/{TemplateGallery,index}.ts(x)` | — |
| **WP-1E** home create flow | `web/oss/src/components/pages/agent-home/StripHome.tsx`, `.../components/TemplateDetail/index.tsx`, `.../hooks/useCreateAgentFromTemplate.ts` (new), `web/oss/src/components/TemplateStrip/components/{AgentIntentActions,StripComposer,CopiedToast}.tsx`, `web/oss/src/components/TemplateStrip/assets/{constants,codingAgentClipboard}.ts(+test)`, `web/oss/src/components/AgentChatSlice/{AgentConversation.tsx,components/AgentComposerDock.tsx,hooks/useOnboardingChat.ts}` | — |
| **WP-1F** home-ui panels | `web/packages/agenta-home-ui/src/{AgentsPanel,NewAgentButton,UsageCard,TemplateDetail}.tsx`, `web/oss/src/components/pages/agent-home/components/YourAgentsTable/index.tsx` | 0B |
| **WP-1G** entity-ui | `web/packages/agenta-entity-ui/src/agent/AgentConfigSummaryCard.tsx`, `web/packages/agenta-entity-ui/src/drive/{ContextRail,DriveHeader}.tsx` | 0B |
| **WP-1H** page gutters | `web/oss/src/pages/w/[workspace_id]/p/[project_id]/apps/[app_id]/overview/index.tsx`, `web/oss/src/pages/w/[workspace_id]/p/[project_id]/settings/index.tsx`, `web/oss/src/components/Layout/Layout.tsx` | — |
| **WP-1J** chat type scale | `web/oss/src/components/AgentChatSlice/components/{AgentChatEmptyState,AgentMessage,AgentTurn,QueuedMessages,SessionHistoryMenu,ToolActivity}.tsx`, `.../components/Inspector/{EventRow,lenses/ContextLens,lenses/TimelineLens}.tsx`, `.../components/clientTools/ElicitationWidget.tsx`, `web/oss/src/components/Playground/Components/Modals/RefinePromptModal/assets/InstructionsPanel.tsx`, `web/packages/agenta-chat/src/components/{AudioPlayer,ComposerAttachments,ApprovalCard}.tsx` | 0B |
| **WP-2A** chat replay ports | `web/packages/agenta-chat/src/assets/{transcriptToMessages,loadSession}.ts` (+ their tests), `web/packages/agenta-entities/src/session/{index.ts,state/interactionStatus.ts}`, `web/packages/agenta-playground/src/state/execution/agentApprovalResume.ts` (+ `tests/unit/renderMap.test.ts`), `web/packages/agenta-shared/tests/unit/elicitation.test.ts`, `web/oss/src/components/AgentChatSlice/components/clientTools/{registry.tsx,meta.test.ts}` | — |
| **WP-2B** liveness + connect flow | `web/oss/src/components/AgentChatSlice/state/{liveness,sessions}.ts` (+ tests), `.../hooks/{useAgentChatSession,useSessionHydration}.ts` (+ tests), `.../components/InteractionDock.tsx`, `.../components/clientTools/{useConnectFlow,ConnectToolWidget}.tsx` (+ test) | — |
| **WP-2C** trigger invalidation | `web/packages/agenta-entities/src/gatewayTrigger/**`, `web/oss/src/components/AgentChatSlice/assets/{toolCacheEffects.ts(new),toolDisplay.ts}`, `.../hooks/{useToolCacheInvalidation.ts(new),useFileActivityDetector.ts}`, `.../components/ApprovalDock.tsx` + **`useAgentChatSession.ts`** | **2B** (shared lock) |
| **WP-2D** project watch (FE) | `web/oss/src/hooks/useProjectWatch.ts` (new), `web/oss/src/components/Layout/ProjectWatch.tsx` (new, + test), `web/oss/src/components/EntityIdentity/useRenameApp.ts`, `.../AgentChatSlice/hooks/useSessionRecordsWatch.ts` + **`Layout.tsx`**, **`AgentChatSlice/state/sessions.ts`** | **1H + 2B** (shared locks) |
| **WP-2E** playground Try again | `web/oss/src/components/Playground/Components/MainLayout/index.tsx` | — |

Everything with no dependency can start immediately. The practical schedule is **0A+0B → nine of
1A–1J in parallel → 2A/2B/2E in parallel → 2C/2D → verification**.

---

## Wave 0

### WP-0A — restore the 13px `xs` step  *(D-01, ~5 min)*

Re-add to the `fontSize` object in `createConfig` (`web/oss/tailwind.config.ts`), immediately above
the `tremor-*` entries, exactly as at `REL:web/oss/tailwind.config.ts:275-276`:

```ts
// `secondary` step of the type scale. `sm` stays stock 14/20 (`body`).
xs: ["13px", {lineHeight: "18px"}],
```

Removed by our own commit `067666a749`. **Do not** re-remove any of the package globs that commit
added — they are correct and load-bearing. Confirm `web/ee/tailwind.config.ts` consumes
`createConfig` (it should inherit; if it defines its own `fontSize`, report rather than fix).

**DoD:** `git grep -n 'xs: \["13px"' -- web/oss/tailwind.config.ts` matches, and
`web/mobile` is untouched (its Tailwind v4 bridge never had this step — see gap 2 in the audit).

### WP-0B — complete the #5850 census  *(read-only, gap 1)*  — ✅ **DONE, 2026-08-11**

**Result:** `REL` has **0** occurrences of the five retired steps across `web/oss/src`,
`web/ee/src` and `web/packages`; `TIP` has **79**. Every one is drift. Full per-file, per-line table
is in the inventory under *"WP-0B deliverable — the complete #5850 census"*, split into
**A — lost #5850 edits** (55 occurrences, 20 files) and **B — off-ladder new code** (24, 8 files).

**The lock table below is superseded by that section's "Lock-table amendments"** — four paths carry
census rows and had no owner: the `agenta-sessions-ui` components go to WP-1D, `TemplateGallery` +
`AnalyticsRangePicker` to WP-1F (and `TemplateGallery` comes **out** of WP-1D's locks),
`AgentRevisionStatus` and `markdown.tsx` to WP-1J. Apply those before dispatch.

The original brief follows, for anyone re-running it.

The audit swept only for `text-[10px]` / `text-[11px]`, so D-20/D-21/D-22 are a **lower bound**.
Produce the complete residue list before the sweep WPs edit anything.

Method: take the full patch `git diff 9d283cdeac^1 9d283cdeac`. For each of the 181 files, resolve
its successor at `TIP` (unmoved path, or the package successor from the audit's move map). For each
`+` line in the hunk, check the successor for the **pre-image** (`-` side) surviving. Cover the
classes the first sweep missed: `text-sm`→`text-base`, heading `20`→`24`, `text-[13.5px]`,
`text-[11.5px]`, `!text-[10px]`, `leading-[…]` pairs, and the four `@agenta/ui` shadcn parity shims
(`alert`, `divider`, `progress`, `spinner`).

**Deliverable:** a markdown table appended to the inventory under a new `## D-20/21/22 — complete
file list` heading: `file · line · found · expected · owning WP`. Rows must map onto **WP-1B / 1F /
1G / 1J only**; if a row lands outside those locks, flag it — it needs a new WP, not a lock breach.

**Writes nothing but that one markdown file.**

---

## Wave 1

### WP-1A — `@agenta/ui` primitives  *(D-02, D-03, D-04)*

Three independent one-to-few-line ports from `REL`.

1. **D-02 (highest user impact in the whole inventory).** Add `"animate-none"` to the `cn(...)` class
   list of **both** `DropdownMenuContent` and `DropdownMenuSubContent` in
   `agenta-ui/src/components/ui/dropdown-menu.tsx`, with Mahmoud's comment. Source:
   `git show 3f91f12abd -- web/packages/agenta-ui/src/components/ui/dropdown-menu.tsx`.
   *Trap:* this file's `cn` is the local `./utils` one — check it is `twMerge`-based before assuming
   `animate-none` beats the `:where()` rule; if it is a plain join, class order is what wins and the
   token must come **after** any `animate-*` in `className`.
2. **D-03.** `data-testid="prompt-schema-control"` on both return branches of `PromptSchemaControl`.
3. **D-04.** Port `enableMapSet()` at module scope in
   `agenta-ui/src/InfiniteVirtualTable/atoms/columnVisibility.ts` (with its comment) and re-add
   `"immer": "^10.1.3"` to `agenta-ui/package.json` dependencies.
   *This is the only WP that touches `web/pnpm-lock.yaml`.* Do **not** run `pnpm install` — record in
   the handoff that the landing pass must run it and commit the lockfile delta.

**DoD:** all three greps that returned empty in the audit now match; no other `@agenta/ui` export
changed.

### WP-1B — navigation chrome  *(D-15, D-16, D-17, D-18 + WP-0B rows)*

All four live in `@agenta/navigation-ui`; the oss files are re-export shims, so fixing the package
fixes every rail.

| Finding | File | Change |
| --- | --- | --- |
| D-15 | `SidebarToggleButton.tsx` | `!h-[28px]` → `!h-[22px] !w-[22px] !p-0`; add `relative after:absolute after:inset-[-3px] after:content-['']`; icon `size={14}` → `16` |
| D-16 | `SidebarLogo.tsx` | row gains `mt-2`; expanded branch gains `ml-2`; `AgentaWordmark` `85×20` → `99×22` |
| D-17 | `NavMenu.tsx` | `w-[94%]` → `w-[calc(100%-16px)]` at lines 43, 139, 265 — keep `mx-auto`, which replaces the old `!mx-2` |
| D-18 | `ProjectOrgSwitcher.tsx` | trigger (line ~281): `border border-solid border-colorBorderSecondary` → `border-0`. **Leave line 314's dropdown border alone** — that is the popover, not the trigger |

Source hunks: `git show 4955d6f8fb`. **Watch the token rename:** the oss originals used
`[var(--ag-colorBorderSecondary)]`; the package uses the bare `colorBorderSecondary` Tailwind token.
Port the *intent*, not the literal string.

*Note D-17 is not a mechanical copy* — the antd-`Menu` original is gone; `NavMenu` is a Radix/plain
rewrite. Match the 8px-each-side inset so nav rows align with the brand row's toggle, which is what
the fix was for.

### WP-1C — sidebar session group headings  *(D-14)*

Remove the grouped-heading machinery, per `git show 9994175b38`:

- `agenta-navigation/src/dynamic/registry.ts`: drop the `getGroup:` passthrough (line 59) and the
  sessions source's `getGroup: (session) => (session.pinned ? "Pinned" : "Recent")` (line 92).
- `dynamic/types.ts`: drop both `getGroup?` declarations (lines 65, 87) and their doc block.
- `dynamic/useSidebarDynamicChildren.ts`: drop the `groups` map, the `currentGroup` tracking and the
  heading-row `children.push({... isPlaceholder: true})` block (lines ~92-99).

The `"Recent"` label is **new in our stack** and has no upstream — it goes with the rest.

**DoD:** `git grep -n "getGroup" -- web/packages/agenta-navigation` is empty; the sidebar sessions
list renders rows only; `@agenta/navigation` unit tests pass.

### WP-1D — browse layout behind an env flag  *(D-05, D-13, D-25 — per the locked decision)*

**Goal:** the toolbar is the default; the rail survives as an opt-in. No layout code is deleted.

Follow the repo's existing build-time flag pattern exactly (`TEMPLATE_BUILDER_MODE` /
`PLAYGROUND_NATIVE_ONBOARDING` in `web/oss/src/components/pages/agent-home/assets/constants.ts`):

1. Register `NEXT_PUBLIC_AGENT_BROWSE_RAIL` in `processEnv` in `web/oss/src/lib/helpers/dynamicEnv.ts`
   (with a comment). **No `hosting/` change is needed** — `NEXT_PUBLIC_*` reaches the browser through
   `window.__env`, and the sibling flags have no compose entries either.
2. Add, beside the other mode constants:
   ```ts
   /** Browse-surface layout (`NEXT_PUBLIC_AGENT_BROWSE_RAIL`). OFF by default: sessions, agents and
    * the templates gallery use the one-row toolbar (#5833/#5846). Set to "true" for the filter rail.
    * Mobile always renders the rail — it is the phone's whole viewport, not a second sidebar. */
   export const BROWSE_RAIL_MODE = (getEnv("NEXT_PUBLIC_AGENT_BROWSE_RAIL") || "").toLowerCase() === "true"
   ```
3. **Packages stay prop-driven** (`agenta-package-practices`): no package reads the env. Each host
   branches and passes what it wants.
   - `SessionsPage.tsx`: when off, render the package `SessionFiltersBar` (it already exists, is
     exported, and mobile uses it) above `SessionsListView`; when on, keep today's
     `FilterRailLayout` + `SessionFiltersPanel`. Restore `title` onto `PageLayout` and drop `!p-0` in
     the toolbar branch — `git show dc39c05be3 -- .../SessionsPage.tsx` is the target shape.
   - Delete the orphaned app copy `web/oss/src/components/pages/sessions/components/SessionFiltersBar.tsx`
     (no importer at `TIP`; the package component supersedes it — pass the agent options through the
     package component's props rather than re-adding an antd `Select` in the app).
   - `AgentsPage.tsx` and the templates gallery: same branch. For the toolbar branch reinstate
     `pageContentWidthClass` (D-25).
   - `agenta-home-ui/src/TemplateDetail.tsx` gains a `layout?: "toolbar" | "rail"` prop
     (default `"toolbar"`), the toolbar branch being #5846's top-bar shape from
     `git show e689f86331`. **This file is WP-1F's lock — hand D-13 to WP-1F** and limit this WP to
     the sessions/agents/gallery hosts plus the flag plumbing.

**DoD:** flag unset → toolbar on all three surfaces; `NEXT_PUBLIC_AGENT_BROWSE_RAIL=true` → today's
rail, unchanged; `web/mobile` untouched and still rendering `SessionFiltersPanel`.

### WP-1E — the create-agent flow  *(D-06 … D-10, plus Class A D-28)*

The largest WP. All of it is `git show cd13ca3747` (#5848) re-applied on top of the extraction, plus
one Class A port that happens to sit in the same file.

1. **D-07 — re-add `useCreateAgentFromTemplate`.** Copy
   `git show $REL:web/oss/src/components/pages/agent-home/hooks/useCreateAgentFromTemplate.ts`
   verbatim; **every dependency still exists at `TIP`** — the oss `./useCreateAgent` hook with the
   same `{name, seedMessage, autoSendSeed}` signature, `../assets/onboardingAnalytics`, and
   `templateBuilderMessage`, which now imports from `@agenta/entities/workflow`. Only two edits are
   needed: that import path, and `AgentTemplate` → `AgentStarterTemplate`.
   *Trap:* there are **two** `useCreateAgent` hooks. Use the oss one
   (`pages/agent-home/hooks/useCreateAgent.ts`, which seeds + navigates), **not**
   `@agenta/home-ui/src/useCreateAgent.ts` (which only mints and commits).
2. **D-07 cont. — wire it in `StripHome.tsx`:** `handlePick` → `void createFromTemplate(template)`,
   and pass `pendingTemplateKey={pendingKey}` to `<TemplateStrip>`. `StripCard`'s
   `loading`/`disabled`/`aria-busy` props survived the extraction and are simply undriven.
3. **D-06 — `TemplateDetail/index.tsx` (the oss wrapper):** `onUseTemplate` → `createFromTemplate`;
   pass `busy={pendingKey === template.key}`. The package component **already accepts `busy`** — no
   package edit.
4. **D-08 — remove the coding-agent copy path again.** Delete `TemplateStrip/components/CopiedToast.tsx`,
   `TemplateStrip/assets/codingAgentClipboard.ts` and its test; strip `onCodingAgentCopy` from
   `AgentIntentActions.tsx` and `StripComposer.tsx`; remove `useCodingAgent`, `copiedToast`,
   `CODING_AGENT_INSTALL` and `TOAST_DISMISS_MS` from `TemplateStrip/assets/constants.ts`; remove
   `handleCodingAgentCopy` / `copiedToastOpen` from `useOnboardingChat.ts`, `AgentComposerDock.tsx`,
   `AgentConversation.tsx` and `StripHome.tsx`.
5. **D-09 — `seededTemplate` back to the key:** `useRef<string | null>(null)`, reset to `null` when
   `templateParam` is absent, early-return on `=== templateParam`.
6. **D-10 — re-add `blankCreate`** (`creatingAgent && !templateParam`): hides `TemplateStrip` and
   adds `my-auto` on the first-run column.
7. **D-28 (#5913) — in `AgentConversation.tsx`,** port the `anyPendingInteraction` memo
   (`buildRenderMap` + `isPendingClientToolInteraction` from `@agenta/playground`) and change the
   status expression to `hitlPending || anyPendingInteraction`, with its deps. Source:
   `git show b670e851a8`.

**Do not** restructure the returning-user branch — that is legitimately `HomeOverview` now.

### WP-1F — `@agenta/home-ui` panels  *(D-11, D-13, D-21 + WP-0B rows)*

1. **D-11.** In `AgentsPanel.tsx`, remove the `onNewAgent` header button (and the now-dead prop), and
   drop the `onNewAgent={...}` argument in `YourAgentsTable/index.tsx`. Keep "All agents".
   Mahmoud's reason: *"the page header already carries 'New agent', so a second one here was noise."*
   Check `web/mobile` does not depend on `onNewAgent` before deleting the prop; if it does, keep the
   prop and stop passing it from oss.
2. **D-13.** Add `layout?: "toolbar" | "rail"` to `TemplateDetail.tsx`, default `"toolbar"`, with
   #5846's top-bar shape (`git show e689f86331`) as the toolbar branch. Coordinate the prop name with
   WP-1D — it is the same flag, read by the host.
3. **D-21.** `NewAgentButton.tsx:90` and `UsageCard.tsx:31` `text-[11px]` → `text-xs`; plus every
   `TemplateGallery.tsx` / `TemplateDetail.tsx` row WP-0B reports.

### WP-1G — `@agenta/entity-ui`  *(D-19, D-20 + WP-0B rows)*

1. **D-19 (user-visible, one line).** In `agent/AgentConfigSummaryCard.tsx:39`:
   `const stated = (summary: string) => ({summary, status: "default" as const})`, carrying Mahmoud's
   comment. Leave `emptyAction` and the `warning` status alone — only the resting state goes grey.
   Verify the `"complete"` arm is then unreferenced; if so remove it from the union, otherwise leave it.
2. **D-20.** `drive/ContextRail.tsx` lines 279, 291, 295, 423 and `drive/DriveHeader.tsx` lines 139,
   151, 251 → the #5850 targets (`text-[11px]`→`text-xs`, `text-[10px]`→`text-[12px]`). Exact
   pre/post pairs: `git diff 9d283cdeac^1 9d283cdeac -- web/oss/src/components/Drives`.
   The other 14 drive files are already correct — **do not touch them.**

### WP-1H — page gutters  *(D-23, D-24)*

1. **D-23.** `apps/[app_id]/overview/index.tsx:114`: `isAgent && "min-h-0 !pl-[4.5rem] !pr-14 !pb-0"`
   → `isAgent && [pageContentWidthClass, "min-h-0"]`, importing from `@agenta/ui/components/page-width`,
   and replace the stale `!px-10` comment with #5836's.
2. **D-24 needs a call, not just a port.** `settings/index.tsx` has `FULL_WIDTH_TABS` back **and**
   `Layout.tsx` has lost the `isAuditLog` full-height branch that variant depends on — the two halves
   now disagree. Determine which combination is coherent by reading
   `@agenta/settings-ui/src/SettingsPageShell.tsx` (the audit did not), then either
   (a) apply #5836 — delete `FULL_WIDTH_TABS`, variant becomes `FORM_TABS.has(t) ? "form" : "full"`,
   leave `Layout.tsx` as-is; or (b) restore `isAuditLog` in `Layout.tsx` to match the reinstated
   `FULL_WIDTH_TABS`. **Report which and why** — do not do both.
3. **`Layout.tsx` lock note:** WP-2D needs one line in this file (`<ProjectWatch />` inside
   `<ProtectedRoute shell="app">`). Release the lock as soon as this WP is done.

**Out of scope:** `pageContentWidthClass` on agents/sessions is WP-1D's toolbar branch.

### WP-1J — the chat type scale  *(D-22 + WP-0B rows)*

Mechanical, but wide. For each locked file, apply #5850's mapping —
`text-[11px]`→`text-xs`, `!text-[11px]`→`!text-xs`, `text-[10px]`→`text-[12px]` — **only where
`git diff 9d283cdeac^1 9d283cdeac` shows Mahmoud made that exact edit**. Do not sweep by regex: #5850
deliberately kept some sites (9px avatar monograms, badge-dot geometry, 61 `text-[13px]` sites,
`MarkdownPreview`'s content scale).

Three of these are package copies whose oss originals were deleted, so the successor is the only
target: `agenta-chat/src/components/{AudioPlayer,ComposerAttachments}.tsx` (successors of the deleted
`AgentChatSlice/components/*`) and `ApprovalCard.tsx` (successor of the approval markup #5850 touched
via `ApprovalDock.tsx` — confirm the mapping before editing, and if `ApprovalDock.tsx` also needs
edits, report it: that file is **WP-2C's lock**).

**Explicitly excluded:** `AgentChatSlice/assets/markdown.tsx` — #5850 never touched it; its
`!text-[10px]` is our own Streamdown work.

---

## Wave 2 — Class A ports

These are absent by construction, so there is nothing to prove — only to port. Each starts from
`git show <commit>` on `REL` and re-applies onto the extracted layout.

### WP-2A — transcript replay  *(D-26 #5912, D-27 #5859)*

**The extraction made this easier:** the oss originals
(`AgentChatSlice/assets/{transcriptToMessages,loadSession,messageParts}.ts`) **no longer exist at
`TIP`**, so the "parity copy" problem is gone — port into `@agenta/chat` only, and drop the
`efb5a0b34b` "sync to the parity copy" commit entirely.

Port in commit order: `57ee7c00c2` (new `agenta-entities/src/session/state/interactionStatus.ts` +
`session/index.ts` export) → `059552579d` → `67de6c8a9f`/`c4c355…` (#5859's `request_input` replay) →
the package test updates. Strip the now-false "Copied from web/oss/… the OSS original remains
authoritative" header comments as you go — they name files that no longer exist.

### WP-2B — liveness and the connect flow  *(D-29 #5857, then D-30 #5909)*

Sequential inside the WP, in commit order (`aaa6f7a287` before `96e42a9f79`) — they share
`useAgentChatSession.ts` and `useSessionHydration.ts`.

**#5857 needs one design call:** at `REL`, `liveness.ts` imports `SessionRunStatus` and
`sessionStatusAtomFamily` from `./sessions`; at `TIP` it imports them from `@agenta/chat/model` and
`@agenta/chat/state`. The port adds `sessionLocalSettledAtAtomFamily` — decide whether that atom
belongs in `@agenta/chat/state` beside its siblings (preferred: it is the same concept) or stays
app-side, and say which in the handoff.

**#5909** additionally carries `d2a6d55c00` (a background records refresh must not clobber a pending
decline) and `a41ecebe2c` (recheck the guard after the async fetch resolves) — port all three. The
API half (`a25681d7be`, `e5f8605374`) is **out of scope**: it is already on `release/v0.112.0` and
this lane sits above it.

### WP-2C — trigger cache invalidation  *(D-31 #5863)*  — needs WP-2B's lock

Port `965851e15d` / `b054e6f7c7`: new `agenta-entities/src/gatewayTrigger/state/invalidate.ts` and
its barrel exports, new `AgentChatSlice/assets/toolCacheEffects.ts` (+ test) and
`hooks/useToolCacheInvalidation.ts`, plus the edits to `toolDisplay.ts`, `ApprovalDock.tsx`,
`useFileActivityDetector.ts` and `useAgentChatSession.ts`.

*`messageParts.ts` has no successor at `TIP`* — find where its logic now lives in `@agenta/chat`
before porting that hunk; do not recreate the deleted file.

### WP-2D — project watch, frontend half  *(D-32 #5903)*  — needs WP-1H + WP-2B locks

Port the four FE commits `8757dc6727` (W3), `e2b4f4277b` (T1), `b1d497dd47` (A4) and the
`sessions.pageTitle` test: new `hooks/useProjectWatch.ts`, new `Layout/ProjectWatch.tsx` + test, the
`<ProjectWatch />` render in `Layout.tsx`, the non-empty-server-name reconcile in
`AgentChatSlice/state/sessions.ts`, the `is_application` workaround removal in `useRenameApp.ts`, and
`useSessionRecordsWatch.ts`.

**The API half is already on `release/v0.112.0`** (`0de7d62207` W1, `0ce7198778` W2 — the
`GET /sessions/watch` endpoint), so the FE port has a live backend. Verify that before wiring, and if
the endpoint is missing, stop and report rather than stubbing.

### WP-2E — Try again  *(D-33 #5906, one line)*

`Playground/Components/MainLayout/index.tsx`: `<Button>Try again</Button>` →
`<Button onClick={() => window.location.reload()}>Try again</Button>`. The surrounding file was
heavily rewritten by the stack (`SplitPane`, `chatPanelMaximizedAtom` from `@agenta/chat/state`) —
change only this line.

---

## Wave 3 — verification and landing (serial, one operator)

1. **Type check.** `pnpm --filter @agenta/oss exec tsc --noEmit`. Gate on the **signature diff**
   against the pre-work baseline, not the error count — a count gate hides a new error behind a fixed
   one. Capture the baseline at `TIP` *before* wave 1 starts.
2. **Lint.** One `pnpm lint-fix` inside `web/`. No agent runs this; concurrent runs fight.
3. **Unit tests** for every touched package: `agenta-navigation`, `agenta-sessions`,
   `agenta-entity-ui`, `agenta-chat`, `agenta-playground`, `agenta-shared`, `agenta-settings`.
4. **`pnpm install`** to regenerate `pnpm-lock.yaml` for WP-1A's `immer` dependency, then commit it.
5. **Browser QA.** Arda runs the dev server; wait for his URL. Priority order, because it maps to the
   findings by impact: open any `@agenta/ui` dropdown and confirm it unmounts (D-02) · `/sessions`
   toolbar with `NEXT_PUBLIC_AGENT_BROWSE_RAIL` unset and rail with it set (WP-1D) · pick a home
   template and confirm it creates and lands in the playground (D-07) · a second `?template=` without
   a reload (D-09) · the sidebar brand row and nav-row alignment (D-15/16/17) · the overview
   Configuration card icons are grey (D-19) · a fresh session on a virtual-table page does not crash
   (D-04).
6. **Land.** `but branch new fix/mahmoud-112-drift --anchor docs/sessions-ux-stack`, then commit in
   WP order so each commit is reviewable on its own. Verify with
   `git diff --name-only docs/sessions-ux-stack..fix/mahmoud-112-drift` — the file list must be
   exactly the union of the lock table. Push, then confirm the SHAs match
   (`git ls-remote --heads origin fix/mahmoud-112-drift` vs `git rev-parse`) — `but push` prints
   nothing on success and is not a confirmation.
7. **PR** with `--base docs/sessions-ux-stack`.

---

## Regression guards (recommended, small)

These are what stop the same drift happening on the next extraction. Propose as a separate WP after
the fixes land.

1. **Pin the type scale.** A unit test that resolves the Tailwind config and asserts
   `theme.fontSize.xs === ["13px", {lineHeight: "18px"}]`. D-01 was a silent one-line deletion inside
   an unrelated "register the new workspace packages" commit; nothing could have caught it.
2. **Ban the retired steps.** An eslint rule rejecting `text-[10px]` and `text-[11px]` in
   `web/packages/**` and `web/oss/src/**` (allow-list the geometry-bound exceptions #5850 names). That
   single rule would have surfaced D-20, D-21 and D-22 at author time.
3. **An extraction checklist.** When a file moves app → package, diff the package copy against the
   **app file at the branch point**, not against the version the extraction started from. Every Class
   B finding here is one instance of skipping that step.

---

## Risks

| Risk | Mitigation |
| --- | --- |
| An agent runs `but`/`git commit` and scrambles the stack | Stated in every dispatch prompt; agents author only. One operator lands. |
| Two agents edit the same file | The lock table is the contract. WP-2C/2D wait on shared locks rather than sharing them. |
| WP-0B finds rows outside the four sweep WPs | The agent flags rather than edits; a new WP is cheaper than a lock breach. |
| The `cn` trap (audit "Known traps") silently no-ops D-02 | WP-1A checks which `cn` `dropdown-menu.tsx` imports before trusting class precedence. |
| D-24's two halves are both wrong | WP-1H must pick one coherent combination and report it, not port both sides. |
| Mobile regressions from package edits | WP-1D/1F check `web/mobile` call sites before removing any prop; mobile keeps the rail. |
| D-01 changes ~335 sites' rendered size at once | It is a restoration, not a new change — but put it first in QA so any fallout is attributed to it rather than to the 25 other fixes. |

---

## Dispatch prompt template

```
You are closing finding(s) <IDs> from
docs/design/sessions-ux-stack/mahmoud-112-drift-inventory.md, work package <WP-ID> of
docs/design/sessions-ux-stack/mahmoud-112-drift-remediation-plan.md.

Read both documents' sections for your WP first.

YOU MAY EDIT ONLY THESE PATHS:
  <locks, verbatim from the lock table>
Touching any other path is a failure — report it instead.

DO NOT: run git commit, any `but` command, gh, pnpm lint-fix, or pnpm install.
DO NOT: refactor, rename, or "fix while you're there". Port the named behaviour only.

The upstream source is `git show <commit>` on origin/release/v0.112.0. The extraction renamed
imports and moved files, so port the BEHAVIOUR, not the literal diff — and verify by reading the
new code, never by a grep that returns nothing.

When done, report: files changed, the before/after for each behaviour, anything you could not do
and why, and any path you wanted to touch but did not.
```
