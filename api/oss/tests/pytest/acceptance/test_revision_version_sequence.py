"""Revision version assignment is collision-free and strictly increasing.

Versions used to be assigned post-insert as a positional count of earlier rows
in the variant. When an earlier revision was hard-removed out of band (a data
migration or manual DB operation), the count regressed and the next commit
silently reused an existing version — two revisions both labeled v2 in one
variant. Versions are now computed pre-insert as GREATEST(count, max + 1)
under a per-variant row lock, so they stay unique on damaged variants and
under concurrent commits, while healthy variants keep the exact same numbers.
"""

import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest


# helpers ----------------------------------------------------------------------


def _create_workflow_with_variant(authed_api):
    slug = f"wf-{uuid4().hex[:8]}"
    response = authed_api(
        "POST",
        "/workflows/",
        json={"workflow": {"slug": slug, "name": slug}},
    )
    assert response.status_code == 200, response.text
    workflow = response.json()["workflow"]

    variant_slug = f"{slug}-v"
    response = authed_api(
        "POST",
        "/workflows/variants/",
        json={
            "workflow_variant": {
                "slug": variant_slug,
                "name": variant_slug,
                "workflow_id": workflow["id"],
            }
        },
    )
    assert response.status_code == 200, response.text
    return workflow, response.json()["workflow_variant"]


def _commit_revision(authed_api, workflow_id: str, variant_id: str, message: str):
    return authed_api(
        "POST",
        "/workflows/revisions/commit",
        json={
            "workflow_revision": {
                "slug": uuid4().hex[-12:],
                "workflow_id": workflow_id,
                "workflow_variant_id": variant_id,
                "message": message,
            }
        },
    )


def _list_revisions(authed_api, workflow_id: str):
    response = authed_api(
        "POST",
        "/workflows/revisions/query",
        json={"workflow_refs": [{"id": workflow_id}]},
    )
    assert response.status_code == 200, response.text
    return response.json()["workflow_revisions"]


def _db_execute(statement: str, **params) -> None:
    """Run one SQL statement against the deployment DB (out-of-band writer)."""
    sqlalchemy = pytest.importorskip("sqlalchemy")
    pytest.importorskip("asyncpg")
    import asyncio

    from sqlalchemy.ext.asyncio import create_async_engine

    uri = os.environ["AGENTA_POSTGRES_URI"]
    if uri.startswith("postgresql://"):
        uri = uri.replace("postgresql://", "postgresql+asyncpg://", 1)

    async def _run():
        engine = create_async_engine(uri)
        try:
            async with engine.begin() as connection:
                await connection.execute(sqlalchemy.text(statement), params)
        finally:
            await engine.dispose()

    asyncio.run(_run())


# tests ------------------------------------------------------------------------


def test_versions_are_gapless_for_healthy_sequential_commits(authed_api):
    workflow, variant = _create_workflow_with_variant(authed_api)

    for i in range(3):
        response = _commit_revision(authed_api, workflow["id"], variant["id"], f"c{i}")
        assert response.status_code == 200, response.text

    revisions = _list_revisions(authed_api, workflow["id"])
    versions = sorted(int(revision["version"]) for revision in revisions)
    assert versions == [0, 1, 2]

    seed = next(r for r in revisions if int(r["version"]) == 0)
    assert not seed.get("data")


@pytest.mark.skipif(
    not os.getenv("AGENTA_POSTGRES_URI"),
    reason="needs AGENTA_POSTGRES_URI for direct DB access",
)
def test_hard_deleted_revision_does_not_cause_version_reuse(authed_api):
    """The customer scenario: an out-of-band hard delete used to make the
    positional count regress, so the next commit reused an existing version."""
    workflow, variant = _create_workflow_with_variant(authed_api)

    for i in range(4):
        response = _commit_revision(authed_api, workflow["id"], variant["id"], f"c{i}")
        assert response.status_code == 200, response.text

    revisions = _list_revisions(authed_api, workflow["id"])
    victim = next(r for r in revisions if int(r["version"]) == 2)
    _db_execute(
        "DELETE FROM workflow_revisions WHERE id = :revision_id",
        revision_id=victim["id"],
    )

    response = _commit_revision(authed_api, workflow["id"], variant["id"], "after-del")
    assert response.status_code == 200, response.text
    assert response.json()["workflow_revision"]["version"] == "4"

    versions = [r["version"] for r in _list_revisions(authed_api, workflow["id"])]
    assert len(versions) == len(set(versions)), versions


def test_concurrent_commits_get_distinct_versions(authed_api):
    workflow, variant = _create_workflow_with_variant(authed_api)

    # Seed the variant so the concurrent burst exercises the non-initial path.
    response = _commit_revision(authed_api, workflow["id"], variant["id"], "seed")
    assert response.status_code == 200, response.text

    def commit(i: int):
        return _commit_revision(authed_api, workflow["id"], variant["id"], f"r{i}")

    with ThreadPoolExecutor(max_workers=12) as pool:
        responses = list(pool.map(commit, range(12)))

    versions = []
    for response in responses:
        assert response.status_code == 200, response.text
        versions.append(response.json()["workflow_revision"]["version"])

    assert len(versions) == len(set(versions)), versions
