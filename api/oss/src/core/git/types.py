"""Git-pattern domain rules for artifact/variant/revision references.

This module owns the shape of `revisions/retrieve` across every git-backed
entity (workflows, applications, evaluators, testsets, queries,
environments). Changes here propagate uniformly. The rules below are the
contract every entity service implements before delegating to its DAO.

Reference shapes
================

A `Reference(id, slug, version)` is *identifying* iff it carries an `id`
or a `slug`. Both are project-unique. A bare `version` (with no `id` or
`slug`) is a per-variant sequence number on its own — not a project-wide
identifier — and never identifies a row.

Variants do not have versions: a `variant_ref` carrying only `version`
is rejected outright by `validate_variant_refs_sufficient`.

A revision can be identified by:

  * `revision_ref.id`                                — project-unique.
  * `revision_ref.slug`                              — project-unique.
  * `variant_ref` (id/slug) + `revision_ref.version` — version is scoped
    to the variant.

Rule 2.a — minimal identifying request
---------------------------------------

Any single identifying reference resolves a single revision:

  * `{revision_ref.id}` or `{revision_ref.slug}` → that revision.
  * `{variant_ref}`                              → latest revision on the
    variant (stable tie-break: `created_at DESC, id DESC`).
  * `{artifact_ref}`                             → latest revision on the
    artifact's default variant (default variant picked by
    `created_at ASC, id ASC LIMIT 1`).

Env-path: `{environment_ref + key}` resolves to the revision currently
deployed under that key. When `key` is omitted but `artifact_ref` has a
slug, the key is derived as `{artifact_slug}.revision`.

Rule 2.b — redundant-consistent request
----------------------------------------

A caller may repeat identifying refs across the
artifact/variant/revision triple, or mix entity refs with env refs.
Every redundant identifier must name the same row that the lookup
resolved. Validated post-resolution by
`validate_retrieve_refs_consistent`.

Rule 2.c — inconsistent request
--------------------------------

When any redundant ref contradicts the resolved revision (different
`id`, different `slug`, or — for revisions inside a variant — different
`version`), `RetrieveRefsInconsistent` is raised. Routers translate this
to HTTP 400 with a `*_ref` field name in the message.

Rule 2.d — insufficient request that picks a default
-----------------------------------------------------

When refs are minimal but unambiguous (single variant, single artifact,
env-ref + key), the rules above pick deterministically.

Rule 2.e — insufficient request that cannot pick
-------------------------------------------------

When refs are present but cannot identify a single revision —
`{revision_ref:{version}}` alone, `{variant_ref:{version}}` alone, or
env refs without a `key` and without an artifact-ref to derive the key
from — `RetrieveRefsInsufficient` is raised. Routers translate this to
HTTP 400.

Empty request (`{}`) resolves to `None` at the service layer; routers
that require at least one identifying input (env-path-only routers like
applications) reject it at the boundary.

Exception registry
==================

`InitialRevisionConflict`, `VariantForkError`, `RetrieveRefsInsufficient`,
and `RetrieveRefsInconsistent` are translated to HTTP responses by
`@handle_git_exceptions()` in
`api/oss/src/apis/fastapi/git/exceptions.py`. Any new git-domain
exception added here must also be registered there.

See `docs/design/playground-open-from-trace/followups.md` for the design
record that drove these rules.
"""

from typing import Optional

from oss.src.core.shared.dtos import Reference


class GitError(Exception):
    """Base exception for git-pattern domain errors."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class VariantForkError(GitError):
    """Raised when a variant fork request cannot be fulfilled."""


class RetrieveRefsInsufficient(GitError):
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


class InitialRevisionConflict(GitError):
    """Raised when an initial revision already exists for a variant.

    The `initial=True` guard in the DAO raises this exception when a
    revision already exists for the variant, so routers can map it to
    HTTP 409 via `@handle_git_exceptions()` without inspecting None.
    """


class RetrieveRefsInconsistent(GitError):
    """Raised when redundant refs disagree with the resolved revision.

    A caller may legitimately repeat identifying refs across the
    artifact/variant/revision triple, but every redundant identifier must
    name the same row that the lookup resolved. If `revision_ref.id`
    resolves to a revision whose `artifact_id` does not match the
    `artifact_ref.id` the caller sent, the request is rejected — silently
    favoring one ref would be a footgun.
    """


def is_identifying(ref: Optional[Reference]) -> bool:
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
    if not is_identifying(artifact_ref):
        return False
    if is_identifying(variant_ref):
        return False
    if is_identifying(revision_ref):
        return False
    return True


def validate_revision_refs_sufficient(
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

    if is_identifying(variant_ref) or is_identifying(artifact_ref):
        return

    raise RetrieveRefsInsufficient(
        f"{entity_type}_revision_ref.version is a per-variant sequence number "
        f"and requires a {entity_type}_variant_ref or {entity_type}_ref to "
        f"scope it. Provide either, or identify the revision by "
        f"{entity_type}_revision_ref.id or {entity_type}_revision_ref.slug "
        f"(both are project-unique)."
    )


def validate_variant_refs_sufficient(
    *,
    variant_ref: Optional[Reference],
    entity_type: str = "artifact",
) -> None:
    """Reject `variant_ref` shapes that can never identify a variant.

    Variants carry `id` and `slug` but no `version` field — version is a
    per-variant counter living on revisions. A `variant_ref` populated with
    only `version` is nonsense the DAO would silently drop, so reject it at
    the boundary.

    Identifying `variant_ref` (id/slug, optionally with redundant version
    that the DAO ignores) is left alone — C3's consistency check covers the
    "redundant but wrong" case. An empty `variant_ref` (no fields set) is
    also left alone — services treat it as "no variant ref" and the DAO
    handles it correctly via `is_identifying`.
    """
    if variant_ref is None:
        return
    if is_identifying(variant_ref):
        return
    if variant_ref.version is None:
        return
    raise RetrieveRefsInsufficient(
        f"{entity_type}_variant_ref carries only `version`, but variants "
        f"have no `version` field. Identify the variant by "
        f"{entity_type}_variant_ref.id or {entity_type}_variant_ref.slug."
    )


def _mismatch(
    ref_field: str,
    ref_value,
    resolved_field: str,
    resolved_value,
) -> Optional[str]:
    if ref_value is None or resolved_value is None:
        return None
    if str(ref_value) == str(resolved_value):
        return None
    return (
        f"{ref_field}={ref_value!r} does not match resolved revision's "
        f"{resolved_field}={resolved_value!r}"
    )


def validate_retrieve_refs_consistent(
    *,
    artifact_ref: Optional[Reference],
    variant_ref: Optional[Reference],
    revision_ref: Optional[Reference],
    resolved_artifact_ref: Optional[Reference] = None,
    resolved_variant_ref: Optional[Reference] = None,
    resolved_revision_ref: Optional[Reference] = None,
    entity_type: str = "artifact",
) -> None:
    """Reject requests where caller-supplied refs contradict the resolved revision (rule 2.d enforcement).

    The retrieve API tolerates redundant refs (the same revision identified
    by multiple of `{artifact_ref, variant_ref, revision_ref}`) because they
    are useful for sanity-check shapes. But every redundant identifier must
    name the same row the lookup resolved — otherwise silently favoring one
    ref over another is a footgun. The version field is the one exception:
    it's a per-variant sequence number and lookup-by-id ignores it, so a
    redundant version that disagrees is still a contradiction worth
    rejecting.

    None-valued caller fields are skipped (only present-but-wrong fails).
    None-valued resolved fields are skipped too — caller asked for a
    consistency check the DAO can't service, which is a no-op rather than a
    failure.
    """
    mismatches: list[Optional[str]] = []
    if artifact_ref is not None and resolved_artifact_ref is not None:
        mismatches.append(
            _mismatch(
                f"{entity_type}_ref.id",
                artifact_ref.id,
                "artifact_id",
                resolved_artifact_ref.id,
            )
        )
        mismatches.append(
            _mismatch(
                f"{entity_type}_ref.slug",
                artifact_ref.slug,
                "artifact_slug",
                resolved_artifact_ref.slug,
            )
        )
    if variant_ref is not None and resolved_variant_ref is not None:
        mismatches.append(
            _mismatch(
                f"{entity_type}_variant_ref.id",
                variant_ref.id,
                "variant_id",
                resolved_variant_ref.id,
            )
        )
        mismatches.append(
            _mismatch(
                f"{entity_type}_variant_ref.slug",
                variant_ref.slug,
                "variant_slug",
                resolved_variant_ref.slug,
            )
        )
    if revision_ref is not None and resolved_revision_ref is not None:
        mismatches.append(
            _mismatch(
                f"{entity_type}_revision_ref.id",
                revision_ref.id,
                "id",
                resolved_revision_ref.id,
            )
        )
        mismatches.append(
            _mismatch(
                f"{entity_type}_revision_ref.slug",
                revision_ref.slug,
                "slug",
                resolved_revision_ref.slug,
            )
        )
        if (
            revision_ref.version is not None
            and resolved_revision_ref.version is not None
        ):
            if str(revision_ref.version) != str(resolved_revision_ref.version):
                mismatches.append(
                    f"{entity_type}_revision_ref.version="
                    f"{revision_ref.version!r} does not match resolved "
                    f"revision's version={resolved_revision_ref.version!r}"
                )

    errors = [m for m in mismatches if m]
    if errors:
        raise RetrieveRefsInconsistent("; ".join(errors))
