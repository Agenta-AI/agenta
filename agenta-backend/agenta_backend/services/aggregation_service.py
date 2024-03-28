import re
import traceback
from typing import List, Optional

from agenta_backend.models.db_models import InvokationResult, Result, Error


def aggregate_ai_critique(results: List[Result]) -> Result:
    """Aggregates the results for the ai critique evaluation.

    Args:
        results (List[Result]): list of result objects

    Returns:
        Result: aggregated result
    """

    numeric_scores = []
    for result in results:
        # Extract the first number found in the result value
        match = re.search(r"\d+", result.value)
        if match:
            try:
                score = int(match.group())
                numeric_scores.append(score)
            except ValueError:
                # Ignore if the extracted value is not an integer
                continue

    # Calculate the average of numeric scores if any are present
    average_value = (
        sum(numeric_scores) / len(numeric_scores) if numeric_scores else None
    )
    return Result(
        type="number",
        value=average_value,
    )


def aggregate_binary(results: List[Result]) -> Result:
    """Aggregates the results for the binary (auto regex) evaluation.

    Args:
        results (List[Result]): list of result objects

    Returns:
        Result: aggregated result
    """

    if all(isinstance(result.value, bool) for result in results):
        average_value = sum(int(result.value) for result in results) / len(results)
    else:
        average_value = None
    return Result(type="number", value=average_value)


def aggregate_float(results: List[Result]) -> Result:
    """Aggregates the results for evaluations aside from auto regex and ai critique.

    Args:
        results (List[Result]): list of result objects

    Returns:
        Result: aggregated result
    """

    try:
        average_value = sum(result.value for result in results) / len(results)
        return Result(type="number", value=average_value)
    except Exception as exc:
        return Result(
            type="error",
            value=None,
            error=Error(message=str(exc), stacktrace=str(traceback.format_exc())),
        )


def aggregate_float_from_llm_app_response(
    invocation_results: List[InvokationResult], key: Optional[str]
) -> Result:
    try:
        if not key:
            raise ValueError("Key is required to aggregate InvokationResult objects.")

        values = [
            getattr(inv_result, key)
            for inv_result in invocation_results
            if hasattr(inv_result, key) and getattr(inv_result, key) is not None
        ]

        if not values:
            raise ValueError(f"No valid values found for {key} aggregation.")

        average_value = sum(values) / len(values)
        return Result(type=key, value=average_value)
    except Exception as exc:
        return Result(
            type="error",
            value=None,
            error=Error(message=str(exc), stacktrace=str(traceback.format_exc())),
        )
