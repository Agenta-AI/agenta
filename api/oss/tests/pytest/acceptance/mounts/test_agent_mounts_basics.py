"""Acceptance tests for artifact-scoped agent mounts.

Query-only tests run without an object store. Credential-signing tests skip when
the running API has no mount storage backend configured. Sign verifies the
artifact exists in the project (404 otherwise), so signing tests create a real
workflow first.
"""

from uuid import uuid4

import pytest


def _create_workflow(authed_api):
    response = authed_api(
        "POST",
        "/workflows/",
        json={"workflow": {"slug": f"wf-agent-mount-{uuid4().hex[:8]}"}},
    )
    assert response.status_code == 200, response.text
    return response.json()["workflow"]["id"]


def _query_agent_mount(authed_api, artifact_id, *, name="default"):
    return authed_api(
        "POST",
        "/mounts/agents/query",
        json={"artifact_id": artifact_id, "name": name},
    )


def _sign_agent_mount(authed_api, artifact_id, *, name="default"):
    response = authed_api(
        "POST",
        "/mounts/agents/sign",
        params={"artifact_id": artifact_id, "name": name},
    )
    if response.status_code == 503:
        pytest.skip("Mount storage backend not configured in this environment")
    return response


class TestAgentMountReads:
    def test_query_rejects_non_uuid_artifact_id(self, authed_api):
        response = _query_agent_mount(authed_api, "not-a-uuid")
        assert response.status_code == 422, response.text

    def test_query_unknown_uuid_stays_empty(self, authed_api):
        artifact_id = str(uuid4())

        first = _query_agent_mount(authed_api, artifact_id)
        assert first.status_code == 200, first.text
        assert first.json()["count"] == 0
        assert first.json()["mounts"] == []

        second = _query_agent_mount(authed_api, artifact_id)
        assert second.status_code == 200, second.text
        assert second.json()["count"] == 0
        assert second.json()["mounts"] == []


class TestAgentMountSign:
    def test_sign_unknown_artifact_returns_404_and_creates_nothing(self, authed_api):
        artifact_id = str(uuid4())

        # Artifact verification runs before the storage check, so 404 needs no store.
        response = authed_api(
            "POST",
            "/mounts/agents/sign",
            params={"artifact_id": artifact_id, "name": "default"},
        )
        assert response.status_code == 404, response.text

        queried = _query_agent_mount(authed_api, artifact_id)
        assert queried.status_code == 200, queried.text
        assert queried.json()["count"] == 0

    def test_sign_then_query_returns_same_mount(self, authed_api):
        artifact_id = _create_workflow(authed_api)
        signed = _sign_agent_mount(authed_api, artifact_id)
        assert signed.status_code == 200, signed.text
        mount_id = signed.json()["mount"]["id"]

        queried = _query_agent_mount(authed_api, artifact_id)
        assert queried.status_code == 200, queried.text
        assert queried.json()["count"] == 1
        assert queried.json()["mounts"][0]["id"] == mount_id

    def test_sign_twice_returns_same_mount(self, authed_api):
        artifact_id = _create_workflow(authed_api)
        first = _sign_agent_mount(authed_api, artifact_id)
        assert first.status_code == 200, first.text

        second = _sign_agent_mount(authed_api, artifact_id)
        assert second.status_code == 200, second.text
        assert second.json()["mount"]["id"] == first.json()["mount"]["id"]
