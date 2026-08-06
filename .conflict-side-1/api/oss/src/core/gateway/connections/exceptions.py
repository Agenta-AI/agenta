from typing import Optional


class ConnectionsError(Exception):
    """Base exception for the connections domain."""

    def __init__(self, message: str = "Connections error"):
        self.message = message
        super().__init__(self.message)


class ProviderNotFoundError(ConnectionsError):
    """Raised when the requested provider_key has no registered adapter."""

    def __init__(self, provider_key: str):
        self.provider_key = provider_key
        super().__init__(f"Provider not found: {provider_key}")


class ConnectionNotFoundError(ConnectionsError):
    """Raised when a connection cannot be found."""

    def __init__(
        self,
        *,
        connection_id: Optional[str] = None,
    ):
        self.connection_id = connection_id
        super().__init__(f"Connection not found: {connection_id}")


class ConnectionInactiveError(ConnectionsError):
    """Raised when trying to use an inactive or revoked connection."""

    def __init__(
        self,
        *,
        connection_id: str,
        detail: Optional[str] = None,
    ):
        self.connection_id = connection_id
        self.detail = detail
        msg = f"Connection is inactive or revoked: {connection_id}"
        if detail:
            msg += f" - {detail}"
        super().__init__(msg)


class AdapterError(ConnectionsError):
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
