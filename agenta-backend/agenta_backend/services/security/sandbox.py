import re
from typing import List, Union, Text, Dict, Any

from RestrictedPython import safe_builtins, compile_restricted
from RestrictedPython.Eval import (
    default_guarded_getiter,
    default_guarded_getitem,
)
from RestrictedPython.Guards import (
    guarded_iter_unpack_sequence,
    full_write_guard,
)


def is_import_safe(module: str) -> bool:
    """Checks if a given package import contains any disallowed patterns of code.
    
    Args:
        module (str) -- The module to check for potentially dangerous code
    
    Returns:
        bool - module is secured or not
    """

    # Define patterns to disallow dangerous code
    disallowed_patterns = [
        r"import\s+os",
        r"import\s+subprocess",
        # Add more patterns as needed
    ]

    # Check if any disallowed patterns are present
    for pattern in disallowed_patterns:
        if re.search(pattern, module):
            return False
    return True


def execute_code_safely(
    code: Text, allowed_imports: List[str], inputs: Dict[str, Any]
) -> Union[float, None]:
    """
    Execute the provided Python code safely using RestrictedPython.

    Args:
    - code (str): The Python code to be executed.
    - allowed_imports (list): List of modules or objects that can be imported.
    - inputs (dict): Inputs to be used during code execution.

    Returns:
    - (float): Result of the execution if successful. Should be between 0 and 1.
    - None if execution fails or result is not a float between 0 and 1.
    """
    # Define the available built-ins
    local_builtins = safe_builtins.copy()
    
    # Add the __import__ built-in function to the local builtins
    local_builtins["__import__"] = __import__

    # Create a dictionary to simulate allowed imports
    allowed_modules = {}
    for item in allowed_imports:
        module_safe = is_import_safe(item)
        if not module_safe:
            raise Exception("")
        else:
            allowed_modules[item] = __import__(item)

    # Add the allowed modules to the local built-ins
    local_builtins.update(allowed_modules)

    # Define the environment for the code execution
    environment = {
        "_getiter_": default_guarded_getiter,
        "_getitem_": default_guarded_getitem,
        "_iter_unpack_sequence_": guarded_iter_unpack_sequence,
        "_write_": full_write_guard,
        "inputs": inputs,
        "__builtins__": local_builtins
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
