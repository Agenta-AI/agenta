evaluators = [
    {
        "name": "Exact Match",
        "key": "auto_exact_match",
        "direct_use": True,
        "settings_template": {
            "label": "Exact Match Settings",
            "description": "Settings for the Exact Match evaluator",
        },
    },
    {
        "name": "Similarity Match",
        "key": "auto_similarity_match",
        "direct_use": False,
        "settings_template": {
            "similarity_threshold": {
                "label": "Similarity Threshold",
                "type": "number",
                "default": 0.5,
                "description": "The threshold value for similarity comparison",
            }
        },
        "description": "Similarity Match evaluator checks if the generated answer is similar to the expected answer. You need to provide the similarity threshold. It uses the Jaccard similarity to compare the answers.",
    },
    {
        "name": "Regex Test",
        "key": "auto_regex_test",
        "direct_use": False,
        "description": "Regex Test evaluator checks if the generated answer matches a regular expression pattern. You need to provide the regex expression and specify whether an answer is correct if it matches or does not match the regex.",
        "settings_template": {
            "regex_pattern": {
                "label": "Regex Pattern",
                "type": "regex",
                "default": "",
                "description": "Pattern for regex testing (ex: ^this_word\\d{3}$)",
            },
            "regex_should_match": {
                "label": "Match/Mismatch",
                "type": "boolean",
                "default": True,
                "description": "If the regex should match or mismatch",
            },
        },
    },
    {
        "name": "JSON Field Match",
        "key": "field_match_test",
        "direct_use": False,
        "settings_template": {
            "json_field": {
                "label": "JSON Field",
                "type": "string",
                "default": "",
                "description": "The name of the field in the JSON output that you wish to evaluate",
            }
        },
        "description": "JSON Field Match evaluator compares specific fields within JSON (JavaScript Object Notation) data. This matching can involve finding similarities or correspondences between fields in different JSON objects.",
    },
    {
        "name": "AI Critique",
        "key": "auto_ai_critique",
        "direct_use": False,
        "settings_template": {
            "prompt_template": {
                "label": "Prompt Template",
                "type": "text",
                "default": "We have an LLM App that we want to evaluate its outputs. Based on the prompt and the parameters provided below evaluate the output based on the evaluation strategy below: Evaluation strategy: 0 to 10 0 is very bad and 10 is very good. Prompt: {llm_app_prompt_template} Inputs: country: {country} Correct Answer:{correct_answer} Evaluate this: {variant_output} Answer ONLY with one of the given grading or evaluation options.",
                "description": "Template for AI critique prompts",
            }
        },
        "description": "AI Critique evaluator sends the generated answer and the correct_answer to an LLM model and uses it to evaluate the correctness of the answer. You need to provide the evaluation prompt (or use the default prompt).",
    },
    {
        "name": "Code Evaluation",
        "key": "auto_custom_code_run",
        "direct_use": False,
        "settings_template": {
            "code": {
                "label": "Evaluation Code",
                "type": "code",
                "default": "from typing import Dict\n\ndef evaluate(\n    app_params: Dict[str, str],\n    inputs: Dict[str, str],\n    output: str,\n    correct_answer: str\n) -> float:\n    # ...\n    return 0.75  # Replace with your calculated score",
                "description": "Code for evaluating submissions",
            }
        },
        "description": "Code Evaluation allows you to write your own evaluator in Python. You need to provide the Python code for the evaluator.",
    },
    {
        "name": "Webhook test",
        "key": "auto_webhook_test",
        "direct_use": False,
        "settings_template": {
            "webhook_url": {
                "label": "Webhook URL",
                "type": "string",
                "default": "https://cloud.agenta.ai/api/evaluations/webhook_example_fake",
                "description": "URL for the webhook test",
            },
            "webhook_body": {
                "label": "Webhook Body",
                "type": "object",
                "default": "{}",
                "description": "Request body for webhook URL",
            },
        },
        "description": "Webhook test evaluator sends the generated answer and the correct_answer to a webhook and expects a response indicating the correctness of the answer. You need to provide the URL of the webhook.",
    },
    {
        "name": "A/B Test",
        "key": "human_a_b_testing",
        "direct_use": False,
        "settings_template": {
            "label": "A/B Testing Settings",
            "description": "Settings for A/B testing configurations",
        },
    },
    {
        "name": "Single Model Test",
        "key": "human_single_model_test",
        "direct_use": False,
        "settings_template": {
            "label": "Single Model Testing Settings",
            "description": "Settings for single model testing configurations",
        },
    },
]


def get_all_evaluators():
    """
    Returns a list of evaluators.

    Returns:
        List[dict]: A list of evaluator dictionaries.
    """
    return evaluators
