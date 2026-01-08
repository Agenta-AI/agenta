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
    ) -> Union[float, None]:
        """
        Execute code and return a float score between 0 and 1.

        Args:
            code: Code to execute
            app_params: Application parameters
            inputs: Input data for the code
            output: Output from the application variant
            correct_answer: Expected/correct answer for comparison
            runtime: Runtime environment (python, javascript, typescript), None = python
            templates: Wrapper templates keyed by runtime.

        Returns:
            Float score between 0 and 1, or None if execution fails
        """
        pass
