# Design: components, contracts, and copy

Read research.md first for the current-code citations. This file says what we build and
where. Open decisions are marked D1..D6 and collected in status.md.

## 1. Drawer structure after the redesign

The "Model & harness" `SectionDrawer` body (built by `useModelHarness`,
`modelHarnessDrawerBody`) becomes three stacked `ConfigAccordionSection`s in this order
(D1, owner default):

1. **Harness** — unchanged. Same info note, same `harnessSection` SectionRail + detail
   panel. Only the SectionRail selection styling changes (section 2 below).
2. **Model** — the model picker moves out of the old "Model & credentials" tabs into its
   own section. Content: the existing `modelControl`
   (`SelectLLMProviderBase` with harness-filtered groups, or the `GroupedChoiceControl`
   fallback) plus the "Filtered to the models this harness can reach…" hint. Status dot:
   warning when no model or `!selectedKeepsModel`. The `modelTab` state and its
   auto-forcing effect (`useModelHarness.tsx` lines ~217-220) are deleted; credentials
   are always visible now.
3. **Provider credentials** — new two-pane section (section 3 below). Status dot:
   warning when `providerNeedsKey`.

Rationale for the order: the harness constrains the models, and the model decides which
provider's credential matters. Picking a model then auto-highlights its provider in the
credentials rail below it, which reads top-to-bottom. The prototype orders it
Harness → Credentials → Model; the owner flagged the order as a decision and set this
as the default.

The right-hand 240px version-history skeleton and the 880px width stay (D3, default:
keep; the alternative is the prototype's 640px single column, which would be a bigger
layout change than this scope wants).

The `advancedDrawerBody` loses its entire "Authentication" group (section 6 below).

## 2. SectionRail selection restyle

File: `web/packages/agenta-entity-ui/src/drawers/shared/SectionRail.tsx` (one place).

Replace the active-row classes (line ~72):

```
before: !bg-[var(--ag-colorPrimaryBg)] !font-medium !text-[var(--ag-colorPrimary)]
after:  !bg-[var(--ag-colorFillSecondary)] !font-semibold !text-[var(--ag-colorText)]
```

Inactive and hover styles stay as they are (`text-[var(--ag-colorTextSecondary)]`,
hover `bg-[var(--ag-colorFillTertiary)]` + `text-[var(--ag-colorText)]`), which already
match the prototype's `#586673` / `#f7f9fb` mapping. Keep `rounded-md`.

This is a **global restyle** (D2, recommended): all five consumers (harness list, drawer
tabs, auth rail, workflow-reference selector, run-version field, commit modal, agent-home
templates gallery; see research.md §4) render the same semantic "selected rail item" and
all are equally broken today, because the active background token does not exist. A
`variant` prop would preserve a broken look somewhere for no benefit. If any consumer
looks wrong in review, fall back to a `selectionStyle?: "filled" | "primary"` prop with
`"filled"` as the default and fix the primary recipe's token.

Verify all five consumers in light AND dark (the tokens carry the dark values).

## 3. The Provider credentials section

New component: `ProviderCredentialsSection` in
`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/ProviderCredentialsSection.tsx`.
It stays in the agentTemplate folder (single consumer today; promote later if reused).

### 3.1 Props (classified by semantic role)

```ts
interface ProviderCredentialsSectionProps {
    // config (the agent draft's credential-relevant slice)
    mode: ConnectionMode                       // config.llm.connection.mode
    connectionSlug: string | null              // config.llm.connection.slug
    onModeChange: (mode: ConnectionMode) => void        // -> writeModel({mode})
    onConnectionSlugChange: (slug: string | null) => void // -> writeModel({slug})

    // routing/context (what the current selection points at)
    selectedProviderFamily: string | null      // derived from the picked model; auto-highlights the rail

    // policy (what the environment allows)
    modeOptions: ConnectionMode[]              // allowedConnectionModes(capabilities, harness)
    isCloud: boolean                           // deployment gate for "Use subscription"

    // presentation
    disabled?: boolean
}
```

Credentials themselves (vault keys, custom providers) are NOT props: the component reads
`standardSecretsAtom` / `customSecretsAtom` and writes through `useVaultSecret` directly,
because key saves are immediate and independent of the drawer draft (locked decision).
Only the agent-config fields (mode, slug) flow through props into the draft.

### 3.2 Layout and behavior

Header row: section title "Provider credentials" + the segmented toggle on the right.

- **Toggle**: antd `Segmented` (theme-aware; do not hand-roll a navy fill, dark mode's
  primary is yellow). Options: "Use API key" (`agenta`), "Use subscription"
  (`self_managed`).
  - Hidden entirely when `modeOptions.length < 2` and the only mode is `agenta`
    (harness does not support self-managed).
  - When the harness supports `self_managed` but `isCloud` is true: the
    "Use subscription" option renders disabled with a tooltip, and the info card (when
    somehow active) shows the "Not on cloud" badge. The existing auto-reset effect in
    `useModelHarness` (lines ~292-296) already snaps an illegal mode back.

- **"Use API key" pane** (mode `agenta`): the prototype's two-pane card.
  - Outer card: 1px `--ag-colorBorderSecondary`, radius 10, min-height ~236px.
  - **Left rail (190px, `--ag-colorFillQuaternary` bg)**: one row per standard provider
    from `standardSecretsAtom` (catalog order), then the existing custom providers from
    `customSecretsAtom`, then "+ Custom provider" pinned at the bottom behind a top
    border. Row = 22px logo tile + name. Logos: `getProviderIcon` / `LLMIconMap` from
    `@agenta/ui` (`SelectLLMProvider/utils.ts`, `LLMIcons`) — reuse them instead of the
    prototype's colored-initial tiles where an icon exists; fall back to an initial tile.
    Selected row uses the same recipe as SectionRail (filled pill + 600 + primary text).
    A dot or check may mark providers that already have a key (nice-to-have).
    Selection state is local (`useState`), initialized from `selectedProviderFamily`
    and re-synced when the model pick changes it (auto-highlight).
  - **Right pane** for the selected standard provider: an evolution of the existing
    `ProviderKeyField` (same immediate-save semantics via
    `useVaultSecret.handleModifyVaultSecret`, which keeps `providerKeySetupDoneAtom`
    working): provider heading, subtitle, "API key *" label, monospace `sk-…` password
    input, Save/Replace button, masked "Key configured" state when a key exists,
    "Encrypted in transit and at rest." footnote.
  - **Named connection select**: when the vault has custom-provider connections matching
    the selected provider (`namedConnectionOptions`), render the existing "Connection"
    select (Project default + named options) below the key form. This is the control
    that moves here from Advanced (D4, default: keep it).
  - **Custom provider inline**: clicking "+ Custom provider" (or an existing custom
    entry) swaps the right pane's content to the extracted `CustomProviderForm`
    (section 4). Same card, same dimensions, no drawer, no modal. The form gets a
    Cancel that swaps back to the key pane and a Save that writes the vault immediately
    (as the old drawer did) then swaps back with the new entry selected.

- **"Use subscription" pane** (mode `self_managed`): the rail and form disappear; one
  info card replaces the card's whole content (icon tile, heading "Self-managed", body
  copy, self-hosting guide link, "Not on cloud" badge when `isCloud`). Copy in section 7.

### 3.3 What feeds `selectedProviderFamily`

In `useModelHarness`:
`providerForModel(capabilities, harnessValue, modelId) ?? connection.provider` — the
same expression `providerVaultEntry` uses today (lines ~188-202). Extract it to a
variable and pass it down.

## 4. Custom-provider form extraction

Goal: one form component shared by the old `ConfigureProviderDrawer` (model-registry
page and the model-picker "Add provider" footer) and the new inline pane. Reusability is
an explicit owner requirement.

New home: `web/packages/agenta-entity-ui/src/secretProvider/CustomProviderForm.tsx`
(entity-specific UI → `@agenta/entity-ui` per the package placement rules; exported from
the package index).

Moves required by the layering rules (`@agenta/entity-ui` cannot import `web/oss`):

| What | From | To |
| --- | --- | --- |
| `PROVIDER_FIELDS`, `PROVIDER_AUTH_REQUIREMENTS` | `web/oss/src/components/ModelRegistry/Drawers/ConfigureProviderDrawer/assets/constants.ts` | `@agenta/entities/secret/core` (pure data about the secret entity) |
| `isSlugInputValid` | `web/oss/src/lib/helpers/utils.ts` | `@agenta/shared/utils` (pure string helper); keep a re-export in the old location |
| `LabelInput` | `web/oss/src/components/ModelRegistry/assets/LabelInput/` | `@agenta/ui` (tiny presentational input), or replace with the plain label+Input pattern the form already uses for textarea/json fields |
| `ModelNameInput` | `.../ConfigureProviderDrawer/assets/ModelNameInput.tsx` | moves with the form into `@agenta/entity-ui/secretProvider/` |

Component contract:

```ts
interface CustomProviderFormProps {
    // data: the entity being edited (null = create)
    initialValue?: LlmProvider | null
    // protocol context: how the host embeds it
    layout?: "drawer" | "inline"     // spacing only; logic identical
    // lifecycle callbacks
    onSaved: (saved: LlmProvider) => void
    onCancel: () => void
    disabled?: boolean
}
```

The form keeps its own antd `Form` instance, validation (slug rules, either/or auth
sets, JSON fields), and submit via `useVaultSecret.handleModifyCustomVaultSecret` —
moved verbatim from `ConfigureProviderDrawerContent`. The old drawer shell
(`ConfigureProviderDrawer/index.tsx`) becomes a thin wrapper: `EnhancedDrawer` +
footer buttons that call the form's submit/cancel (expose them via a `ref` or lift the
`Form` instance up, matching how the drawer already owns `form`). No behavior change on
the model-registry page.

`ConfigureProviderModal` (standard keys) is untouched.

## 5. Unsaved-changes guard

Files: `SectionDrawer.tsx` (+ `AgentTemplateControl.tsx` for wiring).

- `SectionDrawer` gains a `dirty?: boolean` prop. `AgentTemplateControl` passes
  `sectionDirty` (it already computes it) to BOTH section drawers (model-harness and
  advanced get the guard for free).
- Inside `SectionDrawer`, the antd `onClose` (mask click, header X, Escape) routes
  through a handler: if `!dirty`, call `onCancel` as today; if `dirty`, open a confirm
  modal instead of closing.
- Modal: `EnhancedModal` from `@agenta/ui` (package rule: never raw antd `Modal`).
  Three actions:
  - **Keep editing** (default/cancel): close the modal only.
  - **Discard**: `onCancel()` (drops the draft, closes the drawer).
  - **Save changes** (primary): `onSave()` (relays the draft, closes the drawer).
- The footer **Cancel button stays an immediate discard** (the owner scoped the guard to
  closes "without Save/Cancel"). Save disabled-state logic is unchanged.
- Copy in section 7.

## 6. Advanced tab removal

In `useModelHarness.tsx`:

- Delete `authControls`, `authDescription`, `authConnectionField` (lines ~652-701) and
  the "Authentication" `ConfigAccordionSection` block inside `advancedControls`
  (lines ~725-745).
- `hasAdvanced` (lines ~360-368): drop `props.llm` from the condition.
- `advancedSummary` (lines ~704-710): drop the mode segment; keep the sandbox segment.
- KEEP: the mode auto-reset effect (lines ~292-296), `connectionOptions`
  (`namedConnectionOptions`, lines ~299-302; now feeding the credentials pane), and
  everything the mode still touches in `writeModel`. The mode continues to live at
  `config.llm.connection.mode`, so the creation-prefs capture in
  `AgentTemplateControl.saveSection` and the backend contract are untouched.
- The commit-diff classifier already groups `llm` changes under model-harness, so the
  section draft-dots keep working.

## 7. Copy strings (final wording)

| Where | String |
| --- | --- |
| Toggle option A | `Use API key` |
| Toggle option B | `Use subscription` |
| Toggle B disabled tooltip (cloud) | `Available on self-hosted Agenta only.` |
| Standard provider subtitle | `Standard provider · add your key and we auto-list its models.` |
| Key label | `API key *` |
| Key placeholder | `sk-…` |
| Key footnote | `This secret is encrypted in transit and at rest.` |
| Key configured state | `Key configured · enter a new value to replace it.` (existing) |
| Connection select label | `Connection` |
| Connection default option | `Project default` |
| Custom provider rail row | `Custom provider` (with a plus icon) |
| Custom pane hint | `Fields change per type — Bedrock needs a name, region and access keys.` |
| Self-managed card heading | `Self-managed` |
| Self-managed card body | `The harness signs itself in. Use your Claude Code or Codex subscription, or any credentials the harness reads from its own environment, such as environment variables. Agenta stores and injects no key. Requires a self-hosted Agenta deployment.` |
| Self-managed guide link | `Read the self-hosting guide →` (target: `https://docs.agenta.ai/self-host/quick-start`) |
| Cloud badge | `Not on cloud` |
| Unsaved modal title | `You have unsaved changes` |
| Unsaved modal body | `Save your changes to this agent draft, or discard them?` |
| Unsaved modal buttons | `Save changes` (primary) / `Discard` / `Keep editing` |

The same "self-managed" framing (harness signs itself in; subscriptions are one case;
self-hosting required) must replace subscription-only wording in:

- the harness capability descriptions the drawer renders (the harness detail panel's
  hosting line is data-driven and stays; check the mode descriptions that used to live
  in `authDescription`),
- `sdks/python/agenta/sdk/agents/capabilities.py` docstrings if they say
  "subscription" where they mean self-managed (docs-only, no wire change),
- any docs page this project touches (run keep-docs-in-sync in the implementation).

## 8. Deployment (cloud) gating seam (D6)

The package needs one boolean: "is this deployment Agenta cloud?". Recommended: extend
`DrillInUIContext` (the existing app→package bridge, research.md §6) with

```ts
deployment?: {
    isCloud: boolean               // policy: gates self_managed connections
    selfHostingGuideUrl?: string   // metadata: link target for the info card
}
```

wired in `OSSdrillInUIProvider.tsx` from `isDemo()`. Classified by role: `isCloud` is
deployment policy (owned by the host app, changes never at runtime), not agent config,
so it must not live in the config draft or the schema. Alternative: an atom in
`@agenta/shared/state` hydrated by the app layer; the context is preferred because the
drawer already consumes `useDrillInUI` and the value is UI-gating only.

Gating matrix for "Use subscription":

| `modeOptions` includes `self_managed` | `isCloud` | Result |
| --- | --- | --- |
| no | any | toggle hidden (only "Use API key" content, no segmented control) |
| yes | false | toggle enabled |
| yes | true | toggle visible, "Use subscription" disabled + tooltip; card (if reached) shows "Not on cloud" badge |

## 9. Interfaces reviewed (design-interfaces pass)

- `ProviderCredentialsSectionProps` (§3.1): fields grouped as config (mode/slug +
  writers), routing (selectedProviderFamily), policy (modeOptions, isCloud),
  presentation (disabled). Credentials stay out of the props (they are vault data with
  their own lifecycle, owned by the secret entity, saved immediately).
- `CustomProviderFormProps` (§4): data (initialValue), protocol context (layout),
  lifecycle callbacks. The form owns validation; hosts own chrome.
- `SectionDrawer.dirty` (§5): presentation-adjacent policy flag; the host owns the
  draft, so the host computes dirtiness. The drawer only decides whether closing needs
  a confirmation.
- No wire, API, or schema contract changes anywhere in this project. The agent config
  shape (`config.llm.connection.mode/slug`) is untouched.
