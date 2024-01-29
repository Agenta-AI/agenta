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
    },
    {
        "name": "Regex Test",
        "key": "auto_regex_test",
        "direct_use": False,
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
