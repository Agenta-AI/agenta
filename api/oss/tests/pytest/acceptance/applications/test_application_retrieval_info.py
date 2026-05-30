"""Acceptance tests for `retrieval_info` on application retrieve endpoints."""

from uuid import uuid4

import pytest


@pytest.fixture(scope="class")
def application_fixture(authed_api):
    slug = f"app-retr-{uuid4().hex[:8]}"
    r = authed_api("POST", "/applications/", json={"application": {"slug": slug}})
    assert r.status_code == 200, r.text
    app_id = r.json()["application"]["id"]
    r = authed_api(
        "POST",
        "/applications/variants/",
        json={
            "application_variant": {
                "slug": f"{slug}-v",
                "application_id": app_id,
            }
        },
    )
    assert r.status_code == 200, r.text
    variant_id = r.json()["application_variant"]["id"]
    # v0 + v1 double commit
    r = authed_api(
        "POST",
        "/applications/revisions/commit",
        json={
            "application_revision_commit": {
                "slug": f"{slug}-v0",
                "application_id": app_id,
                "application_variant_id": variant_id,
                "message": "Initial",
            }
        },
    )
    assert r.status_code == 200, r.text
    r = authed_api(
        "POST",
        "/applications/revisions/commit",
        json={
            "application_revision_commit": {
                "slug": f"{slug}-v1",
                "application_id": app_id,
                "application_variant_id": variant_id,
                "data": {"parameters": {}},
            }
        },
    )
    assert r.status_code == 200, r.text
    revision = r.json()["application_revision"]
    return {
        "application_id": app_id,
        "application_slug": slug,
        "variant_id": variant_id,
        "revision_id": revision["id"],
    }


class TestApplicationRetrievalInfo:
    def test_direct_retrieve_emits_typed_references(
        self, authed_api, application_fixture
    ):
        r = authed_api(
            "POST",
            "/applications/revisions/retrieve",
            json={
                "application_variant_ref": {
                    "id": application_fixture["variant_id"],
                },
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["count"] == 1
        info = body.get("retrieval_info")
        assert info is not None
        refs = info["references"]
        assert refs["application"]["id"] == application_fixture["application_id"]
        assert refs["application_variant"]["id"] == application_fixture["variant_id"]
        assert refs["application_revision"]["id"] == application_fixture["revision_id"]
        assert info.get("selector") is None
        for k in ("environment", "environment_variant", "environment_revision"):
            assert k not in refs

    def test_resolve_retrieve_emits_retrieval_info(
        self, authed_api, application_fixture
    ):
        r = authed_api(
            "POST",
            "/applications/revisions/retrieve",
            json={
                "application_variant_ref": {
                    "id": application_fixture["variant_id"],
                },
                "resolve": True,
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["count"] == 1
        info = body.get("retrieval_info")
        assert info is not None
        assert (
            info["references"]["application_revision"]["id"]
            == application_fixture["revision_id"]
        )
        assert body.get("resolution_info") is not None


@pytest.fixture(scope="class")
def env_backed_application_fixture(authed_api):
    slug = f"app-envret-{uuid4().hex[:8]}"
    r = authed_api("POST", "/applications/", json={"application": {"slug": slug}})
    assert r.status_code == 200, r.text
    app_id = r.json()["application"]["id"]
    r = authed_api(
        "POST",
        "/applications/variants/",
        json={
            "application_variant": {
                "slug": f"{slug}-v",
                "application_id": app_id,
            }
        },
    )
    assert r.status_code == 200, r.text
    variant_id = r.json()["application_variant"]["id"]
    r = authed_api(
        "POST",
        "/applications/revisions/commit",
        json={
            "application_revision_commit": {
                "slug": f"{slug}-v0",
                "application_id": app_id,
                "application_variant_id": variant_id,
                "message": "Initial",
            }
        },
    )
    assert r.status_code == 200, r.text
    r = authed_api(
        "POST",
        "/applications/revisions/commit",
        json={
            "application_revision_commit": {
                "slug": f"{slug}-v1",
                "application_id": app_id,
                "application_variant_id": variant_id,
                "data": {"parameters": {}},
            }
        },
    )
    assert r.status_code == 200, r.text
    revision = r.json()["application_revision"]

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
    selector_key = "demo.revision"
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
                            "application": {"id": app_id},
                            "application_variant": {"id": variant_id},
                            "application_revision": {"id": revision["id"]},
                        }
                    }
                },
            }
        },
    )
    assert r.status_code == 200, r.text
    env_revision = r.json()["environment_revision"]
    return {
        "application_id": app_id,
        "variant_id": variant_id,
        "revision_id": revision["id"],
        "environment_id": env_id,
        "environment_variant_id": env_variant_id,
        "environment_revision_id": env_revision["id"],
        "selector_key": selector_key,
    }


class TestApplicationRetrievalInfoEnvBacked:
    def test_env_backed_retrieve_merges_environment_and_target_refs(
        self, authed_api, env_backed_application_fixture
    ):
        f = env_backed_application_fixture
        r = authed_api(
            "POST",
            "/applications/revisions/retrieve",
            json={
                "environment_ref": {"id": f["environment_id"]},
                "key": f["selector_key"],
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        info = body["retrieval_info"]
        assert info is not None
        refs = info["references"]
        assert refs["environment"]["id"] == f["environment_id"]
        assert refs["environment_variant"]["id"] == f["environment_variant_id"]
        assert refs["environment_revision"]["id"] == f["environment_revision_id"]
        assert refs["application"]["id"] == f["application_id"]
        assert refs["application_variant"]["id"] == f["variant_id"]
        assert refs["application_revision"]["id"] == f["revision_id"]
        assert info["selector"] == {"key": f["selector_key"]}

    def test_env_backed_retrieve_missing_key_returns_404(
        self, authed_api, env_backed_application_fixture
    ):
        f = env_backed_application_fixture
        r = authed_api(
            "POST",
            "/applications/revisions/retrieve",
            json={
                "environment_ref": {"id": f["environment_id"]},
                "key": "nonexistent.key",
            },
        )
        assert r.status_code == 404
