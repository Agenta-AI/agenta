from typing import Union, Text, Dict, Any

from RestrictedPython import safe_builtins, compile_restricted
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


def execute_code_safely(code: Text, inputs: Dict[str, Any]) -> Union[float, None]:
    """
    Execute the provided Python code safely using RestrictedPython.

    Args:
    - code (str): The Python code to be executed.
    - inputs (dict): Inputs to be used during code execution.

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
        "jsonschema",
        "requests",
        "numpy",
    ]

    # Create a dictionary to simulate allowed imports
    allowed_modules = {}
    for package_name in allowed_imports:
        allowed_modules[package_name] = __import__(package_name)

    # Add the allowed modules to the local built-ins
    local_builtins.update(allowed_modules)

    # Define the environment for the code execution
    environment = {
        "_getiter_": default_guarded_getiter,
        "_getitem_": default_guarded_getitem,
        "_iter_unpack_sequence_": guarded_iter_unpack_sequence,
        "_write_": full_write_guard,
        "inputs": inputs,
        "__builtins__": local_builtins,
    }

    # Compile the code in a restricted environment
    byte_code = compile_restricted(code, filename="<inline>", mode="exec")

    # Execute the code
    exec(byte_code, environment)

    # Extract the result if it exists and is a float between 0 and 1
    result = environment.get("result", None)
    if isinstance(result, float) and 0 <= result <= 1:
        return result
    return None
