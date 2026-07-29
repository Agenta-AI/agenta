"""Unit tests for MountsService slug minting, reserved-slug guard, and path validation."""

from uuid import uuid5, NAMESPACE_DNS

import pytest

from oss.src.core.mounts.service import (
    mint_session_slug,
    reject_reserved_slug,
    validate_file_path,
)
from oss.src.core.mounts.types import (
    MountNameInvalid,
    MountPathInvalid,
    MountSlugReserved,
)


_MOUNTS_NAMESPACE = uuid5(uuid5(NAMESPACE_DNS, "agenta"), "mounts")


# ---------------------------------------------------------------------------
# Session slug minting
# ---------------------------------------------------------------------------


class TestSessionSlugMinting:
    def test_mints_reserved_namespaced_slug(self):
        slug = mint_session_slug(session_id="sess-1", name="cwd")
        expected_hash = uuid5(_MOUNTS_NAMESPACE, "sess-1")
        assert slug == f"__ag__session__{expected_hash}__cwd"

    def test_is_deterministic_for_same_session_and_name(self):
        a = mint_session_slug(session_id="sess-1", name="cwd")
        b = mint_session_slug(session_id="sess-1", name="cwd")
        assert a == b

    def test_different_sessions_get_different_slugs(self):
        a = mint_session_slug(session_id="sess-1", name="cwd")
        b = mint_session_slug(session_id="sess-2", name="cwd")
        assert a != b

    def test_name_is_slugified(self):
        # The mount is an upsert: aliases share the row, so the slug is the canonical form.
        assert mint_session_slug(session_id="sess-1", name="Claude Home").endswith(
            "__claude-home"
        )

    def test_name_that_slugifies_to_nothing_is_rejected(self):
        with pytest.raises(MountNameInvalid):
            mint_session_slug(session_id="sess-1", name="!!!")

    def test_carries_full_undashed_uuid_no_truncation(self):
        slug = mint_session_slug(session_id="sess-1", name="cwd")
        # full canonical dashed uuid5 between the markers
        middle = slug[len("__ag__session__") : -len("__cwd")]
        assert middle == str(uuid5(_MOUNTS_NAMESPACE, "sess-1"))


# ---------------------------------------------------------------------------
# Reserved-slug guard
# ---------------------------------------------------------------------------


class TestReservedSlugGuard:
    def test_allows_plain_slug(self):
        reject_reserved_slug("datasets")

    def test_rejects_reserved_prefix(self):
        with pytest.raises(MountSlugReserved):
            reject_reserved_slug("__ag__anything")


# ---------------------------------------------------------------------------
# File path validation
# ---------------------------------------------------------------------------


class TestFilePathValidation:
    def test_valid_single_segment(self):
        validate_file_path("file.txt")

    def test_valid_multi_segment(self):
        validate_file_path("dir/sub/file.txt")

    def test_rejects_absolute(self):
        with pytest.raises(MountPathInvalid):
            validate_file_path("/etc/passwd")

    def test_rejects_dotdot(self):
        with pytest.raises(MountPathInvalid):
            validate_file_path("safe/../../etc")

    def test_rejects_empty(self):
        with pytest.raises(MountPathInvalid):
            validate_file_path("/")

    def test_accepts_punctuation_real_filenames_use(self):
        # Denylist, not allowlist: only traversal / control chars are unsafe, so real folder names
        # keep working (route groups, npm scopes, angle brackets, etc.).
        validate_file_path("path/<injection>")
        validate_file_path("app/(auth)/[slug]/page.tsx")

    def test_rejects_control_char(self):
        with pytest.raises(MountPathInvalid):
            validate_file_path("path/a\x00b")
