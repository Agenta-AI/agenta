import json
import math
from abc import ABC, abstractmethod
from typing import Any, Dict, Union, Optional


def normalize_result(result: Any, version: str) -> Any:
    """Normalize an evaluate() result according to the evaluator interface version.

    Versions "1" and "2" keep the legacy contract: the result must coerce to float.
    Version "3" accepts any JSON-serializable value; dict outputs become multiple
    metrics downstream. The JSON round-trip both rejects non-serializable results
    and ensures no sandbox-internal objects leak past the runner boundary.
    NaN/Infinity are rejected (allow_nan=False): they are not valid JSON and would
    behave differently across runtimes.
    """
    if version == "3":
        if isinstance(result, bool):
            return result
        if isinstance(result, (int, float)):
            numeric = float(result)
            if not math.isfinite(numeric):
                raise TypeError(
                    "Result is not JSON-serializable: non-finite floats are not supported"
                )
            return numeric
        if result is None:
            raise TypeError(
                "Evaluator returned None: return a float, bool, str, dict, or list"
            )
        try:
            return json.loads(json.dumps(result, allow_nan=False))
        except (TypeError, ValueError) as e:
            raise TypeError(f"Result is not JSON-serializable: {type(result)}") from e

    if isinstance(result, (float, int, str)):
        try:
            result = float(result)
        except ValueError as e:
            raise ValueError(f"Result cannot be converted to float: {e}")

    if not isinstance(result, float):
        raise TypeError(f"Result is not a float after conversion: {type(result)}")

    return result


class CodeRunner(ABC):
    """Abstract base class for code runners (local and remote execution)."""

    @abstractmethod
    def run(
        self,
        code: str,
        app_params: Dict[str, Any],
        inputs: Dict[str, Any],
        output: Union[dict, str],
        correct_answer: Any,
        runtime: Optional[str] = None,
        templates: Optional[Dict[str, str]] = None,
        *,
        version: str = "1",
        trace: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """
        Execute code and return the evaluation result.

        Args:
            code: Code to execute
            app_params: Application parameters (v1 only, deprecated)
            inputs: Input data for the code
            output: Output from the application variant (v1: singular, v2: also used)
            correct_answer: Expected/correct answer for comparison (v1 only)
            runtime: Runtime environment (python, javascript, typescript), None = python
            templates: Wrapper templates keyed by runtime.
            version: Evaluator interface version ("1" = legacy, "2" = float-only,
                "3" = rich outputs)
            trace: Full trace data (v2+ only)

        Returns:
            Versions "1"/"2": float score between 0 and 1, or None if execution fails.
            Version "3": any JSON-serializable value (dict, list, str, float, bool).
        """
        pass
