import re
from typing import Any
from langchain.chains import LLMChain
from langchain.llms import OpenAI
from langchain.prompts import PromptTemplate
from agenta_backend.services.db_manager import Result


def auto_exact_match(variant_output: str, correct_answer: str, settings_values: dict) -> Result:
    exact_match = True if variant_output == correct_answer else False
    result = Result(type="bool", value=exact_match)
    return result


def auto_similarity_match(variant_output: str, correct_answer: str, settings_values: dict) -> Result:
    set1 = set(variant_output.split())
    set2 = set(correct_answer.split())
    intersect = set1.intersection(set2)
    union = set1.union(set2)

    similarity = len(intersect) / len(union)

    is_similar = True if similarity > settings_values["similarity_threshold"] else False
    result = Result(type="bool", value=is_similar)
    return result


def auto_regex_test(test_string: str, regex: Any, should_match: bool) -> Result:
    re_pattern = re.compile(regex, re.IGNORECASE)
    result = bool(re_pattern.search(test_string)) == should_match
    return Result(type="bool", value=result)


def evaluate(
    evaluator_name: str,
    correct_answer: str,
    variant_output :str,
    settings_values: dict,
    *additional_args: tuple,
    **additional_kwargs: dict,
):
    try:
        evaluation_function = globals()[evaluator_name]
        return evaluation_function(
            correct_answer,
            variant_output,
            settings_values,
            *additional_args,
            **additional_kwargs,
        )
    except KeyError:
        raise ValueError(f"Evaluation method '{evaluator_name}' not found.")
