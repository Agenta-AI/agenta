# Schema-driven agent config: current flow, gaps, and a proposal for JP

Purpose: make the agent config drawers schema/metadata-driven instead of hardcoded, reusing the
"ref to detailed schema to control" machinery the prompt playground already uses, and aligned with
the `agent-template` redesign. This doc is meant to be shared with JP for mutual agreement on what the
template schema / UI-primitives catalog must carry.

Our config sections and drawers are not changing. We compose them. What we want is for their
**innards** to be schema-rendered, so the smart drawers stop hard-coding field knowledge.

## 1. The baseline: how the playground resolves "ref to detailed schema to control"

A field carries a thin marker and the detailed schema is fetched and merged before rendering. Verified
flow (file:line):

1. **Ref to full schema (catalog fetch + recursive enrich).** `parametersSchemaAtomFamily(workflowId)`
   (`packages/agenta-entities/src/workflow/state/molecule.ts:530`) runs `enrichSchemaRefs()`
   (`molecule.ts:535`, recursive): for any node with `x-ag-type-ref`, it fetches the full schema via
   `agTypeSchemaAtomFamily(ref)` (`packages/agenta-entities/src/workflow/state/store.ts:1120`) which
   calls `GET /workflows/catalog/types/{agType}` (`packages/agenta-entities/src/workflow/api/api.ts:1279`)
   and reads `response.data.type.json_schema`. Catalog schema is the base; the node's title/description/
   default/overrides win. Cached `staleTime: Infinity` (immutable per type).
2. **Schema to control (dispatch).** `SchemaPropertyRenderer.getControlType()`
   (`packages/agenta-entity-ui/src/DrillInView/SchemaControls/SchemaPropertyRenderer.tsx:80-217`)
   dispatches on `x-ag-type-ref` / `x-ag-type` / `x-parameter`, falling back to JSON Schema type.
   Current map: `agent_config`→AgentConfigControl, `prompt-template`/`prompt`→PromptSchemaControl,
   `grouped_choice`→GroupedChoiceControl, `messages`→MessagesSchemaControl, `code`→CodeEditorControl,
   `feedback_config`→FeedbackConfigurationControl, `fields_tags_editor`→FieldsTagsEditorControl, then
   enum→EnumSelect, boolean→Toggle, number→Slider, object→ObjectSchemaControl, etc.
3. **The model primitive (the example you asked about).** The model field's catalog schema carries
   `choices: {provider: [ids]}` + `x-ag-metadata` (legacy `x-model-metadata`) per-model metadata.
   `hasGroupedChoices()` (`SchemaControls/schemaUtils.ts:104`) detects it; `getOptionsFromSchema()`
   (`packages/agenta-shared/src/utils/schemaOptions.ts:17`) turns `choices` + `x-ag-metadata` into
   `OptionGroup[]` (label/value/metadata); `GroupedChoiceControl` merges vault options from
   `DrillInUIContext.llmProviderConfig` and renders `SelectLLMProviderBase` with pricing tooltips. The
   option data IS the fetched catalog schema.
4. **The agent model picker diverges.** It sources options from `/inspect` `meta.harness_capabilities`
   (`packages/agenta-entities/src/workflow/state/inspectMeta.ts:45`, `harnessCapabilitiesAtomFamily`)
   via `buildModelOptionGroups` (`SchemaControls/connectionUtils.ts:239`), harness-filtered, falling
   back to the catalog `choices` path when the harness publishes no models.

## 2. The gap: the agent panel bypasses this machinery

The catalog/enrich/dispatch chain already resolves the agent's sub-schemas; `AgentConfigControl`
receives them (it passes `props.model` to `GroupedChoiceControl`). But instead of driving from them,
one monolithic control hardcodes nearly everything. The worst offenders (file:line in
`SchemaControls/`):

- **Literal field access + write keys** in `AgentConfigControl.tsx`: `config.model` / `config.harness`
  / `config.tools` / `config.mcp_servers` / `config.skills` / `config.agents_md` / `config.sandbox` /
  `config.permission_policy` / `config.harness_kwargs`; `setField("model" | "harness" | "tools" | ...)`.
- **Section descriptor array** (`AgentConfigControl.tsx:1410+`): keys/titles/icons (`model-harness`,
  `instructions`, `tools`, `mcp`, `skills`, `advanced`) hardcoded, gated on the literal fields above.
- **Polymorphic-entry discriminators sniffed, not declared**: tools (`type` vs `function` vs a
  gateway-name parse), MCP (`transport === "http"` ? `url` : `command`), skills (`@ag.embed`,
  `_agenta.` prefix, `flags.is_platform`) in `describeTool`/`describeMcp`/`describeSkill` and
  `ToolItemControl.inferIsBuiltinTool`.
- **Bespoke labels / metadata**: `HARNESS_META` map (`HarnessSelectControl.tsx:38`, pi_core/pi_agenta/
  claude → color+monogram); `enumLabel()` reading `x-model-metadata`/`oneOf` titles; sandbox
  enforcement/filesystem/network labels hardcoded in `SandboxPermissionControl.tsx`.
- **Conditional UI hardcoded**: Claude permissions only when `harness === "claude"`; permission policy
  hidden for `pi_core`/`pi_agenta`; allowlist textarea only when `network.mode === "allowlist"`;
  `slug` only for `connection.mode === "agenta"`.
- **The catalog id** `"agent_config"` as a literal in 6+ places (detection, dispatch, our collapse code).

## 3. What we want

Keep the sections/drawers (we own composition). Make the field rendering inside them schema-driven, so
the smart drawers read field types, options, metadata, discriminators, labels, and conditional rules
from the schema instead of FE constants. Two workstreams: an FE refactor (ours), and a set of
schema/catalog asks to JP (so the FE has something to drive from).

## 4. FE workstream (ours)

Doable against the existing machinery; sharpens once the asks below land.

1. **Decompose `AgentConfigControl`.** Behind our drawer shells, render each sub-field through the
   existing `SchemaPropertyRenderer` / `enrichSchemaRefs` chain rather than hardcoded controls. The
   shells (summary + `SectionDrawer`) stay; the bodies become schema-dispatched.
2. **Generic discriminated-list control** for `tools` / `mcps` / `skills` / `agents`, keyed on a
   schema-declared discriminator (see ask 2), replacing `describe*` / `infer*` sniffing.
3. **Generic `extras` editor** for the untyped kind-specific bag (harness/sandbox/runner/tool/llm),
   replacing the bespoke per-concern controls (see asks 3, 5).
4. **Centralize the catalog id** into one constant/helper; accept the renamed `agent-template` ref in
   one place, not scattered string checks.
5. **One model primitive.** Keep `SelectLLMProviderBase`, but source options + metadata from a single
   declared place (see ask 4) instead of the inspect-vs-catalog fork.

## 5. Asks to JP (schema / catalog / backend), aligned with the agent-template redesign

Each ask names what we need, the hardcoding it removes, and how it fits the redesign.

1. **Stable `x-ag-type-ref` on every template sub-field, and a catalog type per primitive.** So each
   resolves through the existing `/workflows/catalog/types/{id}` chain. Needed refs: `agent-template`
   (renamed from `agent_config`, CHANGE-R1), the four siblings `harness` / `runner` / `sandbox` (the
   `agent` template itself), `llm`, plus the reused primitives the redesign already names (`schemas`,
   `connection`, `references`, `messages`, `permissions`, `loop`). Removes: literal field access and
   bespoke controls (section 2, bullets 1-2).
2. **A declared discriminator for polymorphic arrays, plus per-kind sub-schemas in the catalog.** The
   redesign's uniform tool entry `{ kind, name, permissions, isolation, <named optional>, extras }`
   (CHANGE-3) should carry an explicit discriminator (e.g. `x-ag-discriminator: kind`, or `oneOf`
   keyed by `kind`) and a sub-schema per `kind` / per MCP transport / per skill source. Removes the
   `type`/`function`/`@ag.embed`/`transport` sniffing.
3. **Render `extras` from the catalog where possible.** CHANGE-4 makes `extras` an untyped per-kind
   bag. To avoid hand-coding harness/sandbox/runner knobs, either (a) publish a per-kind `extras`
   sub-schema in the catalog so it renders typed, or (b) agree the FE renders a generic key/value
   editor for it. Prefer (a) where the fields are knowable.
4. **One declared, harness-scoped source for model options + per-model metadata.** Today agent models
   come from `/inspect harness_capabilities` and prompt models from catalog `choices` + `x-ag-metadata`.
   Align on one: have the `llm`/`model` primitive expose harness-filtered option groups carrying the
   same metadata shape (provider grouping, `model_selection` naming, `connection_modes`, pricing). This
   is the direct analog of the model fetch you referenced; it lets one control serve both playgrounds.
5. **Field-level display + option metadata in the schema.** Enum/label/option metadata so the FE stops
   hardcoding: harness labels (and ideally icon/color) instead of `HARNESS_META`; connection-mode,
   sandbox `filesystem`/`network`/`enforcement` enum labels; model display names. Carried as `oneOf`
   titles / `x-ag-metadata` the way the model primitive already does.
6. **Declared conditional-visibility / dependent-field rules.** So conditionals render from schema, not
   from `if harness === "claude"`: `connection.slug` depends on `mode === "agenta"`; `network.allowlist`
   on `network.mode === "allowlist"`; `harness.permissions` (Claude) on the harness kind; permission
   policy not shown for Pi. A small `x-ag-visible-when` style annotation, or `if`/`then` JSON Schema.
7. **Extend `harness_capabilities` with tool / skill / MCP support per harness.** The known gap (a
   harness switch can silently strand tools the target can't run). Needed for the compatibility panel
   in the Model & harness drawer to warn instead of guess. (This is our deferred follow-up.)

## 6. Open questions to settle with JP

- **Model source unification** (ask 4): is `harness_capabilities` the canonical source, with the
  prompt playground's catalog `choices` folding into it, or do they stay separate with one FE adapter?
- **Where display metadata lives** (asks 5-6): in the type's JSON Schema, or in a separate
  UI-primitives catalog (his `web-ui-primitives.md`, referenced but not yet shared)? This determines
  whether the FE reads it from the same `/workflows/catalog/types/{id}` payload or a new route.
- **Discriminator convention** (ask 2): `x-ag-discriminator` vs JSON Schema `oneOf` + `const`. Pick one
  so the generic list control has a single rule.
- **`extras` rendering** (ask 3): typed per-kind sub-schemas vs a generic editor, per field.

## 7. What stays FE-owned (not JP's call)

Section and drawer layout, the summary + drawer pattern, and which fields group into which drawer. The
schema drives field rendering (type, options, metadata, discriminators, labels, conditionals); we drive
composition. JP's "sections of the template" are a data/schema concern; our panel sections are a UI
concern, and they stay as designed.
