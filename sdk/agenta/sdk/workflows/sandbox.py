from typing import Union, Text, Dict, Any

from RestrictedPython import safe_builtins, compile_restricted, utility_builtins
from RestrictedPython.Eval import (
    default_guarded_getiter,
    default_guarded_getitem,
)
from RestrictedPython.Guards import (
    guarded_iter_unpack_sequence,
    full_write_guard,
)


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
    Execute the provided Python code safely using RestrictedPython.

    Args:
        - app_params (Dict[str, str]): The parameters of the app variant.
        - inputs (dict): Inputs to be used during code execution.
        - output (str): The output of the app variant after being called.
        - correct_answer (str): The correct answer (or target) of the app variant.
        - code (Text): The Python code to be executed.
        - datapoint (Dict[str, str]): The test datapoint.

    Returns:
    - (float): Result of the execution if successful. Should be between 0 and 1.
    - None if execution fails or result is not a float between 0 and 1.
    """
    # Define the available built-ins
    local_builtins = safe_builtins.copy()

    # Add the __import__ built-in function to the local builtins
    local_builtins["__import__"] = __import__

    # Define supported packages
    allowed_imports = [
        "math",
        "random",
        "datetime",
        "json",
        "requests",
        "typing",
    ]

    # Create a dictionary to simulate allowed imports
    allowed_modules = {}
    for package_name in allowed_imports:
        allowed_modules[package_name] = __import__(package_name)

    # Add the allowed modules to the local built-ins
    local_builtins.update(allowed_modules)
    local_builtins.update(utility_builtins)

    # Define the environment for the code execution
    environment = {
        "_getiter_": default_guarded_getiter,
        "_getitem_": default_guarded_getitem,
        "_iter_unpack_sequence_": guarded_iter_unpack_sequence,
        "_write_": full_write_guard,
        "__builtins__": local_builtins,
    }

    # Compile the code in a restricted environment
    byte_code = compile_restricted(code, filename="<inline>", mode="exec")

    # Call the evaluation function, extract the result if it exists
    # and is a float between 0 and 1
    try:
        # Execute the code
        exec(byte_code, environment)

        # Call the evaluation function, extract the result
        result = environment["evaluate"](app_params, inputs, output, correct_answer)

        # Attempt to convert result to float
        if isinstance(result, (float, int, str)):
            try:
                result = float(result)
            except ValueError as e:
                raise ValueError(f"Result cannot be converted to float: {e}")

        if not isinstance(result, float):
            raise TypeError(f"Result is not a float after conversion: {type(result)}")

        return result

    except KeyError as e:
        raise KeyError(f"Missing expected key in environment: {e}")

    except SyntaxError as e:
        raise SyntaxError(f"Syntax error in provided code: {e}")

    except Exception as e:
        raise RuntimeError(f"Error during code execution: {e}")
