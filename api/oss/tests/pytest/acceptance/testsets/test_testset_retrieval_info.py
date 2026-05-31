"""Acceptance tests for `retrieval_info` on testset retrieve endpoint.

Testsets do not get deployed to environments and have no embed-resolve step,
so only the direct retrieve path is exercised here.
"""

from uuid import uuid4

import pytest


@pytest.fixture(scope="class")
def testset_fixture(authed_api):
    slug = f"ts-retr-{uuid4().hex[:8]}"
    r = authed_api("POST", "/testsets/", json={"testset": {"slug": slug}})
    assert r.status_code == 200, r.text
    tid = r.json()["testset"]["id"]
    r = authed_api(
        "POST",
        "/testsets/variants/",
        json={"testset_variant": {"slug": f"{slug}-v", "testset_id": tid}},
    )
    assert r.status_code == 200, r.text
    vid = r.json()["testset_variant"]["id"]
    # v0
    r = authed_api(
        "POST",
        "/testsets/revisions/commit",
        json={
            "testset_revision_commit": {
                "slug": f"{slug}-v0",
                "testset_id": tid,
                "testset_variant_id": vid,
                "message": "Initial",
                "data": {"testcases": []},
            }
        },
    )
    assert r.status_code == 200, r.text
    # v1 with empty testcases list
    r = authed_api(
        "POST",
        "/testsets/revisions/commit",
        json={
            "testset_revision_commit": {
                "slug": f"{slug}-v1",
                "testset_id": tid,
                "testset_variant_id": vid,
                "data": {"testcases": []},
            }
        },
    )
    assert r.status_code == 200, r.text
    revision = r.json()["testset_revision"]
    return {
        "testset_id": tid,
        "variant_id": vid,
        "revision_id": revision["id"],
    }


class TestTestsetRetrievalInfo:
    def test_direct_retrieve_emits_typed_references(self, authed_api, testset_fixture):
        r = authed_api(
            "POST",
            "/testsets/revisions/retrieve",
            json={"testset_variant_ref": {"id": testset_fixture["variant_id"]}},
        )
        assert r.status_code == 200, r.text
        info = r.json().get("retrieval_info")
        assert info is not None
        refs = info["references"]
        assert refs["testset"]["id"] == testset_fixture["testset_id"]
        assert refs["testset_variant"]["id"] == testset_fixture["variant_id"]
        assert refs["testset_revision"]["id"] == testset_fixture["revision_id"]
        assert info.get("selector") is None
