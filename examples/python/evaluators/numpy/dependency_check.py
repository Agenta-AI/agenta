"""
NumPy Available Test
====================

Simple predicate test to check if NumPy is available/installed.
"""

from typing import Dict, Union, Any


def evaluate(
    app_params: Dict[str, str],
    inputs: Dict[str, str],
    output: Union[str, Dict[str, Any]],
    correct_answer: str
) -> float:
    """
    Tests if NumPy is available in the environment.

    This is a simple predicate test that returns a random value between 0.0 and 1.0
    if NumPy can be imported, and 0.0 if it cannot. Useful for testing if the
    environment has NumPy installed.

    Args:
        app_params: Application parameters (not used)
        inputs: Input data (not used)
        output: LLM output (not used)
        correct_answer: Expected answer (not used)

    Returns:
        float: Random value between 0.0 and 1.0 if NumPy is available, 0.0 otherwise

    Example:
        # If NumPy is installed
        Returns: 0.7342... (random value using np.random.random())

        # If NumPy is not installed
        Returns: 0.0
    """
    try:
        import numpy as np

        # Return a random value using NumPy to prove it works
        # This also makes the test non-deterministic as a side benefit
        random_value = np.random.random()

        # Return the random value (between 0.0 and 1.0)
        return float(random_value)
    except ImportError:
        # NumPy is not installed
        return 0.0
    except Exception:
        # NumPy is installed but something went wrong
        return 0.0
