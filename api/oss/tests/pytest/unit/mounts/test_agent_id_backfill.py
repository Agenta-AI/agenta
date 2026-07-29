"""Backfill parser for the `agent_id` migration (oss000000014_add_mounts_agent_id).

The migration's backfill is inline SQL (`split_part(substr(slug, N), '__', 1)`),
matching the sibling core_oss data migrations (oss000000010, oss000000011),
which are also plain SQL with no dedicated unit test. This file pins the
parsing invariant in Python so any drift in the slug format (verified against
`mint_agent_slug`, `core/mounts/service.py`) is caught without a live DB: the
SQL and `mint_agent_slug`/`mint_agent_id` must derive the identical id from
the identical slug. The SQL itself was validated against a real Postgres
instance (ephemeral, local) during implementation.
"""

from uuid import uuid4

from oss.src.core.mounts.service import (
    mint_agent_id,
    mint_agent_slug,
    mint_session_slug,
)

_AGENT_SLUG_PREFIX = "__ag__agent__"


def _parse_agent_id_like_the_migration_sql(slug: str):
    """Python mirror of the migration's `split_part(substr(slug, N), '__', 1)`."""
    if not slug.startswith(_AGENT_SLUG_PREFIX):
        return None
    rest = slug[len(_AGENT_SLUG_PREFIX) :]
    return rest.split("__", 1)[0]


def test_parser_recovers_canonical_artifact_id_from_agent_slug():
    artifact_id = "A0B1C2D3-E4F5-4678-9ABC-DEF012345678"
    slug = mint_agent_slug(artifact_id=artifact_id, name="My Files")

    parsed = _parse_agent_id_like_the_migration_sql(slug)

    assert parsed == mint_agent_id(artifact_id=artifact_id)
    assert parsed == "a0b1c2d3-e4f5-4678-9abc-def012345678"


def test_parser_recovers_id_regardless_of_mount_name_length():
    artifact_id = str(uuid4())
    for name in ("default", "notes", "a-much-longer-mount-name-here"):
        slug = mint_agent_slug(artifact_id=artifact_id, name=name)
        assert _parse_agent_id_like_the_migration_sql(slug) == artifact_id


def test_parser_returns_none_for_session_mount_slug():
    """Session-mount rows must stay agent_id-null: the session segment is a
    uuid5 hash, not the raw id, and the prefix itself does not match."""
    slug = mint_session_slug(session_id="sess-1", name="cwd")

    assert _parse_agent_id_like_the_migration_sql(slug) is None


def test_parser_returns_none_for_unreserved_slug():
    assert _parse_agent_id_like_the_migration_sql("datasets") is None
    assert _parse_agent_id_like_the_migration_sql("__ag__unrelated__x") is None
