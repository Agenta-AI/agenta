"""Acceptance tests for `POST /mounts/sign` (a drive by its slug) and read-only credentials.

A drive signed with `access=read` must read and list its prefix on the real store,
and fail to put or delete there: the STS session policy is the boundary, not the mount flag.

Requires a configured object store with a working STS endpoint, reachable from the test
host at the endpoint the credentials name (the dev stack's SeaweedFS).
"""

import asyncio
import os
from io import BytesIO
from urllib.parse import urlparse
from uuid import uuid4

import aiohttp
import pytest
from miniopy_async import Minio
from miniopy_async.error import S3Error

from oss.tests.pytest.utils.mounts import skip_if_mount_storage_unavailable


def _create_drive(authed_api) -> dict:
    slug = f"drive-{uuid4().hex[:10]}"
    create = authed_api(
        "POST", "/mounts/", json={"mount": {"slug": slug, "name": slug}}
    )
    assert create.status_code == 200, create.text
    return create.json()["mount"]


def _sign(authed_api, slug, access=None):
    params = {"slug": slug}
    if access:
        params["access"] = access
    return authed_api("POST", "/mounts/sign", params=params)


def _client(credentials) -> Minio:
    endpoint = urlparse(credentials["endpoint"])
    return Minio(
        endpoint.netloc,
        access_key=credentials["access_key"],
        secret_key=credentials["secret_key"],
        session_token=credentials["session_token"],
        secure=endpoint.scheme == "https",
        region=credentials["region"],
    )


async def _store_checks(credentials):
    client = _client(credentials)
    bucket = credentials["bucket"]
    prefix = credentials["prefix"].rstrip("/")
    result = {}
    async with aiohttp.ClientSession() as session:
        response = await client.get_object(bucket, f"{prefix}/seed.txt", session)
        result["read"] = await response.read()
    result["listed"] = [
        obj.object_name
        async for obj in client.list_objects(
            bucket, prefix=f"{prefix}/", recursive=True
        )
    ]
    for name, call in (
        (
            "put",
            client.put_object(bucket, f"{prefix}/new.txt", BytesIO(b"x"), length=1),
        ),
        ("delete", client.remove_object(bucket, f"{prefix}/seed.txt")),
    ):
        try:
            await call
            result[name] = "allowed"
        except S3Error as e:
            result[name] = e.code
    return result


def _run_on_store(credentials):
    try:
        return asyncio.run(_store_checks(credentials))
    except (aiohttp.ClientConnectionError, OSError) as e:
        if os.getenv("AGENTA_TEST_REQUIRE_MOUNT_STORAGE", "").lower() == "true":
            pytest.fail(f"The store endpoint is not reachable: {e}")
        pytest.skip("The store endpoint in the credentials is not reachable from here")


class TestMountSignBySlug:
    def test_signs_an_existing_drive_and_never_creates_one(self, authed_api):
        drive = _create_drive(authed_api)
        resp = _sign(authed_api, drive["slug"])
        skip_if_mount_storage_unavailable(resp)
        assert resp.status_code == 200, resp.text
        assert resp.json()["mount"]["id"] == drive["id"]

        missing = _sign(authed_api, f"missing-{uuid4().hex[:8]}")
        assert missing.status_code == 404, missing.text

    def test_an_archived_drive_is_not_signed(self, authed_api):
        drive = _create_drive(authed_api)
        archive = authed_api("POST", f"/mounts/{drive['id']}/archive")
        assert archive.status_code == 200, archive.text
        resp = _sign(authed_api, drive["slug"])
        skip_if_mount_storage_unavailable(resp)
        assert resp.status_code == 404, resp.text

    def test_a_reserved_slug_is_refused(self, authed_api):
        resp = _sign(authed_api, f"__ag__session__{uuid4().hex[:8]}")
        assert resp.status_code == 422, resp.text


class TestReadOnlyCredentials:
    def test_read_only_credentials_read_and_list_but_cannot_write(self, authed_api):
        drive = _create_drive(authed_api)
        write = authed_api(
            "PUT",
            f"/mounts/{drive['id']}/files",
            params={"path": "seed.txt"},
            data=b"seed",
        )
        skip_if_mount_storage_unavailable(write)
        assert write.status_code == 200, write.text

        resp = _sign(authed_api, drive["slug"], access="read")
        skip_if_mount_storage_unavailable(resp)
        assert resp.status_code == 200, resp.text

        result = _run_on_store(resp.json()["credentials"])
        assert result["read"] == b"seed"
        assert any(name.endswith("/seed.txt") for name in result["listed"])
        assert result["put"] == "AccessDenied"
        assert result["delete"] == "AccessDenied"

    def test_read_write_credentials_can_write(self, authed_api):
        drive = _create_drive(authed_api)
        write = authed_api(
            "PUT",
            f"/mounts/{drive['id']}/files",
            params={"path": "seed.txt"},
            data=b"seed",
        )
        skip_if_mount_storage_unavailable(write)
        assert write.status_code == 200, write.text

        resp = _sign(authed_api, drive["slug"])
        skip_if_mount_storage_unavailable(resp)
        assert resp.status_code == 200, resp.text

        result = _run_on_store(resp.json()["credentials"])
        assert result["put"] == "allowed"
        assert result["delete"] == "allowed"
