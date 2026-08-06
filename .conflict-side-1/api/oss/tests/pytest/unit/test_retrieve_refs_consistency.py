"""Unit tests for the shared retrieve-refs consistency validator.

`validate_retrieve_refs_consistent` checks that every identifying field in
the caller-supplied artifact/variant/revision refs agrees with the
corresponding field on the resolved revision. Mismatch raises
`RetrieveRefsInconsistent`, which the router translates to HTTP 400.
"""

from uuid import uuid4

import pytest

from oss.src.core.git.types import (
    GitError,
    RetrieveRefsInconsistent,
    validate_retrieve_refs_consistent,
)
from oss.src.core.shared.dtos import Reference


def _ref(*, id=None, slug=None, version=None):
    return Reference(id=id, slug=slug, version=version)


class TestAllRefsAbsent:
    def test_no_caller_refs_passes(self):
        validate_retrieve_refs_consistent(
            artifact_ref=None,
            variant_ref=None,
            revision_ref=None,
            resolved_artifact_ref=_ref(id=uuid4(), slug="my-artifact"),
            resolved_variant_ref=_ref(id=uuid4(), slug="my-variant"),
            resolved_revision_ref=_ref(id=uuid4(), slug="my-revision", version="1"),
        )

    def test_no_resolved_fields_passes(self):
        validate_retrieve_refs_consistent(
            artifact_ref=_ref(slug="my-artifact"),
            variant_ref=_ref(slug="my-variant"),
            revision_ref=_ref(version="1"),
        )

    def test_empty_refs_pass(self):
        validate_retrieve_refs_consistent(
            artifact_ref=_ref(),
            variant_ref=_ref(),
            revision_ref=_ref(),
            resolved_artifact_ref=_ref(id=uuid4()),
            resolved_variant_ref=_ref(id=uuid4()),
            resolved_revision_ref=_ref(id=uuid4()),
        )


class TestArtifactConsistency:
    def test_artifact_slug_match_passes(self):
        validate_retrieve_refs_consistent(
            artifact_ref=_ref(slug="my-artifact"),
            variant_ref=None,
            revision_ref=None,
            resolved_artifact_ref=_ref(slug="my-artifact"),
        )

    def test_artifact_slug_mismatch_raises(self):
        with pytest.raises(RetrieveRefsInconsistent) as exc:
            validate_retrieve_refs_consistent(
                artifact_ref=_ref(slug="wrong-artifact"),
                variant_ref=None,
                revision_ref=None,
                resolved_artifact_ref=_ref(slug="my-artifact"),
            )
        assert "artifact_ref.slug" in exc.value.message
        assert "wrong-artifact" in exc.value.message
        assert "my-artifact" in exc.value.message

    def test_artifact_id_mismatch_raises(self):
        wrong_id = uuid4()
        right_id = uuid4()
        with pytest.raises(RetrieveRefsInconsistent) as exc:
            validate_retrieve_refs_consistent(
                artifact_ref=_ref(id=wrong_id),
                variant_ref=None,
                revision_ref=None,
                resolved_artifact_ref=_ref(id=right_id),
            )
        assert "artifact_ref.id" in exc.value.message

    def test_artifact_id_match_passes(self):
        same = uuid4()
        validate_retrieve_refs_consistent(
            artifact_ref=_ref(id=same),
            variant_ref=None,
            revision_ref=None,
            resolved_artifact_ref=_ref(id=same),
        )

    def test_entity_type_appears_in_message(self):
        with pytest.raises(RetrieveRefsInconsistent) as exc:
            validate_retrieve_refs_consistent(
                artifact_ref=_ref(slug="wrong"),
                variant_ref=None,
                revision_ref=None,
                resolved_artifact_ref=_ref(slug="right"),
                entity_type="testset",
            )
        assert "testset_ref.slug" in exc.value.message


class TestVariantConsistency:
    def test_variant_slug_mismatch_raises(self):
        with pytest.raises(RetrieveRefsInconsistent) as exc:
            validate_retrieve_refs_consistent(
                artifact_ref=None,
                variant_ref=_ref(slug="wrong-variant"),
                revision_ref=None,
                resolved_variant_ref=_ref(slug="my-variant"),
            )
        assert "variant_ref.slug" in exc.value.message

    def test_variant_id_match_passes(self):
        same = uuid4()
        validate_retrieve_refs_consistent(
            artifact_ref=None,
            variant_ref=_ref(id=same),
            revision_ref=None,
            resolved_variant_ref=_ref(id=same),
        )


class TestRevisionConsistency:
    def test_revision_slug_mismatch_raises(self):
        with pytest.raises(RetrieveRefsInconsistent) as exc:
            validate_retrieve_refs_consistent(
                artifact_ref=None,
                variant_ref=None,
                revision_ref=_ref(slug="wrong-rev"),
                resolved_revision_ref=_ref(slug="my-rev"),
            )
        assert "revision_ref.slug" in exc.value.message

    def test_revision_version_mismatch_raises(self):
        with pytest.raises(RetrieveRefsInconsistent) as exc:
            validate_retrieve_refs_consistent(
                artifact_ref=None,
                variant_ref=None,
                revision_ref=_ref(version="2"),
                resolved_revision_ref=_ref(version="1"),
            )
        assert "revision_ref.version" in exc.value.message

    def test_revision_version_match_passes(self):
        validate_retrieve_refs_consistent(
            artifact_ref=None,
            variant_ref=None,
            revision_ref=_ref(version="1"),
            resolved_revision_ref=_ref(version="1"),
        )


class TestCrossFieldConsistency:
    def test_all_match_passes(self):
        a_id = uuid4()
        v_id = uuid4()
        r_id = uuid4()
        validate_retrieve_refs_consistent(
            artifact_ref=_ref(id=a_id, slug="art"),
            variant_ref=_ref(id=v_id, slug="var"),
            revision_ref=_ref(id=r_id, slug="rev", version="3"),
            resolved_artifact_ref=_ref(id=a_id, slug="art"),
            resolved_variant_ref=_ref(id=v_id, slug="var"),
            resolved_revision_ref=_ref(id=r_id, slug="rev", version="3"),
        )

    def test_multiple_mismatches_reported_together(self):
        with pytest.raises(RetrieveRefsInconsistent) as exc:
            validate_retrieve_refs_consistent(
                artifact_ref=_ref(slug="wrong-art"),
                variant_ref=_ref(slug="wrong-var"),
                revision_ref=None,
                resolved_artifact_ref=_ref(slug="art"),
                resolved_variant_ref=_ref(slug="var"),
            )
        assert "artifact_ref.slug" in exc.value.message
        assert "variant_ref.slug" in exc.value.message


class TestExceptionType:
    def test_inconsistent_is_git_error(self):
        with pytest.raises(GitError):
            validate_retrieve_refs_consistent(
                artifact_ref=_ref(slug="wrong"),
                variant_ref=None,
                revision_ref=None,
                resolved_artifact_ref=_ref(slug="right"),
            )

    def test_exception_message_attribute(self):
        with pytest.raises(RetrieveRefsInconsistent) as exc:
            validate_retrieve_refs_consistent(
                artifact_ref=_ref(slug="wrong"),
                variant_ref=None,
                revision_ref=None,
                resolved_artifact_ref=_ref(slug="right"),
            )
        assert exc.value.message
        assert isinstance(exc.value.message, str)
