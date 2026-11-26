"""Acceptance tests for artifact-scoped agent mounts.

Query-only tests run without an object store. `POST /mounts/agents/sign` signs a
drive only for the agent run that presents its own run credential; every other
caller gets 404. These tests call with an API key, so they check the 404 paths.
"""

from uuid import uuid4


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

    def test_sign_without_a_run_credential_returns_404_and_creates_nothing(
        self, authed_api
    ):
        # Only an agent run may sign its own agent's drive. An API key is not a run
        # credential, so an existing agent still answers 404 and gets no drive.
        # The 404 comes before any storage call, so this check needs no store.
        artifact_id = _create_workflow(authed_api)
        signed = authed_api(
            "POST",
            "/mounts/agents/sign",
            params={"artifact_id": artifact_id, "name": "default"},
        )
        assert signed.status_code == 404, signed.text

        queried = _query_agent_mount(authed_api, artifact_id)
        assert queried.status_code == 200, queried.text
        assert queried.json()["count"] == 0
