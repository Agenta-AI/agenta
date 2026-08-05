# Avoid importing adapter here to prevent SDK dependency issues in standalone scripts.
# Import directly when needed:
#   from oss.src.core.gateway.connections.providers.composio.adapter import (
#       ComposioConnectionsAdapter,
#   )

__all__ = [
    "ComposioConnectionsAdapter",
]


def __getattr__(name):
    """Lazy import to avoid SDK dependency on module import."""
    if name == "ComposioConnectionsAdapter":
        from oss.src.core.gateway.connections.providers.composio.adapter import (
            ComposioConnectionsAdapter,
        )

        return ComposioConnectionsAdapter
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
