# Context: Connect a Model drawer redesign

## What this project is

Redesign the "Model & harness" section drawer in the agent playground's left config panel.
The redesign follows the claude.design prototype "Connect a Model Flow" (saved at
`Agenta onboarding flow redesign (1)/Connect a Model Flow.dc.html` in the repo root).

The drawer today mixes model, harness, and credential concerns across two tabs plus a
separate Advanced drawer. The redesign gives the drawer three clear sections (Harness,
Model, Provider credentials), moves the connection-mode choice out of Advanced into the
credentials section, lets users add custom providers inline without a nested drawer, and
stops silently discarding unsaved edits on an outside click.

## Why now

The agent onboarding flow funnels new users into this drawer (the chat's
"Set up credentials" banner opens it). Three problems hurt that flow:

1. **Selection is unreadable.** The harness list's selected row shows only bold text in
   light mode. Root cause: the shared `SectionRail` styles its active row with
   `var(--ag-colorPrimaryBg)`, a token the theme generator never emits, so the background
   is transparent (see research.md).
2. **Credentials are scattered.** The API-key field hides behind a "Provider key" rail
   tab keyed to the selected model, and the Agenta-managed vs self-managed choice hides in
   the Advanced drawer. A user connecting their first key has to find both.
3. **Silent data loss.** Clicking the scrim closes the drawer and throws away the draft
   with no warning.

## Product owner's decisions (final, locked)

These came from the product owner and are not open for redesign. The plan must implement
them as stated.

1. **Harness section: no layout or behavior change.** The only change is the selection
   styling of its list rows (the shared `SectionRail` recipe). The design's dropdown
   harness picker is NOT adopted.
2. **Provider credentials section** with a two-option segmented toggle:
   **"Use API key" / "Use subscription"**.
   - "Use API key": provider rail on the left (standard providers with colored logo
     tiles, "+ Custom provider" pinned at the bottom), credential form on the right for
     the selected provider.
   - Custom providers render their form INSIDE the right pane (card content swap). No
     nested drawer, no stacked drawers, no pixel shifts. The existing custom-provider form
     logic must be extracted into a reusable component that both the old surfaces
     (`ConfigureProviderDrawer`) and this pane share.
   - **Key saves stay immediate** (per-provider save button writing the vault, as today
     via `useVaultSecret` / `createStandardSecretAtom`). The drawer's footer Save commits
     only the agent config draft (harness / model / mode). LOCKED.
   - "Use subscription": the rail and key form disappear; the pane becomes one info card.
     The toggle label says "Use subscription"; INSIDE the card the heading and language
     are "Self-managed" (the harness signs itself in: a Claude Code or Codex subscription
     OR any harness-side auth such as environment variables). Mention the self-hosting
     requirement; show a "Not on cloud" badge when gated.
   - The toggle is capability-gated via the harness catalog's `allowedConnectionModes`,
     plus deployment gating on cloud.
   - Selecting the mode here REPLACES the mode selector in the Advanced drawer. The
     Agenta-managed/Self-managed `SectionRail` and the named-connection `Select` leave
     Advanced entirely. Nothing mode-related remains in Advanced.
3. **Model section is its own section**, separate from credentials. Recommended order
   (flagged as a decision, default to it): Harness → Model → Provider credentials. When a
   model is picked, auto-highlight its provider in the credentials rail.
4. **Unsaved-changes guard.** If the draft is dirty and the user closes without Save or
   Cancel (scrim click, X), show a confirm modal: save / discard / keep editing.
5. **Copy alignment.** The "self-managed" wording (accurate beyond subscriptions) must
   also be used in the harness capability descriptions and any docs this plan touches.

## Not in scope

- Key validation or test calls against providers.
- Any other drawer sections (Instructions, Tools, MCP servers, Skills, Triggers).
- The chat `ConnectModelBanner` (already fixed separately).
- Layout changes to the harness section beyond selection styling.

## Constraints

- **Build on the current working tree.** The touched files carry uncommitted in-flight
  changes (chat gate logic, `agentCreationPrefsAtom` capture, `providerKeySetupDoneAtom`,
  the self-managed pill fix in `providerNeedsKey`). Never revert them.
- **Keep the creation-prefs capture seam working.** `AgentTemplateControl.saveSection`
  reads the connection mode from `draftConfig.llm` via `connectionFromConfig` when the
  model-harness section saves. Moving the mode control between sections must not break
  that read (it won't, as long as the mode keeps living at `config.llm.connection.mode`).
- **Dark mode must work.** Every design hex maps to an `--ag-*` theme token. The palette
  source of truth is `web/oss/src/styles/theme/palette.ts` plus the generator; never
  hand-edit `theme-variables.css` or `antd-overrides.generated.ts`.
- **Package layering.** The drawer lives in `@agenta/entity-ui`; it cannot import from
  `web/oss`. Anything the pane needs from the app layer must move into a package or flow
  through the `DrillInUIContext` bridge.
