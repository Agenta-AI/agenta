"""NumPy-based evaluators.

Simple tests to verify NumPy availability and basic functionality.
Requires: pip install numpy
"""

from .numpy_available import evaluate as numpy_available
from .numpy_dummy import evaluate as array_sum_match

__all__ = [
    "numpy_available",
    "numpy_dummy",
]
