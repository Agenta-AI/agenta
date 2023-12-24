import re
from typing import Any
from langchain.chains import LLMChain
from langchain.llms import OpenAI
from langchain.prompts import PromptTemplate


def auto_exact_match(variant_output: str, correct_answer: str, settings_values: dict):
    if variant_output == correct_answer:
        return 1
    else:
        return 0


def auto_similarity_match(variant_output: str, correct_answer: str, settings_values: dict):
    set1 = set(variant_output.split())
    set2 = set(correct_answer.split())
    intersect = set1.intersection(set2)
    union = set1.union(set2)

    similarity = len(intersect) / len(union)

    is_similar = True if similarity > settings_values["similarity_threshold"] else False
    return is_similar


def auto_regex_test(test_string: str, regex: Any, should_match: bool):
    re_pattern = re.compile(regex, re.IGNORECASE)
    result = bool(re_pattern.search(test_string))
    return result == should_match


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
            correct_answer, variant_output, settings_values, *additional_args, **additional_kwargs
        )
    except KeyError:
        raise ValueError(f"Evaluation method '{evaluator_name}' not found.")
