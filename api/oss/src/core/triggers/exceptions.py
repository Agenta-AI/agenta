from typing import Optional


class TriggersError(Exception):
    """Base exception for the triggers domain."""

    def __init__(self, message: str = "Triggers error"):
        self.message = message
        super().__init__(self.message)


class ProviderNotFoundError(TriggersError):
    """Raised when the requested provider_key has no registered adapter."""

    def __init__(self, provider_key: str):
        self.provider_key = provider_key
        super().__init__(f"Provider not found: {provider_key}")


class AdapterError(TriggersError):
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
