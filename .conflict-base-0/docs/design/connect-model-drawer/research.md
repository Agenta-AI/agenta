# Research: current code, verified findings, and the design prototype

All paths are repo-relative. Line numbers reflect the working tree on 2026-07-06 (which
includes uncommitted in-flight changes; see context.md).

## 1. The drawer host: AgentTemplateControl

`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentTemplateControl.tsx`

- Renders the agent config as sections (Model & harness, Instructions, Tools, MCP,
  Skills, Triggers, Advanced). The "Model & harness" and "Advanced" sections open a
  `SectionDrawer` each (lines ~866-888).
- **Draft model**: `openSectionDrawer` (lines ~182-194) snapshots the config and the
  build-kit flag into local state (`draftConfig`, `draftBuildKit`) plus a baseline ref.
  `saveSection` (lines ~211-237) relays the draft via `onChange(draftConfig)` →
  `workflowMolecule.actions.updateConfiguration`. This is a LOCAL draft only; committing
  to the server is the playground's separate Commit button. `cancelSection` just drops
  the draft. `sectionDirty` (lines ~239-243) deep-compares draft vs baseline and gates
  the Save button.
- **Creation-prefs capture seam** (uncommitted, lines ~216-230): on a model-harness
  save, it reads `modelIdFromConfig(draftConfig.llm)` and
  `connectionFromConfig(draftConfig.llm)` and writes `agentCreationPrefsAtom`
  (`web/packages/agenta-entities/src/workflow/state/agentCreationPrefs.ts`, consumed by
  `createEphemeralAppFromTemplate` in `state/appUtils.ts` line ~189). The capture reads
  the mode from the llm object, not from any section's UI, so moving the mode control
  into the credentials section keeps it working untouched.
- **Remote open**: `openAgentConfigSectionAtom`
  (`web/packages/agenta-shared/src/state/openConfigSection.ts`) lets the chat banner
  open the "model-harness" drawer (lines ~203-208).
- **Two `useModelHarness` instances** (lines ~278-292): `mh` binds to the live entity
  (headers, badges, inline tab bodies); `mhDraft` binds to the draft and renders the open
  drawer's body. Redesigned bodies automatically inherit this split.
- Section badge tri-state (lines ~451-493): invalid ("No model" / "Unavailable") beats
  incomplete ("Connect key") beats draft dot.

## 2. The drawer chrome: SectionDrawer and EnhancedDrawer

`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/SectionDrawer.tsx`

- Pure chrome over `EnhancedDrawer` (`web/packages/agenta-ui/src/drawer/EnhancedDrawer.tsx`).
- Passes `onClose={onCancel}`. Every close path other than the footer buttons goes
  through antd's `onClose`: **the mask (scrim) click and the header X both call
  `onCancel`, which silently discards the draft.** This is the interception point for the
  unsaved-changes guard.
- `closeOnLayoutClick={false}` already disables EnhancedDrawer's extra
  click-outside-on-layout listener, so only the mask and the X are the leak paths.
- Footer: note text + Cancel + Save (disabled unless dirty).

## 3. The stateful core: useModelHarness

`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/useModelHarness.tsx`

One hook that returns summaries and bodies for both the Model & harness and Advanced
sections. Key regions:

- **Harness catalog**: capabilities come from the `harnesses` catalog
  (`GET /workflows/catalog/harnesses/`) via `harnessCapabilitiesAtomFamily`
  (`web/packages/agenta-entities/src/workflow/state/inspectMeta.ts`, `staleTime:
  Infinity`), keyed by the schema's `x-ag-harness-ref` (lines ~153-165). Shape per
  harness: `{providers, deployments?, connection_modes, model_selection, models}`.
  There is NO hosting/cloud field in the FE type today.
- **Connection mode**: lives at `config.llm.connection.mode` (`"agenta" |
  "self_managed"`; helpers in `../connectionUtils.ts`). `modeOptions =
  allowedConnectionModes(capabilities, harnessValue)` (lines ~176-179,
  connectionUtils.ts lines ~191-200: missing capabilities → both modes). An effect
  auto-resets a mode the harness disallows (lines ~292-296). These stay valid wherever
  the mode UI renders.
- **providerNeedsKey** (lines ~188-212, includes the uncommitted
  `mode !== "self_managed"` guard): resolves the selected model's provider family
  (`providerForModel`, falls back to `connection.provider`), finds its standard vault
  entry, and only asserts "needs key" after the vault query resolves.
- **Model & harness drawer body** (lines ~536-643): two `ConfigAccordionSection`s.
  "Harness" holds an info note plus `harnessSection` (lines ~469-530), a `SectionRail`
  of harnesses with a detail panel (Current pill, model-compat line, providers, hosting).
  "Model & credentials" (lines ~559-612) holds a `SectionRail` with two tabs, "Model"
  (the picker) and "Provider key" (`ProviderKeyField`), with warning dots. Right side:
  a 240px version-history skeleton. Drawer width 880 with capabilities, 560 without
  (line ~886).
- **modelTab auto-forcing** (lines ~217-220): lands on "key" when a key is missing.
  Goes away with the tabs (the credentials section is always visible).
- **Advanced body**: `authControls` (lines ~677-701) renders the mode `SectionRail`
  ("Agenta-managed" / "Self-managed") plus, in agenta mode, the named-connection
  `Select` (options from `namedConnectionOptions`). It sits inside an "Authentication"
  `ConfigAccordionSection` (lines ~725-745). `hasAdvanced` counts `props.llm` (lines
  ~360-368, with the comment "Authentication lives in Advanced now") and
  `advancedSummary` leads with the mode (lines ~704-710). All of this moves or dies in
  the redesign.
- **writeModel** (lines ~239-284): composes `config.llm` from patches; a model pick
  derives its provider (and a vault pick its connection slug). The credentials section
  will call `writeModel({mode})` and the model section `writeModel({modelId})` exactly
  as today.

## 4. The shared rail: SectionRail (and the confirmed styling bug)

`web/packages/agenta-entity-ui/src/drawers/shared/SectionRail.tsx`

Active row style (line ~72):
`!bg-[var(--ag-colorPrimaryBg)] !font-medium !text-[var(--ag-colorPrimary)]`.

**Confirmed root cause of "selection is just bold text":** the theme generator never
emits `--ag-colorPrimaryBg` (zero matches in `web/oss/src/styles/theme-variables.css`).
The CSS variable resolves to nothing, `background:` gets an invalid value, and the row
falls back to transparent. Only the font-weight change and the primary text color
(#1c2c3d in light mode, nearly the same as the default text color) remain, hence
"unreadable".

**Blast radius (every SectionRail consumer):**

| Consumer | File | Rails |
| --- | --- | --- |
| Model & harness drawer | `.../agentTemplate/useModelHarness.tsx` | harness list; Model/Provider-key tabs; auth mode (Advanced) |
| Workflow reference selector | `.../SchemaControls/WorkflowReferenceSelector.tsx` (lines ~524, ~573) | detail-section rails |
| Trigger run-version field | `.../gatewayTrigger/drawers/shared/RunVersionField.tsx` (line ~104) | Pinned/Deployed axis |
| Commit modal | `.../modals/commit/components/EntityCommitContent.tsx` (line ~394) | section rail |
| Agent-home templates gallery | `web/oss/src/components/pages/agent-home/components/TemplatesGallery/index.tsx` (line ~155, imported from `@agenta/entity-ui`) | template category rail |

All five render the same semantic thing (a selected item in a vertical rail) and all
five are equally broken today, which argues for a global restyle rather than a variant
prop. Flagged as a decision in status.md.

`RailField.tsx` (same folder) only mimics the rail layout for labels; it has no
selection state and is unaffected.

## 5. Secrets and providers

`web/packages/agenta-entities/src/secret/state/atoms.ts`:

- `vaultSecretsQueryAtom` — `GET /secrets/`, query key `["vault","secrets",userId,projectId]`.
- `standardSecretsAtom` — maps the static `llmAvailableProviders` catalog
  (`web/packages/agenta-shared/src/utils/llmProviders.ts`: 13 providers, each
  `{title, name: ENV_KEY, key}`) onto vault data, attaching `key`/`id` when stored.
  This is the provider rail's data source for standard providers.
- `customSecretsAtom` — vault entries with `type === "custom_provider"`; the rail's
  custom entries.
- `createStandardSecretAtom` — create-or-update a standard provider key (POST/PUT
  `/secrets/`).
- `providerKeySetupDoneAtom` (uncommitted, `getOnInit: true`) — persisted flag set on a
  successful key save; feeds the chat gate. The new key form must keep setting it
  (it flows through `useVaultSecret.handleModifyVaultSecret`, which is what
  `ProviderKeyField` calls today; verify the flag set stays on that path).
- `useVaultSecret` (`state/useVaultSecret.ts`) — the hook both existing key surfaces
  use: `handleModifyVaultSecret` (standard) and `handleModifyCustomVaultSecret` (custom).

`ProviderKeyField.tsx` (`.../agentTemplate/`): the existing immediate-save key field
(disabled env-name input + password input + Save/Replace button + "Encrypted in transit
and at rest" footnote). The new right-pane key form is an evolution of this component.

## 6. The custom-provider form (extraction target)

`web/oss/src/components/ModelRegistry/Drawers/ConfigureProviderDrawer/`:

- `index.tsx` — thin antd-Form drawer shell (480px) around the content.
- `assets/ConfigureProviderDrawerContent.tsx` — the real form: provider-kind select
  (`SelectLLMProviderBase`), per-kind fields from `PROVIDER_FIELDS`, either/or auth-set
  validation from `PROVIDER_AUTH_REQUIREMENTS` (both in `assets/constants.ts`), slug
  validation via `isSlugInputValid` from `@/oss/lib/helpers/utils`, model list via
  `ModelNameInput`, label inputs via `../../assets/LabelInput`, submit through
  `useVaultSecret.handleModifyCustomVaultSecret`.
- `Modals/ConfigureProviderModal/` — a separate standard-key modal (title + key input);
  NOT the custom form. It stays as is unless it later adopts the shared key field.

**Layering constraint:** the drawer pane lives in `@agenta/entity-ui`, which cannot
import from `web/oss`. Extracting the form means moving it (and its constants) into a
package and moving or replacing its two app-layer imports (`isSlugInputValid`,
`LabelInput`). Details in design.md.

**Existing bridge for app-layer content:** `DrillInUIContext.llmProviderConfig`
(`web/packages/agenta-ui/src/drill-in/context/DrillInUIContext.tsx` line ~305), wired by
`web/oss/src/hooks/useLLMProviderConfig.tsx` through `OSSdrillInUIProvider.tsx`. Today it
injects extra model option groups and an "Add provider" footer that opens
`ConfigureProviderDrawer`. This is the natural seam to extend for deployment (cloud)
gating.

## 7. Cloud detection

The app layer has `isDemo()` (= `isEE()`) in `web/oss/src/lib/helpers/utils.ts` line ~22
and `NEXT_PUBLIC_AGENTA_LICENSE` in `web/packages/agenta-shared/src/api/env.ts`. Neither
distinguishes "Agenta cloud" from a self-hosted EE install by itself; the cloud check
used elsewhere in the app is `isDemo()`. The package cannot call it directly, so the
plan passes an `isCloud` flag through `DrillInUIContext` (see design.md, decision D6).

## 8. The design prototype, extracted

`Agenta onboarding flow redesign (1)/Connect a Model Flow.dc.html` (28 KB, self-contained).

Structure: right drawer 640px over a scrim `rgba(5,23,41,0.45)`; header "Connect a
model" with an X; scrollable body with three stacked sections separated by 1px `#eaeff5`
rules (Harness, Provider credentials, Model); sticky footer with a hint
("Sets Pi · claude-sonnet-4-5 on this agent draft") + Cancel + Save (`#1c2c3d` fill).

Recipes we adopt (with the exact prototype values):

- **Selected list row**: `background:#eef1f5; font-weight:600; color:#1c2c3d;
  border-radius:7px`; unselected `color:#586673`; row hover `background:#f7f9fb`.
- **Segmented toggle**: 1px `#d6dee6` container, radius 8, active segment white text on
  `#1c2c3d`, inactive `#586673`, `font-size:13px; padding:8px 14px`.
- **Provider credentials two-pane**: outer 1px `#eaeff5` card, radius 10, min-height
  236px. Left rail 190px, `background:#fcfdfe`, right border `#eaeff5`, padding 8,
  rows: 22px rounded-6 colored logo tile (white initial on a per-provider color) + name,
  13.5px. "+ Custom provider" pinned bottom behind a top border, plus icon,
  `font-weight:500; color:#1c2c3d` idle.
- **Key form** (right pane, standard provider): provider name 14.5px/600; subtitle
  "Standard provider · add your key and we auto-list its models." 12px `#758391`;
  label "API key *" (asterisk `#d61010`); input `sk-…` placeholder, monospace
  (`var(--font-mono)`), 1px `#d6dee6`, radius 8; footnote "This secret will be encrypted
  in transit and at rest." 11.5px `#97a4b0`.
- **Custom provider pane**: heading "Custom provider"; Type select with chevron; per-type
  fields ("Fields change per type — Bedrock needs a name, region & access keys.").
- **Self-managed card**: 38px icon tile (`#f5f7fa` bg, `#eaeff5` border, radius 10);
  heading 14.5px/600; body 12.5px `#586673`; bordered pill link "Read the self-hosting
  guide →"; amber badge "Not on cloud" (`#8a6d00` on `#fffbe6`, border `#ffe58f`).
  Note: the prototype heading says "Use your own subscription" and the toggle says
  "Agenta-managed / Self-managed"; the owner OVERRODE both (toggle "Use API key" /
  "Use subscription"; card heading "Self-managed"). The owner's copy wins.
- **Harness dropdown + connection status chips**: present in the prototype but OUT of
  scope (harness layout is locked; the chat banner is done).

## 9. Design hex → theme token mapping

Palette source: `web/oss/src/styles/theme/palette.ts`; generated vars in
`web/oss/src/styles/theme-variables.css`. Relevant existing values:

| Prototype hex | Role in prototype | Token to use | Light value today | Dark value today |
| --- | --- | --- | --- | --- |
| `#1c2c3d` | primary text, dark-navy fills | text: `--ag-colorText`; fills: see note | `#1c2c3d` | `rgba(255,255,255,0.85)` |
| `#586673` | secondary text | `--ag-colorTextSecondary` | `#586673` | `rgba(255,255,255,0.65)` |
| `#758391` / `#97a4b0` | tertiary/hint text | `--ag-colorTextTertiary` / `--ag-colorTextQuaternary` | — | — |
| `#eef1f5` | selected row bg | `--ag-colorFillSecondary` | `rgba(5,23,41,0.06)` | `rgba(255,255,255,0.12)` |
| `#f7f9fb` | row hover bg | `--ag-colorFillTertiary` | `rgba(5,23,41,0.04)` | `rgba(255,255,255,0.08)` |
| `#eaeff5` | hairline borders, card borders | `--ag-colorBorderSecondary` | `#eaeff5` | `#303030` |
| `#d6dee6` | input/control borders | `--ag-colorBorder` | — | — |
| `#fcfdfe` | provider rail bg | `--ag-colorFillQuaternary` (or `--ag-colorBgLayout`) | — | — |
| `#fffbe6` / `#ffe58f` / `#8a6d00` | amber badge | `--ag-colorWarningBg` / `--ag-colorWarningBorder` / `--ag-colorWarningText` | `#ffe58f` border confirmed in palette | dark pair generated |
| radius 7/8px | rows, inputs | keep Tailwind `rounded-md`/`rounded-lg` (6/8px), close enough; no new token |
| `var(--font-mono)` | key input | Tailwind `font-mono` |

Notes:

- `rgba(5,23,41,0.06)` renders visually identical to `#eef1f5` on white, so
  `--ag-colorFillSecondary` needs no palette change. **No `palette.ts` edit is required
  for the rail restyle**; if the owner wants the exact flat hex, add a role and
  regenerate (never hand-edit generated files).
- **Dark-navy fills** (`#1c2c3d` active segment / Save button): do NOT hardcode. In dark
  mode the brand primary flips to yellow (`palette.ts` line ~79: `primary: {light:
  "#1c2c3d", dark: "#f2f25c"}`), so hand-rolling white-on-navy breaks dark mode. Use the
  antd `Segmented` component (theme-aware) or `--ag-colorPrimary` +
  `--ag-colorTextLightSolid`-equivalent tokens for the active segment.
- The broken `--ag-colorPrimaryBg` reference must not simply be "fixed" by generating
  that token: the owner picked the neutral filled-pill recipe, not a primary-tinted one.

## 10. Verification environment

Dev stack on the Hetzner box: `http://144.76.237.122:8280` (EE dev, hot-reloads web
changes; package changes under `web/packages` are mounted). Light and dark themes both
required. The `debug-local-deployment` skill documents login and log access.
