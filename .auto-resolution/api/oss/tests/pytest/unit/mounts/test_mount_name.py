"""Session mounts are an upsert: names that slugify alike share a row; empty slugs are rejected."""

import pytest

from oss.src.core.mounts.service import mint_session_slug, slugify_mount_name
from oss.src.core.mounts.types import MountNameInvalid


@pytest.mark.parametrize("name", ["cwd", "claude-projects", "pi-sessions", "a1"])
def test_canonical_names_pass_through(name):
    assert slugify_mount_name(name) == name


@pytest.mark.parametrize(
    "name, slug",
    [
        ("CWD", "cwd"),
        ("--cwd--", "cwd"),
        ("claude projects", "claude-projects"),
        ("claude_projects", "claude-projects"),
        ("claude...projects", "claude-projects"),
    ],
)
def test_aliases_fold_onto_the_canonical_slug(name, slug):
    assert slugify_mount_name(name) == slug


@pytest.mark.parametrize("name", ["!!!", "   ", ""])
def test_names_that_slugify_to_nothing_are_rejected(name):
    # An empty slug would mint a nameless `__ag__<uuid5>__` prefix.
    with pytest.raises(MountNameInvalid):
        slugify_mount_name(name)
    with pytest.raises(MountNameInvalid):
        mint_session_slug(session_id="s1", name=name)


def test_aliases_resolve_to_the_same_slug_so_the_upsert_returns_one_row():
    a = mint_session_slug(session_id="s1", name="claude projects")
    b = mint_session_slug(session_id="s1", name="claude-projects")
    assert a == b
    assert a.endswith("__claude-projects")


def test_slug_is_deterministic_per_session_and_name():
    a = mint_session_slug(session_id="s1", name="cwd")
    b = mint_session_slug(session_id="s1", name="cwd")
    c = mint_session_slug(session_id="s2", name="cwd")
    assert a == b
    assert a != c
