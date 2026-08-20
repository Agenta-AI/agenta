# Drift inventory: Mahmoud's v0.112 fixes vs the extracted packages

Deliverable for [mahmoud-112-drift-audit.md](mahmoud-112-drift-audit.md). **Identification only** —
nothing here was implemented, ported or edited; no branch was touched.

## Ground truth

| Ref | Resolved SHA | Head commit |
| --- | --- | --- |
| `FORK` = `git merge-base origin/release/v0.112.0 origin/docs/sessions-ux-stack` | `613368b81b94e4e5f8bcb1447857e61105b62ef1` | `Merge pull request #5855 …swallowed-exceptions` (2026-08-10, mmabrouk) |
| `REL` = `origin/release/v0.112.0` | `4af155162be0dd25ba00792c20b3d296a3a9b21e` | `Merge pull request #5814 …composio-version-alignment` (2026-08-10) |
| `TIP` = `origin/docs/sessions-ux-stack` | `15c246b334857c79a72b9e08c3fbb16eaa974787` | `docs(frontend): correct the plans, and say which one is live` (2026-08-11) |
| `origin/main` (context only) | `3db504c6387555cdd9bd5d5c2abf73658523cfb3` | — |

`FORK` is an ancestor of both `REL` and `TIP` (verified with `merge-base --is-ancestor`).
`FORK..REL` = **88 commits**, of which the web-touching set is 63 files.

### PR classification (Group 1, 30 PRs)

Classified by `git merge-base --is-ancestor <merge-commit> $FORK`. **Do not trust
`gh pr view --json files`** for these — the head branches moved after merge, so gh reports files
the merge commit does not contain (it lists `CopiedToast.tsx` as *added* by #5848, which actually
**deleted** it). Every file list below comes from `git diff <merge>^1 <merge>`.

- **Class B candidates — merged BEFORE the fork (19):** #5832 #5833 #5834 #5835 #5836 #5837 #5838
  #5839 #5840 #5841 #5842 #5843 #5845 #5846 #5847 #5848 #5850 #5851 #5852
- **Class A — merged AFTER the fork (11):** #5857 #5859 #5863 #5895 #5901 #5903 #5906 #5908 #5909
  #5912 #5913

So the brief's framing inverts here: **most of Group 1 is Class B.** The commit-range diff would
have found only 11 of the 30, and the 19 that a range diff cannot see are where nearly all of the
user-visible damage is.

---

# Findings, ranked by user impact

## `web/oss/tailwind.config.ts` (whole app)

### D-01  The 13px `text-xs` step of the 14px type scale is gone app-wide

- **Class:** B (lost in extraction)
- **Source:** PR #5850 `feat(frontend): the 14px type scale — one ladder for the whole app`,
  merge `9d283cdeac`, `web/oss/tailwind.config.ts`
- **Should now live in:** `web/oss/tailwind.config.ts` (unmoved — the stack edited it in place)
- **What Mahmoud's change did:** redefined Tailwind's `xs` step as `13px/18px` — the "secondary"
  rung of the approved scale. The PR body calls it "the 335-site sweep": ~128 former 10px sites and
  every `text-[11px]` were rewritten to `text-xs` *on the assumption that `xs` now means 13px*.
- **State at TIP:** absent.
- **Evidence:** `git show $REL:web/oss/tailwind.config.ts` line 276 —
  `xs: ["13px", {lineHeight: "18px"}],` with the comment
  `// \`secondary\` step of the type scale. \`sm\` stays stock 14/20 (\`body\`).`
  The whole two-line block is missing from the `fontSize:` object at `TIP`. Removed by our own
  stack commit `067666a749 chore(frontend): register the new workspace packages in the oss and ee
  builds` (`git log -S'xs: ["13px"' $FORK..$TIP -- web/oss/tailwind.config.ts`). No other
  `xs: [` definition exists anywhere at `TIP` (`git grep -n "xs: \[" $TIP -- web` → empty).
- **User-visible?** Yes. Every `text-xs` in oss, ee and every package Tailwind scans renders
  12px/16px instead of 13px/18px — including the several hundred call sites #5850 converted *into*
  `text-xs`, which are therefore now *smaller* than before Mahmoud's PR, not larger.
- **Confidence:** high.

## `@agenta/ui`

### D-02  Every `@agenta/ui` dropdown stays mounted after it closes, aria-hiding the page

- **Class:** A (post-fork)
- **Source:** PR #5895 `fix(frontend): dropdown menus never unmount after close (scroll-fade vs
  Radix Presence)`, merge `3f91f12abd`, `web/packages/agenta-ui/src/components/ui/dropdown-menu.tsx`
- **Should now live in:** `web/packages/agenta-ui/src/components/ui/dropdown-menu.tsx` (unmoved)
- **What Mahmoud's change did:** added `animate-none` to `DropdownMenuContent` and
  `DropdownMenuSubContent`. Their `.overflow-y-auto` class matches the global scroll-fade rule from
  #5837, whose scroll-driven animation never fires `animationend`; Radix Presence then waits forever
  and the closed content stays mounted.
- **State at TIP:** absent, **while the cause is present**.
  - `git grep -n "animate-none" $TIP -- web/packages/agenta-ui/src/components/ui` → empty.
  - The trigger is live: `web/oss/src/styles/globals.css:910-911` at `TIP` still has
    `animation: ag-thumb-fade linear both; animation-timeline: scroll(self block);` applied to
    `:where(.overflow-auto, .overflow-y-auto, .overflow-y-scroll, .ag-scroll-fade)`.
  - `DropdownMenuContent` at `TIP` still carries `overflow-y-auto` in its class list.
- **User-visible?** Yes, and worse in the stack than on 112: the extraction *added* dropdown call
  sites (`SessionRow`, `SessionRowContextMenu`, `AgentActionsMenu`, `NavMenu`). Every one of them
  leaves an invisible mounted menu that `aria-hidden`s the page behind it.
- **Confidence:** high.

### D-03  `PromptSchemaControl` lost its test hook

- **Class:** A · **Source:** PR #5895, same merge, `agenta-entity-ui/.../PromptSchemaControl.tsx`
- **Should now live in:** `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/PromptSchemaControl.tsx` (unmoved)
- **What Mahmoud's change did:** added `data-testid="prompt-schema-control"` to both return branches.
- **State at TIP:** absent — `git grep -n "prompt-schema-control" $TIP -- web` → empty.
- **User-visible?** No (acceptance-test selector only).
- **Confidence:** high.

### D-04  Immer `MapSet` race crashes fresh sessions on virtual-table pages

- **Class:** A · **Source:** PR #5901, merge `8a9abc43d6`
- **Should now live in:** `web/packages/agenta-ui/src/InfiniteVirtualTable/atoms/columnVisibility.ts`
  + `web/packages/agenta-ui/package.json` + `web/pnpm-lock.yaml`
- **What Mahmoud's change did:** registered the Immer `MapSet` plugin at the atom's own module scope
  (and added `immer` as a direct `@agenta/ui` dependency), because a fresh session can reach that
  atom before `_app`'s module-scope `enableMapSet()` has run.
- **State at TIP:** absent.
  `git grep -n "enableMapSet" $TIP -- web` returns only `web/oss/src/components/pages/_app/index.tsx`;
  at `REL` it also returns `columnVisibility.ts:1` and `:11`. `agenta-ui/package.json` at `TIP` has
  no `immer` entry (`REL` line 107: `"immer": "^10.1.3",`).
- **User-visible?** Yes — a crash on first load of a virtual-table page in a fresh session.
- **Confidence:** high.

## `@agenta/sessions-ui` + the `/sessions` page

### D-05  `/sessions` is back to the filters rail Mahmoud deleted

- **Class:** B
- **Source:** PR #5833 `fix(frontend): restore the sessions toolbar layout, dropping the filters
  rail`, merge `dc39c05be3`
- **Should now live in:** `web/oss/src/components/pages/sessions/SessionsPage.tsx` +
  `web/packages/agenta-sessions-ui/src/{SessionFiltersBar,SessionFiltersPanel}.tsx`
- **What Mahmoud's change did:** deleted `SessionFiltersRail.tsx` ("the filters rail put a second
  sidebar inside the sessions page"), replaced it with a one-row toolbar above the list, and swapped
  the vertical `SessionStatusListControl` for a toolbar-sized `SessionStatusControl` Segmented with
  the waiting count in its label.
- **State at TIP:** reverted.
  - `SessionsPage.tsx` at `TIP` renders
    `<FilterRailLayout rail={<SessionFiltersPanel title={title} … />}>` — and
    `SessionFiltersPanel.tsx` is the rail verbatim: `RailLabel`, `<SessionStatusListControl …/>`,
    and the `Show` / `Include` heading sections, with the doc comment
    `The rail box belongs to FilterRailLayout, not here.`
  - The app-side toolbar Mahmoud wrote survives *byte-identical but orphaned*:
    `web/oss/src/components/pages/sessions/components/SessionFiltersBar.tsx` has no importer at
    `TIP` (`git grep -n "SessionFiltersBar" $TIP -- web` shows only mobile importing the *package*
    component and the file's own self-reference).
- **User-visible?** Yes — the desktop sessions page shows the 280px filter rail again.
- **Confidence:** high.

## `@agenta/home-ui` + the create-agent flow

The extraction of home/templates into `@agenta/home-ui` was made from a **pre-#5848 snapshot**. Five
distinct behaviours regressed; they are listed separately because they can be fixed independently.

### D-06  "Use this template" bounces back to the create surface instead of creating the agent

- **Class:** B
- **Source:** PR #5848 `feat(frontend): create-agent flow — picking a template IS creating the
  agent`, merge `cd13ca3747`, `web/oss/src/components/pages/agent-home/components/TemplateDetail/index.tsx`
- **Should now live in:** `web/oss/src/components/pages/agent-home/components/TemplateDetail/index.tsx`
  (the host wiring) over `web/packages/agenta-home-ui/src/TemplateDetail.tsx`
- **What Mahmoud's change did:** replaced `router.push(\`${baseAppURL}?new=1&template=…\`)` with
  `void createFromTemplate(template)` and a `loading` button — "Creates the agent and lands in its
  playground — no bounce back through the create surface to press the same button again."
- **State at TIP:** absent (reverted to the pre-fix bounce).
  `TemplateDetail/index.tsx` at `TIP`:
  `onUseTemplate={(template) => void router.push(\`${baseAppURL}?new=1&template=${template.key}\`)}`
  — and it never passes the package's `busy` prop, so the button reports nothing either.
- **User-visible?** Yes — two clicks and a page transit to do what was one click.
- **Confidence:** high.

### D-07  Home template cards no longer create the agent, and have no per-card busy state

- **Class:** B · **Source:** PR #5848, same merge, `StripHome.tsx` + `hooks/useCreateAgentFromTemplate.ts`
- **Should now live in:** `web/oss/src/components/pages/agent-home/StripHome.tsx` (successor hook
  candidate: `web/packages/agenta-home-ui/src/useCreateAgent.ts`)
- **What Mahmoud's change did:** `handlePick` became `void createFromTemplate(template)` ("A card
  here IS the create action — no composer step, no second confirmation") and fed
  `pendingTemplateKey={pendingKey}` to `TemplateStrip`, which spins the picked card and dims the rest.
- **State at TIP:** absent. `StripHome.tsx` at `TIP` is back to
  `provenance.pick(template)` + `captureFirstAgentIntent(posthog, {source: "template", …})`, and the
  `<TemplateStrip …/>` call passes no `pendingTemplateKey`. The hook file
  `web/oss/src/components/pages/agent-home/hooks/useCreateAgentFromTemplate.ts` does not exist at
  `TIP` at all. (`StripCard`'s `loading`/`disabled` props *did* survive into the package — they are
  simply never driven.)
- **User-visible?** Yes — picking a template only seeds the composer again.
- **Confidence:** high.

### D-08  The "Use my coding agent" clipboard button and its toast are resurrected

- **Class:** B · **Source:** PR #5848, same merge (it **deleted** `CopiedToast.tsx`,
  `codingAgentClipboard.ts`, `codingAgentClipboard.test.ts` and stripped `onCodingAgentCopy` from
  `AgentIntentActions` / `StripComposer` / `STRIP_COPY` / `useOnboardingChat` / `AgentComposerDock` /
  `AgentConversation`)
- **Should now live in:** nowhere — the surface was removed on purpose
- **What Mahmoud's change did:** removed the second, competing call to action from every
  describe-an-agent composer, since picking/creating is now the single path.
- **State at TIP:** fully restored. `git ls-tree -r $TIP web/oss/src/components/TemplateStrip` lists
  `assets/codingAgentClipboard.ts`, `assets/codingAgentClipboard.test.ts` and
  `components/CopiedToast.tsx`; neither exists at `REL` **or** at `FORK`. They were re-added by our
  own stack commit `36f0851f8b feat(frontend): @agenta/home-ui — the home overview, templates and
  agent roster leave the app`. `AgentIntentActions.tsx` at `TIP` again renders
  `<Button icon={<Terminal size={14}/>} onClick={onCodingAgentCopy}>{STRIP_COPY.useCodingAgent}</Button>`,
  and `git grep -n "handleCodingAgentCopy\|copiedToastOpen" $TIP` hits `StripHome.tsx:162/270`,
  `AgentComposerDock.tsx:122/312`, `useOnboardingChat.ts:77/95/265/267`, `AgentConversation.tsx:745`.
- **User-visible?** Yes — a removed button is back on the home hero and the playground onboarding
  composer.
- **Confidence:** high.

### D-09  The template seed guard is back to a boolean, so only the first template ever seeds

- **Class:** B · **Source:** PR #5848, same merge, `StripHome.tsx`
- **Should now live in:** `web/oss/src/components/pages/agent-home/StripHome.tsx`
- **What Mahmoud's change did:** changed `seededTemplate` from a boolean to the template key —
  *"Seed once PER TEMPLATE KEY: a boolean guard blocked every template after the first, because this
  surface stays mounted across `?template=` navigations."*
- **State at TIP:** reverted to the buggy form:
  `const seededTemplate = useRef(false)` … `if (seededTemplate.current || !templateParam) return`
  … `seededTemplate.current = true`.
- **User-visible?** Yes — navigate to a second `?template=` without unmounting home and the composer
  keeps the first template's seed.
- **Confidence:** high.

### D-10  "Blank agent" shows the template grid it just declined

- **Class:** B · **Source:** PR #5848, same merge, `StripHome.tsx`
- **What Mahmoud's change did:** added `blankCreate = creatingAgent && !templateParam`, which hides
  the `TemplateStrip` and centres the composer with `my-auto` — *"'Blank agent' from the New agent
  menu asks for one thing: describe it."*
- **State at TIP:** absent. `blankCreate` does not exist in `StripHome.tsx` at `TIP`; the first-run
  branch renders the strip unconditionally.
- **User-visible?** Yes.
- **Confidence:** high.

### D-11  The rail's "New agent" duplicate action is back

- **Class:** B · **Source:** PR #5847, merge `1074adbd65`,
  `web/oss/src/components/pages/agent-home/components/YourAgentsTable/index.tsx`
- **Should now live in:** `web/packages/agenta-home-ui/src/AgentsPanel.tsx` (+ the `onNewAgent` the
  host passes)
- **What Mahmoud's change did:** removed the panel-header "New agent" button — *"One action only:
  the page header already carries 'New agent', so a second one here was noise."*
- **State at TIP:** restored. `AgentsPanel.tsx` renders
  `{onNewAgent ? <button …><PlusIcon size={14}/>New agent</button> : null}` beside "All agents", and
  `YourAgentsTable/index.tsx` passes `onNewAgent={() => router.push(\`${baseAppURL}?new=1\`)}`.
- **User-visible?** Yes (minor).
- **Confidence:** high.

### D-12  First-run home no longer asks the layout for its bounded frame

- **Class:** B · **Source:** PR #5847, merge `1074adbd65`, `Layout.tsx` + `StripHome.tsx`
- **What Mahmoud's change did:** dropped the route-sniffing `isAppsHome` full-height branch from
  `Layout.tsx` and moved the decision into the page: only the first-run branch calls
  `requestFullHeight(true)`.
- **State at TIP:** half-applied. `Layout.tsx` correctly no longer has `isAppsHome` (and keeps the
  `--ag-demo-banner-h` half of the PR at line 299), but **nothing requests full height for home** —
  `git grep -n "layoutFullHeightRequestAtom" $TIP -- web` returns only `Layout.tsx`,
  `state/layout/fullHeight.ts` and `pages/overview/agent/AgentOverview.tsx`; at `REL` it also
  returns `StripHome.tsx:23/59/75`. The first-run branch at `TIP` still relies on a bounded parent:
  `<div className="mx-auto flex w-full min-h-0 max-w-[1040px] flex-1 flex-col overflow-y-auto …">`.
- **User-visible?** Likely — `flex-1`/`min-h-0`/`overflow-y-auto` against an unbounded parent gives
  the page its own scroll instead of the centred document scrolling inside the frame.
- **Confidence:** needs-a-second-look on the exact visual result; **high** that the request is gone.

### D-13  The template detail page went back to the rail layout #5846 replaced

- **Class:** B · **Source:** PR #5846 `feat(frontend): templates pages join the shared layout`,
  merge `e689f86331`
- **Should now live in:** `web/packages/agenta-home-ui/src/TemplateDetail.tsx`
- **What Mahmoud's change did:** replaced the bleeding 344px `lg:-ml-14` aside with a top bar (back
  link + identity + the one action) over `pageContentWidthClass`, plus one scroller so the pinned
  action stays reachable on a bounded route.
- **State at TIP:** superseded — the package `TemplateDetail` is a `FilterRailLayout` again
  (`"Two shells, swapped at lg. Beside the results there is room for the shared FilterRailLayout:
  identity and the decision live in the rail"`).
- **User-visible?** Yes. This one is plausibly a **deliberate** redesign in the stack rather than an
  accident — flagging it so the owner decides, not asserting it is a bug.
- **Confidence:** high on the divergence; needs-a-second-look on intent.

## `@agenta/navigation` / `@agenta/navigation-ui`

### D-14  The sidebar sessions list shows "Pinned" (and now "Recent") heading rows again

- **Class:** B · **Source:** PR #5840 `fix(frontend): drop the Pinned heading row from the sidebar
  sessions list`, merge `9994175b38`
- **Should now live in:** `web/packages/agenta-navigation/src/dynamic/{registry,types,useSidebarDynamicChildren}.ts`
- **What Mahmoud's change did:** deleted `getGroup` from the sessions source, from the registry
  type, from the generic `registry.ts` passthrough and the heading-insertion loop in
  `useSidebarDynamicChildren` — the whole grouped-heading machinery.
- **State at TIP:** restored *and extended*:
  `agenta-navigation/src/dynamic/registry.ts:92` —
  `getGroup: (session) => (session.pinned ? "Pinned" : "Recent"),` (the `"Recent"` label is new;
  the pre-#5840 original returned `null`). The heading loop is back at
  `useSidebarDynamicChildren.ts:92-99`, and `getGroup` is back on both types (`types.ts:65,87`).
- **User-visible?** Yes — two disabled heading rows in the sidebar sessions list.
- **Confidence:** high.

### D-15  The sidebar collapse toggle is the pre-#5835 pill again (geometry + hit target)

- **Class:** B · **Source:** PR #5835 `style(frontend): nudge the sidebar brand row`, merge `4955d6f8fb`
- **Should now live in:** `web/packages/agenta-navigation-ui/src/SidebarToggleButton.tsx`
  (`web/oss/src/components/Sidebar/components/SidebarToggleButton.tsx` is a bare re-export at `TIP`)
- **What Mahmoud's change did:** `!h-[28px]` → `!h-[22px] !w-[22px] !p-0` (a square the exact height
  of the 22px wordmark, so both optical centres line up — *"The old 28px pill rode 3px low"*), icon
  `size={14}` → `16`, plus a transparent `after:absolute after:inset-[-3px]` hit extender.
- **State at TIP:** absent. The package component reads
  `className={clsx("shrink-0 !h-[28px]", className)}` with `<Sidebar size={14} …/>` and no `after:`.
- **User-visible?** Yes — misaligned toggle, smaller icon, smaller pointer target, in every rail.
- **Confidence:** high.

### D-16  The sidebar wordmark is back to 85×20 and loses its 8px corner offset

- **Class:** B · **Source:** PR #5835, same merge, `SidebarLogo.tsx`
- **Should now live in:** `web/packages/agenta-navigation-ui/src/SidebarLogo.tsx`
- **What Mahmoud's change did:** `mt-2` on the row and `ml-2` on the expanded branch (*"padding
  alone read as no change because the 48px row's centring already held the logo 14px down"*), and
  the wordmark from `85×20` to `99×22` (*"99x22 keeps the SVG's intrinsic 361:80 ratio at the 22px
  brand height"*).
- **State at TIP:** absent. Package `SidebarLogo.tsx`:
  `"flex h-[48px] shrink-0 items-center mb-1"` / `collapsed ? "justify-center" : toggle ?
  "justify-between pl-3 pr-2" : "px-3"` and `<AgentaWordmark width={85} height={20} />`.
- **User-visible?** Yes.
- **Confidence:** high.

### D-17  Sidebar nav rows are back to `w-[94%]`, so they no longer align with the brand row

- **Class:** B · **Source:** PR #5835, same merge, `Sidebar/engine/SidebarMenu.tsx`
- **Should now live in:** `web/packages/agenta-navigation-ui/src/NavMenu.tsx` (the successor; the
  antd-menu original was deleted)
- **What Mahmoud's change did:** `!w-[94%]` → `!w-[calc(100%-16px)]` — *"calc, not 94%: an exact 8px
  inset each side, so the row's right edge lines up with the 8px-inset collapse toggle."*
- **State at TIP:** absent. `NavMenu.tsx` lines 43, 139 and 265 all use `w-[94%] mx-auto`.
- **User-visible?** Yes — the inset drifts with rail width, so the nav rows and the brand row
  disagree at most widths.
- **Confidence:** high.

### D-18  The project/org switcher has its resting border back

- **Class:** B · **Source:** PR #5835, same merge, `Sidebar/components/ProjectOrgSwitcher/index.tsx`
- **Should now live in:** `web/packages/agenta-navigation-ui/src/ProjectOrgSwitcher.tsx`
- **What Mahmoud's change did:** `border border-solid border-[var(--ag-colorBorderSecondary)]` →
  `border-0` — *"Borderless at rest; the hover fill is the affordance."*
- **State at TIP:** absent. `ProjectOrgSwitcher.tsx:281` —
  `"flex cursor-pointer items-center rounded-md border border-solid border-colorBorderSecondary bg-transparent transition-colors hover:bg-colorFillTertiary"`.
- **User-visible?** Yes.
- **Confidence:** high.

## `@agenta/entity-ui`

### D-19  The agent overview Configuration card is green-tinted again

- **Class:** B · **Source:** PR #5841 `style(frontend): grey resting icons in the overview
  Configuration card`, merge `6e3e25eaa5`
- **Should now live in:** `web/packages/agenta-entity-ui/src/agent/AgentConfigSummaryCard.tsx`
  (successor of the deleted `web/oss/src/components/pages/overview/agent/AgentConfigurationCard.tsx`)
- **What Mahmoud's change did:** one line — `stated()` returns `status: "default"` instead of
  `"complete"`, with the reason inline: *"complete tints the icon green, and a read-only card full
  of green checkmark-colored icons reads as noise. Grey is the resting state; only the
  required-but-empty warning keeps a color."*
- **State at TIP:** absent. `AgentConfigSummaryCard.tsx:39` —
  `const stated = (summary: string) => ({summary, status: "complete" as const})`, used by every
  populated row (lines 77, 85, 95, 102, 109, 115).
- **User-visible?** Yes — every filled row on the agent overview Configuration card is green again.
- **Confidence:** high.

## Cross-cutting: the #5850 type scale, per surface

D-01 is the global half. These are the per-file halves the extraction dropped. All are Class B,
source PR #5850 / merge `9d283cdeac`, and all were verified by finding pre-#5850 literals at `TIP`
that do not exist anywhere in the corresponding path at `REL`.

### D-20  `@agenta/entity-ui/drive` kept two pre-#5850 files

- **Should now live in:** `web/packages/agenta-entity-ui/src/drive/{ContextRail,DriveHeader}.tsx`
- **Evidence:** `git grep -n "text-\[1[01]px\]" $TIP -- web/packages/agenta-entity-ui/src/drive`
  → `ContextRail.tsx:279,291,295,423`, `DriveHeader.tsx:139,151,251`. The same grep against
  `$REL -- web/oss/src/components/Drives` returns **nothing** (#5850 converted all of them).
  The other 14 Drives files carried the sweep across correctly.
- **User-visible?** Yes (11px/10px text in the drive rail and header).
- **Confidence:** high.

### D-21  `@agenta/home-ui` and `@agenta/navigation-ui` copies predate the sweep

- **Should now live in:** `agenta-home-ui/src/{NewAgentButton,UsageCard,TemplateDetail,TemplateGallery}.tsx`,
  `agenta-navigation-ui/src/ProjectOrgSwitcher.tsx`
- **Evidence:** `NewAgentButton.tsx:90` still has the exact string #5850 rewrote
  (`…rounded-md text-[11px] font-semibold text-white` → `text-xs`); `UsageCard.tsx:31`
  `text-[11px] text-colorTextSecondary` (#5850 → `text-xs`); `ProjectOrgSwitcher.tsx:67` and `:293`
  still carry `text-[11px]` where #5850 wrote `text-xs`, and the trigger/label classes are the
  pre-#5850 `text-[13.5px]`/`text-[13px]` family.
- **User-visible?** Yes.
- **Confidence:** high.

### D-22  The whole AgentChatSlice surface is back to pre-#5850 sizes

- **Should now live in:** `web/oss/src/components/AgentChatSlice/**` (still app-layer at `TIP`)
- **Evidence:** files that have `text-[10px]`/`text-[11px]` at `TIP` and none at `REL`:
  `components/{AgentChatEmptyState,AgentMessage,AgentTurn,QueuedMessages,SessionHistoryMenu,ToolActivity}.tsx`,
  `components/Inspector/{EventRow,lenses/ContextLens,lenses/TimelineLens}.tsx`,
  `components/clientTools/ElicitationWidget.tsx`,
  `Playground/Components/Modals/RefinePromptModal/assets/InstructionsPanel.tsx`.
  Spot-quote — `AgentMessage.tsx` at `TIP` lines 63, 188, 206, 565 all use `text-[11px]`;
  `git grep -c "text-\[1[01]px\]" $REL -- .../AgentMessage.tsx` → no match.
  (`assets/markdown.tsx` also matches the grep but #5850 never touched it — excluded.)
- **User-visible?** Yes, across the whole chat surface.
- **Confidence:** high. (I did **not** enumerate all 181 #5850 files hunk-by-hunk — see
  "Not yet examined".)

## Page gutters (#5836)

### D-23  The agent overview page is back to its hand-tuned insets

- **Class:** B · **Source:** PR #5836, merge `4eb924f98a`
- **Should now live in:** `web/oss/src/pages/w/[workspace_id]/p/[project_id]/apps/[app_id]/overview/index.tsx`
- **What Mahmoud's change did:** replaced `!pl-[4.5rem] !pr-14 !pb-0` with the shared
  `pageContentWidthClass`, so the overview shares Home's centred column.
- **State at TIP:** reverted, character for character:
  `<PageLayout className={clsx("gap-8", isAgent && "min-h-0 !pl-[4.5rem] !pr-14 !pb-0")}>` (line 114),
  under the pre-#5836 comment `{/* \`!px-10\` matches Home's inset … */}`.
- **User-visible?** Yes.
- **Confidence:** high.

### D-24  The settings page has its `FULL_WIDTH_TABS` special case back

- **Class:** B · **Source:** PR #5836, same merge,
  `web/oss/src/pages/w/[workspace_id]/p/[project_id]/settings/index.tsx`
- **What Mahmoud's change did:** deleted `FULL_WIDTH_TABS` and collapsed the three-way variant to
  `FORM_TABS.has(resolvedTab) ? "form" : "full"`, since the page column now caps width.
- **State at TIP:** reverted — `const FULL_WIDTH_TABS = new Set<SettingsTabKey>(["auditLog"])` and
  the three-way ternary are both back. Related: `Layout.tsx` at `TIP` also dropped the `isAuditLog`
  full-height branch that this variant depended on, so the two halves now disagree.
- **User-visible?** Yes (Audit Log tab width / internal scrolling).
- **Confidence:** high on the reversion; needs-a-second-look on the combined effect with the
  `isAuditLog` removal.

### D-25  `pageContentWidthClass` survives but is applied on one page out of six

- **Class:** B · **Source:** PR #5836, same merge
- **What Mahmoud's change did:** put the shared gutter/centred column on Home, Agents, Archived
  agents, Sessions, Settings and the agent overview at once.
- **State at TIP:** partially present. `pageWidth.ts` is byte-identical and `PageLayout` still spreads
  `pageGutterClass` — but `git grep -n "pageContentWidthClass" $TIP -- web` finds exactly one
  consumer left, `ArchivedAgentsPage.tsx:29`. `AgentsPage` and `SessionsPage` now use
  `PageLayout className="… !p-0"` + `FilterRailLayout`; `StripHome` hand-rolls `px-6 pb-20 pt-14`;
  overview and settings are D-23/D-24.
- **User-visible?** Yes — the pages no longer share one column width.
- **Confidence:** high on the facts; the Agents/Sessions cases are plausibly intentional (the rail
  redesign), so treat those two as **superseded**, not lost.

---

# Class A — absent by construction (post-fork), targets confirmed

These need no proof of absence beyond the range; what is recorded is **where the fix now has to
land** and whether the target survived the extraction.

| # | PR | Behaviour | Target at TIP | Still applicable? |
| --- | --- | --- | --- | --- |
| D-26 | #5912 | Transcript replay respects a cancelled interaction's terminal status (`CANCELLED_CLIENT_TOOL_OUTPUT`, `applyCancelledInteractions`, the `fetchCancelledClientToolTokensAtom` join) | **`@agenta/chat` only** — `agenta-chat/src/assets/{transcriptToMessages,loadSession}.ts` + new `agenta-entities/src/session/state/interactionStatus.ts`. The oss originals (`AgentChatSlice/assets/{transcriptToMessages,loadSession,messageParts}.ts`) **no longer exist at TIP** | Yes, and it got *simpler*: one copy to fix instead of two |
| D-27 | #5859 | `request_input` renders its form again after transcript replay | same package files + `AgentChatSlice/components/clientTools/registry.tsx` (still app-layer), `agenta-playground/src/state/execution/agentApprovalResume.ts` | Yes |
| D-28 | #5913 | A pending interaction *anywhere* in the tab counts as awaiting (`anyPendingInteraction` scan over the whole transcript, feeding `hitlPending \|\| anyPendingInteraction`) | `AgentChatSlice/AgentConversation.tsx` (exists) | Yes |
| D-29 | #5857 | The running-elsewhere strip stops accusing your own tab (`isRunningElsewhere`, `sessionRunningElsewhereAtomFamily`, `sessionLocalSettledAtAtomFamily`) | `AgentChatSlice/state/{liveness,sessions}.ts` (exist; `liveness.ts` was re-pointed at `@agenta/chat/model` + `@agenta/chat/state` by the stack, so the port needs re-homing of those two symbols) | Yes — with an import-site decision |
| D-30 | #5909 | Connect-flow feedback: actionable errors, real auth mode, working decline (+ the `d2a6d55c00` guard against a background records refresh clobbering a pending decline) | `AgentChatSlice/components/clientTools/{useConnectFlow.ts,ConnectToolWidget.tsx}`, `components/InteractionDock.tsx`, `hooks/{useAgentChatSession,useSessionHydration}.ts` (all exist) | Yes |
| D-31 | #5863 | Playground triggers refresh when an agent tool settles | new `agenta-entities/src/gatewayTrigger/state/invalidate.ts` (**absent at TIP**) + `gatewayTrigger/{index.ts,state/index.ts,hooks/*}`, `AgentChatSlice/assets/toolCacheEffects.ts` (absent), `hooks/useToolCacheInvalidation.ts` (absent) | Yes |
| D-32 | #5903 | Project watch channel: one connection refreshes session + agent lists; server session name wins the chat reconcile; `useRenameApp` flag workaround dropped | `web/oss/src/hooks/useProjectWatch.ts` and `components/Layout/ProjectWatch.tsx` **do not exist at TIP**, and `Layout.tsx` at `TIP` no longer renders `<ProjectWatch />`; `state/sessions.ts` and `EntityIdentity/useRenameApp.ts` exist | Yes — plus the API/runner half, which is out of frontend scope |
| D-33 | #5906 | Playground error-state "Try again" actually retries | `Playground/Components/MainLayout/index.tsx` exists, but the file was **heavily rewritten** by the stack (the agent branch now uses `SplitPane` from `@agenta/ui/ui` and `chatPanelMaximizedAtom` from `@agenta/chat/state`). At `TIP` the button is still `<Button>Try again</Button>`; at `REL` it is `<Button onClick={() => window.location.reload()}>` | Yes — one-line port into rewritten surroundings |
| D-34 | #5901 | see **D-04** (listed above with full evidence) | — | Yes |
| D-35 | #5895 | see **D-02** / **D-03** | — | Yes |
| D-36 | #5908 | `rename_agent` paired to `rename_session` — SDK/runner/benchmarks only, no `web/**` path | n/a | Out of frontend scope |

---

# Verified present — do not re-check these

Each was compared hunk-for-hunk (`git show $REL:<path>` vs `git show $TIP:<successor>`); the only
differences are import rewrites or the package refactor.

- **#5832** stop in-app template picks looping agent creation — `OnboardingEntry.tsx` and
  `useConsumePendingTemplate.ts` are **byte-identical** at `REL` and `TIP`; `state/url/template.ts`
  differs only by the `@agenta/entities/workflow` import and the `AgentTemplate` →
  `AgentStarterTemplate` rename.
- **#5834** dark shell rail hue — `--ag-shell-rail-bg: #101010` / `--ag-shell-line: #2c2c2c` present
  in `agenta-ui/src/styles/theme-variables.css:631-632` (the file's new home) and in `palette.ts`.
- **#5837** slim trackless scrollbars — the whole `@property`/`@keyframes ag-thumb-fade` block is at
  `globals.css:883-911`. (This is also what makes **D-02** live.)
- **#5838** templates gallery `baseAppURL` — present in a different shape
  (`useAtomValue(urlAtom)` in the OSS gallery wrapper); the `{ssr: false}` dynamic import on
  `[template_key].tsx` is byte-identical.
- **#5839** agent overview without Classic Mode — `isHidden || hideAdvancedNav` is not reintroduced;
  `useSidebarConfig/index.tsx` differs only by `@agenta/navigation` imports.
- **#5842** dismissible Pro Trial banner — oss `SidebarBanners/state/atoms.ts` byte-identical
  (`countsTowardCap`, the trial exemption); ee copy differs only by imports.
- **#5843** session rows match the homepage — **all** of it survived: `SessionPinButton.tsx` and
  `SessionStatusIcon.tsx` byte-identical (including the `after:inset-[-6px]` hit extender);
  `useSessionsList.ts` byte-identical (including `origin: showTriggered ? "trigger" : undefined` on
  the pinned query); `SessionRow.tsx` differs by one line (`pendingGateLabel`); the row markup
  (18px glyph, `text-sm` title, `text-[13px]` subtitle, `h-5` trailing box, `SessionPinButton`)
  is reproduced in the new `SessionCardList.tsx:72,89,116`; `tailwind.config.ts` still registers
  `agenta-sessions-ui`.
- **#5845** collapse toggle in the agent-scoped sidebar and **#5852** project/org switcher in it —
  `Sidebar/scopes/workflowScope.tsx` differs only by `@agenta/navigation` imports.
- **#5847** (partial) — the `--ag-demo-banner-h` variable (`Layout.tsx:299`), the removal of
  `isAppsHome`, and the sticky rail offset in `agenta-navigation-ui/src/SidebarShell.tsx:266` all
  survived. See D-11/D-12 for the parts that did not.
- **#5848** (partial) — `agenta-shared/src/utils/platform.ts`, `useModifierKey.ts` and
  `RichChatInput.tsx` are byte-identical; `StripCard`'s `loading`/`disabled`/`aria-busy` props and
  `TemplateStrip`'s `pendingTemplateKey` prop survived (unused — see D-07).
- **#5851** centre the agent name against its avatar — both hunks present in
  `agenta-entity-ui/src/agent/AgentCard.tsx` (lines 108-111 and 229).
- **#5836** (partial) — `pageWidth.ts` byte-identical, `PageLayout` still applies `pageGutterClass`,
  and the empty-table `overflow-x-hidden` fix in `InfiniteVirtualTableInner.tsx` is byte-identical.

---

# Group 3 (tests / CI) — one pass, as the brief asked

- **The stack changed zero test files.** `git diff --name-only $FORK $TIP -- web/oss/tests web/ee/tests`
  is empty, while `git diff --name-only $FORK $REL -- web/oss/tests` lists **12** files (#5896,
  #5900, #5905, #5914). Those 12 are Class A and land whenever the stack rebases.
- **No stale sidebar/menu selectors.** `git grep -n "ant-menu\|ant-layout-sider\|Sidebar" $TIP -- web/oss/tests`
  → empty, so the antd-`Menu` → `NavMenu` rewrite breaks no existing selector.
- The antd class selectors that remain (`.ant-modal` ×21, `.ant-message` ×13, `.ant-table-row` ×9,
  `.ant-drawer*` ×12, `.ant-checkbox*`, `.ant-radio*`, `.ant-tabs*`) all sit in auto-evaluation,
  observability, human-annotation and registry flows — surfaces this stack did not extract.
- **The real risk is the inverse and is not covered:** the stack rewrote sessions / home / settings /
  navigation markup from antd to Radix and added no test coverage for any of it.

---

# Not yet examined — explicit gaps

1. **#5850 hunk-by-hunk across all 181 files.** I verified the two global anchors
   (`controlScale.ts` and `antd-themeConfig.json` are byte-identical; `tailwind.config.ts` is
   **not** — D-01) and then swept for pre-#5850 literals (`text-[10px]`/`text-[11px]`). That sweep
   cannot see the sweep's *other* halves: `text-sm`→`text-base`, heading 20→24, `fontSizeSM`
   consumers, and the ~61 deliberately-kept `text-[13px]` sites. D-20/D-21/D-22 are therefore a
   **lower bound** on #5850 drift.
2. **`web/mobile`.** Every finding above was verified against oss/ee call sites only. The brief's
   "mobile lacks tokens the desktop has" trap was not exercised — in particular D-01's `text-xs`
   step never existed in mobile's Tailwind v4 bridge, so mobile may be *correct* where oss is now
   wrong.
3. **The two `cn` helpers.** No finding here turned on a `className` override reaching a `twMerge`
   vs a plain join, so the trap was never triggered — but I did not audit for it systematically.
4. **`FilterRailLayout` adoption on `/agents`, `/sessions` and the templates pages** — I recorded
   these as *superseded* (D-13, D-25) on the reading that they are a deliberate stack redesign. That
   reading is not verified against a design doc; it is the one call in this document made on
   judgement rather than evidence.
5. **Group 2 (runner/sdk/api, 7 PRs)** — not opened. No Group 1 finding points into them.
6. **#5863's app-layer half.** I confirmed the three new files are absent at `TIP` but did not read
   what `toolCacheEffects.ts` does in detail.
7. **One non-Mahmoud divergence noticed in passing, not chased:** `TemplateStrip/index.tsx` at `TIP`
   changed the list-layout category menu from `setShowAllRows(false)` to
   `setGridPage(0); resetScroll()`, dropping the comment *"A new category starts folded; grid/scroll
   calls don't apply in this list layout."* This is our stack changing behaviour that predates the
   fork — outside this audit's scope (no Mahmoud PR touches that hunk), but someone should confirm
   it was intentional.

> **Gap 1 is now closed** — see the census below. Gaps 2–7 remain open.

---

# The app → package move map

Successor resolution used throughout this audit and by the census below. `git log --follow` does not
track these (the extraction rewrote rather than renamed); they were matched on exported symbol name.

| App file at `REL` | Successor at `TIP` |
| --- | --- |
| `oss/src/components/Drives/*.{ts,tsx}` (16 files) | `packages/agenta-entity-ui/src/drive/*` |
| `oss/src/components/AgentChatSlice/components/{AudioPlayer,ComposerAttachments,VoiceInputButton}.tsx` | `packages/agenta-chat/src/components/<same>` |
| `oss/src/components/AgentChatSlice/assets/{transcriptToMessages,loadSession,messageParts}.ts` | `packages/agenta-chat/src/assets/*` (`messageParts` has **no** successor) |
| `oss/src/components/pages/overview/agent/AgentConfigurationCard.tsx` | `packages/agenta-entity-ui/src/agent/AgentConfigSummaryCard.tsx` |
| `oss/src/components/pages/overview/agent/AgentFilesCard.tsx` | `packages/agenta-entity-ui/src/agent/AgentFilesCard.tsx` |
| `oss/src/components/pages/agent-home/components/TemplatesGallery/{index,TemplateSection}.tsx` | `packages/agenta-home-ui/src/TemplateGallery.tsx` |
| `oss/src/components/pages/agent-home/components/TemplatesSection/TemplateCard.tsx` | `packages/agenta-home-ui/src/TemplateCard.tsx` |
| `oss/src/components/pages/agent-home/components/TemplateDetail/index.tsx` | `packages/agenta-home-ui/src/TemplateDetail.tsx` (oss path survives as a thin host) |
| `oss/src/components/NewAgentButton/index.tsx` | `packages/agenta-home-ui/src/NewAgentButton.tsx` |
| `oss/src/components/UsageSummary/index.tsx` | `packages/agenta-home-ui/src/UsageCard.tsx` |
| `oss/src/components/Sidebar/components/{SidebarLogo,ProjectOrgSwitcher,SidebarToggleButton}` | `packages/agenta-navigation-ui/src/<same>` (oss paths survive as re-export shims) |
| `oss/src/components/Sidebar/engine/SidebarMenu.tsx` | `packages/agenta-navigation-ui/src/NavMenu.tsx` (rewrite, not a copy) |
| `oss/src/components/Sidebar/engine/SidebarShell.tsx` | `packages/agenta-navigation-ui/src/SidebarShell.tsx` |
| `oss/src/components/Sidebar/{dynamic/*,engine/types,engine/visibility,scopes/constants}` | `packages/agenta-navigation/src/*` |
| `oss/src/components/pages/settings/**` | `packages/agenta-settings{,-ui}/src/**` |
| `oss/src/styles/theme-variables.css` | `packages/agenta-ui/src/styles/theme-variables.css` |

**The trap this table encodes:** a file can exist at `TIP` **and** have a package successor
(`ProjectOrgSwitcher`, `TemplateDetail`, `NewAgentButton` are oss shims *and* package components).
Checking only the surviving app path reports "fine" while the rendered component is stale. Two
findings (D-21's `NewAgentButton`/`UsageCard`, D-18's `ProjectOrgSwitcher`) live only in the copy.

---

# WP-0B deliverable — the complete #5850 census

**Method (two passes, because either alone has a blind spot).**

1. *Pre-image survival:* for each of #5850's 181 files, resolve the successor and report any removed
   (pre-#5850) line surviving verbatim. Blind spot: a de-antd rewrite that changed the line while
   keeping the stale size (`AudioPlayer`'s `<Text …!text-[11px]>` → `<span …text-[11px]>`) is missed.
   A first run of this pass also produced **48 false positives** in one byte-identical file by
   matching generic fragments (`className={cn(`, `</span>`); filtered to lines carrying a size token.
2. *Token census:* grep `web/{oss,ee}/src` and `web/packages` for the five steps #5850 retired —
   `text-[10px]`, `text-[10.5px]`, `text-[11px]`, `text-[11.5px]`, `text-[13.5px]`.

**The result that makes this exhaustive rather than a sample:**

> `REL` contains **0** occurrences of those five steps across `web/oss/src`, `web/ee/src` and
> `web/packages`. `TIP` contains **79**.

PR #5850 eliminated the retired steps codebase-wide, so this is not a heuristic: every one of the 79 is
drift. This supersedes the "lower bound" caveat on D-20/D-21/D-22.

## A — lost #5850 edits (55 occurrences, 20 files)

The file, or the app original it was copied from, was fixed by #5850 and the successor is stale.

| File at `TIP` | Lines | Owning WP |
| --- | --- | --- |
| `oss/.../AgentChatSlice/components/AgentChatEmptyState.tsx` | 171, 175, 187, 253, 258, 274, 289, 296 | WP-1J |
| `oss/.../AgentChatSlice/components/Inspector/EventRow.tsx` | 92, 102, 106, 111, 121, 127 | WP-1J |
| `oss/.../AgentChatSlice/components/AgentMessage.tsx` | 63, 188, 206, 565 | WP-1J |
| `oss/.../AgentChatSlice/components/SessionHistoryMenu.tsx` | 105, 107, 112, 243 | WP-1J |
| `oss/.../AgentChatSlice/components/ToolActivity.tsx` | 127, 129, 213, 256 | WP-1J |
| `oss/.../AgentChatSlice/components/QueuedMessages.tsx` | 58, 64, 75 | WP-1J |
| `oss/.../AgentChatSlice/components/Inspector/lenses/ContextLens.tsx` | 80, 86, 136 | WP-1J |
| `oss/.../AgentChatSlice/components/clientTools/ElicitationWidget.tsx` | 107, 335 | WP-1J |
| `oss/.../AgentChatSlice/components/AgentTurn.tsx` | 95 | WP-1J |
| `oss/.../AgentChatSlice/components/Inspector/lenses/TimelineLens.tsx` | 154 | WP-1J |
| `oss/.../RefinePromptModal/assets/InstructionsPanel.tsx` | 143 | WP-1J |
| `packages/agenta-chat/src/components/ComposerAttachments.tsx` | 104, 340, 357, 462, 499 | WP-1J |
| `packages/agenta-chat/src/components/AudioPlayer.tsx` | 115 | WP-1J |
| `packages/agenta-entity-ui/src/drive/ContextRail.tsx` | 279, 291, 295, 423 | WP-1G |
| `packages/agenta-entity-ui/src/drive/DriveHeader.tsx` | 139, 151, 251 | WP-1G |
| `packages/agenta-navigation-ui/src/ProjectOrgSwitcher.tsx` | 67, 293 | WP-1B |
| `packages/agenta-navigation-ui/src/NavMenu.tsx` | 53, 139 | WP-1B |
| `packages/agenta-home-ui/src/NewAgentButton.tsx` | 90 | WP-1F |
| `packages/agenta-home-ui/src/UsageCard.tsx` | 31 | WP-1F |
| `packages/agenta-home-ui/src/TemplateGallery.tsx` | 72 | WP-1F |
| `packages/agenta-home-ui/src/TemplateDetail.tsx` | 41 | WP-1F |

`NavMenu` is a rewrite of `SidebarMenu`, which #5850 did **not** touch directly — but #5850's body
states "Sidebar nav, group titles, project switcher: body size (14) — the audit's headline fix", so
these two are in scope. Confirm against that intent rather than a hunk.

## B — off-ladder new code (24 occurrences, 8 files)

Authored by the stack after #5850, so no edit was "lost" — but the ladder says these steps do not
exist, so the defect is the same and so is the fix.

| File at `TIP` | Lines | Note |
| --- | --- | --- |
| `packages/agenta-chat/src/components/ApprovalCard.tsx` | 80, 84, 90, 314, 335, 401, 470, 510, 528 | Successor of the approval markup #5850 fixed via `ApprovalDock.tsx` — treat as class A if that mapping holds. **`ApprovalDock.tsx` is WP-2C's lock** |
| `packages/agenta-sessions-ui/src/SessionFiltersBar.tsx` | 29, 86 | new |
| `packages/agenta-sessions-ui/src/controls/SessionFilterControls.tsx` | 128, 175 | new controls |
| `packages/agenta-sessions-ui/src/SessionFiltersPanel.tsx` | 14 | the resurrected `RailLabel` — `REL` is clean only because #5833 had already deleted the rail |
| `packages/agenta-sessions-ui/src/{SessionCardList,SessionListCard,SessionListPanel}.tsx` | 171, 48, 80 | new |
| `packages/agenta-home-ui/src/AnalyticsRangePicker.tsx` | 36 | new |
| `packages/agenta-playground-ui/src/.../AgentRevisionStatus.tsx` | 129 | new |
| `oss/.../AgentChatSlice/assets/markdown.tsx` | 82 | Streamdown code-block header; #5850 never touched it |
| `oss/.../TemplateStrip/components/CopiedToast.tsx` | 33 (`text-[13.5px]`) | **no action** — WP-1E deletes this file |

## Lock-table amendments this census forces

Four paths carry census rows but were not in any WP's lock list. Assign before dispatch:

- `packages/agenta-sessions-ui/src/{SessionFiltersBar,SessionFiltersPanel,SessionCardList,SessionListCard,SessionListPanel,controls/SessionFilterControls}.tsx` → **WP-1D** (it already owns this
  package's `index.ts`, and its flag work touches these components anyway).
- `packages/agenta-home-ui/src/{TemplateGallery,AnalyticsRangePicker}.tsx` → **WP-1F**. Remove
  `TemplateGallery` from **WP-1D**'s lock list to avoid the clash; WP-1D needs only the oss host page.
- `packages/agenta-playground-ui/src/components/AgentPageHeader/AgentRevisionStatus.tsx` → **WP-1J**.
- `oss/.../AgentChatSlice/assets/markdown.tsx` → **WP-1J** (previously excluded; it is off-ladder even
  though it is not a lost edit).

## What the census does *not* cover

The two passes find retired **`text-[Npx]`** literals. #5850 also moved token-named steps
(`text-sm`→`text-base`, heading 20→24, `fontSizeSM` consumers) and those cannot be detected this way,
because the resulting class names are legal at both scales. `controlScale.ts` and
`antd-themeConfig.json` are byte-identical `REL`↔`TIP`, so the **token ladder itself is intact** and
any residue is confined to per-call-site class names. Given D-01 restores the `xs` step, the
remaining risk is a call site that should have moved a rung but did not — visible only in QA.
