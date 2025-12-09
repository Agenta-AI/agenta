from typing import Union, Text, Dict, Any

from agenta.sdk.workflows.runners import get_runner

# Cache for the runner instance
_runner = None


def is_import_safe(python_code: Text) -> bool:
    """Checks if the imports in the python code contains a system-level import.

    Args:
        python_code (str): The Python code to be executed

    Returns:
        bool - module is secured or not
    """

    disallowed_imports = ["os", "subprocess", "threading", "multiprocessing"]
    for import_ in disallowed_imports:
        if import_ in python_code:
            return False
    return True


def execute_code_safely(
    app_params: Dict[str, Any],
    inputs: Dict[str, Any],
    output: Union[dict, str],
    correct_answer: Any,  # for backward compatibility reasons
    code: Text,
) -> Union[float, None]:
    """
    Execute the provided Python code safely.

    Uses the configured runner (local RestrictedPython or remote Daytona)
    based on the AGENTA_SERVICES_SANDBOX_RUNNER environment variable.

    Args:
        - app_params (Dict[str, Any]): The parameters of the app variant.
        - inputs (Dict[str, Any]): Inputs to be used during code execution.
        - output (Union[dict, str]): The output of the app variant after being called.
        - correct_answer (Any): The correct answer (or target) of the app variant.
        - code (Text): The Python code to be executed.

    Returns:
        - (float): Result of the execution if successful. Should be between 0 and 1.
        - None if execution fails or result is not a float between 0 and 1.
    """
    global _runner

    if _runner is None:
        _runner = get_runner()

    return _runner.run(code, app_params, inputs, output, correct_answer)
