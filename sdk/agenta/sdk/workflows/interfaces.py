from agenta.sdk.models.workflows import WorkflowServiceInterface

echo_v0_interface = WorkflowServiceInterface(
    uri="agenta:built-in:echo:v0",
    schemas=dict(  # type: ignore
        parameters={
            "type": "object",
            "title": "Echo Parameters",
            "description": "No configuration parameters required.",
            "additionalProperties": False,
        },
        inputs={
            "type": "object",
            "title": "Echo Input",
            "description": "Arbitrary input to be echoed back.",
        },
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
    uri="agenta:built-in:auto_exact_match:v0",
    schemas=dict(  # type: ignore
        parameters={
            "type": "object",
            "title": "Exact Match Parameters",
            "description": "Configuration for the Exact Match evaluator.",
            "properties": {
                "correct_answer_key": {
                    "type": "string",
                    "title": "Expected Answer Column",
                    "description": "The name of the column in the test data that contains the correct answer.",
                    "default": "correct_answer",
                }
            },
            "required": ["correct_answer_key"],
            "additionalProperties": False,
        },
        inputs={
            "type": "object",
            "title": "Exact Match Inputs",
            "description": "Testcase data including the correct answer.",
        },
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
    uri="agenta:built-in:auto_regex_test:v0",
    schemas=dict(  # type: ignore
        parameters={
            "type": "object",
            "title": "Regex Test Parameters",
            "description": "Settings for evaluating whether output matches a regex pattern.",
            "properties": {
                "regex_pattern": {
                    "type": "string",
                    "title": "Regex Pattern",
                    "description": "Pattern for regex testing (e.g., ^this_word\\d{3}$).",
                    "default": "",
                },
                "regex_should_match": {
                    "type": "boolean",
                    "title": "Match or Mismatch",
                    "description": "If True, regex must match; if False, regex must not match.",
                    "default": True,
                },
                "case_sensitive": {
                    "type": "boolean",
                    "title": "Case Sensitive",
                    "description": "If True, regex matching is case-sensitive.",
                    "default": True,
                },
            },
            "required": ["regex_pattern"],
            "additionalProperties": False,
        },
        inputs={
            "type": "object",
            "title": "Regex Test Inputs",
            "description": "Output from the workflow execution to be tested against the regex.",
        },
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
    uri="agenta:built-in:field_match_test:v0",
    schemas=dict(  # type: ignore
        parameters={
            "type": "object",
            "title": "Field Match Parameters",
            "description": "Settings for comparing a specific JSON field against the expected answer.",
            "properties": {
                "json_field": {
                    "type": "string",
                    "title": "JSON Field",
                    "description": "The field in the JSON output to evaluate.",
                    "default": "",
                },
                "correct_answer_key": {
                    "type": "string",
                    "title": "Expected Answer Column",
                    "description": "Column in test data containing the correct answer.",
                    "default": "correct_answer",
                },
            },
            "required": ["json_field", "correct_answer_key"],
            "additionalProperties": False,
        },
        inputs={
            "type": "object",
            "title": "Field Match Inputs",
            "description": "Testcase data including the correct answer.",
        },
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

auto_webhook_test_v0_interface = WorkflowServiceInterface(
    uri="agenta:built-in:auto_webhook_test:v0",
    schemas=dict(  # type: ignore
        parameters={
            "type": "object",
            "title": "Webhook Test Parameters",
            "description": "Settings for sending evaluation requests to a webhook service.",
            "properties": {
                "webhook_url": {
                    "type": "string",
                    "format": "uri",
                    "title": "Webhook URL",
                    "description": "The endpoint that will receive the evaluation payload.",
                },
                "correct_answer_key": {
                    "type": "string",
                    "title": "Expected Answer Column",
                    "description": "Column in test data containing the correct answer.",
                    "default": "correct_answer",
                },
                "threshold": {
                    "type": "number",
                    "title": "Threshold",
                    "description": "Score threshold to determine success.",
                    "minimum": 0,
                    "maximum": 1,
                    "default": 0.5,
                },
            },
            "required": ["webhook_url"],
            "additionalProperties": False,
        },
        inputs={
            "type": "object",
            "title": "Webhook Test Inputs",
            "description": "Payload including inputs, output, and correct answer sent to the webhook.",
        },
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
    uri="agenta:built-in:auto_custom_code_run:v0",
    schemas=dict(  # type: ignore
        parameters={
            "type": "object",
            "title": "Custom Code Evaluation Parameters",
            "description": "Settings for running custom Python code to evaluate workflow outputs.",
            "properties": {
                "code": {
                    "type": "string",
                    "title": "Evaluation Code",
                    "description": "Python code snippet that will be executed to evaluate the output.",
                    "default": (
                        "from typing import Dict, Union, Any\n\n"
                        "def evaluate(\n"
                        "    app_params: Dict[str, str],\n"
                        "    inputs: Dict[str, str],\n"
                        "    output: Union[str, Dict[str, Any]],\n"
                        "    correct_answer: str\n"
                        ") -> float:\n"
                        "    if output in correct_answer:\n"
                        "        return 1.0\n"
                        "    return 0.0\n"
                    ),
                },
                "correct_answer_key": {
                    "type": "string",
                    "title": "Expected Answer Column",
                    "description": "Column in the test data containing the correct answer.",
                    "default": "correct_answer",
                },
                "threshold": {
                    "type": "number",
                    "title": "Threshold",
                    "description": "Score threshold used to determine success.",
                    "minimum": 0,
                    "maximum": 1,
                    "default": 0.5,
                },
            },
            "required": ["code"],
            "additionalProperties": False,
        },
        inputs={
            "type": "object",
            "title": "Custom Code Evaluation Inputs",
            "description": "Testcase data and workflow outputs available to the custom code.",
        },
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
    uri="agenta:built-in:auto_ai_critique:v0",
    schemas=dict(  # type: ignore
        parameters={
            "type": "object",
            "title": "LLM-as-a-Judge Parameters",
            "description": "Configuration for using an AI model to critique workflow outputs.",
            "properties": {
                "prompt_template": {
                    "type": "array",
                    "title": "Prompt Template",
                    "description": "Template messages used by the LLM to evaluate outputs.",
                    "items": {"type": "object"},
                },
                "correct_answer_key": {
                    "type": "string",
                    "title": "Expected Answer Column",
                    "description": "Column in test data containing the correct answer.",
                    "default": "correct_answer",
                },
                "model": {
                    "type": "string",
                    "title": "Model",
                    "description": "The LLM model to use for evaluation.",
                    "default": "gpt-3.5-turbo",
                },
                "threshold": {
                    "type": "number",
                    "title": "Threshold",
                    "description": "Score threshold to determine success.",
                    "minimum": 0,
                    "maximum": 1,
                    "default": 0.5,
                },
                "version": {
                    "type": "string",
                    "title": "Evaluator Version",
                    "description": "Internal evaluator version identifier.",
                    "default": "3",
                },
            },
            "required": ["prompt_template"],
            "additionalProperties": False,
        },
        inputs={
            "type": "object",
            "title": "AI Critique Inputs",
            "description": "Testcase data and workflow outputs provided to the LLM judge.",
        },
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
    uri="agenta:built-in:auto_starts_with:v0",
    schemas=dict(  # type: ignore  # type: ignore
        parameters={
            "type": "object",
            "title": "Starts With Parameters",
            "description": "Configuration for checking if output starts with a specific prefix.",
            "properties": {
                "prefix": {
                    "type": "string",
                    "title": "Prefix",
                    "description": "The string to match at the start of the output.",
                },
                "case_sensitive": {
                    "type": "boolean",
                    "title": "Case Sensitive",
                    "description": "If True, matching is case-sensitive.",
                    "default": True,
                },
            },
            "required": ["prefix"],
            "additionalProperties": False,
        },
        inputs={
            "type": "object",
            "title": "Starts With Inputs",
            "description": "Workflow output to be checked against the prefix.",
        },
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
    uri="agenta:built-in:auto_ends_with:v0",
    schemas=dict(  # type: ignore
        parameters={
            "type": "object",
            "title": "Ends With Parameters",
            "description": "Configuration for checking if output ends with a specific suffix.",
            "properties": {
                "suffix": {
                    "type": "string",
                    "title": "Suffix",
                    "description": "The string to match at the end of the output.",
                },
                "case_sensitive": {
                    "type": "boolean",
                    "title": "Case Sensitive",
                    "description": "If True, matching is case-sensitive.",
                    "default": True,
                },
            },
            "required": ["suffix"],
            "additionalProperties": False,
        },
        inputs={
            "type": "object",
            "title": "Ends With Inputs",
            "description": "Workflow output to be checked against the suffix.",
        },
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
    uri="agenta:built-in:auto_contains:v0",
    schemas=dict(  # type: ignore
        parameters={
            "type": "object",
            "title": "Contains Parameters",
            "description": "Configuration for checking if output contains a given substring.",
            "properties": {
                "substring": {
                    "type": "string",
                    "title": "Substring",
                    "description": "The string to check for in the output.",
                },
                "case_sensitive": {
                    "type": "boolean",
                    "title": "Case Sensitive",
                    "description": "If True, substring search is case-sensitive.",
                    "default": True,
                },
            },
            "required": ["substring"],
            "additionalProperties": False,
        },
        inputs={
            "type": "object",
            "title": "Contains Inputs",
            "description": "Workflow output to be checked for substring presence.",
        },
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
    uri="agenta:built-in:auto_contains_any:v0",
    schemas=dict(  # type: ignore
        parameters={
            "type": "object",
            "title": "Contains Any Parameters",
            "description": "Configuration for checking if output contains any of the specified substrings.",
            "properties": {
                "substrings": {
                    "type": "array",
                    "title": "Substrings",
                    "description": "List of substrings to check for. The evaluation passes if any substring is found.",
                    "items": {"type": "string"},
                },
                "case_sensitive": {
                    "type": "boolean",
                    "title": "Case Sensitive",
                    "description": "If True, substring checks are case-sensitive.",
                    "default": True,
                },
            },
            "required": ["substrings"],
            "additionalProperties": False,
        },
        inputs={
            "type": "object",
            "title": "Contains Any Inputs",
            "description": "Workflow output to be checked for substrings.",
        },
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
    uri="agenta:built-in:auto_contains_all:v0",
    schemas=dict(  # type: ignore
        parameters={
            "type": "object",
            "title": "Contains All Parameters",
            "description": "Configuration for checking if output contains all of the specified substrings.",
            "properties": {
                "substrings": {
                    "type": "array",
                    "title": "Substrings",
                    "description": "List of substrings to check for. The evaluation passes only if all substrings are found.",
                    "items": {"type": "string"},
                },
                "case_sensitive": {
                    "type": "boolean",
                    "title": "Case Sensitive",
                    "description": "If True, substring checks are case-sensitive.",
                    "default": True,
                },
            },
            "required": ["substrings"],
            "additionalProperties": False,
        },
        inputs={
            "type": "object",
            "title": "Contains All Inputs",
            "description": "Workflow output to be checked for substrings.",
        },
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
    uri="agenta:built-in:auto_contains_json:v0",
    schemas=dict(  # type: ignore
        parameters={
            "type": "object",
            "title": "Contains JSON Parameters",
            "description": "No configuration parameters required.",
            "additionalProperties": False,
        },
        inputs={
            "type": "object",
            "title": "Contains JSON Inputs",
            "description": "Workflow output to be checked for valid JSON content.",
        },
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
    uri="agenta:built-in:auto_json_diff:v0",
    schemas=dict(  # type: ignore
        parameters={
            "type": "object",
            "title": "JSON Diff Parameters",
            "description": "Settings for comparing predicted JSON output against ground truth JSON.",
            "properties": {
                "correct_answer_key": {
                    "type": "string",
                    "title": "Expected Answer Column",
                    "description": "Column in test data containing the correct JSON answer.",
                    "default": "correct_answer",
                },
                "compare_schema_only": {
                    "type": "boolean",
                    "title": "Compare Schema Only",
                    "description": "If True, only keys and their types are compared; values are ignored.",
                    "default": False,
                },
                "predict_keys": {
                    "type": "boolean",
                    "title": "Include Prediction Keys",
                    "description": "If True, prediction keys not present in ground truth are ignored.",
                    "default": False,
                },
                "case_insensitive_keys": {
                    "type": "boolean",
                    "title": "Case-Insensitive Keys",
                    "description": "If True, key comparisons are case-insensitive.",
                    "default": False,
                },
                "threshold": {
                    "type": "number",
                    "title": "Threshold",
                    "description": "Minimum similarity score required for success.",
                    "minimum": 0,
                    "maximum": 1,
                    "default": 0.5,
                },
            },
            "additionalProperties": False,
        },
        inputs={
            "type": "object",
            "title": "JSON Diff Inputs",
            "description": "Workflow output and ground truth JSON to compare.",
        },
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
    uri="agenta:built-in:auto_levenshtein_distance:v0",
    schemas=dict(  # type: ignore
        parameters={
            "type": "object",
            "title": "Levenshtein Distance Parameters",
            "description": "Settings for computing normalized Levenshtein similarity between outputs and ground truth.",
            "properties": {
                "correct_answer_key": {
                    "type": "string",
                    "title": "Expected Answer Column",
                    "description": "Column in test data containing the correct answer.",
                    "default": "correct_answer",
                },
                "threshold": {
                    "type": "number",
                    "title": "Threshold",
                    "description": "Minimum similarity score required for success.",
                    "minimum": 0,
                    "maximum": 1,
                    "default": 0.5,
                },
                "case_sensitive": {
                    "type": "boolean",
                    "title": "Case Sensitive",
                    "description": "If True, comparison is case-sensitive.",
                    "default": True,
                },
            },
            "additionalProperties": False,
        },
        inputs={
            "type": "object",
            "title": "Levenshtein Inputs",
            "description": "Workflow output and ground truth string to compare.",
        },
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
    uri="agenta:built-in:auto_similarity_match:v0",
    schemas=dict(  # type: ignore
        parameters={
            "type": "object",
            "title": "Similarity Match Parameters",
            "description": "Settings for comparing predicted output against ground truth using string similarity.",
            "properties": {
                "correct_answer_key": {
                    "type": "string",
                    "title": "Expected Answer Column",
                    "description": "Column in test data containing the correct answer.",
                    "default": "correct_answer",
                },
                "threshold": {
                    "type": "number",
                    "title": "Threshold",
                    "description": "Minimum similarity score required for success.",
                    "minimum": 0,
                    "maximum": 1,
                    "default": 0.5,
                },
                "similarity_threshold": {
                    "type": "number",
                    "title": "Similarity Threshold (Alias)",
                    "description": "Alternative field for threshold, retained for compatibility.",
                    "minimum": 0,
                    "maximum": 1,
                },
                "case_sensitive": {
                    "type": "boolean",
                    "title": "Case Sensitive",
                    "description": "If True, similarity comparison is case-sensitive.",
                    "default": True,
                },
            },
            "additionalProperties": False,
        },
        inputs={
            "type": "object",
            "title": "Similarity Match Inputs",
            "description": "Workflow output and ground truth string to compare.",
        },
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
    uri="agenta:built-in:auto_semantic_similarity:v0",
    schemas=dict(  # type: ignore
        parameters={
            "type": "object",
            "title": "Semantic Similarity Parameters",
            "description": "Settings for semantic similarity using embeddings.",
            "properties": {
                "correct_answer_key": {
                    "type": "string",
                    "title": "Expected Answer Column",
                    "description": "Column in test data containing the correct answer.",
                    "default": "correct_answer",
                },
                "embedding_model": {
                    "type": "string",
                    "title": "Embedding Model",
                    "description": "The model used to generate embeddings.",
                    "default": "text-embedding-3-small",
                },
                "threshold": {
                    "type": "number",
                    "title": "Threshold",
                    "description": "Minimum semantic similarity score required for success.",
                    "minimum": 0,
                    "maximum": 1,
                    "default": 0.5,
                },
            },
            "additionalProperties": False,
        },
        inputs={
            "type": "object",
            "title": "Semantic Similarity Inputs",
            "description": "Workflow output and ground truth string to embed and compare.",
        },
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

completion_v0_interface = WorkflowServiceInterface(
    uri="agenta:built-in:completion:v0",
    schemas=dict(  # type: ignore
        parameters={
            "type": "object",
            "title": "Completion App Parameters",
            "description": "Configuration for running a completion workflow.",
            "properties": {
                "prompt": {
                    "type": "object",
                    "title": "Prompt Template",
                    "description": "Prompt template configuration including system and user prompts.",
                }
            },
            "required": ["prompt"],
            "additionalProperties": False,
        },
        inputs={
            "type": "object",
            "title": "Completion App Inputs",
            "description": "Inputs required by the completion workflow, matching the prompt template’s input keys.",
        },
        outputs={
            "type": ["string", "object", "array"],
            "title": "Completion App Outputs",
            "description": "Generated response, which may be text or structured data.",
        },
    ),
)

chat_v0_interface = WorkflowServiceInterface(
    uri="agenta:built-in:chat:v0",
    schemas=dict(  # type: ignore
        parameters={
            "type": "object",
            "title": "Chat App Parameters",
            "description": "Configuration for running a chat-based workflow.",
            "properties": {
                "prompt": {
                    "type": "object",
                    "title": "Prompt Template",
                    "description": "Prompt template configuration for initializing the chat.",
                }
            },
            "required": ["prompt"],
            "additionalProperties": False,
        },
        inputs={
            "type": "object",
            "title": "Chat App Inputs",
            "description": "Optional inputs provided to format the prompt.",
        },
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
