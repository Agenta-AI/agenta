from typing import List, Union, Text

from RestrictedPython import safe_builtins, compile_restricted
from RestrictedPython.Eval import default_guarded_getiter, default_guarded_getitem
from RestrictedPython.Guards import guarded_iter_unpack_sequence, full_write_guard


def execute_code_safely(code: Text, allowed_imports: List[str], inputs: List[str]) -> Union[float, None]:
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

    # Allow certain imports
    for item in allowed_imports:
        local_builtins[item] = __import__(item)

    # Define the environment for the code execution
    environment = {
        '_getiter_': default_guarded_getiter,
        '_getitem_': default_guarded_getitem,
        '_iter_unpack_sequence_': guarded_iter_unpack_sequence,
        '_write_': full_write_guard,
        'inputs': inputs
    }

    # Compile the code in a restricted environment
    byte_code = compile_restricted(code, filename='<inline code>', mode='exec')

    # Execute the code
    exec(byte_code, environment)

    # Extract the result if it exists and is a float between 0 and 1
    result = environment.get('result', None)
    if isinstance(result, float) and 0 <= result <= 1:
        return result
    return None
