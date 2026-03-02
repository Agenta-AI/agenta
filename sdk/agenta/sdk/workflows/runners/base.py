from abc import ABC, abstractmethod
from typing import Any, Dict, Union, Optional


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
    ) -> Union[float, None]:
        """
        Execute code and return a float score between 0 and 1.

        Args:
            code: Code to execute
            app_params: Application parameters (v1 only, deprecated)
            inputs: Input data for the code
            output: Output from the application variant (v1: singular, v2: also used)
            correct_answer: Expected/correct answer for comparison (v1 only)
            runtime: Runtime environment (python, javascript, typescript), None = python
            templates: Wrapper templates keyed by runtime.
            version: Evaluator interface version ("1" = legacy, "2" = new)
            trace: Full trace data (v2 only)

        Returns:
            Float score between 0 and 1, or None if execution fails
        """
        pass
