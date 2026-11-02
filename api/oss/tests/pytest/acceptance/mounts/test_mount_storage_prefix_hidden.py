"""The stored mount prefix is internal: no API schema or response exposes it.

`Mount.storage_prefix` is `Field(exclude=True)`. These checks read the deployed app's
generated OpenAPI document and the JSON of every route that returns a mount.
"""

from uuid import uuid4

from oss.tests.pytest.utils.mounts import skip_if_mount_storage_unavailable


def _properties(node):
    """Yield every property name declared anywhere under a JSON schema node."""
    if isinstance(node, dict):
        for name in (node.get("properties") or {}).keys():
            yield name
        for value in node.values():
            yield from _properties(value)
    elif isinstance(node, list):
        for value in node:
            yield from _properties(value)


class TestMountStoragePrefixHidden:
    def test_openapi_has_no_storage_prefix(self, unauthed_api):
        response = unauthed_api("GET", "/openapi.json")
        assert response.status_code == 200, response.text

        schemas = response.json()["components"]["schemas"]

        assert "storage_prefix" not in set(_properties(schemas))

    def test_mount_responses_have_no_storage_prefix(self, authed_api):
        slug = f"hidden-{uuid4().hex[:12]}"
        created = authed_api(
            "POST",
            "/mounts/",
            json={"mount": {"slug": slug, "name": slug}},
        )
        assert created.status_code == 200, created.text
        mount_id = created.json()["mount"]["id"]

        fetched = authed_api("GET", f"/mounts/{mount_id}")
        assert fetched.status_code == 200, fetched.text

        queried = authed_api("POST", "/mounts/query", json={})
        assert queried.status_code == 200, queried.text

        # Each route returns the mount it is about, and none of them carries the prefix.
        for body in (created.json(), fetched.json()):
            assert body["mount"]["id"] == mount_id
            assert "storage_prefix" not in body["mount"], body
        listed = [m for m in queried.json()["mounts"] if m["id"] == mount_id]
        assert len(listed) == 1
        assert all("storage_prefix" not in m for m in queried.json()["mounts"])

        session_id = f"session-{uuid4().hex[:8]}"
        signed = authed_api(
            "POST", "/sessions/mounts/sign", params={"session_id": session_id}
        )
        skip_if_mount_storage_unavailable(signed)
        assert signed.status_code == 200, signed.text
        session_mount_id = signed.json()["mount"]["id"]
        assert "storage_prefix" not in signed.json()["mount"]

        session_mounts = authed_api(
            "POST",
            "/sessions/mounts/query",
            json={"mount": {"session_id": session_id}},
        )
        assert session_mounts.status_code == 200, session_mounts.text
        rows = session_mounts.json()["mounts"]
        assert [m["id"] for m in rows] == [session_mount_id]
        assert all("storage_prefix" not in m for m in rows)
