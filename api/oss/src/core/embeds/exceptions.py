from typing import List, Dict, Any


class EmbedError(Exception):
    """Base exception for embed resolution errors."""

    pass


class CircularEmbedError(EmbedError):
    def __init__(self, cycle: List[str]):
        self.cycle = cycle
        super().__init__(f"Circular embed detected: {' -> '.join(cycle)}")


class MaxDepthExceededError(EmbedError):
    def __init__(self, depth: int):
        self.depth = depth
        super().__init__(f"Max embed depth {depth} exceeded")


class MaxEmbedsExceededError(EmbedError):
    def __init__(self, count: int):
        self.count = count
        super().__init__(f"Max embed count {count} exceeded")


class EmbedNotFoundError(EmbedError):
    def __init__(self, reference: "EmbedReference"):  # type: ignore # noqa: F821
        self.reference = reference
        super().__init__(f"Referenced entity not found: {reference}")


class UnsupportedReferenceTypeError(EmbedError):
    def __init__(self, ref_type: str):
        self.ref_type = ref_type
        super().__init__(f"Unsupported reference type: {ref_type}")


class PathExtractionError(EmbedError):
    def __init__(self, path: str, config: Dict[str, Any]):
        self.path = path
        self.config = config
        super().__init__(f"Path not found in configuration: {path}")
