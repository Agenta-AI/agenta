"""Unit tests for the shared retrieve-refs sufficiency validators.

The helpers live in `core/git/types.py` and protect the retrieve flow for
every git-backed entity (workflows, applications, evaluators, testsets,
queries, environments) against caller-supplied refs that cannot identify a
single revision: the version-only-no-scope trap (revision side) and the
variant_ref-with-only-version nonsense shape (variant side).
"""

from uuid import uuid4

import pytest

from oss.src.core.git.types import (
    RetrieveRefsInsufficient,
    validate_revision_refs_sufficient,
    validate_variant_refs_sufficient,
)
from oss.src.core.shared.dtos import Reference


# helpers ---------------------------------------------------------------------


def _ref(*, id=None, slug=None, version=None):
    return Reference(id=id, slug=slug, version=version)


# version-only revision_ref ---------------------------------------------------


class TestVersionOnlyRejection:
    """`revision_ref.version` alone (no id, no slug) is ambiguous without a
    variant scope and must raise."""

    def test_version_only_no_variant_raises(self):
        with pytest.raises(RetrieveRefsInsufficient) as exc:
            validate_revision_refs_sufficient(
                artifact_ref=None,
                variant_ref=None,
                revision_ref=_ref(version="1"),
            )
        assert "version" in exc.value.message

    def test_version_only_with_empty_variant_ref_raises(self):
        # Reference(id=None, slug=None, version=None) is truthy but unidentifying.
        with pytest.raises(RetrieveRefsInsufficient):
            validate_revision_refs_sufficient(
                artifact_ref=None,
                variant_ref=_ref(),
                revision_ref=_ref(version="1"),
            )

    def test_version_only_with_variant_having_only_version_raises(self):
        # A variant_ref whose only field is `version` doesn't scope anything
        # — version isn't an identifier for the variant either.
        with pytest.raises(RetrieveRefsInsufficient):
            validate_revision_refs_sufficient(
                artifact_ref=None,
                variant_ref=_ref(version="3"),
                revision_ref=_ref(version="1"),
            )

    def test_entity_type_appears_in_message(self):
        with pytest.raises(RetrieveRefsInsufficient) as exc:
            validate_revision_refs_sufficient(
                artifact_ref=None,
                variant_ref=None,
                revision_ref=_ref(version="1"),
                entity_type="testset",
            )
        assert "testset_revision_ref.version" in exc.value.message
        assert "testset_variant_ref" in exc.value.message

    def test_entity_type_default_is_artifact(self):
        with pytest.raises(RetrieveRefsInsufficient) as exc:
            validate_revision_refs_sufficient(
                artifact_ref=None,
                variant_ref=None,
                revision_ref=_ref(version="1"),
            )
        assert "artifact_revision_ref.version" in exc.value.message


# version-only with sufficient variant scope ---------------------------------


class TestVersionOnlyWithScopePasses:
    """Either a variant_ref or an artifact_ref is sufficient scope for the
    version filter — variant directly, artifact via the deterministic
    default-variant fallback."""

    def test_variant_id_scopes_version(self):
        validate_revision_refs_sufficient(
            artifact_ref=None,
            variant_ref=_ref(id=uuid4()),
            revision_ref=_ref(version="1"),
        )

    def test_variant_slug_scopes_version(self):
        validate_revision_refs_sufficient(
            artifact_ref=None,
            variant_ref=_ref(slug="my-variant"),
            revision_ref=_ref(version="1"),
        )

    def test_artifact_id_scopes_version(self):
        validate_revision_refs_sufficient(
            artifact_ref=_ref(id=uuid4()),
            variant_ref=None,
            revision_ref=_ref(version="1"),
        )

    def test_artifact_slug_scopes_version(self):
        validate_revision_refs_sufficient(
            artifact_ref=_ref(slug="my-workflow"),
            variant_ref=None,
            revision_ref=_ref(version="1"),
        )

    def test_variant_id_with_artifact_also_passes(self):
        validate_revision_refs_sufficient(
            artifact_ref=_ref(slug="my-workflow"),
            variant_ref=_ref(id=uuid4()),
            revision_ref=_ref(version="1"),
        )


# revision_ref with id or slug is always sufficient --------------------------


class TestRevisionIdOrSlugAlwaysSufficient:
    def test_revision_id_alone(self):
        validate_revision_refs_sufficient(
            artifact_ref=None,
            variant_ref=None,
            revision_ref=_ref(id=uuid4()),
        )

    def test_revision_slug_alone(self):
        validate_revision_refs_sufficient(
            artifact_ref=None,
            variant_ref=None,
            revision_ref=_ref(slug="my-revision"),
        )

    def test_revision_id_with_version_ignores_version(self):
        # The id is project-unique; version becomes a redundant hint.
        validate_revision_refs_sufficient(
            artifact_ref=None,
            variant_ref=None,
            revision_ref=_ref(id=uuid4(), version="1"),
        )

    def test_revision_slug_with_version_ignores_version(self):
        validate_revision_refs_sufficient(
            artifact_ref=None,
            variant_ref=None,
            revision_ref=_ref(slug="my-rev", version="1"),
        )


# nothing-to-look-up cases ---------------------------------------------------


class TestNonTriggering:
    """Cases that must NOT raise: the helper is scoped to one specific
    ambiguity and leaves all others to the caller."""

    def test_all_refs_none(self):
        validate_revision_refs_sufficient(
            artifact_ref=None,
            variant_ref=None,
            revision_ref=None,
        )

    def test_all_refs_empty(self):
        validate_revision_refs_sufficient(
            artifact_ref=_ref(),
            variant_ref=_ref(),
            revision_ref=_ref(),
        )

    def test_artifact_only(self):
        validate_revision_refs_sufficient(
            artifact_ref=_ref(slug="my-workflow"),
            variant_ref=None,
            revision_ref=None,
        )

    def test_variant_only(self):
        validate_revision_refs_sufficient(
            artifact_ref=None,
            variant_ref=_ref(slug="my-variant"),
            revision_ref=None,
        )

    def test_artifact_and_variant_no_revision(self):
        validate_revision_refs_sufficient(
            artifact_ref=_ref(slug="my-workflow"),
            variant_ref=_ref(slug="my-variant"),
            revision_ref=None,
        )


# exception type --------------------------------------------------------------


class TestExceptionType:
    def test_revision_ref_invalid_is_git_error(self):
        from oss.src.core.git.types import GitError

        with pytest.raises(GitError):
            validate_revision_refs_sufficient(
                artifact_ref=None,
                variant_ref=None,
                revision_ref=_ref(version="1"),
            )

    def test_exception_message_attribute(self):
        with pytest.raises(RetrieveRefsInsufficient) as exc:
            validate_revision_refs_sufficient(
                artifact_ref=None,
                variant_ref=None,
                revision_ref=_ref(version="1"),
            )
        # Has the .message attribute carried by GitError base.
        assert exc.value.message
        assert isinstance(exc.value.message, str)


# variant_ref carrying only `version` --------------------------------------


class TestVariantVersionOnlyRejection:
    """A `variant_ref` populated with only `version` is nonsense — variants
    have no `version` field. Reject at the boundary."""

    def test_variant_version_only_raises(self):
        with pytest.raises(RetrieveRefsInsufficient) as exc:
            validate_variant_refs_sufficient(variant_ref=_ref(version="1"))
        assert "variant_ref" in exc.value.message

    def test_entity_type_appears_in_variant_message(self):
        with pytest.raises(RetrieveRefsInsufficient) as exc:
            validate_variant_refs_sufficient(
                variant_ref=_ref(version="1"),
                entity_type="testset",
            )
        assert "testset_variant_ref" in exc.value.message


class TestVariantSufficientShapesPass:
    def test_none_passes(self):
        validate_variant_refs_sufficient(variant_ref=None)

    def test_empty_ref_passes(self):
        validate_variant_refs_sufficient(variant_ref=_ref())

    def test_id_only_passes(self):
        validate_variant_refs_sufficient(variant_ref=_ref(id=uuid4()))

    def test_slug_only_passes(self):
        validate_variant_refs_sufficient(variant_ref=_ref(slug="my-variant"))

    def test_id_with_redundant_version_passes(self):
        validate_variant_refs_sufficient(
            variant_ref=_ref(id=uuid4(), version="1"),
        )

    def test_slug_with_redundant_version_passes(self):
        validate_variant_refs_sufficient(
            variant_ref=_ref(slug="my-variant", version="1"),
        )
