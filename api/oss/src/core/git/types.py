from typing import Optional

from oss.src.core.shared.dtos import Reference


class GitError(Exception):
    """Base exception for git-pattern domain errors."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class VariantForkError(GitError):
    """Raised when a variant fork request cannot be fulfilled."""


class RevisionRefInvalid(GitError):
    """Raised when artifact/variant/revision refs are present but cannot
    identify a single revision unambiguously.

    Currently raised when `revision_ref` carries only `version` (no `id`,
    no `slug`) and no `variant_ref` with `id`/`slug` is provided. A revision
    version is a per-variant sequence number and requires a variant context
    to be unambiguous. `revision_ref.id` and `revision_ref.slug` are both
    project-unique and remain valid alone.

    Not raised for the all-refs-empty case: the entity service returns
    `None` for that case rather than raising, matching the "nothing to look
    up" contract.
    """


def _has_id_or_slug(ref: Optional[Reference]) -> bool:
    """A `Reference` is "identifying" only if it carries an `id` or `slug`.

    An empty `Reference(id=None, slug=None, version=None)` is a truthy
    Python object but does not actually scope a lookup, so callers must
    test for a populated identifier rather than relying on `bool(ref)`.
    """
    return bool(ref and (ref.id or ref.slug))


def validate_revision_ref_unambiguous(
    *,
    artifact_ref: Optional[Reference],
    variant_ref: Optional[Reference],
    revision_ref: Optional[Reference],
    entity_type: str = "artifact",
) -> None:
    """Reject revision-retrieve requests that cannot identify a single revision.

    Rule enforced: if `revision_ref.version` is set and neither
    `revision_ref.id` nor `revision_ref.slug` is set, the request must
    carry a `variant_ref` with `id` or `slug`. Without that scope, the same
    `version` value exists across many variants and cannot identify a
    single revision; the DAO would silently return an arbitrary row.

    The all-empty case (no refs at all) is intentionally NOT raised here —
    callers handle that as "nothing to look up" and return `None`.

    Note on `artifact_ref`: in principle a populated `artifact_ref` is also
    sufficient to scope a version lookup, because the service can resolve
    artifact → default variant → revision. This helper does NOT accept
    `artifact_ref` alone today because that resolution path (the default-
    variant pick) is non-deterministic for multi-variant artifacts in the
    current code. Once that lookup becomes deterministic, callers can
    resolve `artifact_ref` → `variant_ref` before invoking this helper and
    the same shape will pass without changing this function. `artifact_ref`
    is accepted as a parameter for forward compatibility (future cross-ref
    mismatch validation, rule 2.c) but is not consulted today.

    `entity_type` is interpolated into the error message ("workflow",
    "testset", ...) so callers across entities can keep their messages
    accurate without duplicating the logic.
    """
    revision_version_only = bool(
        revision_ref
        and revision_ref.version
        and not revision_ref.id
        and not revision_ref.slug
    )
    if not revision_version_only:
        return

    if _has_id_or_slug(variant_ref):
        return

    raise RevisionRefInvalid(
        f"{entity_type}_revision_ref.version is a per-variant sequence number "
        f"and requires a {entity_type}_variant_ref to be unambiguous. "
        f"Provide a {entity_type}_variant_ref, or identify the revision by "
        f"{entity_type}_revision_ref.id or {entity_type}_revision_ref.slug "
        f"(both are project-unique)."
    )
