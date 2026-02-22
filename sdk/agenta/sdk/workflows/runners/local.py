from typing import Any, Dict, Union, Optional

from agenta.sdk.workflows.runners.base import CodeRunner


class LocalRunner(CodeRunner):
    """Local code runner using direct Python execution."""

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
        Execute provided Python code directly.

        Args:
            code: The Python code to be executed
            app_params: The parameters of the app variant (v1 only)
            inputs: Inputs to be used during code execution
            output: The output of the app variant after being called
            correct_answer: The correct answer (or target) for comparison (v1 only)
            runtime: Runtime environment (only "python" is supported for local runner)
            templates: Wrapper templates keyed by runtime (unused for local runner).
            version: Evaluator interface version ("1" = legacy, "2" = new)
            trace: Full trace data (v2 only)

        Returns:
            Float score between 0 and 1, or None if execution fails
        """
        # Normalize runtime: None means python
        runtime = runtime or "python"

        # Local runner only supports Python
        if runtime != "python":
            raise ValueError(
                f"LocalRunner only supports 'python' runtime, got: {runtime}"
            )

        # Define the environment for code execution
        environment: dict[str, Any] = dict()

        # Execute the code directly
        try:
            exec(code, environment)

            fn = environment["evaluate"]

            if version == "2":
                result = fn(inputs, output, trace)
            else:
                result = fn(app_params, inputs, output, correct_answer)

            # Attempt to convert result to float
            if isinstance(result, (float, int, str)):
                try:
                    result = float(result)
                except ValueError as e:
                    raise ValueError(f"Result cannot be converted to float: {e}")

            if not isinstance(result, float):
                raise TypeError(
                    f"Result is not a float after conversion: {type(result)}"
                )

            return result

        except KeyError as e:
            raise KeyError(f"Missing expected key in environment: {e}")

        except SyntaxError as e:
            raise SyntaxError(f"Syntax error in provided code: {e}")

        except Exception as e:
            raise RuntimeError(f"Error during code execution: {e}")
