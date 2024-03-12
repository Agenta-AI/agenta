import re
import json
import httpx
from typing import Any, Dict, Tuple

from agenta_backend.services.security import sandbox
from agenta_backend.models.db_models import Error, Result

from langchain.llms import OpenAI
from langchain.chains import LLMChain
from langchain.prompts import PromptTemplate
import logging

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


def auto_exact_match(
    inputs: Dict[str, Any],
    output: str,
    correct_answer: str,
    app_params: Dict[str, Any],
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],
) -> Result:
    try:
        exact_match = True if output == correct_answer else False
        result = Result(type="bool", value=exact_match)
        return result
    except Exception as e:
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error during Auto Exact Match evaluation", stacktrace=str(e)
            ),
        )


def auto_similarity_match(
    inputs: Dict[str, Any],
    output: str,
    correct_answer: str,
    app_params: Dict[str, Any],
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],
) -> Result:
    try:
        set1 = set(output.split())
        set2 = set(correct_answer.split())
        intersect = set1.intersection(set2)
        union = set1.union(set2)

        similarity = len(intersect) / len(union)

        is_similar = (
            True if similarity > settings_values["similarity_threshold"] else False
        )
        result = Result(type="bool", value=is_similar)
        return result
    except Exception as e:
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error during Auto Similarity Match evaluation",
                stacktrace=str(e),
            ),
        )


def auto_regex_test(
    inputs: Dict[str, Any],
    output: str,
    correct_answer: str,
    app_params: Dict[str, Any],
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],
) -> Result:
    try:
        re_pattern = re.compile(settings_values["regex_pattern"], re.IGNORECASE)
        result = (
            bool(re_pattern.search(output)) == settings_values["regex_should_match"]
        )
        return Result(type="bool", value=result)
    except Exception as e:
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error during Auto Regex evaluation", stacktrace=str(e)
            ),
        )


def field_match_test(
    inputs: Dict[str, Any],
    output: str,
    correct_answer: str,
    app_params: Dict[str, Any],
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],
) -> Result:
    try:
        output_json = json.loads(output)
        result = output_json[settings_values["json_field"]] == correct_answer
        return Result(type="bool", value=result)
    except Exception as e:
        logging.debug("Field Match Test Failed because of Error: " + str(e))
        return Result(type="bool", value=False)


def auto_webhook_test(
    inputs: Dict[str, Any],
    output: str,
    correct_answer: str,
    app_params: Dict[str, Any],
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],
) -> Result:
    try:
        with httpx.Client() as client:
            payload = {
                "correct_answer": correct_answer,
                "output": output,
                "inputs": inputs,
            }
            response = client.post(url=settings_values["webhook_url"], json=payload)
            response.raise_for_status()
            response_data = response.json()
            score = response_data.get("score", None)
            if score is None and not isinstance(score, (int, float)):
                return Result(
                    type="error",
                    value=None,
                    error=Error(
                        message="Error during Auto Webhook evaluation; Webhook did not return a score",
                    ),
                )
            if score < 0 or score > 1:
                return Result(
                    type="error",
                    value=None,
                    error=Error(
                        message="Error during Auto Webhook evaluation; Webhook returned an invalid score. Score must be between 0 and 1",
                    ),
                )
            return Result(type="number", value=score)
    except httpx.HTTPError as e:
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error during Auto Webhook evaluation; An HTTP error occurred",
                stacktrace=str(e),
            ),
        )
    except Exception as e:
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error during Auto Webhook evaluation", stacktrace=str(e)
            ),
        )


def auto_custom_code_run(
    inputs: Dict[str, Any],
    output: str,
    correct_answer: str,
    app_params: Dict[str, Any],
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],
) -> Result:
    try:
        result = sandbox.execute_code_safely(
            app_params=app_params,
            inputs=inputs,
            output=output,
            correct_answer=correct_answer,
            code=settings_values["code"],
        )
        return Result(type="number", value=result)
    except Exception as e:
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error during Auto Custom Code Evaluation", stacktrace=str(e)
            ),
        )


def auto_ai_critique(
    inputs: Dict[str, Any],
    output: str,
    correct_answer: str,
    app_params: Dict[str, Any],
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],
) -> str:
    """
    Evaluate a response using an AI critique based on provided inputs, output, correct answer, app parameters, and settings.

    Args:
        inputs (Dict[str, Any]): Input parameters for the LLM app variant.
        output (str): The output of the LLM app variant.
        correct_answer (str): Correct answer for evaluation.
        app_params (Dict[str, Any]): Application parameters.
        settings_values (Dict[str, Any]): Settings for the evaluation.
        lm_providers_keys (Dict[str, Any]): Keys for language model providers.

    Returns:
        str: Evaluation result.
    """
    try:
        llm = OpenAI(
            openai_api_key=lm_providers_keys["OPENAI_API_KEY"],
            temperature=0.8,
            model="gpt-3.5-turbo-instruct",
        )

        chain_run_args = {
            "llm_app_prompt_template": app_params.get("prompt_user", ""),
            "variant_output": output,
            "correct_answer": correct_answer,
        }

        for key, value in inputs.items():
            chain_run_args[key] = value

        prompt = PromptTemplate(
            input_variables=list(
                chain_run_args.keys()
            ),  # Use the keys from chain_run_args
            template=settings_values["prompt_template"],
        )
        chain = LLMChain(llm=llm, prompt=prompt)

        evaluation_output = chain.run(**chain_run_args)

        return Result(type="text", value=evaluation_output.strip())
    except Exception as e:
        return Result(
            type="error",
            value=None,
            error=Error(message="Error during Auto AI Critique", stacktrace=str(e)),
        )


def auto_starts_with(
    inputs: Dict[str, Any],
    output: str,
    correct_answer: str,
    app_params: Dict[str, Any],
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],
) -> Result:
    try:
        prefix = settings_values.get("prefix", "")
        case_sensitive = settings_values.get("case_sensitive", True)

        if not case_sensitive:
            output = output.lower()
            prefix = prefix.lower()

        result = Result(type="bool", value=output.startswith(prefix))
        return result
    except Exception as e:
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error during Starts With evaluation", stacktrace=str(e)
            ),
        )


def auto_ends_with(
    inputs: Dict[str, Any],
    output: str,
    correct_answer: str,
    app_params: Dict[str, Any],
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],
) -> Result:
    try:
        suffix = settings_values.get("suffix", "")
        case_sensitive = settings_values.get("case_sensitive", True)

        if not case_sensitive:
            output = output.lower()
            suffix = suffix.lower()

        result = Result(type="bool", value=output.endswith(suffix))
        return result
    except Exception as e:
        return Result(
            type="error",
            value=None,
            error=Error(message="Error during Ends With evaluation", stacktrace=str(e)),
        )


def auto_contains(
    inputs: Dict[str, Any],
    output: str,
    correct_answer: str,
    app_params: Dict[str, Any],
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],
) -> Result:
    try:
        substring = settings_values.get("substring", "")
        case_sensitive = settings_values.get("case_sensitive", True)

        if not case_sensitive:
            output = output.lower()
            substring = substring.lower()

        result = Result(type="bool", value=substring in output)
        return result
    except Exception as e:
        return Result(
            type="error",
            value=None,
            error=Error(message="Error during Contains evaluation", stacktrace=str(e)),
        )


def auto_contains_any(
    inputs: Dict[str, Any],
    output: str,
    correct_answer: str,
    app_params: Dict[str, Any],
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],
) -> Result:
    try:
        substrings_str = settings_values.get("substrings", "")
        substrings = [substring.strip() for substring in substrings_str.split(",")]
        case_sensitive = settings_values.get("case_sensitive", True)

        if not case_sensitive:
            output = output.lower()
            substrings = [substring.lower() for substring in substrings]

        result = Result(
            type="bool", value=any(substring in output for substring in substrings)
        )
        return result
    except Exception as e:
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error during Contains Any evaluation", stacktrace=str(e)
            ),
        )


def auto_contains_all(
    inputs: Dict[str, Any],
    output: str,
    correct_answer: str,
    app_params: Dict[str, Any],
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],
) -> Result:
    try:
        substrings_str = settings_values.get("substrings", "")
        substrings = [substring.strip() for substring in substrings_str.split(",")]
        case_sensitive = settings_values.get("case_sensitive", True)

        if not case_sensitive:
            output = output.lower()
            substrings = [substring.lower() for substring in substrings]

        result = Result(
            type="bool", value=all(substring in output for substring in substrings)
        )
        return result
    except Exception as e:
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error during Contains All evaluation", stacktrace=str(e)
            ),
        )


def auto_contains_json(
    inputs: Dict[str, Any],
    output: str,
    correct_answer: str,
    app_params: Dict[str, Any],
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],
) -> Result:
    try:
        try:
            start_index = output.index("{")
            end_index = output.rindex("}") + 1
            potential_json = output[start_index:end_index]

            json.loads(potential_json)
            contains_json = True
        except (ValueError, json.JSONDecodeError):
            contains_json = False

        return Result(type="bool", value=contains_json)
    except Exception as e:
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error during Contains JSON evaluation", stacktrace=str(e)
            ),
        )


def levenshtein_distance(s1, s2):
    if len(s1) < len(s2):
        return levenshtein_distance(s2, s1)

    if len(s2) == 0:
        return len(s1)

    previous_row = range(len(s2) + 1)
    for i, c1 in enumerate(s1):
        current_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (c1 != c2)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row

    return previous_row[-1]


def auto_levenshtein_distance(
    inputs: Dict[str, Any],
    output: str,
    correct_answer: str,
    app_params: Dict[str, Any],
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],
) -> Result:
    try:
        threshold = settings_values.get("threshold", 10)
        distance = levenshtein_distance(output, correct_answer)
        print("threshold", threshold)
        print("distance", distance)

        result = Result(type="bool", value=distance <= threshold)
        return result
    except Exception as e:
        return Result(
            type="error",
            value=None,
            error=Error(
                message="Error during Levenshtein threshold evaluation",
                stacktrace=str(e),
            ),
        )


def evaluate(
    evaluator_key: str,
    inputs: Dict[str, Any],
    output: str,
    correct_answer: str,
    app_params: Dict[str, Any],
    settings_values: Dict[str, Any],
    lm_providers_keys: Dict[str, Any],
) -> Result:
    evaluation_function = globals().get(evaluator_key, None)
    if not evaluation_function:
        raise ValueError(f"Evaluation method '{evaluator_key}' not found.")
    try:
        return evaluation_function(
            inputs,
            output,
            correct_answer,
            app_params,
            settings_values,
            lm_providers_keys,
        )
    except Exception as exc:
        raise RuntimeError(
            f"Error occurred while running {evaluator_key} evaluation. Exception: {str(exc)}"
        )
