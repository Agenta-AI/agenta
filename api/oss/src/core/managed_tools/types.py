"""Managed tool action exceptions."""


class ManagedToolsError(Exception):
    def __init__(self, message: str = "Managed tools error"):
        self.message = message
        super().__init__(message)


class ManagedActionNotFoundError(ManagedToolsError):
    def __init__(self, *, tool: str):
        self.tool = tool
        super().__init__(f"Unknown managed action: {tool}")


class ManagedActionNotSentError(ManagedToolsError):
    """The request provably never reached the upstream, so nothing was bought."""


class ManagedActionRegistryError(ManagedToolsError):
    """The catalog is inconsistent. Raised at construction, never on a request."""
