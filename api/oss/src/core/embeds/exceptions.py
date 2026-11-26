from typing import List, Dict, Any

from oss.src.core.git.types import RetrieveRefsInconsistent


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


class NonEmbeddableWorkflowReferenceError(EmbedError):
    def __init__(self, slug: str):
        self.slug = slug
        super().__init__(
            f"Static workflow '{slug}' is retrievable but cannot be embedded."
        )


class EmbedReferenceInconsistentError(EmbedError, RetrieveRefsInconsistent):
    """An embed's refs name two different entities (e.g. one slug, another's id).

    Subclasses the git refusal so every route keeps answering 400 for it.
    """

    def __init__(self, *, references: Dict[str, Any]):
        slug = next(
            (ref.slug for ref in references.values() if getattr(ref, "slug", None)),
            None,
        )
        named = slug or next(
            (str(ref.id) for ref in references.values() if getattr(ref, "id", None)),
            "an embedded reference",
        )
        kind = next(iter(references), "workflow").split("_", 1)[0]
        # None when the caller sent only ids, so an id is never reported as a slug.
        self.slug = slug
        # Names only what the caller sent: the resolved entity may be one it cannot read.
        RetrieveRefsInconsistent.__init__(
            self,
            f"The configuration references '{named}', but its identifiers point at "
            f"different {kind}s. Remove '{named}' from the configuration and add it "
            "again.",
        )


class MixedEntityTypesError(EmbedError):
    def __init__(self, categories: List[str]):
        self.categories = categories
        super().__init__(
            f"References span multiple entity families: {', '.join(categories)}. "
            "All references in a single embed must belong to the same family "
            "(e.g., workflow_variant + workflow_revision, not workflow_revision + environment_revision)."
        )


class PathExtractionError(EmbedError):
    def __init__(self, path: str, config: Dict[str, Any]):
        self.path = path
        self.config = config
        super().__init__(f"Path not found in configuration: {path}")
