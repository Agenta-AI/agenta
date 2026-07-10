"""Mount names must already be their own slug, so distinct names never share a row."""

import pytest

from oss.src.core.mounts.service import mint_session_slug, validate_mount_name
from oss.src.core.mounts.types import MountNameInvalid


@pytest.mark.parametrize(
    "name", ["cwd", "claude-projects", "pi-sessions", "a1", "x-y-z"]
)
def test_canonical_names_are_accepted(name):
    validate_mount_name(name)


@pytest.mark.parametrize(
    "name",
    [
        "CWD",  # case folds onto "cwd"
        "claude projects",  # space folds onto "claude-projects"
        "claude_projects",  # underscore folds onto "claude-projects"
        "claude...projects",  # punctuation run folds onto "claude-projects"
        "--cwd--",  # leading/trailing dashes strip onto "cwd"
        "!!!",  # punctuation-only slugifies to ""
        "   ",  # whitespace-only slugifies to ""
        "",
    ],
)
def test_non_canonical_names_are_rejected(name):
    with pytest.raises(MountNameInvalid):
        validate_mount_name(name)


def test_names_that_would_collide_cannot_both_be_minted():
    # Only the canonical spelling survives, so one name maps to exactly one slug.
    assert mint_session_slug(session_id="s1", name="claude-projects").endswith(
        "__claude-projects"
    )
    with pytest.raises(MountNameInvalid):
        mint_session_slug(session_id="s1", name="claude projects")


def test_slug_is_deterministic_per_session_and_name():
    a = mint_session_slug(session_id="s1", name="cwd")
    b = mint_session_slug(session_id="s1", name="cwd")
    c = mint_session_slug(session_id="s2", name="cwd")
    assert a == b
    assert a != c
