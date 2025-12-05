from abc import ABC, abstractmethod
from typing import Any, Dict, Union


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
    ) -> Union[float, None]:
        """
        Execute code and return a float score between 0 and 1.

        Args:
            code: Python code to execute
            app_params: Application parameters
            inputs: Input data for the code
            output: Output from the application variant
            correct_answer: Expected/correct answer for comparison

        Returns:
            Float score between 0 and 1, or None if execution fails
        """
        pass
