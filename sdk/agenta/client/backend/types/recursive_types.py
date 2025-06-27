"""
Properly defined recursive types for the SDK to prevent Pydantic recursion errors.
These use TypeAliasType from typing_extensions as recommended by Pydantic documentation.
"""

from typing import Dict, List, Optional, Union, Any
from typing_extensions import TypeAliasType

# Define a non-recursive JSON type that breaks the recursion
# This will be used in place of recursive types in the models
JsonValue = Union[Dict[str, Any], List[Any], str, int, float, bool, None]

# Define properly structured recursive types that Pydantic can handle
RecursiveJson = TypeAliasType(
    "RecursiveJson",
    'Union[Dict[str, "RecursiveJson"], List["RecursiveJson"], str, int, float, bool, None]',
)

# Define a type for OTel spans that properly handles recursion
OTelSpanValue = TypeAliasType("OTelSpanValue", 'Union["OTelSpan", List["OTelSpan"]]')

# The actual implementation will import this later
OTelSpan = Any
