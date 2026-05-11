# llm_v0

## Goal

Define a single unified handler `llm_v0` that covers both prompt and agent
behavior. Prompt mode (`loop = null`) and agent mode (`loop` present) share the
same input contract, the same output schema, and the same LLM fallback logic.

This document covers:

- the unified handler signature and parameter contract
- how configuration drives behavior from single-call prompt to multi-step agent
- `variables` input for template substitution
- LLM fallback ordering across the `llms` array
- `status` output object replacing state/reason/final
- loop semantics, consent gate, and tool routing
- presets that express named configurations

---

## Positioning

The handler follows the canonical workflow signature:

```python
async def llm_v0(
    request: Optional[Data] = None,
    revision: Optional[Data] = None,
    inputs: Optional[Data] = None,
    parameters: Optional[Data] = None,
    outputs: Optional[Union[Data, str]] = None,
    trace: Optional[Data] = None,
    testcase: Optional[Data] = None,
) -> Any:
    ...
```

Recommended URI:

- `agenta:builtin:llm:v0`

`prompt_v0` and `agent_v0` remain as named aliases that delegate to `llm_v0`
with restricted or permissive parameter sets respectively.

---

## Canonical Schema Model

This document should follow the canonical runnable schema structure:

```json
{
  "uri": "agenta:builtin:llm:v0",
  "schemas": {
    "inputs": {...},
    "parameters": {...},
    "outputs": {...}
  }
}
```

Rules:

- `schemas.parameters` and `schemas.outputs` are first-class
- `schemas.inputs` should be present when the input contract is meaningful and
  stable
- each schema should use normal JSON Schema primitives first
- use `x-` extension fields only when plain JSON Schema is not enough to
  express the semantic intent

### JSON Schema first

Prefer normal JSON Schema for structural meaning:

- `type`
- `properties`
- `items`
- `required`
- `enum`
- `additionalProperties`
- `oneOf` / `anyOf`
- `description`
- `default`

Examples:

- `messages` is an `array`
- `context` is an `object`
- `stream` is a `boolean`
- `allowed_tools` is an `array` of `string`

### `x-` extension second

Use an `x-` extension only when we need to say what a field means to the
runtime or UI, beyond its raw JSON shape.

Examples:

- a field is semantically a chat message list
- a field is semantically consent state
- a field is semantically lifecycle status
- a field should use a specialized UI/editor treatment

### SDK model requirement

For any reusable `x-` semantic field or sub-object, we should also define a
corresponding Pydantic model in the SDK type layer so that:

- the type can be used programmatically in Python
- the JSON Schema sub-object can be generated from the model
- the wire contract and SDK contract stay aligned

Relevant current SDK source:

- `sdk/agenta/sdk/utils/types.py`

Existing examples already in that file:

- `Message`
- `ToolCall`
- `ContentPartText`
- `ContentPartImage`
- `ContentPartFile`
- `JSONSchema`
- `ResponseFormatJSONSchema`
- `ModelConfig`
- `MultipleChoiceParam`
- `GroupedMultipleChoiceParam`
- `MessagesInput`

So the intended pattern is not new. We should formalize it.

### Initial `x-ag-*` extension table

| Extension | Applies To | Intent | SDK model direction |
|-----------|------------|--------|---------------------|
| `x-ag-messages` | inputs, outputs, parameters | Marks a field as a message-list semantic slot | `List[Message]` |
| `x-ag-message` | inputs, outputs | Marks a field as a single-message semantic slot | `Message` |
| `x-ag-content` | inputs, outputs | Marks raw multimodal/tool content parts | `List[ContentPart]` or `ContentPart` |
| `x-ag-context` | inputs, outputs, parameters | Marks structured execution context | typed `BaseModel` with `extra="allow"` or domain-specific context model |
| `x-ag-consent` | inputs, outputs, parameters | Marks consent policy/state | new `Consent*` Pydantic models |
| `x-ag-variables` | inputs | Marks variable bindings used for template substitution | `Dict[str, Any]` or a typed variables model |
| `x-ag-status` | outputs | Marks lifecycle status envelope | new `Status` Pydantic model |

These extensions do not replace JSON Schema. They annotate it.

### Current SDK `x-parameter` precedent

The SDK already uses Pydantic-driven schema annotations for parameter widgets in
`sdk/agenta/sdk/utils/types.py`.

Current examples:

- `MCField(...)` emits `json_schema_extra={"x-parameter": "choice"}` or
  `"grouped_choice"`
- `MessagesInput` emits `{"x-parameter": "messages", "type": "array"}`
- `TextParam`, `BinaryParam`, `IntParam`, `FloatParam`,
  `MultipleChoiceParam`, and `GroupedMultipleChoiceParam` all expose schema
  properties through `__schema_type_properties__()`

This is useful prior art for the new managed-workflow schema model:

- JSON Schema shape comes from the Pydantic or Python type
- extension metadata comes from explicit SDK type definitions

For the canonical managed-workflow schema model, Agenta-owned extensions should
use the `x-ag-*` namespace.

### Dynamic schema composition

Some schema fields should not embed their full option payload in stored schema.

Example:

- model selection backed by `supported_llm_models` from the SDK assets layer

In those cases, the schema should carry enough information for a consumer to
resolve the dynamic options, without persisting the fully expanded list into
revision data.

This means we should support composition patterns like:

- static JSON Schema structure
- extension metadata that points to a dynamic option source
- optional SDK-side helper that resolves that source into concrete choices

The missing piece is that the extension itself needs a typed contract so a
consumer knows how to interpret it.

At minimum, the extension should answer:

- what kind of dynamic payload is this?
- is the payload passed inline or by reference?
- if by reference, where should it be resolved from?
- what version of the extension contract is this?

### By-value vs by-reference

For these dynamic schema helpers, we should support two explicit modes.

By value:

- the schema carries the full payload inline
- use this when the option set is small, local, or intentionally snapshotted

By reference:

- the schema carries only a typed reference
- the consumer resolves the current canonical value from the referenced source
- use this when the option set is centrally owned, large, or expected to evolve

Conceptually:

```json
{
  "type": "string",
  "x-ag-type": "grouped_choice",
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

And by value:

```json
{
  "type": "string",
  "x-ag-type": "grouped_choice",
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

The exact field names are not fixed yet. The important part is that the
definition is self-describing and versioned.

### Typed extension contract

The extension object should itself have a stable type identity.

For example:

- `type = "model_catalog"`
- `type = "choice_catalog"`
- `type = "response_format_catalog"`

That lets consumers switch on the definition type and understand the shape they
should expect.

This also gives us a clean migration path:

- legacy definitions can remain materialized
- new definitions can use typed by-reference contracts
- both can coexist while consumers adopt the newer contract

Conceptually:

```json
{
  "type": "string",
  "x-ag-type": "grouped_choice",
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

The important rule is:

- store the reference to the dynamic source
- do not store the full expanded list when the list is large or centrally owned
- make the extension object typed and versioned so consumers know how to
  interpret it

### Current frontend behavior

Today, consumers commonly expect the expanded options to already be present in
schema-like payloads:

- legacy app parsing reads `openapi.json` and uses `x-parameter` plus schema
  defaults in `web/oss/src/services/api.ts`
- backend OpenAPI parsing reads `x-parameter` in
  `api/oss/src/services/llm_apps_service.py`
- schema-driven UI utilities read `choices`, `enum`, and `x-model-metadata`
  directly from the schema in:
  - `web/packages/agenta-shared/src/utils/schemaOptions.ts`
  - `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/schemaUtils.ts`

So the current system is mostly "materialized options in schema", not
"reference to option source".

The target model should allow both during migration:

- materialized choices for compatibility
- dynamic source references for cleaner canonical schemas using `x-ag-*`

### Intent by schema member

`schemas.parameters`

- stored configuration of the runnable
- preset payloads are parameter examples against this schema
- should express required vs optional clearly
- may include `x-` semantic annotations when a parameter has special runtime or
  UI meaning
- when a parameter uses special `x-` semantics, there should be a matching SDK
  model/type that can generate that sub-schema programmatically
- when a parameter's options come from a dynamic source, the schema should
  prefer storing a source reference over embedding the full option set

`schemas.outputs`

- canonical output contract produced by the runnable
- should use plain JSON Schema wherever possible
- may use `x-` annotations when a field has semantic meaning such as message
  list, status, or content parts
- reusable structured output members should have matching SDK Pydantic models

`schemas.inputs`

- canonical run-time input contract provided by the caller
- optional when the family does not yet have a stable explicit input contract
- preferred when there is shared reusable meaning across templates
- reusable structured input members should have matching SDK Pydantic models

---

## Behavior Spectrum

The handler family covers a continuous spectrum of behaviors, driven entirely by
configuration. From left to right:

```
loop = null   →   loop.max_iterations = 1   →   loop.max_iterations = N
tools = null      tools.external only           tools.internal + external
consent = null    consent = null                consent.mode = "per_call"

[ single LLM call ]   [ tool-aware prompt ]   [ multi-step agent ]
     prompt_v0                                      agent_v0
```

### Degenerate case: prompt mode

When `loop` is `null` (or absent) and `tools` is `null` (or absent):

- format `parameters.messages` + `inputs.messages` into a single list
- call the LLM exactly once
- return the assistant response as the output

This is equivalent to `prompt_v0`. No loop state, no tool routing, no consent
evaluation.

### Degenerate case: consent = null

When `consent` is `null` (or `consent.mode = "allow_all"`):

- internal tool calls are executed immediately without any consent check
- external tool calls still return control to the caller
- the runtime behaves as if every internal tool was pre-approved

### Full agent mode

When `loop` has `max_iterations > 1` and `tools` has internal and/or external
entries:

- the runtime enters the full loop described in the Loop Semantics section
- internal tool calls require consent evaluation
- external tool calls pause execution and return to the caller

---

## Presets

Presets are named configurations that express common usage patterns. They live
in the catalog under:

```
catalog/templates/{template_key}/presets/{preset_key}
```

### Recommended presets for `agent_v0`

| Preset key      | Description                                      | Key configuration                                            |
|-----------------|--------------------------------------------------|--------------------------------------------------------------|
| `single_prompt` | One LLM call, no tools, no loop                  | `loop = null`, `tools = null`, `consent = null`              |
| `tool_prompt`   | One LLM call, external tools surfaced to caller  | `loop.max_iterations = 1`, `tools.external = [...]`          |
| `file_agent`    | Multi-step agent with read-only file access      | `loop`, `files.enabled = true`, `consent.mode = "per_call"` |
| `open_agent`    | Multi-step agent, internal tools auto-approved   | `loop`, `tools.internal = [...]`, `consent = null`           |

Each preset is a plain parameter payload that slots directly into
`parameters`. No transform layer.

Example `single_prompt` preset:

```json
{
  "llms": [
    {
      "model": "gpt-4o-mini",
      "temperature": 0.2,
      "max_tokens": 2000
    }
  ],
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    }
  ],
  "loop": null,
  "tools": null,
  "consent": null,
  "stream": false
}
```

Example `file_agent` preset:

```json
{
  "llms": [
    {
      "model": "gpt-4o",
      "temperature": 0.2,
      "max_tokens": 4000
    },
    {
      "model": "gpt-4o-mini",
      "temperature": 0.2,
      "max_tokens": 4000
    }
  ],
  "loop": {
    "max_iterations": 8,
    "max_internal_tool_calls": 16,
    "max_consecutive_errors": 2,
    "allow_implicit_stop": true,
    "require_terminate_tool": false
  },
  "files": {
    "enabled": true,
    "read_only": true,
    "roots": ["."],
    "allow_globs": ["**/*.py", "**/*.md"],
    "deny_globs": ["**/.git/**"],
    "max_file_bytes": 65536,
    "max_total_bytes_per_turn": 262144
  },
  "tools": {
    "internal": ["files.list", "files.read", "files.search"],
    "external": []
  },
  "messages": [
    {
      "role": "system",
      "content": "You are a careful file-aware agent."
    }
  ],
  "consent": {
    "mode": "per_call",
    "apply_to": ["internal"],
    "on_missing_consent": "return_external_tool",
    "remember_decisions": false,
    "allowed_tools": [],
    "denied_tools": [],
    "decisions": {}
  }
}
```

---

## Parameters

### Top-level shape

```json
{
  "llms": [],
  "loop": null,
  "files": null,
  "tools": null,
  "messages": [],
  "context": {},
  "consent": null,
  "response": {
    "stream": false
  }
}
```

Nullability rules:

- `loop = null` → single LLM call (prompt mode), no iteration
- `tools = null` → no tools exposed to the model
- `consent = null` → no consent gate; internal tools execute immediately
- `files = null` → no file tool access

### `llms` (ordered fallback list)

`llms` is an **ordered array** of LLM configurations. The runtime tries each
entry in order. If the primary LLM is unavailable (authentication error, rate
limit, model not found), the runtime falls back to the next entry and tries
again. This continues until the list is exhausted.

```json
"llms": [
  {
    "model": "gpt-4o",
    "temperature": 0.2,
    "max_tokens": 4000,
    "top_p": 1.0,
    "frequency_penalty": 0,
    "presence_penalty": 0,
    "reasoning_effort": null,
    "tool_choice": "auto"
  },
  {
    "model": "gpt-4o-mini",
    "temperature": 0.2,
    "max_tokens": 4000
  },
  {
    "model": "claude-3-5-sonnet-20241022",
    "temperature": 0.2,
    "max_tokens": 4000
  }
]
```

Fallback triggers:

- `AuthenticationError` — wrong or missing key for this provider
- `RateLimitError` — quota exceeded
- `ModelNotFoundError` — model unavailable in this region/account
- provider-level `ServiceUnavailableError`

Non-fallback errors (raise immediately):

- `PromptFormattingError` — template is malformed
- `InvalidParametersError` — parameters failed validation
- tool execution errors (handled separately inside the loop)

All entries in `llms` share the same message list. The fallback just retries
the same prompt with a different model configuration.

When the list is exhausted without a successful response, the runtime returns
`state="failure"` with `reason="llm_unavailable"`.

Shorthand: if `llms` contains a single entry, it behaves identically to the
original `llm: {}` shape. A config migration layer can normalize the old shape
to the new array form.

### `loop`

```json
"loop": {
  "max_iterations": 8,
  "max_internal_tool_calls": 16,
  "max_consecutive_errors": 2,
  "allow_implicit_stop": true,
  "require_terminate_tool": false
}
```

When `loop = null`:

- the runtime executes exactly one LLM call
- no loop state, no iteration counter
- tool calls from the model are returned as-is but not executed
- the output is just the assistant message

### `files`

```json
"files": {
  "enabled": true,
  "read_only": true,
  "roots": ["."],
  "allow_globs": ["**/*.py", "**/*.md", "**/*.ts", "**/*.tsx"],
  "deny_globs": ["**/.git/**", "**/node_modules/**", "**/.venv/**"],
  "max_file_bytes": 65536,
  "max_total_bytes_per_turn": 262144,
  "include_hidden": false
}
```

When `files = null`, file tools are not registered or exposed to the model.

### `tools`

```json
"tools": {
  "internal": [],
  "external": []
}
```

When `tools = null`, no tools are passed to the LLM. The model cannot call
any tools.

### `messages`

```json
"messages": [
  {
    "role": "system",
    "content": "You are a helpful assistant."
  }
]
```

Stored as configuration. Prepended ahead of `inputs.messages` at run start.

### `context`

```json
"context": {}
```

Structured key/value state. Stored as configuration, merged with
`inputs.context` at run start.

### `consent`

```json
"consent": {
  "mode": "per_call",
  "apply_to": ["internal"],
  "on_missing_consent": "return_external_tool",
  "remember_decisions": false,
  "allowed_tools": [],
  "denied_tools": [],
  "decisions": {}
}
```

When `consent = null`, all internal tool calls are auto-approved. No consent
requests are issued. External tool calls still surface to the caller.

Consent modes:

- `"per_call"` — ask for consent on each internal tool call not in `allowed_tools`
- `"allow_all"` — approve all internal tools automatically (same effect as `consent = null`)
- `"deny_all"` — deny all internal tools; any internal call returns a consent refusal

### `response`

```json
"response": {
  "stream": false,
  "format": "messages",
  "schema": {...},
}
```

A namespace object for response behavior. Using an object rather than a
top-level primitive keeps the contract extensible — future fields (e.g.
`response.include_trace`, `response.compress_messages`) can be added without
breaking the flat parameter shape.

`response.stream` controls whether the runtime streams tokens back to the
caller:

- `false` (default) — wait for the full completion before returning
- `true` — stream tokens as they arrive

Streaming does not change the output schema. The same envelope fields
(`state`, `reason`, `final`, `messages`, `context`, `consent`, `usage`) are
always present. In streaming mode the runtime emits incremental token chunks
and then closes with the final envelope.

---

## Inputs

```json
{
  "messages": [],  // x-ag-messages
  "message": [],   // x-ag-message
  "content": [],   // x-ag-content
  "context": {},   // x-ag-context
  "consent": {},   // x-ag-consent
  "variables": {}, // x-ag-variables ~ rest of testcase.data ?
  ...              // rest of testcase.data
}
```

- `messages` — concatenated onto `parameters.messages` after variable substitution
- `variables` — key/value map applied to `{{placeholder}}` slots in all messages (both `parameters.messages` and `inputs.messages`)
- `context` — merged into `parameters.context`
- `consent` — merged into `parameters.consent` (decisions carry through resumptions)

`variables` uses the `template_format` from `parameters` (default `"curly"`).
Template substitution happens before messages are concatenated, so variables
work uniformly across system prompts and user messages.

When resuming after an `pending` status, the caller appends the external tool
result as a tool-role message inside `inputs.messages` and optionally provides
updated `inputs.consent`.

---

## Outputs

The output envelope is always the same shape regardless of mode:

```json
{
  "status": {},   // x-ag-status
  "messages": [], // x-ag-messages
  "message": [],  // x-ag-message
  "content": [],  // x-ag-content
  "context": {},  // x-ag-context
  "consent": {}   // x-ag-consent
}
```

- `status` — lifecycle result object. Same `code`/`type`/`message` shape as error objects so callers handle outcomes uniformly.
- `messages` — full effective message list after the run (system + user + assistant + tool messages). The last assistant message is always the last `role=assistant` entry in this list — no need for a separate `final` field.
- `context` — effective structured context after the run
- `consent` — effective consent state after the run (pass back on resumption)

The schema does not vary between prompt mode and agent mode. In prompt mode,
`context` and `consent` will be empty objects if no values were provided.

`status` values:

| `code` | `type`      | `message`               | Meaning                                         |
|--------|-------------|-------------------------|-------------------------------------------------|
| 200    | `success`   | `completed`             | Run finished, last message is the answer        |
| 202    | `pending`  | `tool_requested`        | External tool call pending, resume with result  |
| 202    | `pending`  | `consent_requested`     | Consent needed, resume with updated consent     |
| 500    | `failure`   | `iterations_exhausted`  | Loop limit reached                              |
| 500    | `failure`   | `calls_exhausted`       | Internal tool call limit reached                |
| 500    | `failure`   | `error_raised`          | Too many consecutive errors                     |
| 503    | `failure`   | `llm_unavailable`       | All LLMs in fallback list exhausted             |

---

## Messages Model

The runtime operates on a single normalized `messages` list:

```json
[
  "...parameters.messages...",
  "...inputs.messages...",
  "...assistant/tool messages generated during the run..."
]
```

Tool calls and tool results flow through `messages`:

- assistant tool calls are assistant messages with `tool_calls`
- tool results are tool messages

The durable conversation state stays in one place.

In prompt mode, this list is built once and passed to the LLM. No further
appending happens.

---

## Consent Model

`consent` mirrors the stored-plus-runtime shape of `messages`:

- `parameters.consent` — stored base consent state and policy
- `inputs.consent` — merged into it for the current run
- `outputs.consent` — resulting effective consent state returned to the caller

When `consent = null` at the parameters level, the runtime skips all consent
evaluation. Internal tools execute immediately.

---

## Context Model

`context` remains separate from `messages`. It is structured state, not
conversation history:

- `parameters.context` — stored base context
- `inputs.context` — merged into it for the run
- `outputs.context` — effective context returned after processing

---

## Tools

### Internal tools

Executed by the runtime. In v0, limited to read-only file tools:

- `files.list`
- `files.read`
- `files.search`

Subject to `consent` evaluation and `files` restrictions.

### External tools

Not executed inside the runtime. Returned to the caller as pending handoffs:

- `control.terminate`
- `control.request_consent`
- product-specific integration tools
- human-in-the-loop actions

### Consent-request schema

```json
{
  "name": "control.request_consent",
  "description": "Ask the caller to collect consent for an internal tool call.",
  "input_schema": {
    "type": "object",
    "properties": {
      "tool_call_id": {"type": "string"},
      "tool_name": {"type": "string"},
      "arguments": {},
      "reason": {"type": "string"}
    },
    "required": ["tool_call_id", "tool_name"]
  }
}
```

### Termination schema

```json
{
  "name": "control.terminate",
  "description": "Signal that the agent considers the run complete.",
  "input_schema": {
    "type": "object",
    "properties": {
      "summary": {"type": "string"},
      "result": {}
    },
    "additionalProperties": true
  }
}
```

---

## Loop Semantics

When `loop = null`, skip to: format messages → call LLM once → return output.

When `loop` is present:

1. validate `parameters`
2. load `parameters.messages`
3. merge `inputs.messages`
4. merge `parameters.context` with `inputs.context`
5. merge `parameters.consent` with `inputs.consent`
6. call LLM (with fallback across `llms` array)
7. inspect assistant output
8. if no tool calls:
   - if `allow_implicit_stop = true`, complete with `state="success"`
   - otherwise continue or fail
9. if tool calls:
   - `control.terminate` → `state="success"`, `reason="goal_achieved"`
   - any other external tool → `state="awaiting"`, `reason="tool_requested"`
   - internal tools: check consent
     - if consented, execute internally and continue loop
     - if not consented, emit `control.request_consent`, return `state="awaiting"`
10. append internal tool results as tool messages and iterate
11. stop on loop limits or repeated errors

---

## State Machine

### States

- `running` — executing
- `pending` — paused, waiting for caller
- `success` — completed
- `failure` — terminated with error

### Transitions

`running → success`
- model emits `control.terminate`
- or model emits no tool calls and `allow_implicit_stop = true`

`running → awaiting`
- model emits an external tool call (other than `control.terminate`)
- or model emits an unconsented internal tool call (converted to `control.request_consent`)

`running → running`
- model emits only consented internal tool calls
- runtime executes them and continues loop

`running → failure`
- any loop limit reached
- `llms` array exhausted without success
- validation fails
- tool execution fails beyond error policy

`awaiting → running`
- caller appends tool result via `inputs.messages`
- and/or updates `inputs.consent`
- then invokes the handler again

---

## Main Loop Pseudocode

```python
async def agent_v0(
    request=None,
    revision=None,
    inputs=None,
    parameters=None,
    outputs=None,
    trace=None,
    testcase=None,
):
    params = validate_parameters(parameters or {})
    run_inputs = validate_inputs(inputs or {})

    messages = [
        *normalize_messages(params.get("messages")),
        *normalize_messages(run_inputs.get("messages")),
    ]
    context = merge_context(
        params.get("context") or {},
        run_inputs.get("context") or {},
    )
    consent = merge_consent(
        params.get("consent"),
        run_inputs.get("consent"),
    )
    usage = {}

    # --- Prompt mode (loop = null) ---
    if params.get("loop") is None:
        assistant_message = await call_llm_with_fallback(
            llms=params["llms"],
            messages=messages,
            tools=None,
        )
        all_messages = [*messages, assistant_message]
        usage = merge_usage(usage, assistant_message["usage"])
        return {
            "state": "success",
            "reason": "goal_achieved",
            "final": assistant_message,
            "messages": all_messages,
            "context": context,
            "consent": consent or {},
            "usage": usage,
        }

    # --- Agent mode (loop present) ---
    loop_params = params["loop"]
    state = {
        "messages": messages,
        "context": context,
        "consent": consent,
        "usage": usage,
        "iterations": 0,
        "internal_tool_calls": 0,
        "consecutive_errors": 0,
    }

    while True:
        if state["iterations"] >= loop_params["max_iterations"]:
            return failure(state, "iterations_exhausted")

        if state["internal_tool_calls"] >= loop_params["max_internal_tool_calls"]:
            return failure(state, "calls_exhausted")

        state["iterations"] += 1

        try:
            assistant_message = await call_llm_with_fallback(
                llms=params["llms"],
                messages=state["messages"],
                tools=build_llm_tools(params.get("tools")),
            )
        except LLMUnavailableError:
            return failure(state, "llm_unavailable")

        state["messages"].append(assistant_message)
        state["usage"] = merge_usage(state["usage"], assistant_message["usage"])
        state["consecutive_errors"] = 0

        tool_calls = assistant_message.get("tool_calls") or []

        if not tool_calls:
            if loop_params.get("allow_implicit_stop", True):
                return success(state, assistant_message)
            continue

        if find_tool_call(tool_calls, "control.terminate"):
            return success(state, assistant_message)

        external_call = first_external_tool_call(tool_calls, params.get("tools"))
        if external_call:
            return awaiting(state, "tool_requested")

        internal_calls = collect_internal_tool_calls(tool_calls, params.get("tools"))

        # consent gate (skipped when consent = null)
        if consent is not None:
            missing = first_call_without_consent(internal_calls, state["consent"])
            if missing:
                append_consent_request(state["messages"], missing)
                return awaiting(state, "consent_requested")

        for tool_call in internal_calls:
            result = await execute_internal_tool_call(
                tool_call=tool_call,
                files_config=params.get("files"),
                context=state["context"],
            )
            state["internal_tool_calls"] += 1
            state["messages"].append(make_tool_message(tool_call["id"], result))


async def call_llm_with_fallback(llms, messages, tools):
    """
    Try each LLM entry in order. Fall back on authentication,
    rate limit, or availability errors. Raise LLMUnavailableError
    if all entries fail.
    """
    last_error = None
    for llm_config in llms:
        try:
            response = await litellm.acompletion(
                model=llm_config["model"],
                messages=messages,
                tools=tools,
                temperature=llm_config.get("temperature"),
                max_tokens=llm_config.get("max_tokens"),
                top_p=llm_config.get("top_p"),
                frequency_penalty=llm_config.get("frequency_penalty"),
                presence_penalty=llm_config.get("presence_penalty"),
                reasoning_effort=llm_config.get("reasoning_effort"),
                tool_choice=llm_config.get("tool_choice"),
            )
            return extract_assistant_message(response)
        except (
            litellm.AuthenticationError,
            litellm.RateLimitError,
            litellm.ServiceUnavailableError,
            litellm.NotFoundError,
        ) as e:
            last_error = e
            continue
    raise LLMUnavailableError(f"All LLM entries failed. Last error: {last_error}")
```

---

## LLM Settings

Each entry in `llms` maps to LiteLLM call parameters:

- `model`
- `temperature`
- `max_tokens`
- `top_p`
- `frequency_penalty`
- `presence_penalty`
- `reasoning_effort`
- `tool_choice`

The `llms` array replaces the singular `llm` block. A compatibility shim can
normalize old `llm: {}` → `llms: [{}]` during config migration.

---

## File Settings

The `files` block governs read-only file tool access in v0:

- explicit roots
- explicit allow/deny globs
- byte limits per file and per turn
- hidden files disabled by default

When `files = null`, file tools are not available.

---

## v0 Scope

### In scope

- unified prompt + agent handler
- direct LiteLLM calls with ordered fallback across `llms`
- single-call prompt mode when `loop = null`
- message-based agent loop
- internal read-only file tools
- external tool handoff
- external `control.terminate` tool
- consent gate on internal tools (or bypass when `consent = null`)

### Out of scope

- framework integrations
- streaming loop state
- server-persisted paused sessions
- write/edit file tools
- background task orchestration
- autonomous execution of external integrations

---

## Presets → Handler Mapping

| Preset          | Handler URI                    | `loop`   | `tools`         | `consent`    |
|-----------------|-------------------------------|----------|-----------------|--------------|
| `single_prompt` | `agenta:builtin:prompt:v0`    | `null`   | `null`          | `null`       |
| `tool_prompt`   | `agenta:builtin:agent:v0`     | `null`   | external only   | `null`       |
| `file_agent`    | `agenta:builtin:agent:v0`     | present  | internal files  | `"per_call"` |
| `open_agent`    | `agenta:builtin:agent:v0`     | present  | internal files  | `null`       |

`prompt_v0` is the restricted entry point: it validates that `loop`, `tools`,
and `consent` are absent, then delegates to the shared inner execution path.
`agent_v0` accepts the full parameter surface.

---

## Implementation Notes

Adding `agent_v0` as a first-class builtin requires widening the existing
builtin service type recognition in the frontend and runtime plumbing.

The `llm → llms` rename is a parameter-level change. Old configurations using
`llm: {}` should be normalized at read time by the configuration layer, not
require a data migration.

Resuming an `pending` run is a fresh invocation with appended
`inputs.messages` and updated `inputs.consent`. The runtime does not need a
separate paused session object for v0.
