"""NumPy-based evaluators.

Simple tests to verify NumPy availability and basic functionality.
Requires: pip install numpy
"""

from .dependency_check import evaluate as numpy_available
from .exact_match import evaluate as array_sum_match

__all__ = [
    "dependency_check",
    "exact_match",
]
