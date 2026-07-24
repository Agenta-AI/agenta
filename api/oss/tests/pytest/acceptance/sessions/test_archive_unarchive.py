"""Acceptance test for the session archive/unarchive lifecycle routes (OSS edition).

POST /sessions/archive and POST /sessions/unarchive (session_id as a query param) soft-archive
and restore the merged stream row; /sessions/query must exclude an archived session and return
it again once unarchived. Covers TEST-GAPS.md §"archive / unarchive lifecycle", which had only
service-level coverage and no route test.

Requires a live stack (AGENTA_API_URL/AGENTA_AUTH_KEY) — see the pytest `acceptance` marker.
"""

import uuid


def _session_ids(query_response) -> set:
    return {s["session_id"] for s in query_response.json().get("sessions", [])}


class TestSessionArchiveUnarchive:
    """A session created via the stream header is queryable, drops out of /sessions/query when
    archived, and returns when unarchived."""

    def test_archive_excludes_then_unarchive_restores(self, authed_api):
        session_id = str(uuid.uuid4())

        # Create the merged stream row (this is what /sessions/query lists).
        create = authed_api(
            "PUT",
            "/sessions/streams/header",
            params={"session_id": session_id},
            json={"name": "Archive Me", "description": "lifecycle check"},
        )
        assert create.status_code == 200, create.text

        listed = authed_api("POST", "/sessions/query", json={})
        assert listed.status_code == 200, listed.text
        assert session_id in _session_ids(listed)

        archived = authed_api(
            "POST", "/sessions/archive", params={"session_id": session_id}
        )
        assert archived.status_code == 200, archived.text

        after_archive = authed_api("POST", "/sessions/query", json={})
        assert after_archive.status_code == 200, after_archive.text
        assert session_id not in _session_ids(after_archive)

        unarchived = authed_api(
            "POST", "/sessions/unarchive", params={"session_id": session_id}
        )
        assert unarchived.status_code == 200, unarchived.text

        after_unarchive = authed_api("POST", "/sessions/query", json={})
        assert after_unarchive.status_code == 200, after_unarchive.text
        assert session_id in _session_ids(after_unarchive)
