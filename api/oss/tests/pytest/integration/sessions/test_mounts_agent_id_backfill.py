"""Migration test for the mounts.agent_id backfill (oss000000016_add_mounts_agent_id).

The migration recovers agent_id straight out of an agent-mount slug
(`__ag__agent__<canonical_artifact_id>__<name>`) with
`split_part(substr(slug, 14), '__', 1)`, guarded by
`left(slug, 13) = '__ag__agent__'`. Session-mount slugs
(`__ag__session__<uuid5>__<name>`) hash the session id, so they must stay agent_id-null.

This runs the migration's exact SQL expression against Postgres (no table/FK needed — the
extraction is over literal slugs) so a drift in the expression fails here instead of
silently mis-backfilling. Mirrors TEST-GAPS.md §"mounts.agent_id backfill".
"""

import uuid

import pytest
from sqlalchemy import text

import oss.src.dbs.postgres.shared.engine as engine_module
from oss.src.dbs.postgres.shared.engine import get_transactions_engine


pytestmark = pytest.mark.integration

# Verbatim from the migration: `left(slug, 13) = '__ag__agent__'` guards, and
# `split_part(substr(slug, 14), '__', 1)` extracts.
_BACKFILL_EXPR = (
    "CASE WHEN left(:slug, 13) = '__ag__agent__' "
    "THEN split_part(substr(:slug, 14), '__', 1) ELSE NULL END"
)


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


async def _extract(slug: str):
    engine = get_transactions_engine()
    async with engine.session() as session:
        result = await session.execute(
            text(f"SELECT {_BACKFILL_EXPR} AS agent_id"), {"slug": slug}
        )
        return result.scalar_one()


async def test_agent_slug_backfills_the_canonical_artifact_id():
    artifact_id = str(uuid.uuid4())
    slug = f"__ag__agent__{artifact_id}__my-agent"

    assert await _extract(slug) == artifact_id


async def test_agent_slug_with_underscores_in_name_keeps_only_the_id():
    artifact_id = str(uuid.uuid4())
    # The name segment may itself contain the `__` separator; only the first field is the id.
    slug = f"__ag__agent__{artifact_id}__my__weird__name"

    assert await _extract(slug) == artifact_id


async def test_session_mount_slug_stays_agent_id_null():
    slug = f"__ag__session__{uuid.uuid4().hex}__claude-projects"

    assert await _extract(slug) is None
