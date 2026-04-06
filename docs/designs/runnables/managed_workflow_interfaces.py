"""Draft managed workflow interface registry.

This file is a design artifact, not the SDK source of truth.

Purpose:
- define a draft canonical `uri + schemas` contract for managed workflows
- cover canonical builtins, legacy chat/completion, and evaluator catalog items
- model dynamic schema composition explicitly without expanding everything inline

Non-goals:
- this file is not imported by production code
- this file does not replace `sdk/agenta/sdk/engines/running/interfaces.py`
- this file does not attempt to preserve every legacy frontend widget exactly
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict


JSON_SCHEMA = "https://json-schema.org/draft/2020-12/schema"


def obj(
    *,
    title: str | None = None,
    description: str | None = None,
    properties: Dict[str, Any] | None = None,
    required: list[str] | None = None,
    additional_properties: bool | Dict[str, Any] = False,
    defs: Dict[str, Any] | None = None,
    **extra: Any,
) -> Dict[str, Any]:
    schema: Dict[str, Any] = {
        "$schema": JSON_SCHEMA,
        "type": "object",
        "properties": properties or {},
        "additionalProperties": additional_properties,
    }
    if title:
        schema["title"] = title
    if description:
        schema["description"] = description
    if required:
        schema["required"] = required
    if defs:
        schema["$defs"] = defs
    schema.update(extra)
    return schema


def arr(
    *,
    items: Dict[str, Any],
    title: str | None = None,
    description: str | None = None,
    default: Any = None,
    **extra: Any,
) -> Dict[str, Any]:
    schema: Dict[str, Any] = {
        "type": "array",
        "items": items,
    }
    if title:
        schema["title"] = title
    if description:
        schema["description"] = description
    if default is not None:
        schema["default"] = default
    schema.update(extra)
    return schema


def scalar(
    *,
    js_type: str | list[str],
    title: str | None = None,
    description: str | None = None,
    default: Any = None,
    enum: list[Any] | None = None,
    **extra: Any,
) -> Dict[str, Any]:
    schema: Dict[str, Any] = {"type": js_type}
    if title:
        schema["title"] = title
    if description:
        schema["description"] = description
    if default is not None:
        schema["default"] = default
    if enum is not None:
        schema["enum"] = enum
    schema.update(extra)
    return schema


def parameter_field(
    *,
    js_field: Dict[str, Any],
    x_ag_type: str | None = None,
    x_ag_type_ref: Dict[str, Any] | None = None,
    x_ag_ui_advanced: bool | None = None,
) -> Dict[str, Any]:
    field = deepcopy(js_field)
    if x_ag_type is not None:
        field["x-ag-type"] = x_ag_type
    if x_ag_type_ref is not None:
        field["x-ag-type-ref"] = x_ag_type_ref
    if x_ag_ui_advanced is not None:
        field["x-ag-ui-advanced"] = x_ag_ui_advanced
    return field


MODEL_CATALOG_DEFINITION = {
    "type": "model_catalog",
    "version": "v1",
    "mode": "reference",
    "source": {
        "kind": "sdk_asset",
        "path": "agenta.sdk.utils.assets.supported_llm_models",
    },
    "metadata_source": {
        "kind": "sdk_asset",
        "path": "agenta.sdk.utils.assets.model_metadata",
    },
}

LLM_MODEL_FIELD = parameter_field(
    js_field=scalar(
        js_type="string",
        title="Model",
        description="Model identifier to use for execution.",
    ),
    x_ag_type="grouped_choice",
    x_ag_type_ref=MODEL_CATALOG_DEFINITION,
)

RUNTIME_FIELD = parameter_field(
    js_field=scalar(
        js_type="string",
        title="Runtime",
        default="python",
        enum=["python", "javascript", "typescript"],
        description="Runtime environment used to execute custom evaluator code.",
    ),
    x_ag_type="choice",
)

MESSAGE_SCHEMA = obj(
    title="Message",
    properties={
        "role": scalar(
            js_type="string",
            enum=["system", "user", "assistant", "tool", "function"],
        ),
        "content": {
            "oneOf": [
                scalar(js_type="string"),
                arr(items={"$ref": "#/$defs/content_part"}),
                scalar(js_type="null"),
            ]
        },
        "name": scalar(js_type=["string", "null"]),
        "tool_calls": arr(items={"$ref": "#/$defs/tool_call"}),
        "tool_call_id": scalar(js_type=["string", "null"]),
    },
    additional_properties=False,
)

CONTENT_PART_DEFS = {
    "image_url": obj(
        properties={
            "url": scalar(js_type="string"),
            "detail": scalar(js_type=["string", "null"], enum=["auto", "low", "high"]),
        },
        additional_properties=False,
    ),
    "file_input": obj(
        properties={
            "file_id": scalar(js_type=["string", "null"]),
            "file_data": scalar(js_type=["string", "null"]),
            "filename": scalar(js_type=["string", "null"]),
            "format": scalar(js_type=["string", "null"]),
        },
        additional_properties=False,
    ),
    "tool_call": obj(
        properties={
            "id": scalar(js_type="string"),
            "type": scalar(js_type="string", enum=["function"], default="function"),
            "function": obj(
                properties={
                    "name": scalar(js_type="string"),
                    "arguments": scalar(js_type=["string", "null"]),
                },
                additional_properties=True,
            ),
        },
        required=["id", "type", "function"],
        additional_properties=False,
    ),
    "content_part_text": obj(
        properties={
            "type": scalar(js_type="string", enum=["text"], default="text"),
            "text": scalar(js_type="string"),
        },
        required=["type", "text"],
        additional_properties=False,
    ),
    "content_part_image": obj(
        properties={
            "type": scalar(js_type="string", enum=["image_url"], default="image_url"),
            "image_url": {"$ref": "#/$defs/image_url"},
        },
        required=["type", "image_url"],
        additional_properties=False,
    ),
    "content_part_file": obj(
        properties={
            "type": scalar(js_type="string", enum=["file"], default="file"),
            "file": {"$ref": "#/$defs/file_input"},
        },
        required=["type", "file"],
        additional_properties=False,
    ),
    "content_part": {
        "oneOf": [
            {"$ref": "#/$defs/content_part_text"},
            {"$ref": "#/$defs/content_part_image"},
            {"$ref": "#/$defs/content_part_file"},
        ]
    },
}

LLM_STATUS_SCHEMA = obj(
    title="LLM Status",
    properties={
        "code": scalar(js_type="integer"),
        "type": scalar(
            js_type="string",
            enum=["success", "pending", "failure"],
        ),
        "message": scalar(js_type="string"),
    },
    required=["code", "type", "message"],
    additional_properties=False,
)

LLM_USAGE_SCHEMA = obj(
    title="LLM Usage",
    properties={
        "completion_tokens": scalar(js_type="integer"),
        "prompt_tokens": scalar(js_type="integer"),
        "total_tokens": scalar(js_type="integer"),
    },
    additional_properties=True,
)

LLM_CONFIG_SCHEMA = obj(
    title="LLM Config",
    properties={
        "model": deepcopy(LLM_MODEL_FIELD),
        "temperature": scalar(js_type="number", minimum=0.0, maximum=2.0),
        "max_tokens": scalar(js_type="integer", minimum=0),
        "top_p": scalar(js_type="number", minimum=0.0, maximum=1.0),
        "frequency_penalty": scalar(js_type="number", minimum=-2.0, maximum=2.0),
        "presence_penalty": scalar(js_type="number", minimum=-2.0, maximum=2.0),
        "reasoning_effort": parameter_field(
            js_field=scalar(
                js_type="string",
                enum=["none", "low", "medium", "high"],
                description="Controls reasoning effort for supported models.",
            ),
            x_ag_type="choice",
        ),
        "tool_choice": {
            "oneOf": [
                scalar(js_type="string", enum=["none", "auto"]),
                obj(additional_properties=True),
            ]
        },
        "response_format": obj(
            title="Response Format",
            properties={
                "type": scalar(
                    js_type="string",
                    enum=["text", "json_object", "json_schema"],
                ),
                "json_schema": obj(
                    title="JSON Schema Response Format",
                    properties={
                        "name": scalar(js_type="string"),
                        "description": scalar(js_type=["string", "null"]),
                        "schema": obj(additional_properties=True),
                        "strict": scalar(js_type=["boolean", "null"]),
                    },
                    additional_properties=False,
                ),
            },
            additional_properties=True,
        ),
    },
    additional_properties=False,
)

LLM_MESSAGES_ARRAY = arr(
    items={"$ref": "#/$defs/message"},
    description="Ordered list of normalized chat messages.",
    default=[],
    **{"x-ag-messages": True},
)

CONTENT_PARTS_ARRAY = arr(
    items={"$ref": "#/$defs/content_part"},
    description="Raw multimodal content parts.",
    **{"x-ag-content": True},
)

LLM_PARAMETERS_SCHEMA = obj(
    title="LLM Parameters",
    description="Canonical stored configuration for prompt_v0, agent_v0, and llm_v0.",
    properties={
        "llms": arr(items=LLM_CONFIG_SCHEMA, description="Ordered LLM fallback list."),
        "loop": obj(
            properties={
                "max_iterations": scalar(js_type="integer", minimum=1),
                "max_internal_tool_calls": scalar(js_type="integer", minimum=0),
                "max_consecutive_errors": scalar(js_type="integer", minimum=0),
                "allow_implicit_stop": scalar(js_type="boolean"),
                "require_terminate_tool": scalar(js_type="boolean"),
            },
            additional_properties=False,
        ),
        "files": obj(
            properties={
                "enabled": scalar(js_type="boolean"),
                "read_only": scalar(js_type="boolean"),
                "roots": arr(items=scalar(js_type="string")),
                "allow_globs": arr(items=scalar(js_type="string")),
                "deny_globs": arr(items=scalar(js_type="string")),
                "max_file_bytes": scalar(js_type="integer", minimum=0),
                "max_total_bytes_per_turn": scalar(js_type="integer", minimum=0),
                "include_hidden": scalar(js_type="boolean"),
            },
            additional_properties=False,
        ),
        "tools": obj(
            properties={
                "internal": arr(items=scalar(js_type="string")),
                "external": arr(items=scalar(js_type="string")),
            },
            additional_properties=False,
        ),
        "messages": LLM_MESSAGES_ARRAY,
        "context": obj(
            description="Stored js_field execution context.",
            additional_properties=True,
            **{"x-ag-context": True},
        ),
        "consent": obj(
            properties={
                "mode": scalar(
                    js_type="string",
                    enum=["per_call", "allow_all", "deny_all"],
                ),
                "apply_to": arr(items=scalar(js_type="string")),
                "on_missing_consent": scalar(js_type="string"),
                "remember_decisions": scalar(js_type="boolean"),
                "allowed_tools": arr(items=scalar(js_type="string")),
                "denied_tools": arr(items=scalar(js_type="string")),
                "decisions": obj(additional_properties=True),
            },
            additional_properties=False,
            **{"x-ag-consent": True},
        ),
        "response": obj(
            properties={
                "stream": scalar(js_type="boolean", default=False),
                "format": scalar(
                    js_type="string",
                    enum=["messages", "text", "json"],
                    default="messages",
                ),
                "schema": obj(additional_properties=True),
            },
            additional_properties=False,
        ),
    },
    additional_properties=False,
    defs={**CONTENT_PART_DEFS, "message": MESSAGE_SCHEMA},
)

LLM_INPUTS_SCHEMA = obj(
    title="LLM Inputs",
    description="Canonical runtime inputs for llm_v0 family handlers.",
    properties={
        "messages": deepcopy(LLM_MESSAGES_ARRAY),
        "message": obj(
            properties=deepcopy(MESSAGE_SCHEMA["properties"]),
            required=["role"],
            additional_properties=False,
            **{"x-ag-message": True},
        ),
        "content": deepcopy(CONTENT_PARTS_ARRAY),
        "context": obj(additional_properties=True, **{"x-ag-context": True}),
        "consent": obj(additional_properties=True, **{"x-ag-consent": True}),
        "variables": obj(
            additional_properties=True,
            **{"x-ag-variables": True},
        ),
    },
    additional_properties=True,
    defs={**CONTENT_PART_DEFS, "message": MESSAGE_SCHEMA},
)

LLM_OUTPUTS_SCHEMA = obj(
    title="LLM Outputs",
    description="Unified output envelope for prompt and agent-style managed workflows.",
    properties={
        "status": {
            **deepcopy(LLM_STATUS_SCHEMA),
            "x-ag-status": True,
        },
        "messages": deepcopy(LLM_MESSAGES_ARRAY),
        "message": obj(
            properties=deepcopy(MESSAGE_SCHEMA["properties"]),
            required=["role"],
            additional_properties=False,
            **{"x-ag-message": True},
        ),
        "content": deepcopy(CONTENT_PARTS_ARRAY),
        "context": obj(additional_properties=True, **{"x-ag-context": True}),
        "consent": obj(additional_properties=True, **{"x-ag-consent": True}),
        "usage": deepcopy(LLM_USAGE_SCHEMA),
    },
    required=["status", "messages", "context", "consent", "usage"],
    additional_properties=False,
    defs={**CONTENT_PART_DEFS, "message": MESSAGE_SCHEMA},
)

MATCH_OUTPUTS_SCHEMA = obj(
    title="Match Outputs",
    description="Recursive result tree mirroring the matcher tree.",
    properties={
        "results": arr(items={"$ref": "#/$defs/result"}),
    },
    required=["results"],
    additional_properties=False,
    defs={
        "result": obj(
            properties={
                "key": scalar(js_type="string"),
                "path": scalar(js_type="string"),
                "success": scalar(js_type="boolean"),
                "score": scalar(js_type="number"),
                "error": scalar(js_type="boolean"),
                "status": scalar(js_type="string"),
                "message": scalar(js_type=["string", "null"]),
                "children": arr(items={"$ref": "#/$defs/result"}),
            },
            required=["key", "success", "score", "error", "status"],
            additional_properties=False,
        )
    },
)

LEGACY_OPENAI_APP_PARAMETERS = obj(
    title="Legacy OpenAI App Parameters",
    description=(
        "Compatibility parameter schema for legacy chat/completion workflows. "
        "Precise canonical parameter schemas are not normalized yet."
    ),
    properties={
        "model": deepcopy(LLM_MODEL_FIELD),
        "temperature": scalar(js_type="number"),
        "max_tokens": scalar(js_type="integer"),
        "top_p": scalar(js_type="number"),
        "frequency_penalty": scalar(js_type="number"),
        "presence_penalty": scalar(js_type="number"),
        "prompt_system": scalar(js_type="string"),
        "prompt_user": scalar(js_type="string"),
    },
    additional_properties=True,
)

GENERIC_EVALUATOR_INPUTS_SCHEMA = obj(
    title="Evaluator Inputs",
    description=(
        "Generic testcase row object available to evaluator workflows. "
        "This intentionally remains open because many evaluators reference "
        "caller-provided keys such as `correct_answer_key` or prompt variables."
    ),
    additional_properties=True,
)

SUCCESS_ONLY_OUTPUTS_SCHEMA = obj(
    title="Success-Only Outputs",
    properties={"success": scalar(js_type="boolean")},
    required=["success"],
    additional_properties=False,
)

SCORE_SUCCESS_OUTPUTS_SCHEMA = obj(
    title="Score And Success Outputs",
    properties={
        "score": scalar(js_type="number"),
        "success": scalar(js_type="boolean"),
    },
    additional_properties=False,
)


def interface(
    *,
    uri: str,
    name: str,
    description: str,
    parameters: Dict[str, Any] | None,
    outputs: Dict[str, Any] | None,
    inputs: Dict[str, Any] | None = None,
    url: str | None = None,
    categories: list[str] | None = None,
    archived: bool = False,
    recommended: bool = False,
) -> Dict[str, Any]:
    schemas: Dict[str, Any] = {
        "parameters": deepcopy(parameters),
        "outputs": deepcopy(outputs),
    }
    if inputs is not None:
        schemas["inputs"] = deepcopy(inputs)

    return {
        "uri": uri,
        "url": url,
        "name": name,
        "description": description,
        "archived": archived,
        "recommended": recommended,
        "categories": categories or [],
        "schemas": schemas,
    }


def service_url(
    *,
    uri: str,
) -> str:
    parts = uri.split(":")
    if len(parts) < 4:
        raise ValueError(f"Unsupported URI for service exposure: {uri}")
    return f"/services/{parts[2]}"


def evaluator_parameters_schema(
    properties: Dict[str, Any],
    *,
    required: list[str] | None = None,
    description: str | None = None,
) -> Dict[str, Any]:
    return obj(
        title="Evaluator Parameters",
        description=description or "Stored evaluator configuration parameters.",
        properties=properties,
        required=required,
        additional_properties=False,
    )


def derived_outputs_schema(
    *,
    title: str,
    default_properties: Dict[str, Any],
    required: list[str] | None = None,
    derivation: Dict[str, Any],
) -> Dict[str, Any]:
    schema = obj(
        title=title,
        properties=default_properties,
        required=required,
        additional_properties=False,
    )
    schema["x-ag-output-definition"] = derivation
    return schema


AI_CRITIQUE_OUTPUTS_SCHEMA = derived_outputs_schema(
    title="AI Critique Outputs",
    default_properties={"score": scalar(js_type="boolean")},
    required=["score"],
    derivation={
        "type": "parameterized_output_schema",
        "version": "v1",
        "mode": "reference",
        "source": {
            "kind": "parameter_path",
            "parameter": "json_schema",
            "path": "schema",
        },
        "fallback": "default_inline_schema",
    },
)

JSON_MULTI_FIELD_OUTPUTS_SCHEMA = derived_outputs_schema(
    title="JSON Multi-Field Match Outputs",
    default_properties={"aggregate_score": scalar(js_type="number")},
    required=["aggregate_score"],
    derivation={
        "type": "parameterized_output_schema",
        "version": "v1",
        "mode": "reference",
        "source": {
            "kind": "parameter_transform",
            "parameter": "fields",
            "transform": "json_multi_field_match_outputs_v1",
        },
    },
)


MANAGED_WORKFLOW_INTERFACES: Dict[str, Dict[str, Any]] = {
    "agenta:custom:feedback:v0": interface(
        uri="agenta:custom:feedback:v0",
        url=service_url(uri="agenta:custom:feedback:v0"),
        name="Trace",
        description="Custom trace-backed workflow. Canonical schemas are not normalized yet.",
        parameters=None,
        inputs=None,
        outputs=None,
        categories=["custom"],
    ),
    "agenta:custom:hook:v0": interface(
        uri="agenta:custom:hook:v0",
        url=service_url(uri="agenta:custom:hook:v0"),
        name="Hook",
        description="Custom hook workflow. Canonical schemas are not normalized yet.",
        parameters=None,
        inputs=None,
        outputs=None,
        categories=["custom"],
    ),
    "agenta:custom:code:v0": interface(
        uri="agenta:custom:code:v0",
        url=service_url(uri="agenta:custom:code:v0"),
        name="Code",
        description="Custom code workflow. Canonical schemas are not normalized yet.",
        parameters=None,
        inputs=None,
        outputs=None,
        categories=["custom"],
    ),
    "agenta:custom:snippet:v0": interface(
        uri="agenta:custom:snippet:v0",
        url=service_url(uri="agenta:custom:snippet:v0"),
        name="Snippet",
        description="Custom snippet workflow. Canonical schemas are not normalized yet.",
        parameters=None,
        inputs=None,
        outputs=None,
        categories=["custom"],
    ),
    "agenta:builtin:llm:v0": interface(
        uri="agenta:builtin:llm:v0",
        url=service_url(uri="agenta:builtin:llm:v0"),
        name="Canonical LLM Workflow",
        description="Unified managed workflow covering prompt and agent behavior.",
        parameters=LLM_PARAMETERS_SCHEMA,
        inputs=LLM_INPUTS_SCHEMA,
        outputs=LLM_OUTPUTS_SCHEMA,
        categories=["canonical", "llm"],
        recommended=True,
    ),
    "agenta:builtin:prompt:v0": interface(
        uri="agenta:builtin:prompt:v0",
        url=service_url(uri="agenta:builtin:prompt:v0"),
        name="Prompt Workflow",
        description="Single-call prompt alias over llm_v0.",
        parameters={
            **deepcopy(LLM_PARAMETERS_SCHEMA),
            "x-ag-alias-of": "agenta:builtin:llm:v0",
            "x-ag-parameter-profile": "prompt_v0",
        },
        inputs=LLM_INPUTS_SCHEMA,
        outputs=LLM_OUTPUTS_SCHEMA,
        categories=["canonical", "llm", "prompt"],
        recommended=True,
    ),
    "agenta:builtin:agent:v0": interface(
        uri="agenta:builtin:agent:v0",
        url=service_url(uri="agenta:builtin:agent:v0"),
        name="Agent Workflow",
        description="Multi-step agent alias over llm_v0.",
        parameters={
            **deepcopy(LLM_PARAMETERS_SCHEMA),
            "x-ag-alias-of": "agenta:builtin:llm:v0",
            "x-ag-parameter-profile": "agent_v0",
        },
        inputs=LLM_INPUTS_SCHEMA,
        outputs=LLM_OUTPUTS_SCHEMA,
        categories=["canonical", "llm", "agent"],
        recommended=True,
    ),
    "agenta:builtin:chat:v0": interface(
        uri="agenta:builtin:chat:v0",
        url=service_url(uri="agenta:builtin:chat:v0"),
        name="Legacy Chat Workflow",
        description="Legacy chat application workflow.",
        parameters=LEGACY_OPENAI_APP_PARAMETERS,
        inputs=obj(
            title="Legacy Chat Inputs",
            properties={"messages": deepcopy(LLM_MESSAGES_ARRAY)},
            additional_properties=True,
            defs={**CONTENT_PART_DEFS, "message": MESSAGE_SCHEMA},
        ),
        outputs=obj(
            title="Chat App Outputs",
            properties={
                "role": scalar(js_type="string"),
                "content": scalar(js_type="string"),
            },
            required=["role", "content"],
            additional_properties=True,
        ),
        categories=["legacy", "chat"],
    ),
    "agenta:builtin:completion:v0": interface(
        uri="agenta:builtin:completion:v0",
        url=service_url(uri="agenta:builtin:completion:v0"),
        name="Legacy Completion Workflow",
        description="Legacy completion application workflow.",
        parameters=LEGACY_OPENAI_APP_PARAMETERS,
        inputs=obj(
            title="Legacy Completion Inputs",
            additional_properties=True,
        ),
        outputs=scalar(
            js_type=["string", "object", "array"],
            title="Completion App Outputs",
            description="Generated response, which may be text or structured data.",
        ),
        categories=["legacy", "completion"],
    ),
    "agenta:builtin:echo:v0": interface(
        uri="agenta:builtin:echo:v0",
        url=service_url(uri="agenta:builtin:echo:v0"),
        name="Echo",
        description="Returns the input value unchanged.",
        parameters=obj(
            title="Echo Parameters",
            additional_properties=True,
        ),
        inputs=obj(
            title="Echo Inputs",
            additional_properties=True,
        ),
        outputs=obj(
            title="Echo Output",
            properties={"got": scalar(js_type="string")},
            required=["got"],
            additional_properties=False,
        ),
        categories=["builtin"],
    ),
    "agenta:builtin:match:v0": interface(
        uri="agenta:builtin:match:v0",
        url=service_url(uri="agenta:builtin:match:v0"),
        name="Matcher Workflow",
        description="Recursive matcher tree evaluation.",
        parameters=obj(
            title="Match Parameters",
            additional_properties=True,
        ),
        inputs=obj(
            title="Match Inputs",
            additional_properties=True,
        ),
        outputs=MATCH_OUTPUTS_SCHEMA,
        categories=["builtin", "matcher"],
    ),
    "agenta:builtin:auto_ai_critique:v0": interface(
        uri="agenta:builtin:auto_ai_critique:v0",
        url=service_url(uri="agenta:builtin:auto_ai_critique:v0"),
        name="LLM-as-a-judge",
        description="Configurable AI critique evaluator.",
        parameters=evaluator_parameters_schema(
            {
                "prompt_template": parameter_field(
                    js_field=deepcopy(LLM_MESSAGES_ARRAY),
                    x_ag_type="messages",
                ),
                "correct_answer_key": parameter_field(
                    js_field=scalar(
                        js_type="string",
                        default="correct_answer",
                        description="Column name containing the expected answer.",
                    ),
                    x_ag_type="text",
                    x_ag_ui_advanced=True,
                ),
                "model": deepcopy(LLM_MODEL_FIELD),
                "response_type": parameter_field(
                    js_field=scalar(js_type="string", default="json_schema"),
                    x_ag_type="hidden",
                    x_ag_ui_advanced=True,
                ),
                "json_schema": parameter_field(
                    js_field=obj(
                        title="Feedback Configuration",
                        properties={
                            "name": scalar(js_type="string", default="schema"),
                            "schema": obj(additional_properties=True),
                            "strict": scalar(js_type=["boolean", "null"], default=True),
                        },
                        additional_properties=False,
                    ),
                    x_ag_type="llm_response_schema",
                ),
                "version": parameter_field(
                    js_field=scalar(js_type="string", default="4"),
                    x_ag_type="hidden",
                ),
            },
            required=["prompt_template"],
        ),
        inputs=GENERIC_EVALUATOR_INPUTS_SCHEMA,
        outputs=AI_CRITIQUE_OUTPUTS_SCHEMA,
        categories=["evaluator", "catalog", "ai_llm"],
        recommended=True,
    ),
    "agenta:builtin:auto_custom_code_run:v0": interface(
        uri="agenta:builtin:auto_custom_code_run:v0",
        url=service_url(uri="agenta:builtin:auto_custom_code_run:v0"),
        name="Code Evaluation",
        description="Custom evaluator code in Python, JavaScript, or TypeScript.",
        parameters=evaluator_parameters_schema(
            {
                "requires_llm_api_keys": parameter_field(
                    js_field=scalar(js_type="boolean", default=False),
                    x_ag_type="bool",
                    x_ag_ui_advanced=True,
                ),
                "code": parameter_field(
                    js_field=scalar(
                        js_type="string", description="Evaluator source code."
                    ),
                    x_ag_type="code",
                ),
                "runtime": deepcopy(RUNTIME_FIELD),
                "correct_answer_key": parameter_field(
                    js_field=scalar(js_type="string", default="correct_answer"),
                    x_ag_type="text",
                    x_ag_ui_advanced=True,
                ),
                "version": parameter_field(
                    js_field=scalar(js_type="string", default="2"),
                    x_ag_type="hidden",
                ),
            },
            required=["requires_llm_api_keys", "code"],
        ),
        inputs=GENERIC_EVALUATOR_INPUTS_SCHEMA,
        outputs=deepcopy(SCORE_SUCCESS_OUTPUTS_SCHEMA),
        categories=["evaluator", "catalog", "custom"],
    ),
    "agenta:builtin:field_match_test:v0": interface(
        uri="agenta:builtin:field_match_test:v0",
        url=service_url(uri="agenta:builtin:field_match_test:v0"),
        name="JSON Field Match",
        description="Archived single JSON field match evaluator.",
        parameters=evaluator_parameters_schema(
            {
                "json_field": parameter_field(
                    js_field=scalar(js_type="string"),
                    x_ag_type="text",
                ),
                "correct_answer_key": parameter_field(
                    js_field=scalar(js_type="string", default="correct_answer"),
                    x_ag_type="text",
                    x_ag_ui_advanced=True,
                ),
            },
            required=["json_field"],
        ),
        inputs=GENERIC_EVALUATOR_INPUTS_SCHEMA,
        outputs=deepcopy(SUCCESS_ONLY_OUTPUTS_SCHEMA),
        categories=["evaluator", "catalog", "classifiers"],
        archived=True,
    ),
    "agenta:builtin:json_multi_field_match:v0": interface(
        uri="agenta:builtin:json_multi_field_match:v0",
        url=service_url(uri="agenta:builtin:json_multi_field_match:v0"),
        name="JSON Multi-Field Match",
        description="Compares configured JSON fields and emits per-field metrics plus aggregate score.",
        parameters=evaluator_parameters_schema(
            {
                "fields": parameter_field(
                    js_field=arr(
                        items=scalar(js_type="string"),
                        description="Fields to compare using dot notation.",
                    ),
                    x_ag_type="fields_tags_editor",
                ),
                "correct_answer_key": parameter_field(
                    js_field=scalar(js_type="string", default="correct_answer"),
                    x_ag_type="text",
                    x_ag_ui_advanced=True,
                ),
            },
            required=["fields", "correct_answer_key"],
        ),
        inputs=GENERIC_EVALUATOR_INPUTS_SCHEMA,
        outputs=JSON_MULTI_FIELD_OUTPUTS_SCHEMA,
        categories=["evaluator", "catalog", "classifiers"],
        recommended=True,
    ),
    "agenta:builtin:auto_json_diff:v0": interface(
        uri="agenta:builtin:auto_json_diff:v0",
        url=service_url(uri="agenta:builtin:auto_json_diff:v0"),
        name="JSON Diff Match",
        description="Compares JSON outputs against expected JSON.",
        parameters=evaluator_parameters_schema(
            {
                "compare_schema_only": parameter_field(
                    js_field=scalar(js_type="boolean", default=False),
                    x_ag_type="bool",
                    x_ag_ui_advanced=True,
                ),
                "predict_keys": parameter_field(
                    js_field=scalar(js_type="boolean", default=False),
                    x_ag_type="bool",
                    x_ag_ui_advanced=True,
                ),
                "case_insensitive_keys": parameter_field(
                    js_field=scalar(js_type="boolean", default=False),
                    x_ag_type="bool",
                    x_ag_ui_advanced=True,
                ),
                "correct_answer_key": parameter_field(
                    js_field=scalar(js_type="string", default="correct_answer"),
                    x_ag_type="text",
                    x_ag_ui_advanced=True,
                ),
            },
        ),
        inputs=GENERIC_EVALUATOR_INPUTS_SCHEMA,
        outputs=deepcopy(SCORE_SUCCESS_OUTPUTS_SCHEMA),
        categories=["evaluator", "catalog", "classifiers"],
    ),
    "agenta:builtin:auto_semantic_similarity:v0": interface(
        uri="agenta:builtin:auto_semantic_similarity:v0",
        url=service_url(uri="agenta:builtin:auto_semantic_similarity:v0"),
        name="Semantic Similarity Match",
        description="Semantic similarity evaluator using embeddings or LLM-backed similarity.",
        parameters=evaluator_parameters_schema(
            {
                "correct_answer_key": parameter_field(
                    js_field=scalar(js_type="string", default="correct_answer"),
                    x_ag_type="text",
                    x_ag_ui_advanced=True,
                )
            },
            required=["correct_answer_key"],
        ),
        inputs=GENERIC_EVALUATOR_INPUTS_SCHEMA,
        outputs=deepcopy(SCORE_SUCCESS_OUTPUTS_SCHEMA),
        categories=["evaluator", "catalog", "similarity"],
        recommended=True,
    ),
    "agenta:builtin:auto_webhook_test:v0": interface(
        uri="agenta:builtin:auto_webhook_test:v0",
        url=service_url(uri="agenta:builtin:auto_webhook_test:v0"),
        name="Webhook Test",
        description="Delegates evaluation to an external webhook.",
        parameters=evaluator_parameters_schema(
            {
                "requires_llm_api_keys": parameter_field(
                    js_field=scalar(js_type="boolean", default=False),
                    x_ag_type="bool",
                    x_ag_ui_advanced=True,
                ),
                "webhook_url": parameter_field(
                    js_field=scalar(js_type="string", description="Webhook URL."),
                    x_ag_type="text",
                ),
                "correct_answer_key": parameter_field(
                    js_field=scalar(js_type="string", default="correct_answer"),
                    x_ag_type="text",
                    x_ag_ui_advanced=True,
                ),
            },
            required=["requires_llm_api_keys", "webhook_url"],
        ),
        inputs=GENERIC_EVALUATOR_INPUTS_SCHEMA,
        outputs=deepcopy(SCORE_SUCCESS_OUTPUTS_SCHEMA),
        categories=["evaluator", "catalog", "custom"],
    ),
    "agenta:builtin:auto_exact_match:v0": interface(
        uri="agenta:builtin:auto_exact_match:v0",
        url=service_url(uri="agenta:builtin:auto_exact_match:v0"),
        name="Exact Match",
        description="Checks exact equality against the expected answer.",
        parameters=evaluator_parameters_schema(
            {
                "correct_answer_key": parameter_field(
                    js_field=scalar(js_type="string", default="correct_answer"),
                    x_ag_type="text",
                    x_ag_ui_advanced=True,
                ),
            },
        ),
        inputs=GENERIC_EVALUATOR_INPUTS_SCHEMA,
        outputs=deepcopy(SUCCESS_ONLY_OUTPUTS_SCHEMA),
        categories=["evaluator", "catalog", "classifiers"],
        recommended=True,
    ),
    "agenta:builtin:auto_contains_json:v0": interface(
        uri="agenta:builtin:auto_contains_json:v0",
        url=service_url(uri="agenta:builtin:auto_contains_json:v0"),
        name="Contains JSON",
        description="Checks whether the output contains valid JSON.",
        parameters=evaluator_parameters_schema({}),
        inputs=obj(title="Contains JSON Inputs", additional_properties=True),
        outputs=deepcopy(SUCCESS_ONLY_OUTPUTS_SCHEMA),
        categories=["evaluator", "catalog", "classifiers"],
    ),
    "agenta:builtin:auto_similarity_match:v0": interface(
        uri="agenta:builtin:auto_similarity_match:v0",
        url=service_url(uri="agenta:builtin:auto_similarity_match:v0"),
        name="Similarity Match",
        description="Text similarity evaluator with threshold.",
        parameters=evaluator_parameters_schema(
            {
                "similarity_threshold": parameter_field(
                    js_field=scalar(
                        js_type="number",
                        default=0.5,
                        minimum=0,
                        maximum=1,
                    ),
                    x_ag_type="float",
                ),
                "correct_answer_key": parameter_field(
                    js_field=scalar(js_type="string", default="correct_answer"),
                    x_ag_type="text",
                    x_ag_ui_advanced=True,
                ),
            },
            required=["similarity_threshold"],
        ),
        inputs=GENERIC_EVALUATOR_INPUTS_SCHEMA,
        outputs=deepcopy(SCORE_SUCCESS_OUTPUTS_SCHEMA),
        categories=["evaluator", "catalog", "similarity"],
    ),
    "agenta:builtin:auto_regex_test:v0": interface(
        uri="agenta:builtin:auto_regex_test:v0",
        url=service_url(uri="agenta:builtin:auto_regex_test:v0"),
        name="Regex Test",
        description="Regex-based matcher evaluator.",
        parameters=evaluator_parameters_schema(
            {
                "regex_pattern": parameter_field(
                    js_field=scalar(js_type="string", default=""),
                    x_ag_type="regex",
                ),
                "regex_should_match": parameter_field(
                    js_field=scalar(js_type="boolean", default=True),
                    x_ag_type="bool",
                ),
            },
            required=["regex_pattern"],
        ),
        inputs=obj(
            title="Regex Test Inputs",
            additional_properties=True,
        ),
        outputs=deepcopy(SUCCESS_ONLY_OUTPUTS_SCHEMA),
        categories=["evaluator", "catalog", "classifiers"],
    ),
    "agenta:builtin:auto_starts_with:v0": interface(
        uri="agenta:builtin:auto_starts_with:v0",
        url=service_url(uri="agenta:builtin:auto_starts_with:v0"),
        name="Starts With",
        description="Archived prefix matcher evaluator.",
        parameters=evaluator_parameters_schema(
            {
                "prefix": parameter_field(
                    js_field=scalar(js_type="string"), x_ag_type="text"
                ),
                "case_sensitive": parameter_field(
                    js_field=scalar(js_type="boolean", default=True),
                    x_ag_type="bool",
                ),
            },
            required=["prefix"],
        ),
        inputs=obj(title="Starts With Inputs", additional_properties=True),
        outputs=deepcopy(SUCCESS_ONLY_OUTPUTS_SCHEMA),
        categories=["evaluator", "catalog", "classifiers"],
        archived=True,
    ),
    "agenta:builtin:auto_ends_with:v0": interface(
        uri="agenta:builtin:auto_ends_with:v0",
        url=service_url(uri="agenta:builtin:auto_ends_with:v0"),
        name="Ends With",
        description="Archived suffix matcher evaluator.",
        parameters=evaluator_parameters_schema(
            {
                "case_sensitive": parameter_field(
                    js_field=scalar(js_type="boolean", default=True),
                    x_ag_type="bool",
                ),
                "suffix": parameter_field(
                    js_field=scalar(js_type="string"), x_ag_type="text"
                ),
            },
            required=["suffix"],
        ),
        inputs=obj(title="Ends With Inputs", additional_properties=True),
        outputs=deepcopy(SUCCESS_ONLY_OUTPUTS_SCHEMA),
        categories=["evaluator", "catalog", "classifiers"],
        archived=True,
    ),
    "agenta:builtin:auto_contains:v0": interface(
        uri="agenta:builtin:auto_contains:v0",
        url=service_url(uri="agenta:builtin:auto_contains:v0"),
        name="Contains",
        description="Archived substring matcher evaluator.",
        parameters=evaluator_parameters_schema(
            {
                "case_sensitive": parameter_field(
                    js_field=scalar(js_type="boolean", default=True),
                    x_ag_type="bool",
                ),
                "substring": parameter_field(
                    js_field=scalar(js_type="string"), x_ag_type="text"
                ),
            },
            required=["substring"],
        ),
        inputs=obj(title="Contains Inputs", additional_properties=True),
        outputs=deepcopy(SUCCESS_ONLY_OUTPUTS_SCHEMA),
        categories=["evaluator", "catalog", "classifiers"],
        archived=True,
    ),
    "agenta:builtin:auto_contains_any:v0": interface(
        uri="agenta:builtin:auto_contains_any:v0",
        url=service_url(uri="agenta:builtin:auto_contains_any:v0"),
        name="Contains Any",
        description="Archived any-substring matcher evaluator.",
        parameters=evaluator_parameters_schema(
            {
                "case_sensitive": parameter_field(
                    js_field=scalar(js_type="boolean", default=True),
                    x_ag_type="bool",
                ),
                "substrings": parameter_field(
                    js_field=scalar(js_type="string"),
                    x_ag_type="text",
                ),
            },
            required=["substrings"],
        ),
        inputs=obj(title="Contains Any Inputs", additional_properties=True),
        outputs=deepcopy(SUCCESS_ONLY_OUTPUTS_SCHEMA),
        categories=["evaluator", "catalog", "classifiers"],
        archived=True,
    ),
    "agenta:builtin:auto_contains_all:v0": interface(
        uri="agenta:builtin:auto_contains_all:v0",
        url=service_url(uri="agenta:builtin:auto_contains_all:v0"),
        name="Contains All",
        description="Archived all-substring matcher evaluator.",
        parameters=evaluator_parameters_schema(
            {
                "case_sensitive": parameter_field(
                    js_field=scalar(js_type="boolean", default=True),
                    x_ag_type="bool",
                ),
                "substrings": parameter_field(
                    js_field=scalar(js_type="string"),
                    x_ag_type="text",
                ),
            },
            required=["substrings"],
        ),
        inputs=obj(title="Contains All Inputs", additional_properties=True),
        outputs=deepcopy(SUCCESS_ONLY_OUTPUTS_SCHEMA),
        categories=["evaluator", "catalog", "classifiers"],
        archived=True,
    ),
    "agenta:builtin:auto_levenshtein_distance:v0": interface(
        uri="agenta:builtin:auto_levenshtein_distance:v0",
        url=service_url(uri="agenta:builtin:auto_levenshtein_distance:v0"),
        name="Levenshtein Distance",
        description="Levenshtein-based similarity evaluator.",
        parameters=evaluator_parameters_schema(
            {
                "threshold": parameter_field(
                    js_field=scalar(js_type="number"),
                    x_ag_type="float",
                ),
                "correct_answer_key": parameter_field(
                    js_field=scalar(js_type="string", default="correct_answer"),
                    x_ag_type="text",
                    x_ag_ui_advanced=True,
                ),
            },
        ),
        inputs=GENERIC_EVALUATOR_INPUTS_SCHEMA,
        outputs=deepcopy(SCORE_SUCCESS_OUTPUTS_SCHEMA),
        categories=["evaluator", "catalog", "similarity"],
    ),
}


if __name__ == "__main__":
    print(f"{len(MANAGED_WORKFLOW_INTERFACES)} managed workflow interfaces defined")
    for uri in sorted(MANAGED_WORKFLOW_INTERFACES):
        print(uri)
