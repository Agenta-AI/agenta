"""Acceptance tests for artifact-scoped agent mounts.

Query-only tests run without an object store. Credential-signing tests skip when
the running API has no mount storage backend configured.
"""

from uuid import uuid4

import pytest


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
    def test_sign_then_query_returns_same_mount(self, authed_api):
        artifact_id = str(uuid4())
        signed = _sign_agent_mount(authed_api, artifact_id)
        assert signed.status_code == 200, signed.text
        mount_id = signed.json()["mount"]["id"]

        queried = _query_agent_mount(authed_api, artifact_id)
        assert queried.status_code == 200, queried.text
        assert queried.json()["count"] == 1
        assert queried.json()["mounts"][0]["id"] == mount_id

    def test_sign_twice_returns_same_mount(self, authed_api):
        artifact_id = str(uuid4())
        first = _sign_agent_mount(authed_api, artifact_id)
        assert first.status_code == 200, first.text

        second = _sign_agent_mount(authed_api, artifact_id)
        assert second.status_code == 200, second.text
        assert second.json()["mount"]["id"] == first.json()["mount"]["id"]
