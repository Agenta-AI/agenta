"""Typed execution failures raised across the executor seam. SDK-free."""


class ExecutionError(RuntimeError):
    """A streamed turn failed: source exception, error event, or unclean termination."""

    def __init__(self, message: str, *, source: BaseException | None = None) -> None:
        super().__init__(message)
        self.source = source
