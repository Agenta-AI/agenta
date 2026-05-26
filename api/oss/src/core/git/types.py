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


def _is_identifying(ref: Optional[Reference]) -> bool:
    """A `Reference` is "identifying" only if it carries an `id` or `slug`.

    An empty `Reference(id=None, slug=None, version=None)` is a truthy
    Python object but does not actually scope a lookup, so callers must
    test for a populated identifier rather than relying on `bool(ref)`.
    """
    return bool(ref and (ref.id or ref.slug))


def needs_default_variant_resolution(
    *,
    artifact_ref: Optional[Reference],
    variant_ref: Optional[Reference],
    revision_ref: Optional[Reference],
) -> bool:
    """True when the service should resolve `artifact_ref` to its default variant
    before reaching the DAO.

    Fires when `artifact_ref` is identifying, `variant_ref` is not, and
    `revision_ref` is not identifying either (it's None, empty, or
    version-only). Both shapes — `{artifact_ref}` alone (latest-of-default)
    and `{artifact_ref + version}` (specific-version-on-default) — need the
    same artifact→variant resolution to give the DAO a usable variant scope.
    """
    if not _is_identifying(artifact_ref):
        return False
    if _is_identifying(variant_ref):
        return False
    if _is_identifying(revision_ref):
        return False
    return True


def validate_revision_ref_unambiguous(
    *,
    artifact_ref: Optional[Reference],
    variant_ref: Optional[Reference],
    revision_ref: Optional[Reference],
    entity_type: str = "artifact",
) -> None:
    """Reject requests whose refs are insufficient to identify a single revision (rule 2.e).

    Rule enforced: if `revision_ref.version` is set and neither
    `revision_ref.id` nor `revision_ref.slug` is set, the request must
    carry either a `variant_ref` with `id`/`slug` OR an `artifact_ref` with
    `id`/`slug`. Either is sufficient to scope the version lookup: a
    variant directly scopes it, an artifact scopes it via the
    default-variant fallback (deterministic ORDER BY at the DAO).

    The all-empty case (no refs at all) is intentionally NOT raised here —
    callers handle that as "nothing to look up" and return `None`.

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

    if _is_identifying(variant_ref) or _is_identifying(artifact_ref):
        return

    raise RevisionRefInvalid(
        f"{entity_type}_revision_ref.version is a per-variant sequence number "
        f"and requires a {entity_type}_variant_ref or {entity_type}_ref to "
        f"scope it. Provide either, or identify the revision by "
        f"{entity_type}_revision_ref.id or {entity_type}_revision_ref.slug "
        f"(both are project-unique)."
    )
