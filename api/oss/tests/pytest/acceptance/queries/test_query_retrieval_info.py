"""Acceptance tests for `retrieval_info` on query retrieve endpoint.

Queries do not get deployed to environments and have no embed-resolve step,
so only the direct retrieve path is exercised here.
"""

from uuid import uuid4

import pytest


@pytest.fixture(scope="class")
def query_fixture(authed_api):
    slug = f"q-retr-{uuid4().hex[:8]}"
    r = authed_api("POST", "/queries/", json={"query": {"slug": slug}})
    assert r.status_code == 200, r.text
    qid = r.json()["query"]["id"]
    r = authed_api(
        "POST",
        "/queries/variants/",
        json={"query_variant": {"slug": f"{slug}-v", "query_id": qid}},
    )
    assert r.status_code == 200, r.text
    vid = r.json()["query_variant"]["id"]
    r = authed_api(
        "POST",
        "/queries/revisions/commit",
        json={
            "query_revision_commit": {
                "slug": f"{slug}-v0",
                "query_id": qid,
                "query_variant_id": vid,
                "message": "Initial",
            }
        },
    )
    assert r.status_code == 200, r.text
    r = authed_api(
        "POST",
        "/queries/revisions/commit",
        json={
            "query_revision_commit": {
                "slug": f"{slug}-v1",
                "query_id": qid,
                "query_variant_id": vid,
                "data": {"filtering": {"conditions": []}},
            }
        },
    )
    assert r.status_code == 200, r.text
    revision = r.json()["query_revision"]
    return {
        "query_id": qid,
        "variant_id": vid,
        "revision_id": revision["id"],
    }


class TestQueryRetrievalInfo:
    def test_direct_retrieve_emits_typed_references(self, authed_api, query_fixture):
        r = authed_api(
            "POST",
            "/queries/revisions/retrieve",
            json={"query_variant_ref": {"id": query_fixture["variant_id"]}},
        )
        assert r.status_code == 200, r.text
        info = r.json().get("retrieval_info")
        assert info is not None
        refs = info["references"]
        assert refs["query"]["id"] == query_fixture["query_id"]
        assert refs["query_variant"]["id"] == query_fixture["variant_id"]
        assert refs["query_revision"]["id"] == query_fixture["revision_id"]
        assert info.get("selector") is None
