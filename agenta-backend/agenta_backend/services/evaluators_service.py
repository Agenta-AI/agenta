import re
import json
import httpx
from typing import Any, Dict, Tuple

from agenta_backend.services.security import sandbox
from agenta_backend.services.db_manager import Result

from langchain.llms import OpenAI
from langchain.chains import LLMChain
from langchain.prompts import PromptTemplate


def auto_exact_match(
    variant_output: str, correct_answer: str, settings_values: Dict[str, Any]
) -> Result:
    exact_match = True if variant_output == correct_answer else False
    result = Result(type="bool", value=exact_match)
    return result


def auto_similarity_match(
    variant_output: str, correct_answer: str, settings_values: Dict[str, Any]
) -> Result:
    set1 = set(variant_output.split())
    set2 = set(correct_answer.split())
    intersect = set1.intersection(set2)
    union = set1.union(set2)

    similarity = len(intersect) / len(union)

    is_similar = True if similarity > settings_values["similarity_threshold"] else False
    result = Result(type="bool", value=is_similar)
    return result


def auto_regex_test(
    variant_output: str, correct_answer: str, settings_values: Dict[str, Any]
) -> Result:
    re_pattern = re.compile(settings_values["regex_pattern"], re.IGNORECASE)
    result = (
        bool(re_pattern.search(variant_output)) == settings_values["regex_should_match"]
    )
    return Result(type="bool", value=result)


def auto_webhook_test(
    variant_output: str, correct_answer: str, settings_values: Dict[str, Any]
) -> Result:
    try:
        with httpx.Client() as client:
            webhook_body = settings_values.get("webhook_body", None)
            if isinstance(webhook_body, str):
                payload = json.loads(webhook_body)
            if not webhook_body:
                payload = {}
            if isinstance(webhook_body, dict):
                payload = webhook_body
            response = client.post(
                url=settings_values["webhook_url"], json=payload
            )
            response.raise_for_status()
            response_data = response.json()
            score = response_data.get("score", None)
            if not score:
                raise httpx.HTTPError("Webhook did not return a score")
            if score < 0 or score > 1:
                raise httpx.HTTPError(
                    "Webhook returned an invalid score. Score must be between 0 and 1"
                )
            return Result(type="number", value=score)
    except httpx.HTTPError as e:
        print(f"An HTTP error occurred: {e}")
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"An error occurred: {e}")


def auto_custom_code_run(
    variant_output: str,
    correct_answer: str,
    settings_values: Dict[str, Any],
    **kwargs: Dict[str, Any],
) -> Result:
    try:
        result = sandbox.execute_code_safely(
            app_params=kwargs["app_params"],
            inputs=kwargs["inputs"],
            output=variant_output,
            correct_answer=correct_answer,
            code=settings_values["code"],
        )
        return Result(type="number", value=result)
    except Exception as exc:
        raise exc


def auto_ai_critique(
    variant_output: str, correct_answer: str, settings_values: dict
) -> str:
    """Evaluate a response using an AI critique based on provided
     - An evaluation prompt,
     - An LLM App prompt,
     - An LLM App output,
     - a correct answer.

    Args:
        llm_app_prompt_template (str): the prompt template of the llm app variant
        llm_app_inputs (list): parameters
        correct_answer (str): correct answer
        variant_output (str): the output of an ll app variant with given parameters
        evaluation_prompt_template (str): evaluation prompt set by an agenta user in the ai evaluation view

    Returns:
        str: returns an evaluation
    """
    llm = OpenAI(
        openai_api_key=settings_values["open_ai_key"],
        temperature=settings_values["temperature"],
    )

    input_variables = []

    # List of default variables
    default_vars = [
        "variant_output",
        "llm_app_prompt_template",
        "correct_answer",
    ]

    # Check default variables
    for var in default_vars:
        if "{%s}" % var in settings_values["evaluation_prompt_template"]:
            input_variables.append(var)

    # Iterate over llm_app_inputs and check if the variable name exists in the evaluation_prompt_template
    for input_item in settings_values["llm_app_inputs"]:
        if (
            "{%s}" % input_item["input_name"]
            in settings_values["evaluation_prompt_template"]
        ):
            input_variables.append(input_item["input_name"])

    chain_run_args = {
        "llm_app_prompt_template": settings_values["llm_app_prompt_template"],
        "correct_answer": correct_answer,
        "variant_output": variant_output,
    }

    for input_item in settings_values["llm_app_inputs"]:
        chain_run_args[input_item["input_name"]] = input_item["input_value"]

    prompt = PromptTemplate(
        input_variables=input_variables,
        template=settings_values["evaluation_prompt_template"],
    )
    chain = LLMChain(llm=llm, prompt=prompt)

    output = chain.run(**chain_run_args)

    return Result(type="text", value=output.strip())


def evaluate(
    evaluator_name: str,
    correct_answer: str,
    variant_output: str,
    settings_values: Dict[str, Any],
    *additional_args: Tuple[Any],
    **additional_kwargs: Dict[str, Any],
) -> Result:
    evaluation_function = globals().get(evaluator_name, None)
    if not evaluation_function:
        raise ValueError(f"Evaluation method '{evaluator_name}' not found.")
    try:
        return evaluation_function(
            correct_answer,
            variant_output,
            settings_values,
            *additional_args,
            **additional_kwargs,
        )
    except Exception as exc:
        raise RuntimeError(
            f"Error occurred while running {evaluator_name} evaluation. Exception: {str(exc)}"
        )
