from agenta.sdk.models.workflows import WorkflowServiceInterface


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

match_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:match:v0",
    schemas=dict(  # type: ignore
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
        }
    ),
)

prompt_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:prompt:v0",
    schemas=dict(  # type: ignore
        outputs={
            "type": "object",
            "title": "Prompt Evaluator Outputs",
            "description": "Result returned by the LLM-based prompt evaluator.",
            "properties": {
                "score": {
                    "type": "number",
                    "title": "Score",
                    "description": "Numeric evaluation score assigned by the LLM.",
                },
                "success": {
                    "type": "boolean",
                    "title": "Success",
                    "description": "True if score meets or exceeds the threshold, or LLM returned True.",
                },
                "message": {
                    "type": "string",
                    "title": "Message",
                    "description": "Raw LLM text output when not a number or boolean.",
                },
            },
            "additionalProperties": True,
        },
    ),
)

agent_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:agent:v0",
    schemas=None,
)

# --- OLD URI

chat_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:chat:v0",
    schemas=dict(  # type: ignore
        outputs={
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
        outputs={
            "type": ["string", "object", "array"],
            "title": "Completion App Outputs",
            "description": "Generated response, which may be text or structured data.",
        },
    ),
)


echo_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:echo:v0",
    schemas=dict(  # type: ignore
        outputs={
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
        outputs={
            "type": "object",
            "title": "Exact Match Outputs",
            "description": "Result indicating whether the output exactly matched the expected answer.",
            "properties": {
                "success": {
                    "type": "boolean",
                    "title": "Success",
                    "description": "True if the outputs exactly matched, False otherwise.",
                }
            },
            "required": ["success"],
            "additionalProperties": False,
        },
    ),
)

auto_regex_test_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_regex_test:v0",
    schemas=dict(  # type: ignore
        outputs={
            "type": "object",
            "title": "Regex Test Outputs",
            "description": "Result indicating whether regex matched as configured.",
            "properties": {
                "success": {
                    "type": "boolean",
                    "title": "Success",
                    "description": "True if regex condition passed, False otherwise.",
                }
            },
            "required": ["success"],
            "additionalProperties": False,
        },
    ),
)

field_match_test_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:field_match_test:v0",
    schemas=dict(  # type: ignore
        outputs={
            "type": "object",
            "title": "Field Match Outputs",
            "description": "Result indicating whether the selected field matched the expected answer.",
            "properties": {
                "success": {
                    "type": "boolean",
                    "title": "Success",
                    "description": "True if the JSON field matched the expected answer.",
                }
            },
            "required": ["success"],
            "additionalProperties": False,
        },
    ),
)

json_multi_field_match_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:json_multi_field_match:v0",
    schemas=dict(  # type: ignore
        outputs={
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
            "additionalProperties": True,  # Allows dynamic field outputs
        },
    ),
)

auto_webhook_test_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_webhook_test:v0",
    schemas=dict(  # type: ignore
        outputs={
            "type": "object",
            "title": "Webhook Test Outputs",
            "description": "Score and success flag returned by the webhook evaluation.",
            "properties": {
                "score": {
                    "type": "number",
                    "title": "Score",
                    "description": "Numeric evaluation score returned by the webhook.",
                },
                "success": {
                    "type": "boolean",
                    "title": "Success",
                    "description": "True if the score meets or exceeds the threshold.",
                },
            },
            "required": ["score", "success"],
            "additionalProperties": False,
        },
    ),
)

auto_custom_code_run_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_custom_code_run:v0",
    schemas=dict(  # type: ignore
        outputs={
            "type": "object",
            "title": "Custom Code Evaluation Outputs",
            "description": "Score and success flag returned by the custom evaluation code.",
            "properties": {
                "score": {
                    "type": "number",
                    "title": "Score",
                    "description": "Numeric score computed by the custom code.",
                },
                "success": {
                    "type": "boolean",
                    "title": "Success",
                    "description": "True if score meets or exceeds the threshold.",
                },
            },
            "required": ["score", "success"],
            "additionalProperties": False,
        },
    ),
)

auto_ai_critique_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_ai_critique:v0",
    schemas=dict(  # type: ignore
        outputs={
            "type": "object",
            "title": "AI Critique Outputs",
            "description": "Score and success flag returned by the AI critique evaluator.",
            "properties": {
                "score": {
                    "type": "number",
                    "title": "Score",
                    "description": "Numeric evaluation score assigned by the AI.",
                },
                "success": {
                    "type": "boolean",
                    "title": "Success",
                    "description": "True if the score meets or exceeds the threshold.",
                },
            },
            "required": ["score", "success"],
            "additionalProperties": False,
        },
    ),
)

auto_starts_with_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_starts_with:v0",
    schemas=dict(  # type: ignore  # type: ignore
        outputs={
            "type": "object",
            "title": "Starts With Outputs",
            "description": "Result of the prefix check.",
            "properties": {
                "success": {
                    "type": "boolean",
                    "title": "Success",
                    "description": "True if output starts with the given prefix.",
                }
            },
            "required": ["success"],
            "additionalProperties": False,
        },
    ),
)

auto_ends_with_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_ends_with:v0",
    schemas=dict(  # type: ignore
        outputs={
            "type": "object",
            "title": "Ends With Outputs",
            "description": "Result of the suffix check.",
            "properties": {
                "success": {
                    "type": "boolean",
                    "title": "Success",
                    "description": "True if output ends with the given suffix.",
                }
            },
            "required": ["success"],
            "additionalProperties": False,
        },
    ),
)

auto_contains_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_contains:v0",
    schemas=dict(  # type: ignore
        outputs={
            "type": "object",
            "title": "Contains Outputs",
            "description": "Result of the substring presence check.",
            "properties": {
                "success": {
                    "type": "boolean",
                    "title": "Success",
                    "description": "True if substring is found in the output.",
                }
            },
            "required": ["success"],
            "additionalProperties": False,
        },
    ),
)

auto_contains_any_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_contains_any:v0",
    schemas=dict(  # type: ignore
        outputs={
            "type": "object",
            "title": "Contains Any Outputs",
            "description": "Result of the 'contains any' substring check.",
            "properties": {
                "success": {
                    "type": "boolean",
                    "title": "Success",
                    "description": "True if any substring is found in the output.",
                }
            },
            "required": ["success"],
            "additionalProperties": False,
        },
    ),
)

auto_contains_all_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_contains_all:v0",
    schemas=dict(  # type: ignore
        outputs={
            "type": "object",
            "title": "Contains All Outputs",
            "description": "Result of the 'contains all' substring check.",
            "properties": {
                "success": {
                    "type": "boolean",
                    "title": "Success",
                    "description": "True if all substrings are found in the output.",
                }
            },
            "required": ["success"],
            "additionalProperties": False,
        },
    ),
)

auto_contains_json_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_contains_json:v0",
    schemas=dict(  # type: ignore
        outputs={
            "type": "object",
            "title": "Contains JSON Outputs",
            "description": "Result of the JSON validity check.",
            "properties": {
                "success": {
                    "type": "boolean",
                    "title": "Success",
                    "description": "True if valid JSON content was found in the output.",
                }
            },
            "required": ["success"],
            "additionalProperties": False,
        },
    ),
)

auto_json_diff_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_json_diff:v0",
    schemas=dict(  # type: ignore
        outputs={
            "type": "object",
            "title": "JSON Diff Outputs",
            "description": "Score and success flag for the JSON comparison.",
            "properties": {
                "score": {
                    "type": "number",
                    "title": "Score",
                    "description": "Similarity score between prediction and ground truth.",
                },
                "success": {
                    "type": "boolean",
                    "title": "Success",
                    "description": "True if score meets or exceeds the threshold.",
                },
            },
            "required": ["score", "success"],
            "additionalProperties": False,
        },
    ),
)

auto_levenshtein_distance_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_levenshtein_distance:v0",
    schemas=dict(  # type: ignore
        outputs={
            "type": "object",
            "title": "Levenshtein Outputs",
            "description": "Score and success flag for the Levenshtein similarity comparison.",
            "properties": {
                "score": {
                    "type": "number",
                    "title": "Score",
                    "description": "Normalized Levenshtein similarity score (0–1).",
                },
                "success": {
                    "type": "boolean",
                    "title": "Success",
                    "description": "True if score meets or exceeds the threshold.",
                },
            },
            "required": ["score", "success"],
            "additionalProperties": False,
        },
    ),
)

auto_similarity_match_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_similarity_match:v0",
    schemas=dict(  # type: ignore
        outputs={
            "type": "object",
            "title": "Similarity Match Outputs",
            "description": "Score and success flag for the similarity comparison.",
            "properties": {
                "score": {
                    "type": "number",
                    "title": "Score",
                    "description": "Similarity score (0–1).",
                },
                "success": {
                    "type": "boolean",
                    "title": "Success",
                    "description": "True if score meets or exceeds the threshold.",
                },
            },
            "required": ["score", "success"],
            "additionalProperties": False,
        },
    ),
)

auto_semantic_similarity_v0_interface = WorkflowServiceInterface(
    uri="agenta:builtin:auto_semantic_similarity:v0",
    schemas=dict(  # type: ignore
        outputs={
            "type": "object",
            "title": "Semantic Similarity Outputs",
            "description": "Score and success flag for the semantic similarity comparison.",
            "properties": {
                "score": {
                    "type": "number",
                    "title": "Score",
                    "description": "Cosine similarity score between output and ground truth embeddings.",
                },
                "success": {
                    "type": "boolean",
                    "title": "Success",
                    "description": "True if score meets or exceeds the threshold.",
                },
            },
            "required": ["score", "success"],
            "additionalProperties": False,
        },
    ),
)
