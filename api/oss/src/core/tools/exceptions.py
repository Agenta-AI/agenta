from typing import List, Optional


class ToolsError(Exception):
    """Base exception for the tools domain."""

    def __init__(self, message: str = "Tools error"):
        self.message = message
        super().__init__(self.message)


class ProviderNotFoundError(ToolsError):
    """Raised when the requested provider_key has no registered adapter."""

    def __init__(self, provider_key: str):
        self.provider_key = provider_key
        super().__init__(f"Provider not found: {provider_key}")


class ConnectionNotFoundError(ToolsError):
    """Raised when a connection cannot be found."""

    def __init__(
        self,
        *,
        provider_key: str,
        integration_key: str,
        connection_slug: str,
    ):
        self.provider_key = provider_key
        self.integration_key = integration_key
        self.connection_slug = connection_slug
        super().__init__(
            f"Connection not found: {provider_key}/{integration_key}/{connection_slug}"
        )


class ConnectionSlugConflictError(ToolsError):
    """Raised when a connection slug already exists for the integration."""

    def __init__(
        self,
        *,
        provider_key: str,
        integration_key: str,
        connection_slug: str,
    ):
        self.provider_key = provider_key
        self.integration_key = integration_key
        self.connection_slug = connection_slug
        super().__init__(
            f"Connection slug already exists: {provider_key}/{integration_key}/{connection_slug}"
        )


class ToolNotConnectedError(ToolsError):
    """Raised when trying to invoke a tool with no active connection."""

    def __init__(self, slug: str):
        self.slug = slug
        super().__init__(f"Tool not connected: {slug}")


class ToolAmbiguousError(ToolsError):
    """Raised when a tool slug is ambiguous (multiple connections, none specified)."""

    def __init__(
        self,
        *,
        slug: str,
        available_connections: Optional[List[str]] = None,
    ):
        self.slug = slug
        self.available_connections = available_connections or []
        super().__init__(
            f"Ambiguous tool slug: {slug}. "
            f"Available connections: {', '.join(self.available_connections)}"
        )


class AdapterError(ToolsError):
    """Raised when an adapter operation fails."""

    def __init__(
        self,
        *,
        provider_key: str,
        operation: str,
        detail: Optional[str] = None,
    ):
        self.provider_key = provider_key
        self.operation = operation
        self.detail = detail
        msg = f"Adapter error ({provider_key}.{operation})"
        if detail:
            msg += f": {detail}"
        super().__init__(msg)
