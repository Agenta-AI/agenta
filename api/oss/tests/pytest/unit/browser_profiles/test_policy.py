from uuid import UUID

import pytest

from oss.src.core.browser_profiles.dtos import BrowserProfile, BrowserProfileState
from oss.src.core.browser_profiles.policy import (
    check_tool_access,
    normalize_allowed_hosts,
    normalize_host,
)
from oss.src.core.browser_profiles.types import (
    BrowserProfileHostInvalid,
    BrowserToolError,
)

OWNER = UUID("00000000-0000-0000-0000-00000000000a")
OTHER = UUID("00000000-0000-0000-0000-00000000000b")


class TestNormalizeHost:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("app.example.com", "app.example.com"),
            ("www.instagram.com", "instagram.com"),
            ("https://www.instagram.com/", "instagram.com"),
            ("  App.Example.COM ", "app.example.com"),
            ("https://app.example.com/login?next=/", "app.example.com"),
            ("app.example.com:8443/path", "app.example.com"),
            ("*.example.com", "example.com"),
            ("example.com.", "example.com"),
            ("bücher.de", "xn--bcher-kva.de"),
        ],
    )
    def test_accepts_and_normalizes(self, raw, expected):
        assert normalize_host(raw) == expected

    @pytest.mark.parametrize(
        "raw",
        [
            "",
            "localhost",
            "http://localhost:3000",
            "api.localhost",
            "127.0.0.1",
            "https://10.0.0.1/admin",
            "[::1]",
            "127.1",
            "intranet",
            "bad_host.example.com",
            "-a.example.com",
        ],
    )
    def test_rejects(self, raw):
        with pytest.raises(BrowserProfileHostInvalid):
            normalize_host(raw)

    def test_list_dedupes_in_order(self):
        assert normalize_allowed_hosts(
            ["b.example.com", "https://a.example.com", "B.example.com"]
        ) == ["b.example.com", "a.example.com"]

    def test_list_requires_one_host(self):
        with pytest.raises(BrowserProfileHostInvalid):
            normalize_allowed_hosts([])


def _profile(*, owner=OWNER, state=BrowserProfileState.READY) -> BrowserProfile:
    return BrowserProfile(
        id=UUID("00000000-0000-0000-0000-000000000001"),
        name="Ops",
        allowed_hosts=["example.com"],
        state=state,
        generation=1,
        created_by_id=owner,
    )


def _code(**kwargs) -> str | None:
    try:
        check_tool_access(**kwargs)
    except BrowserToolError as e:
        return e.code
    return None


class TestCheckToolAccess:
    def test_owner_draft_run_is_allowed(self):
        assert (
            _code(
                profile=_profile(),
                user_id=OWNER,
                is_draft=True,
                revision_author_id=None,
            )
            is None
        )

    def test_owner_committed_run_by_owner_revision_is_allowed(self):
        assert (
            _code(
                profile=_profile(),
                user_id=OWNER,
                is_draft=False,
                revision_author_id=OWNER,
            )
            is None
        )

    def test_missing_profile_is_not_available(self):
        assert (
            _code(profile=None, user_id=OWNER, is_draft=True, revision_author_id=None)
            == "profile_not_available"
        )

    def test_other_run_user_is_not_available(self):
        assert (
            _code(
                profile=_profile(),
                user_id=OTHER,
                is_draft=True,
                revision_author_id=None,
            )
            == "profile_not_available"
        )

    def test_committed_revision_by_someone_else_is_not_available(self):
        assert (
            _code(
                profile=_profile(),
                user_id=OWNER,
                is_draft=False,
                revision_author_id=OTHER,
            )
            == "profile_not_available"
        )

    def test_committed_revision_without_author_is_not_available(self):
        assert (
            _code(
                profile=_profile(),
                user_id=OWNER,
                is_draft=False,
                revision_author_id=None,
            )
            == "profile_not_available"
        )

    def test_pending_login_needs_login(self):
        assert (
            _code(
                profile=_profile(state=BrowserProfileState.PENDING_LOGIN),
                user_id=OWNER,
                is_draft=True,
                revision_author_id=None,
            )
            == "profile_needs_login"
        )

    def test_non_owner_never_learns_the_login_state(self):
        assert (
            _code(
                profile=_profile(state=BrowserProfileState.PENDING_LOGIN),
                user_id=OTHER,
                is_draft=True,
                revision_author_id=None,
            )
            == "profile_not_available"
        )
