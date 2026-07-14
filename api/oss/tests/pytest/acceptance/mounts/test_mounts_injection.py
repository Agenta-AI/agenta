"""Acceptance tests for sandbox-injection bind + signing (M7/M10).

Covers the API surface the runner calls to mount a durable cwd:
  - POST /sessions/mounts/sign?session_id=...  → bind-and-sign the session `cwd` mount
  - POST /mounts/{mount_id}/sign               → sign an existing mount

Asserts the get-or-create upsert is idempotent (same session → same mount), the signed
credentials are prefix-scoped (carry the mount's `<project_id>/<mount_id>` prefix, not the
bucket root), and a durable file written through the mount's file API survives a re-bind
(the cross-turn persistence contract, exercised at the store level).

Requires a configured object store with a working STS endpoint (AGENTA_STORE_* →
SeaweedFS in the dev stack). A 503 means no store / STS — skip rather than fail.

The full runner round-trip (geesefs mount inside a live run, file visible across two turns)
is a manual/live check on the dev stack; see docs/designs/sessions/mounts/extend/tasks.md M10.
"""

from uuid import uuid4

import pytest


def _skip_if_no_store(resp):
    if resp.status_code == 503:
        pytest.skip("Mount storage / STS backend not configured in this environment")


def _sign_session(authed_api, session_id):
    return authed_api(
        "POST", "/sessions/mounts/sign", params={"session_id": session_id}
    )


class TestSessionMountSign:
    def test_bind_and_sign_returns_scoped_credentials(self, authed_api):
        session_id = f"session-{uuid4().hex[:8]}"
        resp = _sign_session(authed_api, session_id)
        _skip_if_no_store(resp)
        assert resp.status_code == 200, resp.text

        body = resp.json()
        mount = body["mount"]
        creds = body["credentials"]

        # The bound mount is the session's cwd (name) and a reserved, session-derived slug.
        assert mount["name"] == "cwd"
        assert mount["slug"].startswith("__ag__session__")
        assert mount["session_id"] == session_id

        # Credentials are prefix-scoped to THIS mount, never the bucket root.
        # The key layout is [<namespace>/]mounts/<project_id>/<mount_id>; assert the
        # mount-scoped tail without coupling to the deployment namespace prefix.
        assert creds["prefix"].endswith(f"mounts/{mount['project_id']}/{mount['id']}")
        assert creds["access_key"]
        assert creds["secret_key"]
        assert creds["bucket"]

    def test_bind_is_idempotent_same_session_same_mount(self, authed_api):
        session_id = f"session-{uuid4().hex[:8]}"
        first = _sign_session(authed_api, session_id)
        _skip_if_no_store(first)
        assert first.status_code == 200, first.text

        second = _sign_session(authed_api, session_id)
        assert second.status_code == 200, second.text

        # Get-or-create: the same session resolves to the same mount row (same id + prefix).
        assert first.json()["mount"]["id"] == second.json()["mount"]["id"]
        assert (
            first.json()["credentials"]["prefix"]
            == second.json()["credentials"]["prefix"]
        )

    def test_different_sessions_get_different_prefixes(self, authed_api):
        a = _sign_session(authed_api, f"session-{uuid4().hex[:8]}")
        _skip_if_no_store(a)
        assert a.status_code == 200, a.text
        b = _sign_session(authed_api, f"session-{uuid4().hex[:8]}")
        assert b.status_code == 200, b.text

        assert a.json()["credentials"]["prefix"] != b.json()["credentials"]["prefix"]

    def test_sign_validates_session_id(self, authed_api):
        # An invalid session id (slashes/control chars) is rejected before signing.
        # `_validate_session_id_http` raises 400 (the shared session-id guard).
        resp = authed_api(
            "POST", "/sessions/mounts/sign", params={"session_id": "bad/../id"}
        )
        assert resp.status_code == 400, resp.text


class TestMountSign:
    def test_sign_existing_mount(self, authed_api):
        # Create a plain (non-session) mount, then sign it.
        slug = uuid4().hex[:12]
        create = authed_api(
            "POST",
            "/mounts/",
            json={"mount": {"slug": slug, "name": f"mount-{slug}"}},
        )
        assert create.status_code == 200, create.text
        mount = create.json()["mount"]

        resp = authed_api("POST", f"/mounts/{mount['id']}/sign")
        _skip_if_no_store(resp)
        assert resp.status_code == 200, resp.text

        creds = resp.json()["credentials"]
        assert creds["prefix"].endswith(f"mounts/{mount['project_id']}/{mount['id']}")

    def test_sign_missing_mount_returns_404(self, authed_api):
        resp = authed_api("POST", f"/mounts/{uuid4()}/sign")
        assert resp.status_code == 404, resp.text


class TestDurablePrefixSurvivesRebind:
    """A file written under the mount's prefix is still there after a re-bind (cross-turn)."""

    def test_file_survives_rebind(self, authed_api):
        session_id = f"session-{uuid4().hex[:8]}"
        first = _sign_session(authed_api, session_id)
        _skip_if_no_store(first)
        assert first.status_code == 200, first.text
        mount_id = first.json()["mount"]["id"]

        # Write a file through the session-scoped file API (same durable prefix geesefs mounts).
        write = authed_api(
            "PUT",
            f"/mounts/{mount_id}/files",
            params={"path": "turn1.txt"},
            data=b"written in turn 1",
        )
        _skip_if_no_store(write)
        assert write.status_code == 200, write.text

        # Re-bind (a fresh "turn"): same mount, and the file is still readable.
        second = _sign_session(authed_api, session_id)
        assert second.status_code == 200, second.text
        assert second.json()["mount"]["id"] == mount_id

        read = authed_api(
            "GET", f"/mounts/{mount_id}/files", params={"read": "turn1.txt"}
        )
        assert read.status_code == 200, read.text
        assert read.json()["content"] == "written in turn 1"
