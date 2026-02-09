"""Utility functions for environment reference key handling.

Provides flatten/unflatten operations for converting between:
- Flat dict with dot-notation keys: {"my-app.revision": Reference(...)}
- Nested dict structures: {"my-app": {"revision": Reference(...)}}
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
        >>> flatten({"my-app": {"revision": ref, "variant": ref2}})
        {"my-app.revision": ref, "my-app.variant": ref2}
    """
    out: Dict[str, Any] = {}
    for k, v in d.items():
        full = f"{prefix}.{k}" if prefix else k

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
        >>> unflatten({"my-app.revision": ref, "my-app.variant": ref2})
        {"my-app": {"revision": ref, "variant": ref2}}
    """
    out: Dict[str, Any] = {}

    for key, val in flat.items():
        parts = key.split(".")

        d = out
        for part in parts[:-1]:
            if part not in d:
                d[part] = {}
            d = d[part]

        d[parts[-1]] = val

    return out
