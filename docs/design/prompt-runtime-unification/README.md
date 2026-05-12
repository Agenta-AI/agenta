# RFC: Prompt Variables, JSON Values, and LLM Runtime Unification

## Context

Agenta runs several LLM-backed services that share most of their lifecycle but were built separately:

- Completion prompts.
- Chat prompts.
- LLM-as-a-judge evaluators.
- Future agent-style services.

Each can be invoked from multiple surfaces — direct API, SDK (including local evaluation workflows), the normal playground, the evaluator playground, and the evaluation service jobs that run app and evaluator revisions over stored testsets.

The same conceptual operation appears in all of them: take structured inputs, expose variables to a prompt, render message templates, resolve provider/model settings, call an LLM, and normalize outputs. Today those steps differ enough that users and developers cannot rely on one consistent mental model.

## Problem Statement

Users need a consistent answer to these questions:

- What variables can I use in a prompt?
- Are variables strings, JSON objects, arrays, or messages?
- If a testset cell contains JSON, can I access nested fields?
- Which template formats are supported, and how do I escape special characters?
- Why does the same variable behave differently in completion, chat, evaluator playground, and evaluation runs?
- Why can chat/completion use some configured models while LLM-as-a-judge cannot?

The current system makes those answers difficult because runtime behavior and frontend transport behavior are not fully aligned.

## Current State

### Runtime services

**Chat and completion** share the same prompt runtime.

- Config lives under `parameters.prompt`: `messages`, `template_format`, `input_keys`, and `llm_config`.
- Rendering goes through `PromptTemplate.format(**inputs)` in `sdk/agenta/sdk/utils/types.py`, which supports `curly`, `fstring`, and `jinja2`.
- Completion exposes top-level `inputs` keys as variables. Chat exposes the same keys except `messages`, which is appended as typed messages after rendering (not exposed as a template variable).

**LLM-as-a-judge** is close in behavior but uses a separate runtime path.

- Config is a flat evaluator shape: `prompt_template`, `model`, `response_type`, `json_schema`, `correct_answer_key`, `threshold`, `version`, optional `template_format`.
- Renders messages through `_format_with_template` in `sdk/agenta/sdk/engines/running/handlers.py`. It supports the same three formats as `PromptTemplate.format`; the default depends on evaluator `version` — `fstring` for v2, `curly` for v3+.
- Render context combines the testcase row, app outputs, ground-truth aliases, trace, and evaluator parameters. See [Variable Matrix](#variable-matrix) for the full list with types and availability.

### Runtime gaps

All three services should share the same building blocks but currently don't:

- **Provider/model resolution.** Chat and completion use workflow provider settings; the judge manually extracts a fixed provider-key set and therefore cannot reliably use custom or self-hosted models configured in the UI.
- **Rendering.** Each service has different rendering behavior:
  - `PromptTemplate.format` raises on Jinja errors; `_format_with_template` returns the original content with a warning.
  - Chat and completion recursively render `llm_config.response_format`. The judge builds `response_format` from `response_type` / `json_schema` and does not render variables inside `json_schema`.
- **Config.** The judge does not allow configuring `temperature`. It currently sends a hard-coded `temperature=0.01`, which some models reject as an unsupported optional parameter.
- **Output.** Completion, chat, and judge return different output shapes. Shared runtime code should stop before handler-specific output normalization.

### Invocation surfaces

**Direct API and SDK calls.** The caller sends `data.inputs` as JSON; the runtime receives native JSON values. For chat, `messages` arrives as a typed message list.

**Evaluation service.**

- For chat / completion, `parse_legacy_inputs(...)` selects configured `input_keys` from `testcase.data` (or copies the row), preserving native objects and arrays. For chat, it reads `messages` or `chat`; native lists are preserved and string values are parsed as message JSON only for that special field.
- For evaluator invocation, the request sends `inputs=testcase.data`, `outputs=...`, `trace=...`, so evaluator runs already receive native testcase JSON.

**Normal playground.**

- Completion path: testcase values can start as native JSON in the UI state, but request construction stringifies object and array values before invoking the runtime. As a result, whole-value insertion (`{{profile}}`) appears to work; nested access (`{{profile.name}}`) breaks.
- Chat path: chat history is normalized into typed `messages`, but other variables follow the same stringifying input construction.

**Evaluator playground.** Combines testcase data, upstream app output, traces, evaluator settings, and evaluator input schema. Like the normal playground, it stringifies object and array testcase values via `normalizeCompact` in `web/packages/agenta-entities/src/runnable/utils.ts`; the inputs reach the evaluator runtime as JSON-encoded strings rather than native objects. Types in play: testcase columns (any JSON), `prediction` / upstream output (any JSON, currently sent as a string), evaluator parameters (object).

### Playground transport

The playground discovers variables from prompt templates and configuration, then builds input rows from testcase data or manual entry. It also extracts variables from response formats and tools in some prompt configurations.

The problematic part is execution payload construction:

- For completion, object and array testcase values are converted to strings before being sent.
- For chat, `messages` is normalized as chat history, while non-message variables follow the same stringifying input construction path.
- The evaluator playground does the same.
- Testcase editing already has utilities to detect object, array, string, boolean, number, null, and messages — but that type information is not consistently preserved through execution.

The basic rule should be: **native JSON stays native until template rendering.**

Transport should preserve type. Rendering should decide how a value becomes text. A JSON object should be sent as an object, not as a JSON-encoded string. If a user stores JSON text in a string field, it should remain a string.

In the playground, this means:

- Send testcase data as-is when it is JSON in the testset.
- Allow the user to switch between data types (string ↔ JSON) explicitly.

Today the UI can display JSON, the evaluation service preserves JSON, but normal playground execution may still send that JSON as a string. This RFC closes that gap.

Example.

```json
{"profile": {"name": "Ada"}}
```

`profile` is a JSON object. The runtime can access `{{profile.name}}`, `{{profile.tags.0}}`, or `{{profile}}` (renders as compact JSON text).

```json
{"profile": "{\"name\":\"Ada\"}"}
```

`profile` is a string whose text happens to contain JSON. The runtime treats it as a string. It does not silently parse the value — that would make strings ambiguous and break users who intentionally store JSON text.

## Solution Requirements

### 1. Preserve native value types

- Playground execution must preserve native JSON objects and arrays when the stored testcase value is an object or array.

### 2. Make field types visible and editable

- Show the field type wherever testcase or trace values are edited or inspected: `string`, `object`, `array`, `number`, `boolean`, `null`, `messages`.
- Use the same type-display pattern in the playground, testset views, and observability views.
- Allow users to create and edit JSON object/array variables directly in the playground.
- Allow users to intentionally convert a field between string and JSON.
- Preserve the selected type when saving or invoking.

### 3. Template rendering semantics

Three substitution formats plus one full templating engine:

- **`mustache`** — `{{variable}}` substitution. **The default for new apps.** `{{a.b}}` always means nested access (`a` then property `b`). Supports JSONPath (`{{$.profile.name}}`) and JSON Pointer (`{{/profile/name}}`). JSON objects and arrays render as compact JSON text when inserted as whole values into a string template. We use the name "mustache" for recognizability; we do not implement the full mustache spec (no sections or partials) — just variable substitution with our path enhancements.

- **`curly`** — `{{variable}}` substitution. **Deprecated.** Same syntax as `mustache`, but the resolver applies literal-key-first lookup: if a top-level key is literally named `foo.bar`, `{{foo.bar}}` returns that key's value before nested traversal is attempted. This is what keeps old apps that have variables with literal dots in their names working. Not surfaced in the playground for new apps; existing apps keep their declared format.

- **`fstring`** — `{variable}` substitution. Backward compatibility only. Not recommended for nested JSON because of brace-escaping conflicts. Not extended.

- **`jinja2`** — full sandboxed Jinja2. The format to pick when conditionals, loops, filters, or other logic are required.

### 4. Variable by service

- Provide a variable matrix for each service and invocation surface (see [Variable Matrix](#variable-matrix) below).
- Document variable name, type, source, and when the variable is available.
- Add tests for the render context each service exposes.

### 5. Align model and provider resolution

- LLM-as-a-judge must resolve provider settings using the same path as chat/completion.
- LLM-as-a-judge must support custom/self-hosted models configured in the UI.
- LLM-as-a-judge must not inject unsupported optional parameters such as `temperature`.
- The existing judge flat config and output shape must remain compatible.

### 6. Playground UX

- Field type is visible: string, JSON object, JSON array, number, boolean, null, messages.
- Users can edit JSON values without losing their type.
- Users can intentionally convert a field between string and JSON.
- The variables panel (right side of the playground) shows:
  - variables discovered from the prompt
  - variables available from the current testcase or trace context, labeled with source and type
- The prompt editor provides autocomplete for available variables — top-level only, no nesting.

### 7. Documentation

The shipped documentation must include:

- Template formats with examples.
- Escaping rules for literal braces and special characters in each format.
- JSON vs. stringified JSON examples.
- Variable availability by service.
- SDK examples for local usage of completion, chat, and LLM-as-a-judge.
- Evaluation service examples showing app invocation and evaluator invocation.

## Variable Matrix

What variables are exposed to prompt rendering, by service. Surface availability is described after the per-service lists.

### Completion

| Variable | Type | Source |
|---|---|---|
| top-level keys from `data.inputs` | any JSON | the request payload |

No special variables. Whatever keys the caller puts into `inputs` become available to the prompt template, with their native types.

### Chat

| Variable | Type | Source |
|---|---|---|
| top-level keys from `data.inputs` (excluding `messages`) | any JSON | the request payload |
| `messages` | message list | the request payload, typed special field |

`messages` is **not** a regular template variable. It is removed from the render context, then appended as chat history after the prompt template renders. The evaluation service preserves native message-list values; for legacy rows that store a JSON-encoded string, it parses the string into a list — that is the only place the system converts string-encoded messages to a list.

### LLM-as-a-judge

| Variable | Type | Source |
|---|---|---|
| `inputs` | object | dict spread into the render context; source depends on interface (see below) |
| top-level testcase / trace-input keys | any JSON | spread from `inputs` |
| `outputs` / `prediction` | any JSON | upstream app output (offline) or trace output (online) |
| `ground_truth` / `correct_answer` / `reference` | any JSON | resolved as `inputs[correct_answer_key]` at runtime |
| `trace` | dict | the full trace, dumped via `trace.model_dump(mode="json")` |
| `parameters` | object | evaluator configuration |

Notes on the judge variables:

- **`inputs`** — In **offline evaluation**, `inputs` is the testcase row (`testcase.data` is passed directly to the handler, including any columns that aren't declared as evaluator inputs — ground-truth column, metadata, etc.). In **online evaluation**, there is no stored testcase row, so `inputs` is sourced from the trace's recorded inputs (the root span's `ag.data.inputs`). The handler treats both paths the same way once `inputs` is built: it spreads top-level keys into the render context, so `{{question}}` and `{{inputs.question}}` both work. Native JSON values are preserved through the spread — `{{profile.name}}` and `{{tags.0}}` resolve against the native dict / list, with stringification happening only at the final substitution into the rendered text.

- **`outputs` / `prediction`** — Populated when an upstream app result is available. Offline: the output of the upstream app run over the testcase. Online: sourced from the trace's recorded outputs. Same native-JSON handling as `inputs`.

- **`ground_truth` / `correct_answer` / `reference`** — `correct_answer_key` is still part of the evaluator parameters (default: `"correct_answer"`); the runtime reads it from `parameters` and resolves the value as `inputs[correct_answer_key]`. The aliases are populated only when that key resolves — in practice, offline evaluation where the testset includes the configured ground-truth column. Not typically populated in online evaluation, since traces don't carry ground-truth columns.

- **`trace`** — A plain dict (the result of `trace.model_dump(mode="json")` on the trace passed in by the evaluation service). Prompt authors can dot-traverse it; the structure follows the trace schema (root span, spans, attributes including `ag.data.*` and `ag.meta.*`). Populated when the judge runs in a context that produced a trace — primarily online evaluation.

- **`parameters`** — The evaluator's own configuration object. Useful when a prompt needs to reference its own settings (rare).

### Variable population by interface

#### Direct API / SDK

All variables come from the request payload — caller decides what's there. Native JSON values arrive intact.

#### Evaluator playground

- `inputs`: from the testcase row.
- `outputs` / `prediction`: from the chained app run, when present.
- `ground_truth`: from `inputs[correct_answer_key]` when configured and the column is present.
- `trace`: from the chained app run, when present.

The evaluator playground currently stringifies object and array values before transport via `normalizeCompact` in `web/packages/agenta-entities/src/runnable/utils.ts`. Same fix as WP2 needs to apply here so JSON arrives native.

#### Evaluation service — offline (testset-driven)

Reference: `api/oss/src/core/evaluations/tasks/legacy.py`.

- `inputs`: `testcase.data`, the full testset row. Includes any columns that aren't declared as evaluator inputs (ground-truth column, metadata, etc.).
- `outputs` / `prediction`: from the upstream app run over the testcase.
- `ground_truth`: from `inputs[correct_answer_key]` when configured and the column is present.
- `trace`: from the upstream app run, when produced. Usually not central to offline judge prompts.

Native JSON preserved end to end (this is the reference behavior the playground paths should match).

#### Evaluation service — online (trace-driven)

Reference: `api/oss/src/core/evaluations/tasks/live.py`.

- No stored testcase row exists. `inputs` is taken from the trace's recorded inputs (`root_span_attributes_ag_data.get("inputs")`).
- `outputs` / `prediction`: from the trace's recorded outputs.
- `ground_truth`: typically not present — traces don't carry ground-truth columns.
- `trace`: the trace itself.

## Work Packages

The work falls into three layers: backend service alignment, frontend UX, documentation. Within each layer the order matters because later packages build on earlier ones.

### Backend

#### WP-B1 — Secret handling and low-level rendering helper

- Patch `auto_ai_critique_v0` to use the shared provider/secret resolution path. Custom and self-hosted models configured in the UI become available to the judge.
- Stop sending hard-coded `temperature=0.01` from the judge LLM call.
- Extract a low-level rendering helper with signature roughly `(template_string, mode, context) -> rendered_string`. Pure, unit-testable, no service knowledge. The substitution modes (`mustache`, `curly`, `fstring`) and `jinja2` all funnel through it.

#### WP-B2 — Message and JSON-return rendering on top of the helper

Builds on WP-B1.

- Build a message renderer on top of the low-level helper, used by completion, chat, and judge.
- Build a JSON-return renderer on top of the low-level helper. It renders variables inside `response_format` (chat/completion) and `json_schema` (judge) the same way. The judge's `json_schema` is no longer a special case.
- Align Jinja error behavior on **raise** across all services. The judge's silent-return-on-error is removed.
- Keep handler-specific output parsing in the handlers (judge keeps its output normalization).

#### WP-B3 — Add `mustache` template format

Builds on WP-B1.

- Add `mustache` as a new template-format option in the runtime. Semantics: `{{variable}}` substitution; `{{a.b}}` is nested access only (no literal-key-first); JSONPath and JSON Pointer supported.
- `mustache` becomes the runtime default for new apps. Existing apps continue to use the format they declared.
- **Brace escaping.** `mustache` ships with an explicit escape mechanism so users can include literal `{{` / `}}` in prompts (e.g., few-shot examples that show LLM output formatting). `curly` and `fstring` keep their current escape semantics:
  - `fstring` already escapes via `{{` → `{` and `}}` → `}` (Python `str.format` rule).
  - `jinja2` already supports `{% raw %}…{% endraw %}` blocks.
  - `curly` has no escape today. Adding one to `curly` is non-trivial because the existing `\{\{\s*(.*?)\s*\}\}` regex captures the inner braces of `{{{{x}}}}` as part of the variable name. We document the gap in the rendering appendix and recommend `jinja2` for prompts that need literal braces; the cleanest place to land a real fix is `mustache`, which is greenfield. Whether to also retrofit an escape into `curly` is an open question for WP-B3 (decision factor: how many existing apps need literal `{{` in their prompts).
- See [appendix-rendering-edge-cases.md](appendix-rendering-edge-cases.md) for the current escape behavior of every mode and the expected behavior for `mustache`.

### Frontend

#### WP-F1 — JSON ↔ string switching, applied everywhere

The same UX pattern lives in playground inputs, the testset editor, observability/trace views, and evaluation result views.

- Type indicator next to each value: `string`, `object`, `array`, `number`, `boolean`, `null`, `messages`.
- Convert action between `string` and `JSON`. The user's choice is preserved.
- The selected type round-trips through save/load and through invocation.

#### WP-F2 — Playground execution with native JSON and dotless variable handling

Depends on WP-B3 (`mustache` available) and WP-F1 (type switching available).

- Send testcase data as native JSON when the stored type is JSON. No `JSON.stringify` in request construction.
- In `mustache` mode, `{{a.b}}` is treated as a single variable `a` (object) with `.b` as a property accessor. The playground's variable discovery creates one variable `a` of type object that the user fills with JSON.
- `curly` mode is hidden from new-app creation flows. Existing apps still on `curly` continue to work — the literal-key-first behavior is preserved for them.

#### WP-F3 — Variable discovery (autocomplete)

A nicety on top of WP-F2.

- Autocomplete in the prompt editor surfaces top-level variables only — no nesting. Combines variables referenced in the prompt template with variables available from the testcase, trace, or evaluator context, labeled with source and type.
- The variables panel (right side of the playground) shows the same set, plus expandable nested fields.

### Documentation

#### WP-D1 — Documentation and SDK examples

- Publish prompt templating docs covering `mustache` (default for new apps), `curly` (legacy compat), `fstring`, and `jinja2`. Spell out the dot-semantics distinction between `mustache` and `curly`.
- Publish the variable matrix by service and interface.
- Add SDK / local examples for completion, chat, and LLM-as-a-judge.
- Document escaping rules, JSON vs. stringified JSON, JSONPath, and JSON Pointer.

Reference template examples:

```text
Hello {{name}}
Profile JSON: {{profile}}
Profile name: {{profile.name}}
First tag: {{profile.tags.0}}
JSON Pointer: {{/profile/name}}
JSONPath: {{$.profile.name}}
```

Reference JSON-vs-stringified-JSON examples:

```json
{"profile": {"name": "Ada"}}
```

This is an object and supports nested lookup.

```json
{"profile": "{\"name\":\"Ada\"}"}
```

This is a string. It does not support nested lookup unless the user explicitly parses it elsewhere.

## Rollout Plan

The work packages have a natural order:

1. **WP-B1** unblocks judge model coverage and creates the rendering helper everything builds on.
2. **WP-B2** stands up message and JSON-return rendering on the helper, and aligns Jinja error behavior.
3. **WP-B3** adds `mustache` as a new format.
4. **WP-F1** lands the same JSON/string switching pattern in playground / testset / observability / evaluation.
5. **WP-F2** flips playground execution to send native JSON and switches new apps to `mustache`. Curly stays for legacy apps only.
6. **WP-F3** adds autocomplete on top.
7. **WP-D1** publishes the templating docs, variable matrix, and SDK examples.

## Test Plan

### Backend runtime

- The low-level rendering helper resolves top-level, nested, JSONPath, and JSON Pointer references in `mustache` and `curly` modes.
- `curly` preserves literal-key-first behavior on dotted keys; `mustache` does not (treats them as nested).
- Whole-object insertion renders as compact JSON text in both modes.
- `fstring` and `jinja2` behavior is preserved.
- Stringified JSON inputs are treated as strings (no auto-parse).
- Chat removes `messages` from template inputs and appends them as chat history.
- LLM-as-a-judge exposes the variables in the variable matrix.
- LLM-as-a-judge resolves custom provider settings via the shared resolver.
- LLM-as-a-judge does not send `temperature` in the LLM call.
- Variables inside `json_schema` (judge) and `response_format` (chat/completion) render via the shared renderer.
- Jinja errors raise consistently across all services.

### Frontend

- Playground completion request body preserves object testcase fields.
- Playground completion request body preserves array testcase fields.
- Playground keeps string testcase fields as strings, even if their text contains JSON.
- Chat request body sends `messages` as an array of message objects.
- Evaluator playground sends testcase `inputs` as an object and upstream output as `outputs` / `prediction`.
- New apps default to `mustache`; existing apps keep their declared `template_format`.
- In `mustache` mode, a prompt containing `{{a.b}}` causes the playground to discover one variable `a` of type object.
- Type switch (string ↔ JSON) round-trips through save/load and through invocation, in playground / testset / observability / evaluation views.

### Evaluation service

- `parse_legacy_inputs(...)` preserves object and array testcase values.
- Chat evaluation parses stringified `messages` for legacy rows.
- Evaluator workflow request uses `testcase.data` as `inputs`.

### Documentation

- Examples cover string, JSON object, array, nested access, JSONPath, JSON Pointer, messages, and brace escaping in each format.
- Variable matrix covers completion, chat, judge, and the four interfaces (Direct API/SDK, evaluator playground, evaluation service offline, evaluation service online).

## Future Directions

Sketches for follow-up work. None of this is part of the present RFC.

### Sharing the prompt template across services

Today, chat and completion store their prompt config under `parameters.prompt`. The judge has a flat config with `prompt_template`, `model`, `response_type`, `json_schema`, `correct_answer_key`, `threshold`, `version`. The follow-up is to give the judge a `prompt` field with the same shape as chat/completion (messages, template format, input keys, llm_config), and keep judge-specific fields alongside it — rather than try to invent one structure that fits every service.

```yaml
# chat / completion
prompt:
  messages: [...]
  template_format: mustache | curly | fstring | jinja2
  input_keys: [...]
  llm_config:
    model: ...
    response_format: ...

# judge — same prompt block, plus judge-specific fields alongside it
prompt:
  messages: [...]
  template_format: ...
  input_keys: [...]
  llm_config:
    model: ...
    response_format: ...   # absorbs response_type + json_schema
correct_answer_key: ...
threshold: ...
version: ...
```

Notes:

- Open question: `response_type` and `json_schema` in today's judge config describe the same thing chat/completion's `response_format` does — the response shape. The unification collapses them into a single `response_format` (e.g. `{type: "json_schema", json_schema: ...}`).
- Open question: A migration adapter at the API boundary translates legacy judge flat config into the unified shape. The old shape stays valid until usage drops to zero, then is deprecated.

## Implementation tracking

Each work package gets its own subfolder with research, plan, implementation notes, QA, and status:

- [`wp-b1-runtime-foundation/`](wp-b1-runtime-foundation/README.md) — judge backend patch (provider/secret resolution + temperature removal) and the low-level rendering helper extraction.

Subfolders for the remaining work packages will be added as each is picked up.

## Appendices

- [`appendix-rendering-edge-cases.md`](appendix-rendering-edge-cases.md) — operational reference for special characters, escape sequences, ambiguous placeholders, and the template/value boundary across all four modes (`curly`, `fstring`, `jinja2`, `mustache`).
