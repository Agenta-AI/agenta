# Avoid importing adapter here to prevent SDK dependency issues in standalone scripts.
# Import directly when needed:
#   from oss.src.core.triggers.providers.composio.adapter import ComposioTriggersAdapter

__all__ = [
    "ComposioTriggersAdapter",
]


def __getattr__(name):
    """Lazy import to avoid SDK dependency on module import."""
    if name == "ComposioTriggersAdapter":
        from oss.src.core.triggers.providers.composio.adapter import (
            ComposioTriggersAdapter,
        )

        return ComposioTriggersAdapter
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
