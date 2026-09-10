# Status

Last updated: 2026-08-24.

## Where things stand

- Design iteration 1 published and reviewed. **D1–D7 locked** (see `context.md`): iteration
  B (inline reveal), text detection never gates, template clicks route through the step,
  new `NEXT_PUBLIC_AGENT_CONNECT_STEP` flag, M2 carry-through now, package placement,
  drawer kept for this round.
- **WP-1 DONE, uncommitted.** `web/packages/agenta-entities/src/workflow/detectAccounts.ts`
  and `tests/unit/detectAccounts.test.ts`, exported from `src/workflow/index.ts`. 18 cases.
- **WP-2 DONE, uncommitted.** `@agenta/entity-ui/onboarding` — `AgentSetupCard`, `AccountRow`,
  `copy.ts`, plus the rules module `@agenta/entities/workflow/agentSetup.ts` (gating **and**
  WP-5's preamble builder, both pure). `AccountRow` was *extracted* from
  `TemplateSetupDrawer/IntegrationRow.tsx`, which is deleted — the drawer now renders the
  extracted row off `detectAccountsFromTemplate`, so both surfaces show one row.
- **WP-3 DONE, uncommitted.** Home first run: submit opens the step instead of creating; the
  description settles into a line with Edit; the card renders below it and the template strip
  hides while the step is open. A template card click opens the step too (D3).
- **WP-4 DONE, uncommitted.** Playground onboarding: `commit()` now opens the step and
  `commitWithSetup(selection)` does the real commit. The card docks above the composer, where the
  strip sits and where the agent's own mid-run connect card appears.
- **WP-5 DONE, uncommitted.** `useCreateAgent` takes `setup` and appends the preamble to the seed.
- **WP-6 DONE, uncommitted.** `tests/unit/onboardingConnectFlow.test.ts` covers both flows.
- Flag: `NEXT_PUBLIC_AGENT_CONNECT_STEP` (`CONNECT_STEP_MODE`), default on.

## Mobile (`/m`) — wired and live-verified

The step now runs on mobile too (`web/mobile/src/features/onboarding/`), reading the same
`NEXT_PUBLIC_AGENT_CONNECT_STEP` flag via `src/lib/connectStep.ts` (the `browseLayout.ts`
precedent — mobile may not import `@/oss/*`).

**First-run alignment with production.** `/m`'s first run offered three plain text chips and a
"Browse templates" button where the desktop offers the real template strip. It now renders the
shared `TemplateCard` (already used by `/m`'s templates screen) in a horizontally scrolling row
with the category filter, plus the desktop's exact composer placeholder. The desktop's 3-at-a-time
pager is the one thing not copied: a phone has no room for it, so the same cards scroll.

Verified in the browser on a fresh project:

- Submitting a description opens the step instead of creating.
- Detection: brand names (GitHub, Slack) and aliases (`pull request`→GitHub, `inbox`→Gmail), in
  mention order.
- Skip dims the row, swaps in Undo, updates badge and footnote.
- **Template pick opens the step with the declared account marked Required, no Skip, Create
  disabled, footnote "Connect GitHub to create."** — D2/D3 proven end to end.
- Create produced the agent, navigated to its session, and the seed carried
  `I've skipped Slack for now — ask me when you need it. Ask me before you write or send anything.`
- Connect opens the real shared `ConnectDrawer`.

### Four defects live QA caught that the unit tests did not

1. **Footnote "Nothing to do here." under two Connect buttons.** `setupStatus` returns `ready`
   there and the copy fell through to the all-set line. Fixed; `setupCopy.test.ts` pins it.
2. **Row subtitles truncated mid-word** and every detected row repeated the same sentence.
   Detected rows now carry no subtitle (`NO_SCOPE_LINE`); the card's lead says it once. Template
   rows keep their real scope line.
3. **Edit silently lost the description.** The step replaces the composer, so `setMarkdown` hit an
   unmounted editor. Fixed with a parked-refill effect in `FirstRunComposer`.
4. **The lead claimed "From your description." for a template's declared accounts** — false, and
   the "description" there is the template's builder message the user never wrote. `setupLead` now
   takes `fromTemplate`.

## Verified

- `@agenta/entities`: 1396/1396 unit tests pass (43 new).
- `@agenta/entity-ui`: 484/484 pass (11 new gating tests).
- `tsc --noEmit` clean on `@agenta/entities`, `@agenta/entity-ui`, `@agenta/oss` and `@agenta/ee`
  (0 errors each).
- `pnpm lint-fix` clean across all 25 workspace packages.
- **Not run in a browser.** No visual, dark-mode, or `/m` pass yet.

## Decisions taken during implementation

- **`AgentSetupCard.onCreate` hands back the whole selection.** Which accounts are connected is
  known only inside the card (each row reads its own workspace connection), so making the host
  track it a second time would have been two sources of truth for the thing the gate depends on.
- **Skip is structurally unavailable on a required row** — `onSkip` is passed as `undefined` when
  `account.required`, so D2 holds in the props, not just in the rendering.
- **The playground path no longer fakes a sent turn when the step opens.** `handleCreateAgent`
  used to set the optimistic first turn and clear the composer before committing; with the step
  that would show a message as sent while the user is still in setup. It now leaves the composer
  alone, and the existing `committingSeed` effect picks the turn up when the step actually commits.
- **The permission answer is sent even with zero accounts** when it is non-default: "read only"
  constrains an agent that needs no account at all.

## D5 revised — M1 is not viable, and that is settled

Investigated rather than assumed. A connected-app tool is **per-action**:
`{type: "gateway", provider, integration, action, connection}`, and `parseGatewayTool` returns
`null` without `action` (`entity-ui/DrillInView/SchemaControls/toolUtils.ts:53`). There is no
toolkit-level tool object, and `permission` is a field *on a tool*. The setup step knows the
integration and has no basis to choose `GITHUB_CREATE_ISSUE` over `GITHUB_LIST_ISSUES` — that is
what the builder's `discover_tools` is for. Writing guessed actions into the config would be
worse than writing none.

So **M2 is the carry-through permanently**, not a stopgap. Since the preamble is therefore
always visible in the first turn (the seed is auto-sent as the user's own message, and
`AgentFirstRunSeed` carries text only), it is now written in the **user's voice**:

> Triage new GitHub issues and post a daily digest to Slack.
>
> I've connected GitHub. I've skipped Slack for now — ask me when you need it. Ask me before you
> write or send anything.

Nothing is appended when the user connects nothing and keeps the default posture.

## Open — needs your call

- **Is the visible line acceptable?** If not, the only remaining option is a hidden context
  channel on the seed, which means plumbing through `@agenta/chat`'s send path and
  `agentRequest` — bigger than this issue, and it needs the runner contract's agreement.
- **Browser QA has not run.** `qa.md` is the matrix; it needs your dev stack.

## What WP-1 turned out to need

Word-boundary matching alone was not enough. Three provider names are ordinary English, and
"linear algebra", "the notion that" and "cut some slack" are all whole-word hits. The
detector carries a small `NEGATIVE_CONTEXT` table keyed by slug, checked against a 24-char
window either side of the match. It keys only on the idiomatic readings — a bare leading
article is not a rejection, so "the Notion database" and "the Slack channel" still match.
Both directions are covered by tests.

## Open

- **D5/M1** — the config-write carry-through needs the agent tool-item shape confirmed with
  Mahmoud. M2 (seed preamble) ships without it; M1 is a documented seam.
- **S5** — a pre-commit planning turn from the builder would replace text detection
  entirely. Out of scope here; the `DetectedAccount[]` contract is the seam.
- The alias table is a first pass. It should be revisited against real
  `first_agent_intent` composer text once the step is live — that event already captures
  the description (truncated to 500 chars).

## Next steps

1. WP-2 — `AgentSetupCard` + `AccountRow` in `@agenta/entity-ui`, extracted from
   `TemplateSetupDrawer/IntegrationRow.tsx`.
2. WP-3 / WP-4 — mount it on the two surfaces behind the flag.
3. WP-5 / WP-6 — carry-through and flow tests.
4. Live matrix per `plan.md`, light and dark, plus `/m`.

## Not verified

Nothing is committed and nothing has been run in a browser. WP-1 is covered by unit tests
only.

## Mobile create surface unified (2026-09-04)

Arda's direction, from the live `/m` first run: every new-agent entry uses the first-run
structure, blank create shows the template strip, and a template create swaps the STRIP for
the connect card while the editor stays where the screenshot has it.

- New route `/agents/new` (`?template=<key>`) mounts `NewAgentScreen` → the shared
  `FirstRunScreen`. Home first run keeps mounting the same screen inline.
- `FirstRunScreen` restructured: the offer slot holds the strip OR the `AgentSetupCard`
  (with a Connections/Cancel header); the composer NEVER unmounts. The step's seed lives in
  the editor (a template pick seeds its builder message there, editable), so the draft chip,
  the Edit button and the parked-refill-on-Edit hack are gone — `FirstRunSetupStep.tsx`
  deleted. The card's Create reads the LIVE editor text; the composer's own Create button
  hides while the step is open so there is exactly one create action.
- Rewired to the route: Agents list "New agent" + roster create cell, Home's New agent menu
  (blank → `/agents/new`, template pick → `?template=`), template detail "Use this template".
  The gallery/detail screens no longer create in place, so their creating strips and
  `useNewAgentAction` uses are removed.
- `createFromPrompt` now carries `name`, so a template create commits the ephemeral under
  the template's name instead of "New agent".
- `?template=` arrival opens the step once per key; if the step declines (nothing to
  connect), the arrival auto-creates. Cancel drops `?template=` (shallow replace) and clears
  an unedited seeded prompt.

Verified: `tsc` clean, eslint clean, 144/144 mobile unit tests. Not yet run in a browser.

### Follow-ups from Arda's review (same day)

- **Template flow locks the editor until connections are made.** `AgentSetupCard` gained an
  optional `onReadyChange(canCreate)` (additive; desktop untouched) so the host can see the
  gate; `/m` disables the composer off it while `step.draft?.template` is set.
- **The template's own prompt is the hero subtitle** (as the desktop already does), replacing
  the generic "Connect what it needs…" line, which is now only the pre-open fallback. The
  editor is therefore NOT seeded anymore: in the template flow it is an optional
  "Anything else it should know?" input whose text is appended (`\n\n`) after the template's
  prompt on create. A typed description still lives in the editor itself.
- **No "Also add" chips on a template draft.** `useAgentSetupStep` returns `suggestions: []`
  when the draft carries a template — a template declares exactly what it needs. Described
  agents keep the chips. Pinned in `useAgentSetupStep.open.test.tsx` (2 new tests).
- **Alternatives are now a control, not a statement** (Arda: "there should always be a
  selection"). `AccountRow` renders one pill per provider in a slot (primary +
  alternatives); the default is the connected provider, else the slot's preferred; the
  pills stay visible while connected so a second agent can point at the alternative.
  Everything follows the selection — detail query, connection state, ConnectDrawer, and
  the slug reported for gating (with an effect cleanup un-reporting the deselected
  provider), so choosing an unconnected GitLab blocks create until GitLab is connected
  even when GitHub already is. Selection state lives inside the card (remounts per step).
  The footnote names the chosen provider ("Connect GitLab to create."), and
  `buildSetupPreamble`'s `labelsFor` resolves through alternatives so the seed says
  "I've connected GitLab." — the builder's only channel for WHICH provider to wire.
  `open()` now opens a satisfied TEMPLATE draft when a slot offers a choice (else the
  GitLab option could never be reached); satisfied slots with no choice still decline.
  The drawer keeps the static "or …" text (no `onSelect`). Tests: entities 1519,
  entity-ui 646, all green; tsc clean on entities/entity-ui/mobile/oss.
- **Reverted the "optional extra" editor** (Arda): in the template flow the editor DISPLAYS the
  builder message (same text as the hero, duplication accepted), locked until connections are
  made, then editable as the seed itself — create sends the editor text, no appending.
- **The step docks INSIDE the composer** (Arda: "combine these two"). `ChatComposer` gained a
  `headerExtra` slot (renders inside the input frame, above editor + attachments tray);
  `AgentSetupCard` gained `variant="docked"` (frameless, bottom divider only) and `hideCreate`,
  with `onReadyChange` now also handing back the live `AgentSetupSelection`. On `/m` the card
  renders in that slot, "Create agent" sits in the send button's place (gated by the step;
  Enter does the same once ready), and the offer slot keeps only the Connections/Cancel row.
  Desktop card usage unchanged (defaults). entity-ui 646 / chat 638 / mobile 144 tests green.
- **Editor lock removed; Cancel moved into the card; the swap animates.** Final shape: the
  editor is always editable (only the Create button — and Enter — gate on the step's required
  connections); `AgentSetupCard` carries its own ✕ (`onDismiss`); the strip and the docked card
  swap via `HeightCollapse` fade-folds on both sides (strip stays mounted; the card survives
  `close()` because `step.accounts` outlives the draft).
- **Accordion connect card (design option D, picked from the mockup canvas).** With 2+
  connections, `AgentSetupCard` renders each account as an accordion section: a slim 44px
  header (status icon · provider name · Connected/Required/Optional/Skipped · chevron) over a
  HeightCollapse body (scope line, provider switch, Skip/Connect). Exactly one open: the first
  unresolved section by default; tapping a header opens it (settled ones too — that's how you
  switch provider after connecting); connecting/skipping the open one auto-advances to the next
  unresolved, and with nothing unresolved everything collapses. A SINGLE connection keeps the
  flat row — accordion chrome around one section is a tap tax. All rows stay mounted (collapsed
  bodies), so live connection reporting and gating are unchanged. Both shapes share the queries,
  provider switch and ConnectDrawer inside `AccountRow` (`accordion` prop). Worst case today: 3
  slots, one 3-way choice (meeting-followup: HubSpot|Salesforce|Attio). Mockups:
  claude.ai/code/artifact/4af76024-6ab5-49fb-9347-1848fe513109 (row D).
- **Provider choice reworked to "choice = connection" (canvas row E).** The segmented switch is
  gone. A slot with alternatives shows one CARD per provider in the section body — preferred
  first ("Recommended"), horizontally scrollable for 3-way slots. Tapping an unconnected card
  opens that provider's ConnectDrawer directly (drawer slug decoupled from the row's active
  provider; only onSuccess adopts the choice — closing the drawer changes nothing, no
  "will use / connect next" limbo). Tapping an already-connected card makes it the one this
  agent uses (ring). Single-provider slots keep the plain Connect button. Card passes
  `providerConnected` (workspace connections) so every option shows true state.
- **Choice slots are titled by their NEED, not a provider.** New `connectionNeedLabel` in
  agentTemplates (PROVIDER_CATEGORY map): a slot whose options share one category is named by
  it ("CRM", "Code hosting", "Team chat"…); mixed-category slots keep the primary's name.
  Flows via `DetectedAccount.needLabel` into the accordion header — "CRM · Optional" instead
  of "HubSpot · Optional"; once connected, the provider in use rides along ("CRM Salesforce ·
  Connected"). 4 new entities tests incl. full-catalogue sweep.
- **Need-naming extended to single-provider slots** (Arda): every template slot is titled by
  its need — "Email · Required" opens to a Gmail card, "Calendar · Optional" to Google
  Calendar. The provider card renders for single-provider slots too (it is where the provider
  shows its face, and it carries the connect action; the plain Connect button is gone from
  card sections). "Recommended" only appears where there is an actual choice. Text-detected
  accounts keep the provider name the user themselves typed.
- **Blocked footnote de-provider-ized**: "Connect Gmail to create." → "1 required connection
  left." (neutral count; rows are need-titled so a provider name pointed at nothing visible).
  The selection→label remapping for the footnote is deleted with it.
- **Blocked footnote removed entirely**: badge + amber rows + disabled Create already say it;
  `setupFootnote("blocked", …)` returns "" and the card renders no span for it.
- **Skip removed end to end** (Arda). Leaving an optional slot unconnected IS the skip:
  `AgentSetupSelection.skippedSlugs` deleted; hook loses skip/undoSkip; card and row lose the
  buttons, the "Skipped" state, the "N skipped" badge and the skip footnote; the preamble's
  "I've skipped X" sentence is gone (the builder asks when it needs an unconnected optional).
  Auto-open rule tightened with it: only REQUIRED unsatisfied sections auto-open — optional
  ones start collapsed and never demand attention. Hosts (mobile FirstRunScreen, StripHome,
  AgentComposerDock) updated. entities 1523 / entity-ui 639 / mobile 144 green; tsc clean on
  entities, entity-ui, oss, ee, mobile.
- **Accordion never moves itself** (Arda): the open section is decided ONCE (first
  required-unsatisfied slot, after the connections query settles) and then only user taps
  change it — connecting no longer auto-collapses/advances (that mockup behavior yanked the
  section shut mid-look). Category label "Code hosting" → "Source control".
- **Non-primary choice becomes an INSTRUCTION in the seed.** The choice of an alternative only
  travels as prose (M2), and "I've connected GitLab." loses to a PR-reviewer prompt soaked in
  GitHub vocabulary — and says nothing when BOTH providers are connected (discovery offers
  each). `buildSetupPreamble` now appends "Use GitLab, not GitHub." whenever a slot was
  satisfied by an alternative. Structural backstop unchanged: discovery recomputes connection
  state fresh and a gateway tool can only bind to a real connection id — the builder can't
  silently wire an unconnected provider; the instruction covers the both-connected ambiguity.
- **Create hand-off hardened** (Arda hit a bounce to Home after create): `run()` now navigates
  BEFORE invalidating the workflows list (the refetch flips Home's first-run surface to the
  overview, racing the push and eating the error line), and fresh-marks every session id it
  stashes (template creates that skipped the step minted un-fresh ids, sending the chat after
  nonexistent history). Not live-reproduced — strongest code-supported explanation; needs a
  retry to confirm.
- **Create surface always lands with config collapsed**: the stored panel preference (written
  by session pages) used to beat `collapseConfigByDefault`. New mount-scoped
  `configPanelCollapsedOverrideAtom` in @agenta/chat panelLayout — set while a
  collapse-by-default surface is mounted, cleared by any user write, never persisted.
- **Desktop (oss/ee) create surface ported to the /m anatomy.** StripHome: the composer never
  unmounts — the connect card docks INSIDE it (`StripComposer` gained `header`/`createDisabled`/
  `onResetPrompt`, RichChatInput's header slot); Create in the trailing cluster is the gated
  action (AgentIntentActions `disabled`); the template's prompt seeds the editor (editable,
  Reset prompt on divergence, same change-stream baseline as /m); hero subtitle = template
  `description`, not the prompt; the docked read-only prompt box + Edit are gone; card ✕
  dismisses (drops `?template=`, keeps `?new=1`); strip folds via HeightCollapse. Card
  internals (accordion, need titles, provider cards, no skip) were already shared. The
  playground onboarding dock (AgentComposerDock) keeps its card-above-composer shape on
  purpose — different surface, same shared card. ee inherits via re-export; tsc clean both.
- **Desktop layout matched to /m** (Arda: "layout is different"): StripHome's first-run frame
  is now the same shape — left-aligned hero at the top, flex spacer, template strip as the
  offer ABOVE the composer, composer pinned to the bottom of the frame. The centred-column
  document (my-auto, strip below at mt-20) is gone.
