# agent_v0

## Goal

Define a simple builtin agent handler that:

- uses `litellm` directly for LLM calls
- does not depend on an agent framework
- supports multi-step tool use with an explicit loop
- treats loop termination as an external tool call
- supports consent-gated internal tool calls
- stays close to the newer workflow handler shape used by `prompt_v0`

This is research/design only.

## Positioning

`agent_v0` should follow the newer canonical workflow signature, not the legacy app handlers.

Recommended URI:

- `agenta:builtin:agent:v0`

Recommended handler signature:

```python
async def agent_v0(
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

Rationale:

- `prompt_v0` already uses the canonical workflow request shape and direct LiteLLM calling.
- `chat_v0` and `completion_v0` are older single-call wrappers.
- `agent_v0` needs loop state, tool calls, and pending handoff states, so the `prompt_v0` shape is a better base.

## Core Model

`agent_v0` is a loop around repeated `litellm.acompletion(...)` calls.

Per iteration:

1. build the current message list
2. pass tools to the model
3. inspect assistant output
4. if the model calls tools:
   - external tool calls become handoff outputs
   - internal tool calls require consent checks before execution
5. append tool results as tool messages
6. continue until termination or loop limit

No server-side orchestration framework should be involved.

## Messages Model

The runtime should operate on a single normalized `messages` list.

Configuration:

- `parameters.messages`

Per-run input:

- `inputs.messages`

Normalization rule:

- `messages` is stored as configuration
- at run start it is prepended ahead of per-run messages
- after that, the loop only reads/writes one message list

Effective runtime messages:

```json
[
  "...parameters.messages...",
  "...inputs.messages...",
  "...assistant/tool messages generated during the run..."
]
```

This keeps configuration stable and runtime state uniform.

Tool calls and tool results should not have separate first-class state channels.

They should flow through `messages`:

- assistant tool calls are assistant messages with `tool_calls`
- tool results are tool messages

So the durable conversation state stays in one place.

Any external tool call should return control to the caller immediately.

That includes consent requests.

## Consent Model

`consent` should mirror the same stored-plus-runtime shape as `messages`.

Configuration:

- `parameters.consent`

Per-run input:

- `inputs.consent`

Per-run output:

- `outputs.consent`

Normalization rule:

- `parameters.consent` is the stored base consent state and policy
- `inputs.consent` is merged into it conceptually for the current run
- `outputs.consent` returns the resulting effective consent state

Recommended interpretation:

- policy-like fields may be overridden by the runtime input if explicitly provided
- list/map-like consent state should be merged by key, not replaced blindly

This removes the need for a separate `consent_decisions` field.

## Context Model

`context` should remain separate from `messages`.

Unlike tool calls and tool results, `context` is structured state, not conversation history.

Configuration:

- `parameters.context`

Per-run input:

- `inputs.context`

Per-run output:

- `outputs.context`

Normalization rule:

- `parameters.context` is the stored base context
- `inputs.context` is merged into it for the run
- `outputs.context` returns the effective context after processing

## Parameters

Recommended top-level `parameters` shape:

```json
{
  "llm": {
    "model": "gpt-4o-mini",
    "temperature": 0.2,
    "max_tokens": 2000,
    "top_p": 1.0,
    "frequency_penalty": 0,
    "presence_penalty": 0,
    "reasoning_effort": "medium",
    "tool_choice": "auto"
  },
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
    "allow_globs": ["**/*.py", "**/*.md", "**/*.ts", "**/*.tsx"],
    "deny_globs": ["**/.git/**", "**/node_modules/**", "**/.venv/**"],
    "max_file_bytes": 65536,
    "max_total_bytes_per_turn": 262144,
    "include_hidden": false
  },
  "tools": {
    "internal": [],
    "external": []
  },
  "messages": [
    {
      "role": "system",
      "content": "You are a careful file-aware agent."
    }
  ],
  "context": {},
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

## Inputs

Recommended `inputs` shape:

```json
{
  "messages": [],
  "context": {},
  "consent": {}
}
```

Suggested meanings:

- `messages`: incremental conversation state supplied by the caller
- `context`: structured runtime context supplied by the caller
- `consent`: incremental consent state supplied by the caller

`inputs.messages` should be concatenated conceptually onto `parameters.messages`.

`inputs.consent` should be merged conceptually into `parameters.consent`.

Example `consent` input:

```json
{
  "decisions": {
    "call_123": {
      "decision": "allow"
    }
  }
}
```

Tool results should come back through `inputs.messages` as tool-role messages, not through a separate `external_tool_results` field.

## Outputs

Recommended output envelope:

```json
{
  "state": "success",
  "reason": "goal_achieved",
  "final": null,
  "messages": [],
  "context": {},
  "consent": {},
  "usage": {}
}
```

Recommended `state` values:

- `running`
- `awaiting`
- `success`
- `failure`

Recommended `reason` values:

- `tool_requested`
- `consent_requested`
- `goal_achieved`
- `iterations_exhausted`
- `calls_exhausted`
- `error_raised`

Recommended `final`:

- final assistant message when `state="success"`
- `null` otherwise

`outputs.messages` should be the full effective message state after the step.

`outputs.consent` should be the full effective consent state after the step.

`outputs.context` should be the effective structured context after the step.

## Tools

Split tools into two classes.

### Internal tools

Executed by the runtime itself.

Examples for v0:

- `files.list`
- `files.read`
- `files.search`

Rules:

- should be read-only in v0
- should be governed by `consent`
- should respect file restrictions from `parameters.files`

### External tools

Not executed inside the runtime.

They are returned to the caller as pending handoffs.

Examples:

- `control.terminate`
- `control.request_consent`
- product-specific integration tools
- any human-in-the-loop action

Special rule:

- loop termination is modeled as an external tool call, not a magical side channel
- consent requests are also modeled as external tool calls

Suggested consent-request schema:

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

## Termination

`control.terminate` should be available as an external tool.

Suggested schema:

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

Behavior:

- if the model calls `control.terminate`, the runtime stops immediately
- this means the agent considers the run done
- the runtime returns `state="success"` and `reason="goal_achieved"`
- the tool arguments are optional termination metadata, not a required side channel for the final answer

Open question:

- whether `require_terminate_tool=true` should forbid plain assistant completion without that tool call

Current recommendation:

- allow both modes
- default to `require_terminate_tool=false`

## Permissions

Use `consent` terminology throughout.

Why:

- the mechanism is broader than user approval
- it can express policy, allowlists, deny lists, remembered decisions, and automated gatekeeping

Recommended rules:

- internal tool calls require consent evaluation
- external tool calls always produce handoff outputs
- `control.terminate` is an external tool and does not require internal consent execution

If an internal tool call is produced without consent:

- return `state="awaiting"`
- return `reason="consent_requested"`
- surface a consent request as an external tool call
- do not execute the internal tool yet

If an external tool call is produced:

- return `state="awaiting"`
- return `reason="tool_requested"`
- keep the tool call in `outputs.messages`
- expect the caller to append the eventual tool result back through `inputs.messages`

Suggested consent pattern:

- runtime detects an internal tool call that is not yet consented
- runtime returns an external tool call such as `control.request_consent`
- caller obtains consent externally
- caller resumes the run with updated `inputs.consent`

## Loop Semantics

Recommended baseline algorithm:

1. validate `parameters`
2. load `parameters.messages`
3. merge `inputs.messages` into the runtime message state
4. merge `parameters.context` with `inputs.context`
5. merge `parameters.consent` with `inputs.consent`
6. run the next model step
7. inspect assistant output
8. if no tool calls:
   - if implicit stop is allowed, complete
   - otherwise continue or fail according to loop policy
9. if there are tool calls:
   - `control.terminate` completes the run with `state="success"` and `reason="goal_achieved"`
   - any other external tool returns `state="awaiting"` and `reason="tool_requested"`
   - internal tools require consent before execution
   - if consent is missing, return an external consent-request handoff
10. append internal tool results as tool messages and continue
11. stop on loop limits or repeated errors

Loop limits should be explicit and configurable:

- max iterations
- max internal tool calls
- max consecutive errors

## State Machine

Split runtime outcome into two fields:

- `state`: coarse lifecycle state
- `reason`: specific explanation for the current state

Recommended `state` values:

- `running`
- `awaiting`
- `success`
- `failure`

### State transitions

`running -> success`

- the model emits `control.terminate`
- or the model emits no tool calls and implicit stop is allowed

`running -> awaiting`

- the model emits any external tool call other than `control.terminate`
- or the model emits an internal tool call that is not yet consented, and the runtime converts that into an external `control.request_consent` handoff

`running -> running`

- the model emits only consented internal tool calls
- the runtime executes them
- tool results are appended as tool-role messages
- the next loop iteration begins

`running -> failure`

- any loop limit is reached before completion
- validation fails
- model invocation fails irrecoverably
- tool execution fails beyond retry/error policy

`awaiting -> running`

- the caller appends the external tool result back through `inputs.messages`
- and/or updates `inputs.consent`
- then invokes the handler again

### External handoff rule

There is only one handoff state:

- `awaiting`

This intentionally covers:

- normal external tool execution
- human-in-the-loop actions
- consent collection

There should not be a separate `awaiting_consent` state.

### Consent-gated internal tool rule

When the model asks for an internal tool:

1. check effective consent state
2. if consent exists, execute the tool internally
3. if consent does not exist, do not execute the tool
4. emit an external `control.request_consent` tool call instead
5. return `state="awaiting"` with `reason="consent_requested"`

### Termination rule

`control.terminate` is special only in outcome:

- it is still an external tool call in shape
- but when the agent emits it, the runtime does not wait for a caller result
- it means the agent has decided the run is over
- the runtime returns `state="success"` with `reason="goal_achieved"`

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

    state = {
        "messages": [
            *normalize_messages(params.get("messages")),
            *normalize_messages(run_inputs.get("messages")),
        ],
        "context": merge_context(
            params.get("context") or {},
            run_inputs.get("context") or {},
        ),
        "consent": merge_consent(
            params.get("consent") or {},
            run_inputs.get("consent") or {},
        ),
        "usage": {},
        "iterations": 0,
        "internal_tool_calls": 0,
        "consecutive_errors": 0,
    }

    while True:
        if state["iterations"] >= params["loop"]["max_iterations"]:
            return {
                "state": "failure",
                "reason": "iterations_exhausted",
                "final": last_assistant_message(state["messages"]),
                "messages": state["messages"],
                "context": state["context"],
                "consent": state["consent"],
                "usage": state["usage"],
            }

        if state["internal_tool_calls"] >= params["loop"]["max_internal_tool_calls"]:
            return {
                "state": "failure",
                "reason": "calls_exhausted",
                "final": last_assistant_message(state["messages"]),
                "messages": state["messages"],
                "context": state["context"],
                "consent": state["consent"],
                "usage": state["usage"],
            }

        state["iterations"] += 1

        llm_response = await litellm.acompletion(
            model=params["llm"]["model"],
            messages=state["messages"],
            tools=build_llm_tools(params["tools"]),
            tool_choice=params["llm"].get("tool_choice"),
            temperature=params["llm"].get("temperature"),
            max_tokens=params["llm"].get("max_tokens"),
            top_p=params["llm"].get("top_p"),
            frequency_penalty=params["llm"].get("frequency_penalty"),
            presence_penalty=params["llm"].get("presence_penalty"),
            reasoning_effort=params["llm"].get("reasoning_effort"),
        )

        assistant_message = extract_assistant_message(llm_response)
        state["messages"].append(assistant_message)
        state["usage"] = merge_usage(state["usage"], extract_usage(llm_response))

        tool_calls = assistant_message.get("tool_calls") or []
        if not tool_calls:
            if params["loop"].get("allow_implicit_stop", True):
                return {
                    "state": "success",
                    "reason": "goal_achieved",
                    "final": assistant_message,
                    "messages": state["messages"],
                    "context": state["context"],
                    "consent": state["consent"],
                    "usage": state["usage"],
                }
            continue

        terminate_call = find_tool_call(tool_calls, "control.terminate")
        if terminate_call is not None:
            return {
                "state": "success",
                "reason": "goal_achieved",
                "final": assistant_message,
                "messages": state["messages"],
                "context": state["context"],
                "consent": state["consent"],
                "usage": state["usage"],
            }

        external_call = first_external_tool_call(tool_calls, params["tools"])
        if external_call is not None:
            return {
                "state": "awaiting",
                "reason": "tool_requested",
                "final": None,
                "messages": state["messages"],
                "context": state["context"],
                "consent": state["consent"],
                "usage": state["usage"],
            }

        internal_calls = collect_internal_tool_calls(tool_calls, params["tools"])
        missing_consent_call = first_call_without_consent(
            internal_calls,
            state["consent"],
        )
        if missing_consent_call is not None:
            consent_request_call = make_request_consent_tool_call(missing_consent_call)
            append_external_tool_call_to_last_assistant_message(
                state["messages"],
                consent_request_call,
            )
            return {
                "state": "awaiting",
                "reason": "consent_requested",
                "final": None,
                "messages": state["messages"],
                "context": state["context"],
                "consent": state["consent"],
                "usage": state["usage"],
            }

        for tool_call in internal_calls:
            tool_result = await execute_internal_tool_call(
                tool_call=tool_call,
                files_config=params["files"],
                context=state["context"],
            )
            state["internal_tool_calls"] += 1
            state["messages"].append(
                make_tool_message(
                    tool_call_id=tool_call["id"],
                    content=tool_result,
                )
            )
```

Notes:

- resumed runs are just fresh invocations with appended `inputs.messages` and updated `inputs.consent`
- external tool results should come back as tool-role messages inside `inputs.messages`
- the runtime does not need a separate paused session object for v0
- hitting `max_consecutive_errors` should return `state="failure"` with `reason="error_raised"`

## LLM Settings

The `llm` block should map closely to the existing model config fields already used in prompt handling:

- `model`
- `temperature`
- `max_tokens`
- `top_p`
- `frequency_penalty`
- `presence_penalty`
- `reasoning_effort`
- `tool_choice`

This keeps `agent_v0` consistent with existing prompt/chat/completion configuration patterns while still using a dedicated agent loop.

## File Settings

The `files` block should be first-class because internal file tools are a primary early use case.

Recommended v0 restrictions:

- read-only only
- explicit roots
- explicit allow/deny globs
- byte limits per file and per turn
- hidden files disabled by default

This is enough for a useful file-aware agent without opening write/edit risk in v0.

## v0 Scope

Recommended in-scope:

- direct LiteLLM calls
- message-based loop
- internal read-only tools
- external tool handoff
- external terminate tool
- explicit consent on internal tools

Recommended out-of-scope:

- framework integrations
- streaming loop state
- server-persisted paused agent sessions
- write/edit file tools
- background task orchestration
- autonomous execution of external integrations

## Implementation Notes

If `agent_v0` becomes a first-class builtin runnable, existing builtin-service assumptions will need widening.

Current frontend/runtime plumbing recognizes builtin service types around `completion` and `chat`.

Implication:

- adding `agent` later likely requires updating builtin service type detection and service-schema fetching paths

This is an implementation concern for later, not a reason to distort the handler design now.

## Current Recommendation

Build `agent_v0` as:

- a canonical workflow handler
- a normalized message-loop runtime
- configuration-backed messages plus per-run messages
- configuration-backed consent plus per-run consent merges
- configuration-backed context plus per-run context merges
- a strict split between internal and external tools
- consent for internal tools
- explicit `control.terminate` external tool for loop termination

Keep the first version simple and read-only.
