"""Acceptance tests for `retrieval_info` on environment retrieve/resolve."""

from uuid import uuid4

import pytest


@pytest.fixture(scope="class")
def environment_fixture(authed_api):
    slug = f"env-retr-{uuid4().hex[:8]}"
    r = authed_api("POST", "/environments/", json={"environment": {"slug": slug}})
    assert r.status_code == 200, r.text
    env_id = r.json()["environment"]["id"]
    r = authed_api(
        "POST",
        "/environments/variants/",
        json={
            "environment_variant": {
                "slug": f"{slug}-v",
                "environment_id": env_id,
            }
        },
    )
    assert r.status_code == 200, r.text
    variant_id = r.json()["environment_variant"]["id"]
    # v0
    r = authed_api(
        "POST",
        "/environments/revisions/commit",
        json={
            "environment_revision_commit": {
                "slug": f"{slug}-r0",
                "environment_id": env_id,
                "environment_variant_id": variant_id,
                "message": "Initial",
                "data": {"references": {}},
            }
        },
    )
    assert r.status_code == 200, r.text
    # v1 with empty refs (still no embeds — safe for resolve)
    r = authed_api(
        "POST",
        "/environments/revisions/commit",
        json={
            "environment_revision_commit": {
                "slug": f"{slug}-r1",
                "environment_id": env_id,
                "environment_variant_id": variant_id,
                "data": {"references": {}},
            }
        },
    )
    assert r.status_code == 200, r.text
    revision = r.json()["environment_revision"]
    return {
        "environment_id": env_id,
        "variant_id": variant_id,
        "revision_id": revision["id"],
    }


class TestEnvironmentRetrievalInfo:
    def test_direct_retrieve_emits_typed_references(
        self, authed_api, environment_fixture
    ):
        r = authed_api(
            "POST",
            "/environments/revisions/retrieve",
            json={
                "environment_revision_ref": {"id": environment_fixture["revision_id"]}
            },
        )
        assert r.status_code == 200, r.text
        info = r.json()["retrieval_info"]
        assert info is not None
        refs = info["references"]
        assert refs["environment"]["id"] == environment_fixture["environment_id"]
        assert refs["environment_variant"]["id"] == environment_fixture["variant_id"]
        assert refs["environment_revision"]["id"] == environment_fixture["revision_id"]
        assert info.get("selector") is None

    def test_resolve_retrieve_emits_retrieval_info(
        self, authed_api, environment_fixture
    ):
        r = authed_api(
            "POST",
            "/environments/revisions/retrieve",
            json={
                "environment_revision_ref": {"id": environment_fixture["revision_id"]},
                "resolve": True,
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # Resolve with no embeds in the data still emits retrieval_info and a
        # zero-counts resolution_info.
        info = body.get("retrieval_info")
        assert info is not None
        assert (
            info["references"]["environment_revision"]["id"]
            == environment_fixture["revision_id"]
        )
        assert body.get("resolution_info") is not None
