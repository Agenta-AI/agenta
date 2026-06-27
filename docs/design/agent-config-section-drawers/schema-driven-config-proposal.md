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

## 7. Detailed designs: shapes, FE usage, backend

Each subsection has the schema shape we want the catalog to emit, the FE snippet that consumes it
(replacing today's hardcoding), and the backend emission note with the likely problem and how to
tackle it. Snippets are illustrative, not final code.

### 7.1 `x-ag-type-ref` on every sub-field + a catalog type per primitive

**Schema shape** (the enriched `agent` template; each sub-field is a thin ref the catalog expands):

```jsonc
{
  "x-ag-type-ref": "agent-template",
  "type": "object",
  "properties": {
    "instructions": { "x-ag-type-ref": "instructions" },
    "llm":          { "x-ag-type-ref": "llm" },
    "tools":        { "type": "array", "x-ag-type-ref": "tools" },
    "mcps":         { "type": "array", "x-ag-type-ref": "mcps" },
    "skills":       { "type": "array", "x-ag-type-ref": "skills" },
    "agents":       { "type": "array", "x-ag-type-ref": "agent-template" }, // recursive
    "assets":       { "type": "array", "x-ag-type-ref": "assets" },
    "directories":  { "type": "array", "x-ag-type-ref": "directories" }
  }
}
```

The siblings `harness` / `runner` / `sandbox` are their own top-level refs, resolved the same way.

**FE usage.** The body of each drawer stops hardcoding controls and dispatches the resolved sub-schema
through the existing renderer. The drawer shells (summary + `SectionDrawer`) stay ours:

```tsx
// AgentTemplateControl: schema is already ref-enriched by enrichSchemaRefs.
function InstructionsDrawerBody({schema, value, onChange}: BodyProps) {
  const instructions = schema.properties?.instructions   // resolved sub-schema
  return (
    <SchemaPropertyRenderer
      schema={instructions}
      value={value?.instructions}
      onChange={(v) => onChange({...value, instructions: v})}
      path={["instructions"]}
    />
  )
}
// Which sub-fields land in which drawer stays an FE decision (composition);
// HOW each renders is now the schema's job (no `config.agents_md` literal).
```

**Backend + problem.** The SDK already stamps `x-ag-type-ref` via the `AgSchemaMixin` / `__ag_type__`
pattern (`AgentConfigSchema.__ag_type__ = "agent_config"` today). The ask is to give each sub-type its
own `__ag_type__` and register a catalog entry so `/workflows/catalog/types/{id}` returns it.
- *Problem: recursion.* `agents[]` is a recursive `agent-template`, so the schema refers to itself.
  The FE `enrichSchemaRefs` must not expand it eagerly into an infinite tree. *Tackle:* keep `agents[]`
  a thin ref and resolve it lazily (only when a subagent row opens), and cap `enrichSchemaRefs` depth /
  break on a self-ref. The catalog fetch is cached `staleTime: Infinity`, so repeated lookups are free.
- *Problem: `$defs`.* Pydantic emits nested models as `$ref: "#/$defs/..."`. *Tackle:* the catalog
  route should inline `$defs` into each `type.json_schema` (or the FE derefs them), so the FE gets a
  self-contained schema per type.

### 7.2 Declared discriminator + per-kind sub-schemas (tools / mcps / skills / agents)

**Schema shape** (the redesign's uniform entry, as a discriminated union):

```jsonc
{
  "type": "array",
  "x-ag-type-ref": "tools",
  "items": {
    "discriminator": { "propertyName": "kind" },   // OpenAPI; Pydantic already emits this
    "oneOf": [
      { "title": "Built-in", "properties": {
          "kind": {"const": "builtin"}, "name": {"type":"string"},
          "permissions": {"x-ag-type-ref":"permissions"} } },
      { "title": "Gateway", "properties": {
          "kind": {"const": "gateway"}, "name": {"type":"string"},
          "provider": {"type":"string"}, "integration": {"type":"string"},
          "action": {"type":"string"}, "connection": {"x-ag-type-ref":"connection"} } },
      { "title": "MCP", "properties": {
          "kind": {"const": "mcp"}, "transport": {"enum":["http","stdio"]},
          "url": {"type":"string"}, "command": {"type":"string"} } },
      { "title": "Code", "properties": {
          "kind": {"const": "code"}, "isolation": {"enum":["shared","isolated"]},
          "parameters": {"type":"object","properties":{"runtime":{},"script":{}}},
          "schemas": {"x-ag-type-ref":"schemas"} } }
    ]
  }
}
```

**FE usage.** One generic control replaces `describeTool` / `describeMcp` / `describeSkill` /
`inferIsBuiltinTool`. It picks the variant by the declared discriminator and renders it:

```tsx
function DiscriminatedListControl({schema, value, onChange}: BodyProps) {
  const disc = schema.items?.discriminator?.propertyName
    ?? schema.items?.["x-ag-discriminator"] ?? "kind"
  const variants: Schema[] = schema.items?.oneOf ?? []
  const variantFor = (entry: Record<string, unknown>) =>
    variants.find(v => v.properties?.[disc]?.const === entry?.[disc])

  return (value as Record<string, unknown>[]).map((entry, i) => (
    <SchemaPropertyRenderer
      key={i}
      schema={variantFor(entry)}            // the per-kind sub-schema, no sniffing
      value={entry}
      onChange={(v) => onChange(patchAt(value, i, v))}
      path={[String(i)]}
    />
  ))
}
// "Add" uses the same oneOf to offer the kind options + their default shapes.
```

**Backend + problem.** A Pydantic discriminated union
(`Annotated[Union[BuiltinTool, GatewayTool, McpTool, ...], Field(discriminator="kind")]`) already emits
`discriminator: {propertyName, mapping}` + `oneOf`.
- *Problem: the FE wants the variant schema inline, but Pydantic emits `oneOf: [{$ref: "#/$defs/..."}]`.*
  *Tackle:* same `$defs` inlining as 7.1; then `oneOf[i].properties.kind.const` is directly readable.
- *Problem: today's stored tools are not in `kind` shape* (`{type, function}`, gateway-name encoding).
  *Tackle:* this is the CHANGE-3 migration on the backend (no production data), so the new schema and
  the stored entries land together; the FE only ever sees the new `kind` shape. No FE compat layer.
- *Convention:* the FE can read OpenAPI `discriminator.propertyName` with no extra backend work; an
  `x-ag-discriminator` alias is optional. Recommend reading `discriminator` first.

### 7.3 `extras` as a typed-but-open object (per kind)

`extras` is "untyped by design" (CHANGE-4) but we still want a real editor. The two goals reconcile:
keep runtime open, but publish the known fields for the editor.

**Schema shape** (lives on each discriminated variant, so it falls out of 7.2 for free):

```jsonc
// inside the harness oneOf, kind = claude
"extras": {
  "type": "object",
  "additionalProperties": true,          // runtime stays open
  "properties": {                        // known fields → typed controls in the editor
    "soul_md":       {"type":"string","x-parameters":{"multiline":true}},
    "principles_md": {"type":"string","x-parameters":{"multiline":true}}
  }
}
```

**FE usage.** Render the known properties with the schema renderer, and the residue (anything not in
`properties`) with a generic key/value editor:

```tsx
function ExtrasControl({schema, value, onChange}: BodyProps) {
  const known = new Set(Object.keys(schema.properties ?? {}))
  const residue = Object.fromEntries(
    Object.entries(value ?? {}).filter(([k]) => !known.has(k)),
  )
  return (
    <>
      <ObjectSchemaControl schema={schema} value={value} onChange={onChange} />
      {schema.additionalProperties === true && (
        <KeyValueEditor value={residue} onChange={(r) => onChange({...stripResidue(value, known), ...r})} />
      )}
    </>
  )
}
```

**Backend + problem.** Emit `additionalProperties: true` plus the known `properties`.
- *Problem: "untyped" and "renderable" seem to conflict.* *Tackle:* they do not. `additionalProperties:
  true` keeps the runtime contract open (any harness-specific key is accepted) while `properties` is a
  hint list for the editor only. List the real fields explicitly (the redesign already says "list its
  fields, never comment them out"), and the FE renders typed controls for them and a key/value editor
  for the rest. No new convention needed.

### 7.4 One harness-scoped source for model options + per-model metadata

**Schema/inspect shape.** Extend the existing `harness_capabilities` so its model entries carry the
same metadata shape `x-ag-metadata` already uses, removing the inspect-vs-catalog fork:

```jsonc
"harness_capabilities": {
  "claude": {
    "providers": ["anthropic"],
    "connection_modes": ["agenta","self_managed"],
    "model_selection": "alias",
    "models": { "anthropic": ["sonnet","haiku","opus"] },
    "models_metadata": {                         // NEW, same shape getOptionsFromSchema reads
      "anthropic": { "sonnet": {"name":"Claude Sonnet 4.6","input":3,"output":15} }
    }
  }
}
```

**FE usage.** `buildModelOptionGroups` already accepts a metadata arg, so this is a one-line source
change and the deletion of the fallback fork in `AgentConfigControl`:

```tsx
const caps = useAtomValue(harnessCapabilitiesAtomFamily(revisionId ?? ""))
const harnessCaps = caps?.[harnessValue ?? ""]
const groups = buildModelOptionGroups(caps, harnessValue, harnessCaps?.models_metadata)
// single path; drop the `hasInspectModels ? SelectLLMProviderBase : GroupedChoiceControl` branch
return <SelectLLMProviderBase showGroup options={groups} value={modelId} onChange={...} />
```

**Backend + problem.** `harness_capabilities` is assembled where `/inspect` `meta` is built.
- *Problem: duplicating the pricing/metadata catalog.* The prompt playground's `x-ag-metadata` already
  has per-model pricing/display data. *Tackle:* do not duplicate it. Project that same catalog into
  `models_metadata`, filtered to the harness's published models. One source, two projections (catalog
  `choices` for prompts, `harness_capabilities` for agents).
- *Problem: alias vs provider-id naming* (`model_selection: "alias"` for Claude vs `"provider/id"` for
  Pi). *Tackle:* key `models_metadata` exactly as `models` is keyed, so the FE looks up metadata by the
  same id it shows. The FE never has to translate.

### 7.5 Field-level display + option metadata in the schema

**Schema shape.** Carry labels (and optional presentational metadata) on enum members as `oneOf` +
`const` + `title`, the way the model primitive already does:

```jsonc
"harness": {
  "x-ag-type-ref": "harness",
  "properties": {
    "kind": {
      "oneOf": [
        {"const":"claude",  "title":"Claude Code","x-ag-metadata":{"short":"CC","color":"#d97757"}},
        {"const":"pi_core", "title":"Pi",         "x-ag-metadata":{"short":"Pi","color":"#6b5bd6"}}
      ]
    }
  }
}
```

**FE usage.** `HarnessSelectControl` reads option titles + metadata instead of the hardcoded
`HARNESS_META`; `enumLabel` already prefers `oneOf` titles, so summaries come for free:

```tsx
const options = oneOfOptions(schema.properties.kind)
//            → [{value:"claude", label:"Claude Code", meta:{short:"CC", color:"#d97757"}}, ...]
return <Segmented options={options.map(o => ({value:o.value, label:<HarnessChip {...o.meta}/>}))} />
```

**Backend + problem.** Emit `title` per `Literal` member (a small mapping on the Pydantic field).
- *Problem: icon/color is presentational, arguably not the backend's concern.* *Tackle:* split it.
  Labels (`title`) are authoritative and belong in the schema now. Icon/color can either ride in
  `x-ag-metadata` or stay a tiny FE fallback keyed by `kind`; if a UI-primitives catalog ships (open
  question), move them there. Either way the FE stops owning the label text.

### 7.6 Declared conditional-visibility rules

**Schema shape.** A minimal annotation keeps the FE evaluator tiny (full JSON Schema `if`/`then` is
verbose and needs a large evaluator):

```jsonc
"connection": { "properties": {
  "mode": {"enum":["agenta","self_managed"]},
  "slug": {"type":"string","x-ag-visible-when":{"field":"mode","equals":"agenta"}}
}},
"network": { "properties": {
  "mode": {"enum":["on","off","allowlist"]},
  "allowlist": {"type":"array","x-ag-visible-when":{"field":"mode","equals":"allowlist"}}
}}
```

**FE usage.** A one-function evaluator, applied in the object control before rendering a child:

```tsx
function isVisible(propSchema: Schema, siblings: Record<string, unknown>): boolean {
  const rule = propSchema["x-ag-visible-when"]
  if (!rule) return true
  const actual = getByPath(siblings, rule.field)          // intra-object path
  if ("equals" in rule) return actual === rule.equals
  if ("in" in rule)     return (rule.in as unknown[]).includes(actual)
  return true
}
// ObjectSchemaControl: Object.entries(properties).filter(([k, s]) => isVisible(s, value)).map(render)
```

**Backend + problem.** Emit `x-ag-visible-when: {field, equals | in}`.
- *Problem: cross-object conditions.* "Claude permissions only on the Claude harness" is not an
  intra-object rule (permissions live on `harness`, the harness kind is a sibling field). *Tackle:* in
  the redesign these already co-locate (`harness.permissions` sits on `harness`, gated by
  `harness.kind`), so most conditionals are intra-object. The genuinely cross-object case (a tool's
  validity vs the harness) is a *capability* concern, handled by 7.7, not by visibility. Keep
  `x-ag-visible-when` strictly intra-object; push cross-object logic to capabilities.

### 7.7 Extend `harness_capabilities` with tool / skill / MCP support

**Schema/inspect shape.**

```jsonc
"claude": {
  "...": "...",
  "tools":  { "kinds": ["builtin","mcp","gateway"], "builtins": ["read","write","bash"] },
  "skills": { "supported": true },
  "mcp":    { "transports": ["http","stdio"] }
}
```

**FE usage.** The Model & harness compatibility panel warns per configured tool whose kind the target
harness cannot run (mirrors the existing `harnessAllowsModel`):

```tsx
function harnessAllowsToolKind(caps, harness, kind: string): boolean {
  const kinds = caps?.[harness ?? ""]?.tools?.kinds
  return !kinds || kinds.includes(kind)        // permissive when unknown
}
// for each configured tool: if (!harnessAllowsToolKind(caps, target, tool.kind)) warn(tool)
```

**Backend + problem.** The supported kinds/builtins are real harness-adapter knowledge.
- *Problem: that knowledge may not be centrally exposed yet.* *Tackle:* start with a static per-harness
  capability table in the harness registry (cheap and correct enough), surfaced in `/inspect` `meta`;
  refine later as adapters report it directly. The FE degrades gracefully: when the field is absent the
  helper returns permissive (no warning), so the FE ships before the data is complete. This is the
  deferred harness-gating follow-up.

## 8. The minimal backend change that covers most of this

Asks 2, 3, and 5 collapse into one coherent, small backend posture rather than three separate
features:

- Model the polymorphic sections (`tools` / `mcps` / `skills` / `agents`, and the `harness` / `runner`
  / `sandbox` kinds) as **Pydantic discriminated unions** keyed on `kind`. That single choice gives the
  FE the `discriminator` + `oneOf` it needs (ask 2), a natural home for each kind's typed-but-open
  `extras` (ask 3), and per-member `title`s for labels (ask 5).
- Make the catalog route **inline `$defs`** so each `type.json_schema` is self-contained (needed by
  7.1 and 7.2).
- Add `models_metadata` to `harness_capabilities` by projecting the existing model catalog (ask 4), and
  a static per-harness capability table for tool kinds (ask 7).

Asks 6 (`x-ag-visible-when`) and the icon/color half of 5 are the only genuinely new annotations, and
both are small and optional-to-start. Everything else reuses machinery the prompt playground and the
SDK schema mixin already have.
