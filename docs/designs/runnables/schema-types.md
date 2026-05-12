# Schema Types

This is the working document for cleaning up schema, input, parameter, and
output types across managed workflows in Agenta.

The current system mixes multiple representations:

1. Legacy evaluator registry UI fields in
   `api/oss/src/resources/evaluators/evaluators.py`
2. Runnable runtime contracts in
   `sdk/agenta/sdk/engines/running/interfaces.py`
3. Prompt/agent semantic port annotations in
   `docs/designs/runnables/prompts-and-agents.md`
4. API transport wrappers in
   `api/oss/src/apis/fastapi/evaluators/router.py`
5. Frontend compatibility helpers in
   `web/oss/src/lib/evaluators/utils.ts`
6. Backend compatibility hydration in
   `api/oss/src/core/evaluators/service.py` and
   `api/oss/src/core/evaluators/utils.py`

The goal of this document is not just to list types. It should separate:

- what exists today
- what is legacy and can be dropped
- what is legacy but must remain backward-compatible
- what should become the clean target model

---

## Core Distinction

There are three different concepts that must stop being conflated.

### 1. Form field types

These are frontend/editor rendering hints for configuring a runnable.

Current source:

- `settings_template` in the builtin evaluator registry
- exposed unchanged by legacy `GET /simple/evaluators/templates`
- also remapped into `data.schemas.parameters` by
  `GET /evaluators/catalog/templates`

Examples:

- `string`
- `boolean`
- `number`
- `multiple_choice`
- `messages`
- `code`
- `regex`
- `fields_tags_editor`
- `llm_response_schema`
- `hidden`

These are not JSON Schema types. They are UI field widgets.

### 2. Runnable schemas

These are machine-readable contracts for the runnable itself.

Current source:

- `WorkflowServiceInterface(..., schemas=...)` in
  `sdk/agenta/sdk/engines/running/interfaces.py`
- stored on simple evaluators as `data.schemas`
- exposed through catalog responses as `template.data.schemas`

Examples:

- `schemas.inputs`
- `schemas.parameters`
- `schemas.outputs`

These should be JSON Schema based, not custom UI widgets.

### 3. Semantic annotations

These are extension keys that describe meaning beyond raw JSON type.

Current source:

- `x-ag-*` contract in `docs/designs/runnables/prompts-and-agents.md`

Examples:

- `x-ag-messages`
- `x-ag-message`
- `x-ag-content`
- `x-ag-context`
- `x-ag-consent`
- `x-ag-variables`
- `x-ag-status`

These are the clean path for prompt/agent-style workflows because they encode
semantic meaning without coupling to a specific frontend form.

### 4. SDK typed schema generators

These are Pydantic or Python types in the SDK that can be used
programmatically and can also generate schema fragments.

Current source:

- `sdk/agenta/sdk/utils/types.py`

Relevant examples already present there:

- `Message`
- `ToolCall`
- `ContentPartText`
- `ContentPartImage`
- `ContentPartFile`
- `JSONSchema`
- `ResponseFormatJSONSchema`
- `ModelConfig`
- `MessagesInput`
- `MultipleChoiceParam`
- `GroupedMultipleChoiceParam`

This is important because the target system should not rely only on markdown or
hand-authored JSON snippets. For reusable semantic sub-objects, we want an SDK
type that can be used directly and can emit the corresponding JSON Schema.

### 5. Dynamic schema sources

Some schema data should be composed dynamically rather than stored inline.

The clearest example is model selection:

- the SDK already has centrally owned model data in
  `agenta.sdk.utils.assets.supported_llm_models`
- current schema helpers also support grouped choices and model metadata

For those cases, the canonical schema should be able to point at a dynamic
source rather than embedding the full expanded choice list in stored revision
data.

This means we need to distinguish:

- structural schema
- semantic annotations
- dynamic source references

---

## Current Sources Of Truth

### Builtin evaluator registry

File:

- `api/oss/src/resources/evaluators/evaluators.py`

What it currently defines:

- builtin evaluator template metadata
- `settings_template`
- `settings_presets`
- some fixed `outputs_schema`
- evaluator-specific defaults

Important detail:

- `outputs_schema` is not authored uniformly at the template definition site
- many entries get `outputs_schema` injected afterwards through
  `_FIXED_OUTPUT_SCHEMA_BY_KEY`
- `auto_ai_critique` derives default `outputs_schema` from the default value of
  the `json_schema` parameter field

So today the registry is both:

- a UI form registry
- a partial runtime schema registry

That is one of the main problems.

### Runnable interfaces

File:

- `sdk/agenta/sdk/engines/running/interfaces.py`

What it currently defines:

- builtin URIs such as `agenta:builtin:auto_ai_critique:v0`
- runtime `schemas.inputs`
- runtime `schemas.outputs`
- new workflow handlers like `llm_v0`, `prompt_v0`, `agent_v0`

Important detail:

- evaluator builtins already have runtime-oriented schemas here
- these schemas overlap with the output schemas also maintained in the evaluator
  registry
- in some cases the interface schema and registry-derived schema do not model
  the same thing with the same precision

Examples:

- `auto_ai_critique_v0_interface` says outputs are `{score, success}`
- the builtin evaluator registry may instead derive outputs from the
  configurable `json_schema`
- `json_multi_field_match_v0_interface` allows dynamic output keys with
  `additionalProperties: True`
- frontend/backend helper code rebuilds a stricter schema from the selected
  `fields`

### Prompt and agent design

File:

- `docs/designs/runnables/prompts-and-agents.md`

What it currently defines:

- `llm_v0` target contract
- parameter structure
- status envelope
- semantic input/output annotations via `x-ag-*`

This is the cleanest document in the set because it separates:

- raw JSON structure
- semantic meaning
- stored parameters vs runtime inputs vs produced outputs

### Evaluator API transport

Files:

- `api/oss/src/apis/fastapi/evaluators/router.py`
- `api/oss/src/apis/fastapi/evaluators/models.py`

Important detail:

- legacy template endpoint returns registry-native shape:
  `settings_template`, `settings_presets`, `outputs_schema`
- catalog endpoint remaps the same builtin registry entry into:
  `data.uri`, `data.schemas.parameters`, `data.schemas.outputs`
- presets are remapped into:
  `data.uri`, `data.parameters`

So two API surfaces are already exposing the same evaluator definitions in two
different schema vocabularies.

### Compatibility helpers

Files:

- `api/oss/src/core/evaluators/utils.py`
- `api/oss/src/core/evaluators/service.py`
- `web/oss/src/lib/evaluators/utils.ts`

These are doing important hidden work:

- rebuilding output schemas from evaluator key + parameter values
- hydrating missing `data.schemas.outputs` for old stored simple evaluators
- deriving dynamic output schema for `auto_ai_critique`
- deriving dynamic output schema for `json_multi_field_match`

This means the actual effective schema is sometimes:

- not what is stored
- not what the interface says
- not what the registry says
- but what helper code reconstructs at runtime

That is the main cleanup target.

---

## Compatibility Classification

### Can Be Dropped

- treating evaluator `settings_template.type` values as if they were runtime
  schema types
- maintaining two primary public template APIs long-term:
  `/templates` and `/catalog/templates`
- implicit output schema reconstruction as the normal path

### Must Stay Backward-Compatible

- stored simple evaluators with `data.uri` pointing at builtin evaluator URIs
- stored simple evaluators that have `parameters` but no `data.schemas.outputs`
- legacy evaluator templates that frontend still reads as
  `settings_template` / `settings_presets`
- evaluator parameter names already in use in stored configs:
  `correct_answer_key`, `prompt_template`, `json_schema`, `fields`, `code`,
  `runtime`, `similarity_threshold`, and similar registry-defined settings

### Clean Target

- one canonical runnable contract per managed workflow:
  `uri + schemas + parameters`
- schemas expressed as JSON Schema
- semantic meaning carried by `x-ag-*` annotations, not UI widget names
- catalog responses exposing only canonical runnable data
- frontend form generation driven from canonical schemas plus UI metadata, not
  from a separate evaluator-only field-type system

---

## Current Evaluator Data Shapes

### Legacy template shape

Returned by:

- `GET /simple/evaluators/templates`

Shape:

```json
{
  "key": "auto_ai_critique",
  "name": "LLM-as-a-judge",
  "settings_template": {
    "prompt_template": {"type": "messages"},
    "model": {"type": "multiple_choice"},
    "json_schema": {"type": "llm_response_schema"}
  },
  "settings_presets": [
    {"key": "hallucination", "values": {...}}
  ],
  "outputs_schema": {...}
}
```

Status:

- legacy transport
- still actively used by frontend
- should remain readable until frontend migrates

### Catalog template shape

Returned by:

- `GET /evaluators/catalog/templates`

Shape:

```json
{
  "key": "auto_ai_critique",
  "data": {
    "uri": "agenta:builtin:auto_ai_critique:v0",
    "schemas": {
      "parameters": {...},
      "outputs": {...}
    }
  }
}
```

Status:

- preferred transport direction
- still populated from legacy registry content
- `schemas.parameters` is not yet true JSON Schema; today it is still the old
  `settings_template` object under a new key

### Catalog preset shape

Returned by:

- `GET /evaluators/catalog/templates/{template_key}/presets`

Shape:

```json
{
  "key": "hallucination",
  "data": {
    "uri": "agenta:builtin:auto_ai_critique:v0",
    "parameters": {...}
  }
}
```

Status:

- good target transport shape
- the clean part here is that presets are already plain parameter payloads

Additional note:

- presets should be treated as parameter examples, not as independent schema
  systems
- a preset may intentionally omit optional fields
- a preset may also make some fields irrelevant for that preset's behavior even
  if those fields exist in the template-level parameter schema

### Stored simple evaluator shape

Stored/read through:

- `/simple/evaluators/*`

Shape:

```json
{
  "data": {
    "uri": "agenta:builtin:auto_ai_critique:v0",
    "parameters": {...},
    "schemas": {
      "outputs": {...},
      "parameters": {...}
    }
  }
}
```

Status:

- this is closest to the target model
- but many old records are incomplete and rely on compatibility hydration

---

## Legacy Field Types

These are current registry field widget types from
`api/oss/src/resources/evaluators/evaluators.py`.

They are still useful to document because frontend depends on them, but they
should be treated as legacy UI metadata, not canonical schema primitives.

### `string`

Plain text input.

Typical use:

- column keys
- URLs
- substrings
- JSON paths

### `boolean`

Checkbox or toggle.

Typical use:

- case sensitivity
- compare flags
- matcher behavior switches

### `number`

Numeric input with optional `min` and `max`.

Typical use:

- thresholds
- scores
- distances

### `multiple_choice`

Single-select dropdown using `options`.

Typical use:

- model names
- runtimes
- response modes

### `messages`

Array of `{role, content}` messages.

Typical use:

- `prompt_template`

This is conceptually close to the `x-ag-messages` semantic annotation and
should eventually converge with that model.

### `code`

Code editor widget.

Typical use:

- `auto_custom_code_run.code`

This is a UI/editor concept, not a runtime primitive. Runtime should represent
the actual stored value in a normal schema plus metadata.

### `regex`

Regex-specific text input.

Typical use:

- regex pattern parameters

### `fields_tags_editor`

Editable list of field names.

Typical use:

- `json_multi_field_match.fields`

This should eventually become a normal array schema with item constraints.

### `llm_response_schema`

Structured builder for the LLM judge output schema.

Typical use:

- `auto_ai_critique.json_schema`

This is currently the most important legacy-special field because it directly
drives output schema generation.

### `hidden`

Stored but not rendered.

Typical use:

- `version`
- `response_type`

This is a UI visibility flag, not a real data type.

---

## Legacy Field Metadata Flags

These properties currently modify frontend behavior:

| Flag | Meaning |
|------|---------|
| `advanced` | Hide under advanced settings |
| `required` | Mark field as mandatory |
| `options` | Allowed options for `multiple_choice` |
| `min` / `max` | Numeric bounds |

These should survive only as UI metadata. They should not be confused with the
underlying runnable schema.

---

## Presets And Parameter Examples

Catalog presets are important because they express the intended parameter
payloads for common cases.

They should be treated as:

- curated example parameter sets
- compatibility fixtures for legacy evaluator presets
- a way to show which parameters are typically used together

They should not become:

- a second schema language
- a hidden transform layer
- the only place where optionality or field applicability is understood

### Preset semantics

For a given template, a preset parameter example may do any of the following:

- provide a value for a required field
- provide a value for an optional field
- omit an optional field
- omit a field that exists in the broad template schema but is not considered
  for that preset

That last case matters. "Field exists in template schema" and "field is
considered in this preset" are not the same statement.

### Suggested vocabulary

At the template schema level, each parameter should be classifiable as:

- required
- optional
- derived
- internal

At the preset-example level, each parameter should be classifiable as:

- provided
- omitted but allowed
- not considered for this preset

### Why this matters

Without this distinction, a reader cannot tell whether a missing field means:

- the field is required and the example is incomplete
- the field is optional and simply omitted
- the field exists generally but should be ignored for this preset

### Working recommendation

When we document a managed workflow template, we should include:

1. canonical parameter schema
2. parameter examples from presets
3. an indication of which fields are required vs optional
4. when useful, an indication of which fields are considered by a given preset

For example, conceptually:

```json
{
  "template": {
    "parameters": {
      "model": {"required": false},
      "prompt_template": {"required": true},
      "json_schema": {"required": false},
      "correct_answer_key": {"required": false}
    }
  },
  "preset": {
    "key": "hallucination",
    "parameters": {
      "prompt_template": [...],
      "model": "gpt-4o-mini",
      "json_schema": {...}
    },
    "field_usage": {
      "prompt_template": "provided",
      "model": "provided",
      "json_schema": "provided",
      "correct_answer_key": "omitted_but_allowed"
    }
  }
}
```

Exact wire format is still open. The important requirement is that the docs and
eventual canonical model can express both optionality and preset-specific field
participation.

---

## Current Dynamic Schema Cases

These are the places where schemas are not static today.

### `auto_ai_critique`

Current behavior:

- registry exposes parameter field `json_schema` of type
  `llm_response_schema`
- registry default `outputs_schema` is derived from the default
  `json_schema.default.schema`
- backend helper `build_evaluator_data()` derives actual `data.schemas.outputs`
  from `parameters.json_schema.schema`
- frontend helper `deriveEvaluatorOutputsSchema()` does the same

Implication:

- outputs are parameterized by configuration
- the interface definition in `sdk/.../interfaces.py` is currently too coarse
  to be the only source of truth

Target direction:

- make parameterized outputs a first-class concept in canonical runnable schema
- avoid duplicating the derivation logic in both frontend and backend

### `json_multi_field_match`

Current behavior:

- parameter `fields` is configured through `fields_tags_editor`
- backend helper expands those field names into explicit output properties
- frontend helper expands the same field names into explicit output properties
- interface file allows dynamic additional properties instead of the exact shape

Implication:

- exact output schema depends on parameter values
- the parameter-to-output relation is duplicated in multiple places

Target direction:

- define one canonical way for a parameterized runnable to expose derived output
  schema

### Stored builtin simple evaluators without outputs schema

Current behavior:

- `SimpleEvaluatorsService._normalize_evaluator_data()` detects builtin `uri`
- if `data.schemas.outputs` is missing, it reconstructs the full data using
  `build_evaluator_data()`

Implication:

- old stored evaluators continue to work
- schema completeness is currently guaranteed by hydration logic, not by stored
  data integrity

Status:

- backward compatibility path, should stay until data migration is complete

---

## `x-ag-*` Semantic Annotations

These belong to the cleaner future model, especially for prompts, agents, and
other managed workflows that have semantic I/O.

They should be used only when JSON Schema primitives are not sufficient by
themselves.

### Rule of use

Use plain JSON Schema first for structure:

- `type`
- `properties`
- `items`
- `required`
- `enum`
- `description`
- `default`

Use `x-ag-*` only for semantic meaning that the runtime or UI must understand
but that cannot be expressed by structure alone.

Examples:

- "this object is consent state"
- "this array is a message list"
- "this object is the lifecycle status envelope"

### SDK generation rule

For every reusable `x-` semantic field or sub-object, we should have a matching
SDK type in `sdk/agenta/sdk/utils/types.py` or a nearby SDK types module.

That type should serve two roles:

- programmatic Python type for SDK users and internal code
- source for generating the JSON Schema sub-object plus extension metadata

This is already partially true today through the existing SDK `x-parameter`
helpers.

Examples already in the SDK:

- `MultipleChoiceParam` and `GroupedMultipleChoiceParam`
- `MessagesInput`
- `Message`
- `ContentPart*`
- `JSONSchema`

Target implication:

- `x-ag-message` should correspond to a `Message` SDK model
- `x-ag-messages` should correspond to `List[Message]`
- `x-ag-content` should correspond to `ContentPart` models
- `x-ag-status` should correspond to a dedicated status model
- `x-ag-consent` should correspond to dedicated consent models

### Dynamic option-source rule

For fields such as model selectors, provider selectors, or other centrally
maintained option sets, the canonical schema should support a source reference
instead of embedding the entire option list.

Conceptually:

- the schema says "this is a grouped choice field"
- the schema also says "resolve the choices from this SDK/assets source"

This avoids:

- duplicating large option sets in stored revision data
- stale snapshots of centrally owned lists
- unnecessary schema churn when the central option set changes

To make this workable, the extension must itself be typed and versioned.

It should answer:

- what kind of definition is this?
- is it passed by value or by reference?
- if by reference, where does the consumer resolve it from?
- which version of the definition contract is this?

Conceptually:

```json
{
  "x-ag-type-ref": {
    "type": "model_catalog",
    "version": "v1",
    "mode": "reference",
    "source": {
      "kind": "sdk_asset",
      "path": "agenta.sdk.utils.assets.supported_llm_models"
    }
  }
}
```

Or:

```json
{
  "x-ag-type-ref": {
    "type": "model_catalog",
    "version": "v1",
    "mode": "value",
    "value": {
      "choices": {
        "openai": ["gpt-5", "gpt-5-mini"]
      }
    }
  }
}
```

This gives us a clean distinction between:

- by-value definitions
- by-reference definitions
- legacy materialized payloads

It also gives consumers an explicit type to switch on.

Current code reality:

- legacy and current frontend helpers mostly expect materialized `choices` or
  `enum` values in the schema
- `web/packages/agenta-shared/src/utils/schemaOptions.ts` reads `choices`,
  `enum`, and `x-model-metadata`
- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/schemaUtils.ts`
  detects grouped choices from `x-parameter`, `choices`, or model enums
- legacy OpenAPI consumers parse `x-parameter` from the OpenAPI schema in:
  - `web/oss/src/services/api.ts`
  - `api/oss/src/services/llm_apps_service.py`

So dynamic source references are a target capability, not the dominant current
behavior.

### Inputs

| Annotation | Intent | When To Use |
|------------|--------|-------------|
| `x-ag-messages` | marks a field as a message-list semantic slot | when an array represents chat turns, not just arbitrary objects |
| `x-ag-message` | marks a field as a single-message semantic slot | when a field is exactly one normalized message |
| `x-ag-content` | marks raw content parts | when content is passed without a role wrapper |
| `x-ag-context` | marks structured execution context | when an object is intended to merge into runtime context |
| `x-ag-consent` | marks consent state or policy | when an object controls or carries consent decisions |
| `x-ag-variables` | marks template-substitution variables | when an object supplies placeholder bindings |

### Outputs

| Annotation | Intent | When To Use |
|------------|--------|-------------|
| `x-ag-status` | marks lifecycle/status envelope | when an object carries normalized run outcome status |
| `x-ag-messages` | marks full message list after execution | when outputs return the effective message transcript |
| `x-ag-message` | marks a single message slot | when outputs expose one primary message separately |
| `x-ag-content` | marks output content parts | when outputs expose raw content-part payloads |
| `x-ag-context` | marks resulting structured context | when outputs return merged or updated runtime context |
| `x-ag-consent` | marks resulting consent state | when outputs return effective consent state for resume |

Key point:

- these annotations are semantic overlays on JSON Schema
- they are a better long-term abstraction than evaluator-specific form widget
  names

---

## Proposed Cleanup Rules

### Rule 1

Canonical managed workflow definitions should be expressed as:

```json
{
  "uri": "...",
  "schemas": {
    "inputs": {...},
    "parameters": {...},
    "outputs": {...}
  }
}
```

### Rule 2

`schemas.inputs`, `schemas.parameters`, and `schemas.outputs` should be JSON
Schema documents or a documented extension of JSON Schema, not evaluator-only
form field DSL objects.

The default rule is:

- use JSON Schema primitives for structure
- add `x-ag-*` only for semantics and intent
- for reusable semantic structures, back them with SDK Pydantic models that can
  generate those schema fragments

### Rule 3

UI behavior should be attached as metadata, not encoded as fake data types.

Examples:

- `ui:widget = "code"` instead of `type = "code"`
- `ui:widget = "messages"` instead of `type = "messages"`
- `ui:advanced = true` instead of overloading field semantics

Exact naming is still open. The important point is separation of concerns.

### Rule 4

Parameter-driven output schemas must have one canonical derivation path.

Today this logic exists in:

- backend evaluator utils
- frontend evaluator utils
- partially in the builtin registry

That should be collapsed into one source of truth.

### Rule 5

Catalog endpoints should expose only the canonical runnable contract.

That means:

- templates expose `data.uri + data.schemas`
- presets expose `data.uri + data.parameters`
- no long-term dependency on `settings_template` / `settings_presets`

### Rule 6

Optionality must be explicit at the canonical parameter-schema layer.

That means the system must be able to answer, for every field:

- is this required?
- is this optional?
- is this derived/internal and therefore not user-supplied?

### Rule 7

Presets should be able to indicate field participation.

That means a preset example should be interpretable as:

- field provided
- field omitted but still allowed
- field not relevant for this preset

This can be documented metadata first and formalized later, but we should not
leave it implicit.

### Rule 8

`schemas.parameters` and `schemas.outputs` should be defined first for managed
workflows.

`schemas.inputs` should also be defined when the input contract is stable and
meaningful enough to standardize. If not, it may remain temporarily absent, but
that should be treated as an explicit temporary state, not the desired end
model.

### Rule 9

Legacy evaluator field types remain supported only as an adapter layer for old
frontend screens until migration is complete.

### Rule 10

For managed workflows, reusable schema fragments should be defined in the SDK
type layer whenever possible, then referenced in docs and interface definitions.

The intended flow is:

1. define SDK type
2. generate or derive JSON Schema fragment
3. annotate with `x-` metadata when needed
4. embed into `schemas.inputs`, `schemas.parameters`, or `schemas.outputs`

### Rule 11

For dynamic option sets, do not persist the fully expanded values in canonical
stored schemas unless materialization is specifically needed for compatibility.

Prefer:

1. schema shape
2. extension metadata describing the field kind
3. typed definition object describing whether the payload is inline or indirect
4. source reference describing where the options come from when indirect

Compatibility consumers may still receive materialized `choices` / `enum`
during migration.

### Rule 12

Dynamic definition extensions should be self-describing.

That means they should include, at minimum:

- `type`
- `version`
- `mode`
- `source` or `value`

This lets consumers understand both the current shape and future revised shapes
without guessing from the presence or absence of random fields.

---

## Recommended Transition Model

### Phase 1

Document the distinction and stop adding new concepts to `settings_template`.

### Phase 2

For new managed workflows:

- define canonical JSON Schema first
- add semantic annotations where needed
- add UI metadata separately

### Phase 3

For evaluator builtins:

- keep reading legacy `settings_template`
- generate canonical `schemas.parameters`
- migrate frontend form rendering to the canonical representation

### Phase 4

After frontend migration:

- deprecate legacy `/templates`
- keep compatibility hydration for stored simple evaluators
- eventually remove duplicated schema derivation paths once data migration is
  complete

---

## Open Questions

1. Do we want `schemas.parameters` to be strict JSON Schema, or JSON Schema plus
   documented Agenta UI extensions?
2. What is the single canonical mechanism for parameterized outputs such as
   `auto_ai_critique` and `json_multi_field_match`?
3. Should builtin runtime interfaces in
   `sdk/agenta/sdk/engines/running/interfaces.py` become the primary source of
   truth for builtin evaluator schemas, with registry data reduced to metadata
   and presets only?
4. Should prompt/agent semantic annotations become the standard for all managed
   workflow ports, including evaluator-like workflows where applicable?
5. Should the existing SDK `x-parameter` convention be migrated into `x-ag-*`,
   or should we support `x-parameter` only as a legacy compatibility shape?
6. What should the canonical source-reference extension be called for dynamic
   option sets such as supported LLM models?
7. Should every Agenta-owned field/widget classification move under
   `x-ag-type`, with legacy `x-parameter` retained only for migration?

---

## Practical Conclusions For This Cleanup

When reviewing any schema or type in this area, first classify it as one of:

- legacy UI widget metadata
- canonical runnable schema
- semantic schema annotation
- compatibility adapter/hydration behavior

If a concept does not clearly fit one of those buckets, it is probably part of
the current confusion and should not be copied forward.
