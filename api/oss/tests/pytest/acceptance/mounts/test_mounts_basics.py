"""Acceptance tests for /mounts and /sessions/mounts.

Covers: create, fetch, query (by session_id), edit, archive/unarchive, and
path-injection rejection. Requires a running API (OSS or EE).
"""

from uuid import uuid4


def _mount_payload(*, name=None, session_id=None):
    # Storage location is derived server-side (bucket from env, key = project_id/mount_id);
    # the caller supplies identity only (slug/name/session_id), no bucket/prefix.
    slug = uuid4().hex[:12]
    return {
        "mount": {
            "slug": slug,
            "name": name or f"mount-{slug}",
            "description": "Acceptance test mount",
            "session_id": session_id,
        }
    }


# ---------------------------------------------------------------------------
# Read-only / empty state
# ---------------------------------------------------------------------------


class TestMountsReads:
    def test_query_mounts_returns_200_empty(self, authed_api):
        response = authed_api("POST", "/mounts/query", json={})
        assert response.status_code == 200, response.text
        body = response.json()
        assert "mounts" in body
        assert isinstance(body["mounts"], list)

    def test_fetch_nonexistent_mount_returns_404(self, authed_api):
        fake_id = str(uuid4())
        response = authed_api("GET", f"/mounts/{fake_id}")
        assert response.status_code == 404, response.text

    def test_query_sessions_mounts_returns_200_empty(self, authed_api):
        session_id = f"session-{uuid4().hex[:8]}"
        response = authed_api(
            "POST",
            "/sessions/mounts/query",
            json={"mount": {"session_id": session_id}},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert "mounts" in body

    def test_query_sessions_mounts_without_session_id_returns_422(self, authed_api):
        response = authed_api("POST", "/sessions/mounts/query", json={})
        assert response.status_code == 422, response.text


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------


class TestMountsCreate:
    def test_create_mount_basic(self, authed_api):
        payload = _mount_payload()
        response = authed_api("POST", "/mounts/", json=payload)
        assert response.status_code == 200, response.text

        body = response.json()
        mount = body["mount"]
        assert mount["slug"] == payload["mount"]["slug"]
        # Storage is server-derived: data carries no caller bucket/prefix anymore.
        assert mount["data"] == {}
        assert "id" in mount

    def test_create_mount_with_session_id(self, authed_api):
        session_id = f"session-{uuid4().hex[:8]}"
        payload = _mount_payload(session_id=session_id)
        response = authed_api("POST", "/mounts/", json=payload)
        assert response.status_code == 200, response.text

        body = response.json()
        assert body["mount"]["session_id"] == session_id

    def test_create_duplicate_slug_returns_409(self, authed_api):
        payload = _mount_payload()
        r1 = authed_api("POST", "/mounts/", json=payload)
        assert r1.status_code == 200, r1.text

        r2 = authed_api("POST", "/mounts/", json=payload)
        assert r2.status_code == 409, r2.text

    def test_create_mount_reserved_slug_returns_422(self, authed_api):
        # Storage location is server-derived (no caller bucket/prefix), so the only create-time
        # guard is the reserved-slug namespace the service mints session slugs into.
        payload = _mount_payload()
        payload["mount"]["slug"] = "__ag__hijack"
        response = authed_api("POST", "/mounts/", json=payload)
        assert response.status_code == 422, response.text


# ---------------------------------------------------------------------------
# Fetch + edit
# ---------------------------------------------------------------------------


class TestMountsFetchEdit:
    def test_fetch_created_mount(self, authed_api):
        payload = _mount_payload()
        create_resp = authed_api("POST", "/mounts/", json=payload)
        assert create_resp.status_code == 200, create_resp.text
        mount_id = create_resp.json()["mount"]["id"]

        fetch_resp = authed_api("GET", f"/mounts/{mount_id}")
        assert fetch_resp.status_code == 200, fetch_resp.text
        assert fetch_resp.json()["mount"]["id"] == mount_id

    def test_edit_mount_name_and_description(self, authed_api):
        payload = _mount_payload(name="original-name")
        create_resp = authed_api("POST", "/mounts/", json=payload)
        assert create_resp.status_code == 200, create_resp.text
        mount = create_resp.json()["mount"]

        edit_payload = {
            "mount": {
                "id": mount["id"],
                "name": "updated-name",
                "description": "updated description",
            }
        }
        edit_resp = authed_api("PUT", f"/mounts/{mount['id']}", json=edit_payload)
        assert edit_resp.status_code == 200, edit_resp.text
        assert edit_resp.json()["mount"]["name"] == "updated-name"

    def test_edit_mount_id_mismatch_returns_400(self, authed_api):
        payload = _mount_payload()
        create_resp = authed_api("POST", "/mounts/", json=payload)
        assert create_resp.status_code == 200, create_resp.text
        mount_id = create_resp.json()["mount"]["id"]

        edit_payload = {
            "mount": {
                "id": str(uuid4()),
                "name": "new-name",
            }
        }
        edit_resp = authed_api("PUT", f"/mounts/{mount_id}", json=edit_payload)
        assert edit_resp.status_code == 400, edit_resp.text


# ---------------------------------------------------------------------------
# Archive / unarchive
# ---------------------------------------------------------------------------


class TestMountsArchive:
    def test_archive_then_unarchive(self, authed_api):
        payload = _mount_payload()
        create_resp = authed_api("POST", "/mounts/", json=payload)
        assert create_resp.status_code == 200, create_resp.text
        mount_id = create_resp.json()["mount"]["id"]

        archive_resp = authed_api("POST", f"/mounts/{mount_id}/archive")
        assert archive_resp.status_code == 200, archive_resp.text
        assert archive_resp.json()["mount"]["deleted_at"] is not None

        unarchive_resp = authed_api("POST", f"/mounts/{mount_id}/unarchive")
        assert unarchive_resp.status_code == 200, unarchive_resp.text
        assert unarchive_resp.json()["mount"].get("deleted_at") is None

    def test_archived_mount_excluded_from_default_query(self, authed_api):
        payload = _mount_payload()
        create_resp = authed_api("POST", "/mounts/", json=payload)
        assert create_resp.status_code == 200, create_resp.text
        mount_id = create_resp.json()["mount"]["id"]
        slug = create_resp.json()["mount"]["slug"]

        authed_api("POST", f"/mounts/{mount_id}/archive")

        query_resp = authed_api("POST", "/mounts/query", json={})
        assert query_resp.status_code == 200, query_resp.text
        slugs = [m["slug"] for m in query_resp.json()["mounts"]]
        assert slug not in slugs


# ---------------------------------------------------------------------------
# Session-filtered view
# ---------------------------------------------------------------------------


class TestSessionsMountsQuery:
    def test_query_by_session_id(self, authed_api):
        session_id = f"session-{uuid4().hex[:8]}"
        payload = _mount_payload(session_id=session_id)

        create_resp = authed_api("POST", "/mounts/", json=payload)
        assert create_resp.status_code == 200, create_resp.text
        mount_id = create_resp.json()["mount"]["id"]

        # Query via /sessions/mounts/query with session_id filter
        query_resp = authed_api(
            "POST",
            f"/sessions/mounts/query?session_id={session_id}",
            json={},
        )
        assert query_resp.status_code == 200, query_resp.text
        ids = [m["id"] for m in query_resp.json()["mounts"]]
        assert mount_id in ids

    def test_session_query_does_not_return_other_session_mounts(self, authed_api):
        session_a = f"session-{uuid4().hex[:8]}"
        session_b = f"session-{uuid4().hex[:8]}"

        payload_a = _mount_payload(session_id=session_a)
        authed_api("POST", "/mounts/", json=payload_a)

        payload_b = _mount_payload(session_id=session_b)
        authed_api("POST", "/mounts/", json=payload_b)

        query_resp = authed_api(
            "POST",
            f"/sessions/mounts/query?session_id={session_a}",
            json={},
        )
        assert query_resp.status_code == 200, query_resp.text
        session_ids = {m["session_id"] for m in query_resp.json()["mounts"]}
        assert session_b not in session_ids


# ---------------------------------------------------------------------------
# File ops (durable store contents)
#
# Require a configured object store (AGENTA_STORE_* → SeaweedFS in the dev
# stack). A 503 means the backend isn't configured in this env — skip rather
# than fail so the suite stays green where no store is wired.
# ---------------------------------------------------------------------------


def _create_mount(authed_api):
    payload = _mount_payload()
    resp = authed_api("POST", "/mounts/", json=payload)
    assert resp.status_code == 200, resp.text
    return resp.json()["mount"]["id"]


def _skip_if_no_store(resp):
    import pytest

    if resp.status_code == 503:
        pytest.skip("Mount storage backend not configured in this environment")


class TestMountFileOps:
    def test_write_read_list_delete_roundtrip(self, authed_api):
        mount_id = _create_mount(authed_api)

        write = authed_api(
            "PUT",
            f"/mounts/{mount_id}/files",
            params={"path": "notes.txt"},
            data=b"hello world",
        )
        _skip_if_no_store(write)
        assert write.status_code == 200, write.text
        assert write.json()["path"] == "notes.txt"

        read = authed_api(
            "GET", f"/mounts/{mount_id}/files", params={"read": "notes.txt"}
        )
        assert read.status_code == 200, read.text
        assert read.json()["content"] == "hello world"

        listing = authed_api("GET", f"/mounts/{mount_id}/files")
        assert listing.status_code == 200, listing.text
        assert "notes.txt" in {f["path"] for f in listing.json()["files"]}

        delete = authed_api(
            "DELETE", f"/mounts/{mount_id}/files", params={"path": "notes.txt"}
        )
        assert delete.status_code == 200, delete.text
        assert delete.json()["count"] == 1

        gone = authed_api(
            "GET", f"/mounts/{mount_id}/files", params={"read": "notes.txt"}
        )
        assert gone.status_code == 404, gone.text

    def test_create_folder_upload_read_cascade_delete(self, authed_api):
        mount_id = _create_mount(authed_api)

        folder = authed_api(
            "POST", f"/mounts/{mount_id}/files/folder", params={"path": "workspace"}
        )
        _skip_if_no_store(folder)
        assert folder.status_code == 200, folder.text
        assert folder.json()["path"] == "workspace"

        # List shows the folder as a folder row, NOT as a phantom file.
        listing = authed_api("GET", f"/mounts/{mount_id}/files")
        assert listing.status_code == 200, listing.text
        files = listing.json()["files"]
        folder_rows = [f for f in files if f.get("is_folder")]
        file_rows = [f for f in files if not f.get("is_folder")]
        assert any(f["path"] == "workspace" for f in folder_rows)
        assert all(not f["path"].endswith("/") for f in file_rows)

        # Upload a binary file into the folder via multipart.
        upload = authed_api(
            "POST",
            f"/mounts/{mount_id}/files/upload",
            params={"path": "workspace/data.bin"},
            files={
                "file": ("data.bin", b"\x00\x01\x02\x03", "application/octet-stream")
            },
        )
        assert upload.status_code == 200, upload.text
        assert upload.json()["path"] == "workspace/data.bin"

        read = authed_api(
            "GET",
            f"/mounts/{mount_id}/files",
            params={"read": "workspace/data.bin"},
        )
        assert read.status_code == 200, read.text

        # Delete the folder → cascades marker + contained file.
        delete = authed_api(
            "DELETE", f"/mounts/{mount_id}/files", params={"path": "workspace"}
        )
        assert delete.status_code == 200, delete.text
        assert delete.json()["count"] >= 2

        after = authed_api("GET", f"/mounts/{mount_id}/files")
        assert after.status_code == 200, after.text
        assert not any(f["path"].startswith("workspace") for f in after.json()["files"])

    def test_upload_falls_back_to_filename(self, authed_api):
        mount_id = _create_mount(authed_api)

        upload = authed_api(
            "POST",
            f"/mounts/{mount_id}/files/upload",
            files={"file": ("report.txt", b"content", "text/plain")},
        )
        _skip_if_no_store(upload)
        assert upload.status_code == 200, upload.text
        assert upload.json()["path"] == "report.txt"

    def test_path_traversal_rejected_on_write(self, authed_api):
        mount_id = _create_mount(authed_api)

        resp = authed_api(
            "PUT",
            f"/mounts/{mount_id}/files",
            params={"path": "../../etc/passwd"},
            data=b"evil",
        )
        # 422 (rejected) is the contract; never 200. A 503 store-not-configured
        # also acceptable since validation precedes storage (so 422 expected).
        assert resp.status_code == 422, resp.text

    def test_path_traversal_rejected_on_folder(self, authed_api):
        mount_id = _create_mount(authed_api)

        resp = authed_api(
            "POST",
            f"/mounts/{mount_id}/files/folder",
            params={"path": "../escape"},
        )
        assert resp.status_code == 422, resp.text

    def test_path_traversal_rejected_on_upload(self, authed_api):
        mount_id = _create_mount(authed_api)

        resp = authed_api(
            "POST",
            f"/mounts/{mount_id}/files/upload",
            params={"path": "/abs/evil"},
            files={"file": ("x", b"x", "text/plain")},
        )
        assert resp.status_code == 422, resp.text

    def test_files_on_missing_mount_returns_404(self, authed_api):
        fake_id = str(uuid4())
        resp = authed_api("GET", f"/mounts/{fake_id}/files")
        assert resp.status_code == 404, resp.text
