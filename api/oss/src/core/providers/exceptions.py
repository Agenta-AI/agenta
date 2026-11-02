class ProviderProbeError(Exception):
    """Base for probe failures the caller must fix in its request."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class UnsupportedProviderKind(ProviderProbeError):
    pass


class ProviderEndpointRequired(ProviderProbeError):
    pass


class ProviderEndpointNotAllowed(ProviderProbeError):
    pass
