"""Acceptance tests for `retrieval_info` on evaluator retrieve endpoints."""

from uuid import uuid4

import pytest


@pytest.fixture(scope="class")
def evaluator_fixture(authed_api):
    slug = f"eval-retr-{uuid4().hex[:8]}"
    r = authed_api("POST", "/evaluators/", json={"evaluator": {"slug": slug}})
    assert r.status_code == 200, r.text
    eid = r.json()["evaluator"]["id"]
    r = authed_api(
        "POST",
        "/evaluators/variants/",
        json={"evaluator_variant": {"slug": f"{slug}-v", "evaluator_id": eid}},
    )
    assert r.status_code == 200, r.text
    vid = r.json()["evaluator_variant"]["id"]
    r = authed_api(
        "POST",
        "/evaluators/revisions/commit",
        json={
            "evaluator_revision_commit": {
                "slug": f"{slug}-v0",
                "evaluator_id": eid,
                "evaluator_variant_id": vid,
                "message": "Initial",
            }
        },
    )
    assert r.status_code == 200, r.text
    r = authed_api(
        "POST",
        "/evaluators/revisions/commit",
        json={
            "evaluator_revision_commit": {
                "slug": f"{slug}-v1",
                "evaluator_id": eid,
                "evaluator_variant_id": vid,
                "data": {"parameters": {}},
            }
        },
    )
    assert r.status_code == 200, r.text
    revision = r.json()["evaluator_revision"]
    return {
        "evaluator_id": eid,
        "variant_id": vid,
        "revision_id": revision["id"],
    }


class TestEvaluatorRetrievalInfo:
    def test_direct_retrieve_emits_typed_references(
        self, authed_api, evaluator_fixture
    ):
        r = authed_api(
            "POST",
            "/evaluators/revisions/retrieve",
            json={"evaluator_variant_ref": {"id": evaluator_fixture["variant_id"]}},
        )
        assert r.status_code == 200, r.text
        info = r.json().get("retrieval_info")
        assert info is not None
        refs = info["references"]
        assert refs["evaluator"]["id"] == evaluator_fixture["evaluator_id"]
        assert refs["evaluator_variant"]["id"] == evaluator_fixture["variant_id"]
        assert refs["evaluator_revision"]["id"] == evaluator_fixture["revision_id"]
        assert info.get("selector") is None

    def test_resolve_retrieve_emits_retrieval_info(self, authed_api, evaluator_fixture):
        r = authed_api(
            "POST",
            "/evaluators/revisions/retrieve",
            json={
                "evaluator_variant_ref": {"id": evaluator_fixture["variant_id"]},
                "resolve": True,
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["count"] == 1
        info = body.get("retrieval_info")
        assert info is not None
        assert (
            info["references"]["evaluator_revision"]["id"]
            == evaluator_fixture["revision_id"]
        )
        assert body.get("resolution_info") is not None


@pytest.fixture(scope="class")
def env_backed_evaluator_fixture(authed_api):
    slug = f"eval-envret-{uuid4().hex[:8]}"
    r = authed_api("POST", "/evaluators/", json={"evaluator": {"slug": slug}})
    assert r.status_code == 200, r.text
    eid = r.json()["evaluator"]["id"]
    r = authed_api(
        "POST",
        "/evaluators/variants/",
        json={"evaluator_variant": {"slug": f"{slug}-v", "evaluator_id": eid}},
    )
    assert r.status_code == 200, r.text
    vid = r.json()["evaluator_variant"]["id"]
    r = authed_api(
        "POST",
        "/evaluators/revisions/commit",
        json={
            "evaluator_revision_commit": {
                "slug": f"{slug}-v0",
                "evaluator_id": eid,
                "evaluator_variant_id": vid,
                "message": "Initial",
            }
        },
    )
    assert r.status_code == 200, r.text
    r = authed_api(
        "POST",
        "/evaluators/revisions/commit",
        json={
            "evaluator_revision_commit": {
                "slug": f"{slug}-v1",
                "evaluator_id": eid,
                "evaluator_variant_id": vid,
                "data": {"parameters": {}},
            }
        },
    )
    assert r.status_code == 200, r.text
    revision = r.json()["evaluator_revision"]

    env_slug = f"env-{uuid4().hex[:8]}"
    r = authed_api("POST", "/environments/", json={"environment": {"slug": env_slug}})
    assert r.status_code == 200, r.text
    env_id = r.json()["environment"]["id"]
    r = authed_api(
        "POST",
        "/environments/variants/",
        json={
            "environment_variant": {
                "slug": f"{env_slug}-v",
                "environment_id": env_id,
            }
        },
    )
    assert r.status_code == 200, r.text
    env_variant_id = r.json()["environment_variant"]["id"]
    r = authed_api(
        "POST",
        "/environments/revisions/commit",
        json={
            "environment_revision_commit": {
                "slug": f"{env_slug}-r0",
                "environment_id": env_id,
                "environment_variant_id": env_variant_id,
                "message": "Initial",
                "data": {"references": {}},
            }
        },
    )
    assert r.status_code == 200, r.text
    selector_key = "eval-suite.revision"
    r = authed_api(
        "POST",
        "/environments/revisions/commit",
        json={
            "environment_revision_commit": {
                "slug": f"{env_slug}-r1",
                "environment_id": env_id,
                "environment_variant_id": env_variant_id,
                "data": {
                    "references": {
                        selector_key: {
                            "evaluator": {"id": eid},
                            "evaluator_variant": {"id": vid},
                            "evaluator_revision": {"id": revision["id"]},
                        }
                    }
                },
            }
        },
    )
    assert r.status_code == 200, r.text
    env_revision = r.json()["environment_revision"]
    return {
        "evaluator_id": eid,
        "variant_id": vid,
        "revision_id": revision["id"],
        "environment_id": env_id,
        "environment_variant_id": env_variant_id,
        "environment_revision_id": env_revision["id"],
        "selector_key": selector_key,
    }


class TestEvaluatorRetrievalInfoEnvBacked:
    def test_env_backed_retrieve_merges_environment_and_target_refs(
        self, authed_api, env_backed_evaluator_fixture
    ):
        f = env_backed_evaluator_fixture
        r = authed_api(
            "POST",
            "/evaluators/revisions/retrieve",
            json={
                "environment_ref": {"id": f["environment_id"]},
                "key": f["selector_key"],
            },
        )
        assert r.status_code == 200, r.text
        info = r.json()["retrieval_info"]
        refs = info["references"]
        assert refs["environment"]["id"] == f["environment_id"]
        assert refs["environment_variant"]["id"] == f["environment_variant_id"]
        assert refs["environment_revision"]["id"] == f["environment_revision_id"]
        assert refs["evaluator"]["id"] == f["evaluator_id"]
        assert refs["evaluator_variant"]["id"] == f["variant_id"]
        assert refs["evaluator_revision"]["id"] == f["revision_id"]
        assert info["selector"] == {"key": f["selector_key"]}

    def test_env_backed_retrieve_missing_key_returns_404(
        self, authed_api, env_backed_evaluator_fixture
    ):
        f = env_backed_evaluator_fixture
        r = authed_api(
            "POST",
            "/evaluators/revisions/retrieve",
            json={
                "environment_ref": {"id": f["environment_id"]},
                "key": "nonexistent.key",
            },
        )
        assert r.status_code == 404
