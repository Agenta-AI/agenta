"""Acceptance tests for `retrieval_info` on workflow retrieve/resolve endpoints.

Covers:
- Direct retrieve by `workflow_variant_ref` returns retrieval_info with
  workflow / workflow_variant / workflow_revision triple.
- Environment-backed retrieve returns retrieval_info that merges the env
  triple (environment / environment_variant / environment_revision) with
  the resolved target triple plus a `key`.
- `resolve=True` retrieve still emits retrieval_info.
"""

from uuid import uuid4

import pytest


@pytest.fixture(scope="class")
def workflow_fixture(authed_api):
    """Create a workflow with one committed revision."""
    slug = f"wf-retr-{uuid4().hex[:8]}"
    r = authed_api("POST", "/workflows/", json={"workflow": {"slug": slug}})
    assert r.status_code == 200
    workflow_id = r.json()["workflow"]["id"]

    r = authed_api(
        "POST",
        "/workflows/variants/",
        json={
            "workflow_variant": {
                "slug": f"{slug}-v",
                "workflow_id": workflow_id,
            }
        },
    )
    assert r.status_code == 200
    variant_id = r.json()["workflow_variant"]["id"]

    # Revisions follow the v0-then-v1 commit pattern: v0 establishes the
    # revision row, v1+ carries the actual data.
    r = authed_api(
        "POST",
        "/workflows/revisions/commit",
        json={
            "workflow_revision": {
                "slug": f"{slug}-v0",
                "workflow_id": workflow_id,
                "workflow_variant_id": variant_id,
                "message": "Initial",
            }
        },
    )
    assert r.status_code == 200
    r = authed_api(
        "POST",
        "/workflows/revisions/commit",
        json={
            "workflow_revision": {
                "slug": f"{slug}-v1",
                "workflow_id": workflow_id,
                "workflow_variant_id": variant_id,
                "data": {"parameters": {"temperature": 0.2}},
            }
        },
    )
    assert r.status_code == 200
    revision = r.json()["workflow_revision"]

    return {
        "workflow_id": workflow_id,
        "workflow_slug": slug,
        "variant_id": variant_id,
        "variant_slug": f"{slug}-v",
        "revision_id": revision["id"],
        "revision_slug": revision["slug"],
        "revision_version": revision["version"],
    }


class TestWorkflowRetrievalInfo:
    def test_direct_retrieve_emits_typed_references(self, authed_api, workflow_fixture):
        r = authed_api(
            "POST",
            "/workflows/revisions/retrieve",
            json={"workflow_variant_ref": {"id": workflow_fixture["variant_id"]}},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["count"] == 1
        info = body.get("retrieval_info")
        assert info is not None, "retrieval_info should be emitted on retrieve"

        refs = info["references"]
        assert refs["workflow"]["id"] == workflow_fixture["workflow_id"]
        assert refs["workflow_variant"]["id"] == workflow_fixture["variant_id"]
        assert refs["workflow_revision"]["id"] == workflow_fixture["revision_id"]
        assert info.get("selector") is None
        # Environment refs should NOT appear on a direct retrieve.
        assert "environment" not in refs
        assert "environment_variant" not in refs
        assert "environment_revision" not in refs

    def test_resolve_retrieve_emits_retrieval_info(self, authed_api, workflow_fixture):
        r = authed_api(
            "POST",
            "/workflows/revisions/retrieve",
            json={
                "workflow_variant_ref": {"id": workflow_fixture["variant_id"]},
                "resolve": True,
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["count"] == 1
        info = body.get("retrieval_info")
        assert info is not None
        assert (
            info["references"]["workflow_revision"]["id"]
            == workflow_fixture["revision_id"]
        )
        # resolve=True also fills resolution_info
        assert body.get("resolution_info") is not None


@pytest.fixture(scope="class")
def env_backed_fixture(authed_api):
    """Create a workflow plus an environment whose references map points at it."""
    wf_slug = f"wf-envret-{uuid4().hex[:8]}"
    r = authed_api("POST", "/workflows/", json={"workflow": {"slug": wf_slug}})
    assert r.status_code == 200, r.text
    workflow_id = r.json()["workflow"]["id"]
    r = authed_api(
        "POST",
        "/workflows/variants/",
        json={
            "workflow_variant": {
                "slug": f"{wf_slug}-v",
                "workflow_id": workflow_id,
            }
        },
    )
    assert r.status_code == 200, r.text
    variant_id = r.json()["workflow_variant"]["id"]
    # v0 + v1 double commit
    r = authed_api(
        "POST",
        "/workflows/revisions/commit",
        json={
            "workflow_revision": {
                "slug": f"{wf_slug}-v0",
                "workflow_id": workflow_id,
                "workflow_variant_id": variant_id,
                "message": "Initial",
            }
        },
    )
    assert r.status_code == 200
    r = authed_api(
        "POST",
        "/workflows/revisions/commit",
        json={
            "workflow_revision": {
                "slug": f"{wf_slug}-v1",
                "workflow_id": workflow_id,
                "workflow_variant_id": variant_id,
                "data": {"parameters": {}},
            }
        },
    )
    assert r.status_code == 200
    revision = r.json()["workflow_revision"]

    env_slug = f"env-{uuid4().hex[:8]}"
    r = authed_api(
        "POST",
        "/environments/",
        json={"environment": {"slug": env_slug, "name": "Env"}},
    )
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

    # Env revisions follow a v0-then-v1 commit pattern: v0 carries no data,
    # subsequent commits attach the references map.
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
                            "workflow": {"id": workflow_id},
                            "workflow_variant": {"id": variant_id},
                            "workflow_revision": {"id": revision["id"]},
                        }
                    }
                },
            }
        },
    )
    assert r.status_code == 200, r.text
    env_revision = r.json()["environment_revision"]

    return {
        "workflow_id": workflow_id,
        "variant_id": variant_id,
        "revision_id": revision["id"],
        "environment_id": env_id,
        "environment_variant_id": env_variant_id,
        "environment_revision_id": env_revision["id"],
        "selector_key": selector_key,
    }


class TestWorkflowRetrievalInfoEnvBacked:
    def test_env_backed_retrieve_merges_environment_and_target_refs(
        self, authed_api, env_backed_fixture
    ):
        r = authed_api(
            "POST",
            "/workflows/revisions/retrieve",
            json={
                "environment_ref": {"id": env_backed_fixture["environment_id"]},
                "key": env_backed_fixture["selector_key"],
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["count"] == 1
        info = body["retrieval_info"]
        assert info is not None
        refs = info["references"]
        # Both env triple and target triple present.
        assert refs["environment"]["id"] == env_backed_fixture["environment_id"]
        assert (
            refs["environment_variant"]["id"]
            == env_backed_fixture["environment_variant_id"]
        )
        assert (
            refs["environment_revision"]["id"]
            == env_backed_fixture["environment_revision_id"]
        )
        assert refs["workflow"]["id"] == env_backed_fixture["workflow_id"]
        assert refs["workflow_variant"]["id"] == env_backed_fixture["variant_id"]
        assert refs["workflow_revision"]["id"] == env_backed_fixture["revision_id"]
        assert info["selector"] == {"key": env_backed_fixture["selector_key"]}

    def test_env_backed_retrieve_missing_key_returns_404(
        self, authed_api, env_backed_fixture
    ):
        r = authed_api(
            "POST",
            "/workflows/revisions/retrieve",
            json={
                "environment_ref": {"id": env_backed_fixture["environment_id"]},
                "key": "nonexistent.key",
            },
        )
        assert r.status_code == 404
