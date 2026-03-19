from agenta.sdk.models.workflows import WorkflowServiceInterface


JSON_SCHEMA = "https://json-schema.org/draft/2020-12/schema"


def obj(
    *,
    title: str | None = None,
    description: str | None = None,
    properties: dict | None = None,
    required: list[str] | None = None,
    additional_properties: bool | dict = False,
    defs: dict | None = None,
    **extra,
) -> dict:
    schema = {
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
    items: dict,
    title: str | None = None,
    description: str | None = None,
    default=None,
    **extra,
) -> dict:
    schema = {
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
    jtype,
    title: str | None = None,
    description: str | None = None,
    default=None,
    enum: list | None = None,
    **extra,
) -> dict:
    schema = {"type": jtype}
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


def ag_field(
    *,
    base: dict,
    x_ag_type: str | None = None,
    x_ag_type_ref: dict | None = None,
    x_ag_ui_advanced: bool | None = None,
) -> dict:
    field = dict(base)
    if x_ag_type is not None:
        field["x-ag-type"] = x_ag_type
    if x_ag_type_ref is not None:
        field["x-ag-type-ref"] = x_ag_type_ref
    if x_ag_ui_advanced is not None:
        field["x-ag-ui-advanced"] = x_ag_ui_advanced
    return field


MODEL_CATALOG_REF = {
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

MODEL_FIELD = ag_field(
    base=scalar(
        jtype="string",
        title="Model",
        description="Model identifier to use for execution.",
    ),
    x_ag_type="grouped_choice",
    x_ag_type_ref=MODEL_CATALOG_REF,
)

MESSAGE_SCHEMA = obj(
    title="Message",
    properties={
        "role": scalar(
            jtype="string",
            enum=["system", "user", "assistant", "tool", "function"],
        ),
        "content": {
            "oneOf": [
                scalar(jtype="string"),
                arr(items={"type": "object"}),
                scalar(jtype="null"),
            ]
        },
        "name": scalar(jtype=["string", "null"]),
        "tool_calls": arr(items={"type": "object"}),
        "tool_call_id": scalar(jtype=["string", "null"]),
    },
    additional_properties=False,
)

LLM_MESSAGES_ARRAY = arr(
    items={"$ref": "#/$defs/message"},
    description="Ordered list of normalized chat messages.",
    default=[],
    **{"x-ag-messages": True},
)

GENERIC_EVALUATOR_INPUTS_SCHEMA = obj(
    title="Evaluator Inputs",
    description="Generic testcase row object available to evaluator workflows.",
    additional_properties=True,
)

SUCCESS_ONLY_OUTPUTS_SCHEMA = obj(
    title="Success-Only Outputs",
    properties={"success": scalar(jtype="boolean")},
    required=["success"],
    additional_properties=False,
)

SCORE_SUCCESS_OUTPUTS_SCHEMA = obj(
    title="Score And Success Outputs",
    properties={
        "score": scalar(jtype="number"),
        "success": scalar(jtype="boolean"),
    },
    additional_properties=False,
)


# --- NEW URI

trace_v0_interface = WorkflowServiceInterface(
    uri="agenta:custom:trace:v0",
    schemas=None,
)

hook_v0_interface = WorkflowServiceInterface(
    uri="agenta:custom:hook:v0",
    schemas=None,
)

code_v0_interface = WorkflowServiceInterface(
    uri="agenta:custom:code:v0",
    schemas=None,
)

snippet_v0_interface = WorkflowServiceInterface(
    uri="agenta:custom:snippet:v0",
    schemas=None,
)

match_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:match:v0",
    schemas=dict(  # type: ignore
        parameters=obj(
            title="Match Parameters",
            description="Matcher configuration payload.",
            additional_properties=True,
        ),
        inputs=obj(
            title="Match Inputs",
            additional_properties=True,
        ),
        outputs={
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "title": "Match Outputs",
            "description": "Recursive result tree mirroring the matcher tree.",
            "properties": {
                "results": {
                    "type": "array",
                    "items": {"$ref": "#/$defs/result"},
                }
            },
            "required": ["results"],
            "$defs": {
                "result": {
                    "type": "object",
                    "properties": {
                        "key": {
                            "type": "string",
                            "description": "Matcher key copied onto the result node.",
                        },
                        "path": {
                            "type": "string",
                            "description": "Matcher path copied onto the result node.",
                        },
                        "success": {"type": "boolean"},
                        "score": {"type": "number"},
                        "error": {"type": "boolean"},
                        "status": {"type": "string"},
                        "message": {"type": "string"},
                        "children": {
                            "type": "array",
                            "items": {"$ref": "#/$defs/result"},
                        },
                    },
                    "required": ["key", "success", "score", "error", "status"],
                    "additionalProperties": False,
                }
            },
            "additionalProperties": False,
        },
    ),
)

llm_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:llm:v0",
    schemas=dict(  # type: ignore
        parameters=obj(
            title="LLM Parameters",
            description="Canonical stored configuration for prompt and agent-style managed workflows.",
            properties={
                "llms": arr(
                    items=obj(
                        title="LLM Config",
                        properties={
                            "model": MODEL_FIELD,
                            "temperature": scalar(
                                jtype="number", minimum=0.0, maximum=2.0
                            ),
                            "max_tokens": scalar(jtype="integer", minimum=0),
                            "top_p": scalar(jtype="number", minimum=0.0, maximum=1.0),
                            "frequency_penalty": scalar(
                                jtype="number", minimum=-2.0, maximum=2.0
                            ),
                            "presence_penalty": scalar(
                                jtype="number", minimum=-2.0, maximum=2.0
                            ),
                            "reasoning_effort": ag_field(
                                base=scalar(
                                    jtype="string",
                                    enum=["none", "low", "medium", "high"],
                                ),
                                x_ag_type="choice",
                            ),
                            "tool_choice": {
                                "oneOf": [
                                    scalar(jtype="string", enum=["none", "auto"]),
                                    obj(additional_properties=True),
                                ]
                            },
                        },
                        additional_properties=False,
                    ),
                ),
                "loop": obj(
                    properties={
                        "max_iterations": scalar(jtype="integer", minimum=1),
                        "max_internal_tool_calls": scalar(jtype="integer", minimum=0),
                        "max_consecutive_errors": scalar(jtype="integer", minimum=0),
                        "allow_implicit_stop": scalar(jtype="boolean"),
                        "require_terminate_tool": scalar(jtype="boolean"),
                    },
                    additional_properties=False,
                ),
                "files": obj(
                    properties={
                        "enabled": scalar(jtype="boolean"),
                        "read_only": scalar(jtype="boolean"),
                        "roots": arr(items=scalar(jtype="string")),
                        "allow_globs": arr(items=scalar(jtype="string")),
                        "deny_globs": arr(items=scalar(jtype="string")),
                        "max_file_bytes": scalar(jtype="integer", minimum=0),
                        "max_total_bytes_per_turn": scalar(jtype="integer", minimum=0),
                        "include_hidden": scalar(jtype="boolean"),
                    },
                    additional_properties=False,
                ),
                "tools": obj(
                    properties={
                        "internal": arr(items=scalar(jtype="string")),
                        "external": arr(items=scalar(jtype="string")),
                    },
                    additional_properties=False,
                ),
                "messages": LLM_MESSAGES_ARRAY,
                "context": obj(additional_properties=True, **{"x-ag-context": True}),
                "consent": obj(additional_properties=True, **{"x-ag-consent": True}),
                "response": obj(
                    properties={
                        "stream": scalar(jtype="boolean", default=False),
                        "format": scalar(
                            jtype="string",
                            enum=["messages", "text", "json"],
                            default="messages",
                        ),
                        "schema": obj(additional_properties=True),
                    },
                    additional_properties=False,
                ),
            },
            additional_properties=False,
            defs={"message": MESSAGE_SCHEMA},
        ),
        inputs=obj(
            title="LLM Inputs",
            description="Canonical runtime inputs for llm_v0 handlers.",
            properties={
                "messages": LLM_MESSAGES_ARRAY,
                "message": obj(
                    properties=MESSAGE_SCHEMA["properties"],
                    required=["role"],
                    additional_properties=False,
                    **{"x-ag-message": True},
                ),
                "content": arr(items={"type": "object"}, **{"x-ag-content": True}),
                "context": obj(additional_properties=True, **{"x-ag-context": True}),
                "consent": obj(additional_properties=True, **{"x-ag-consent": True}),
                "variables": obj(
                    additional_properties=True, **{"x-ag-variables": True}
                ),
            },
            additional_properties=True,
            defs={"message": MESSAGE_SCHEMA},
        ),
        outputs={
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "title": "LLM Outputs",
            "description": "Unified output envelope for prompt and agent runs.",
            "properties": {
                "status": {
                    "type": "object",
                    "properties": {
                        "code": {"type": "integer"},
                        "type": {"type": "string"},
                        "message": {"type": "string"},
                    },
                    "required": ["code", "type", "message"],
                },
                "messages": {
                    "type": "array",
                    "items": {"type": "object"},
                },
                "context": {"type": "object"},
                "consent": {"type": "object"},
                "usage": {"type": "object"},
            },
            "required": ["status", "messages", "context", "consent", "usage"],
            "additionalProperties": False,
        },
    ),
)

# --- OLD URI

chat_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:chat:v0",
    schemas=dict(  # type: ignore
        parameters=obj(
            title="Legacy Chat Parameters",
            properties={
                "model": MODEL_FIELD,
                "temperature": scalar(jtype="number"),
                "max_tokens": scalar(jtype="integer"),
                "top_p": scalar(jtype="number"),
                "frequency_penalty": scalar(jtype="number"),
                "presence_penalty": scalar(jtype="number"),
                "prompt_system": scalar(jtype="string"),
                "prompt_user": scalar(jtype="string"),
            },
            additional_properties=True,
        ),
        inputs=obj(
            title="Legacy Chat Inputs",
            properties={"messages": LLM_MESSAGES_ARRAY},
            additional_properties=True,
            defs={"message": MESSAGE_SCHEMA},
        ),
        outputs={
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "title": "Chat App Outputs",
            "description": "Final chat message returned by the workflow.",
            "properties": {
                "role": {
                    "type": "string",
                    "description": "Role of the message sender.",
                },
                "content": {"type": "string", "description": "Content of the message."},
            },
            "required": ["role", "content"],
            "additionalProperties": True,  # allows OpenAI-style message fields like tool_calls
        },
    ),
)

completion_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:completion:v0",
    schemas=dict(  # type: ignore
        parameters=obj(
            title="Legacy Completion Parameters",
            properties={
                "model": MODEL_FIELD,
                "temperature": scalar(jtype="number"),
                "max_tokens": scalar(jtype="integer"),
                "top_p": scalar(jtype="number"),
                "frequency_penalty": scalar(jtype="number"),
                "presence_penalty": scalar(jtype="number"),
                "prompt_system": scalar(jtype="string"),
                "prompt_user": scalar(jtype="string"),
            },
            additional_properties=True,
        ),
        inputs=obj(
            title="Legacy Completion Inputs",
            additional_properties=True,
        ),
        outputs={
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": ["string", "object", "array"],
            "title": "Completion App Outputs",
            "description": "Generated response, which may be text or structured data.",
        },
    ),
)


echo_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:echo:v0",
    schemas=dict(  # type: ignore
        parameters=obj(title="Echo Parameters", additional_properties=True),
        inputs=obj(title="Echo Inputs", additional_properties=True),
        outputs={
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "title": "Echo Output",
            "description": "The echoed response object.",
            "properties": {
                "got": {
                    "type": "string",
                    "title": "Echoed Value",
                    "description": "The input value passed back unchanged.",
                }
            },
            "required": ["got"],
            "additionalProperties": False,
        },
    ),
)

auto_exact_match_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_exact_match:v0",
    schemas=dict(  # type: ignore
        parameters=obj(
            title="Exact Match Parameters",
            properties={
                "correct_answer_key": ag_field(
                    base=scalar(jtype="string", default="correct_answer"),
                    x_ag_type="text",
                    x_ag_ui_advanced=True,
                ),
            },
            additional_properties=False,
        ),
        inputs=GENERIC_EVALUATOR_INPUTS_SCHEMA,
        outputs=SUCCESS_ONLY_OUTPUTS_SCHEMA,
    ),
)

auto_regex_test_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_regex_test:v0",
    schemas=dict(  # type: ignore
        parameters=obj(
            title="Regex Test Parameters",
            properties={
                "regex_pattern": ag_field(
                    base=scalar(jtype="string", default=""), x_ag_type="regex"
                ),
                "regex_should_match": ag_field(
                    base=scalar(jtype="boolean", default=True), x_ag_type="bool"
                ),
            },
            required=["regex_pattern"],
            additional_properties=False,
        ),
        inputs=obj(title="Regex Test Inputs", additional_properties=True),
        outputs=SUCCESS_ONLY_OUTPUTS_SCHEMA,
    ),
)

field_match_test_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:field_match_test:v0",
    schemas=dict(  # type: ignore
        parameters=obj(
            title="Field Match Parameters",
            properties={
                "json_field": ag_field(base=scalar(jtype="string"), x_ag_type="text"),
                "correct_answer_key": ag_field(
                    base=scalar(jtype="string", default="correct_answer"),
                    x_ag_type="text",
                    x_ag_ui_advanced=True,
                ),
            },
            required=["json_field"],
            additional_properties=False,
        ),
        inputs=GENERIC_EVALUATOR_INPUTS_SCHEMA,
        outputs=SUCCESS_ONLY_OUTPUTS_SCHEMA,
    ),
)

json_multi_field_match_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:json_multi_field_match:v0",
    schemas=dict(  # type: ignore
        parameters=obj(
            title="JSON Multi-Field Match Parameters",
            properties={
                "fields": ag_field(
                    base=arr(
                        items=scalar(jtype="string"),
                        description="Fields to compare using dot notation.",
                    ),
                    x_ag_type="fields_tags_editor",
                ),
                "correct_answer_key": ag_field(
                    base=scalar(jtype="string", default="correct_answer"),
                    x_ag_type="text",
                    x_ag_ui_advanced=True,
                ),
            },
            required=["fields", "correct_answer_key"],
            additional_properties=False,
        ),
        inputs=GENERIC_EVALUATOR_INPUTS_SCHEMA,
        outputs={
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "title": "JSON Multi-Field Match Outputs",
            "description": "Per-field match scores and aggregate score. Each field produces a 0 or 1 output.",
            "properties": {
                "aggregate_score": {
                    "type": "number",
                    "title": "Aggregate Score",
                    "description": "Percentage of matched fields (0-1).",
                },
            },
            "required": ["aggregate_score"],
            "additionalProperties": True,
            "x-ag-type-ref": {
                "type": "parameterized_output_schema",
                "version": "v1",
                "mode": "reference",
                "source": {
                    "kind": "parameter_transform",
                    "parameter": "fields",
                    "transform": "json_multi_field_match_outputs_v1",
                },
            },
        },
    ),
)

auto_webhook_test_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_webhook_test:v0",
    schemas=dict(  # type: ignore
        parameters=obj(
            title="Webhook Test Parameters",
            properties={
                "requires_llm_api_keys": ag_field(
                    base=scalar(jtype="boolean", default=False),
                    x_ag_type="bool",
                    x_ag_ui_advanced=True,
                ),
                "webhook_url": ag_field(base=scalar(jtype="string"), x_ag_type="text"),
                "correct_answer_key": ag_field(
                    base=scalar(jtype="string", default="correct_answer"),
                    x_ag_type="text",
                    x_ag_ui_advanced=True,
                ),
            },
            required=["requires_llm_api_keys", "webhook_url"],
            additional_properties=False,
        ),
        inputs=GENERIC_EVALUATOR_INPUTS_SCHEMA,
        outputs=SCORE_SUCCESS_OUTPUTS_SCHEMA,
    ),
)

auto_custom_code_run_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_custom_code_run:v0",
    schemas=dict(  # type: ignore
        parameters=obj(
            title="Custom Code Evaluation Parameters",
            properties={
                "requires_llm_api_keys": ag_field(
                    base=scalar(jtype="boolean", default=False),
                    x_ag_type="bool",
                    x_ag_ui_advanced=True,
                ),
                "code": ag_field(base=scalar(jtype="string"), x_ag_type="code"),
                "runtime": ag_field(
                    base=scalar(
                        jtype="string",
                        default="python",
                        enum=["python", "javascript", "typescript"],
                    ),
                    x_ag_type="choice",
                ),
                "correct_answer_key": ag_field(
                    base=scalar(jtype="string", default="correct_answer"),
                    x_ag_type="text",
                    x_ag_ui_advanced=True,
                ),
                "version": ag_field(
                    base=scalar(jtype="string", default="2"), x_ag_type="hidden"
                ),
            },
            required=["requires_llm_api_keys", "code"],
            additional_properties=False,
        ),
        inputs=GENERIC_EVALUATOR_INPUTS_SCHEMA,
        outputs=SCORE_SUCCESS_OUTPUTS_SCHEMA,
    ),
)

auto_ai_critique_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_ai_critique:v0",
    schemas=dict(  # type: ignore
        parameters=obj(
            title="AI Critique Parameters",
            properties={
                "prompt_template": ag_field(
                    base=LLM_MESSAGES_ARRAY, x_ag_type="messages"
                ),
                "correct_answer_key": ag_field(
                    base=scalar(jtype="string", default="correct_answer"),
                    x_ag_type="text",
                    x_ag_ui_advanced=True,
                ),
                "model": MODEL_FIELD,
                "response_type": ag_field(
                    base=scalar(jtype="string", default="json_schema"),
                    x_ag_type="hidden",
                    x_ag_ui_advanced=True,
                ),
                "json_schema": ag_field(
                    base=obj(
                        title="Feedback Configuration",
                        properties={
                            "name": scalar(jtype="string", default="schema"),
                            "schema": obj(additional_properties=True),
                            "strict": scalar(jtype=["boolean", "null"], default=True),
                        },
                        additional_properties=False,
                    ),
                    x_ag_type="llm_response_schema",
                ),
                "version": ag_field(
                    base=scalar(jtype="string", default="4"),
                    x_ag_type="hidden",
                ),
            },
            required=["prompt_template"],
            additional_properties=False,
            defs={"message": MESSAGE_SCHEMA},
        ),
        inputs=GENERIC_EVALUATOR_INPUTS_SCHEMA,
        outputs={
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "title": "AI Critique Outputs",
            "description": "Output schema derived from the configured judge response schema.",
            "properties": {
                "score": {
                    "type": "boolean",
                    "title": "Score",
                    "description": "Default score field from the configured response schema.",
                },
            },
            "required": ["score"],
            "additionalProperties": False,
            "x-ag-type-ref": {
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
        },
    ),
)

auto_starts_with_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_starts_with:v0",
    schemas=dict(  # type: ignore  # type: ignore
        parameters=obj(
            title="Starts With Parameters",
            properties={
                "prefix": ag_field(base=scalar(jtype="string"), x_ag_type="text"),
                "case_sensitive": ag_field(
                    base=scalar(jtype="boolean", default=True), x_ag_type="bool"
                ),
            },
            required=["prefix"],
            additional_properties=False,
        ),
        inputs=obj(title="Starts With Inputs", additional_properties=True),
        outputs=SUCCESS_ONLY_OUTPUTS_SCHEMA,
    ),
)

auto_ends_with_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_ends_with:v0",
    schemas=dict(  # type: ignore
        parameters=obj(
            title="Ends With Parameters",
            properties={
                "case_sensitive": ag_field(
                    base=scalar(jtype="boolean", default=True), x_ag_type="bool"
                ),
                "suffix": ag_field(base=scalar(jtype="string"), x_ag_type="text"),
            },
            required=["suffix"],
            additional_properties=False,
        ),
        inputs=obj(title="Ends With Inputs", additional_properties=True),
        outputs=SUCCESS_ONLY_OUTPUTS_SCHEMA,
    ),
)

auto_contains_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_contains:v0",
    schemas=dict(  # type: ignore
        parameters=obj(
            title="Contains Parameters",
            properties={
                "case_sensitive": ag_field(
                    base=scalar(jtype="boolean", default=True), x_ag_type="bool"
                ),
                "substring": ag_field(base=scalar(jtype="string"), x_ag_type="text"),
            },
            required=["substring"],
            additional_properties=False,
        ),
        inputs=obj(title="Contains Inputs", additional_properties=True),
        outputs=SUCCESS_ONLY_OUTPUTS_SCHEMA,
    ),
)

auto_contains_any_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_contains_any:v0",
    schemas=dict(  # type: ignore
        parameters=obj(
            title="Contains Any Parameters",
            properties={
                "case_sensitive": ag_field(
                    base=scalar(jtype="boolean", default=True), x_ag_type="bool"
                ),
                "substrings": ag_field(base=scalar(jtype="string"), x_ag_type="text"),
            },
            required=["substrings"],
            additional_properties=False,
        ),
        inputs=obj(title="Contains Any Inputs", additional_properties=True),
        outputs=SUCCESS_ONLY_OUTPUTS_SCHEMA,
    ),
)

auto_contains_all_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_contains_all:v0",
    schemas=dict(  # type: ignore
        parameters=obj(
            title="Contains All Parameters",
            properties={
                "case_sensitive": ag_field(
                    base=scalar(jtype="boolean", default=True), x_ag_type="bool"
                ),
                "substrings": ag_field(base=scalar(jtype="string"), x_ag_type="text"),
            },
            required=["substrings"],
            additional_properties=False,
        ),
        inputs=obj(title="Contains All Inputs", additional_properties=True),
        outputs=SUCCESS_ONLY_OUTPUTS_SCHEMA,
    ),
)

auto_contains_json_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_contains_json:v0",
    schemas=dict(  # type: ignore
        parameters=obj(title="Contains JSON Parameters", additional_properties=False),
        inputs=obj(title="Contains JSON Inputs", additional_properties=True),
        outputs=SUCCESS_ONLY_OUTPUTS_SCHEMA,
    ),
)

auto_json_diff_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_json_diff:v0",
    schemas=dict(  # type: ignore
        parameters=obj(
            title="JSON Diff Parameters",
            properties={
                "compare_schema_only": ag_field(
                    base=scalar(jtype="boolean", default=False),
                    x_ag_type="bool",
                    x_ag_ui_advanced=True,
                ),
                "predict_keys": ag_field(
                    base=scalar(jtype="boolean", default=False),
                    x_ag_type="bool",
                    x_ag_ui_advanced=True,
                ),
                "case_insensitive_keys": ag_field(
                    base=scalar(jtype="boolean", default=False),
                    x_ag_type="bool",
                    x_ag_ui_advanced=True,
                ),
                "correct_answer_key": ag_field(
                    base=scalar(jtype="string", default="correct_answer"),
                    x_ag_type="text",
                    x_ag_ui_advanced=True,
                ),
            },
            additional_properties=False,
        ),
        inputs=GENERIC_EVALUATOR_INPUTS_SCHEMA,
        outputs=SCORE_SUCCESS_OUTPUTS_SCHEMA,
    ),
)

auto_levenshtein_distance_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_levenshtein_distance:v0",
    schemas=dict(  # type: ignore
        parameters=obj(
            title="Levenshtein Distance Parameters",
            properties={
                "threshold": ag_field(base=scalar(jtype="number"), x_ag_type="float"),
                "correct_answer_key": ag_field(
                    base=scalar(jtype="string", default="correct_answer"),
                    x_ag_type="text",
                    x_ag_ui_advanced=True,
                ),
            },
            additional_properties=False,
        ),
        inputs=GENERIC_EVALUATOR_INPUTS_SCHEMA,
        outputs=SCORE_SUCCESS_OUTPUTS_SCHEMA,
    ),
)

auto_similarity_match_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_similarity_match:v0",
    schemas=dict(  # type: ignore
        parameters=obj(
            title="Similarity Match Parameters",
            properties={
                "similarity_threshold": ag_field(
                    base=scalar(jtype="number", default=0.5, minimum=0, maximum=1),
                    x_ag_type="float",
                ),
                "correct_answer_key": ag_field(
                    base=scalar(jtype="string", default="correct_answer"),
                    x_ag_type="text",
                    x_ag_ui_advanced=True,
                ),
            },
            required=["similarity_threshold"],
            additional_properties=False,
        ),
        inputs=GENERIC_EVALUATOR_INPUTS_SCHEMA,
        outputs=SCORE_SUCCESS_OUTPUTS_SCHEMA,
    ),
)

auto_semantic_similarity_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_semantic_similarity:v0",
    schemas=dict(  # type: ignore
        parameters=obj(
            title="Semantic Similarity Parameters",
            properties={
                "correct_answer_key": ag_field(
                    base=scalar(jtype="string", default="correct_answer"),
                    x_ag_type="text",
                    x_ag_ui_advanced=True,
                ),
            },
            required=["correct_answer_key"],
            additional_properties=False,
        ),
        inputs=GENERIC_EVALUATOR_INPUTS_SCHEMA,
        outputs=SCORE_SUCCESS_OUTPUTS_SCHEMA,
    ),
)
