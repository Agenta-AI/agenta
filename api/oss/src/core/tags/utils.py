"""Utility functions for tags handling.

Provides flatten/unflatten operations for converting between:
- Flat dict with dot-notation keys: {"env": "prod", "owner.name": "Juan"}
- Nested dict structures: {"env": "prod", "owner": {"name": "Juan"}}
"""

from typing import Any, Dict


def flatten(d: Dict[str, Any], prefix: str = "") -> Dict[str, Any]:
    """
    Convert a nested dictionary to a flat dictionary with dot-notation keys.

    Args:
        d: Nested dictionary to flatten
        prefix: Current prefix for dot-notation path (used recursively)

    Returns:
        Flat dictionary with dot-notation keys

    Example:
        >>> input_dict = {"env": "prod", "owner": {"name": "Juan", "role": "admin"}}
        >>> flatten(input_dict)
        {"env": "prod", "owner.name": "Juan", "owner.role": "admin"}
    """
    out: Dict[str, Any] = {}
    for k, v in d.items():
        # Build the full key path with dot notation
        full = f"{prefix}.{k}" if prefix else k

        # Recursively flatten nested dicts
        if isinstance(v, dict):
            out.update(flatten(v, full))
        else:
            out[full] = v

    return out


def unflatten(flat: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert a flat dictionary with dot-notation keys to a nested dictionary.

    Args:
        flat: Flat dictionary with dot-notation keys to unflatten

    Returns:
        Nested dictionary structure

    Example:
        >>> input_dict = {"env": "prod", "owner.name": "Juan", "owner.role": "admin"}
        >>> unflatten(input_dict)
        {"env": "prod", "owner": {"name": "Juan", "role": "admin"}}
    """
    out: Dict[str, Any] = {}

    for key, val in flat.items():
        # Split the key by dots to get the path
        parts = key.split('.')

        # Navigate/create nested structure
        d = out
        for part in parts[:-1]:
            if part not in d:
                d[part] = {}
            d = d[part]

        # Set the final value
        d[parts[-1]] = val

    return out
