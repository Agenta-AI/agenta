"""Unit tests for sandbox-injection bind + signing (M7).

Two layers, both against in-memory fakes:
1. ``get_or_create_session_cwd`` mints the deterministic session slug and upserts —
   the same session id resolves to the same row (get-or-create idempotency).
2. ``sign_mount_credentials`` derives the prefix-scoped policy, returns scoped temp
   credentials, and never leaks the master key.

The real STS call (a signed ``GetFederationToken`` against the S3 endpoint) is covered
live against the docker-compose SeaweedFS in the acceptance suite; the fakes here exercise
the service-side derivation (prefix, bucket, policy scope, XML parsing, master-key isolation).
"""

from typing import Dict, Optional
from uuid import uuid4, uuid5, NAMESPACE_DNS

import pytest

from oss.src.core.mounts.dtos import Mount, MountCreate
from oss.src.core.mounts.service import (
    MountsService,
    mint_session_slug,
    _SESSION_CWD_NAME,
)
from oss.src.core.mounts.types import MountStorageUnavailable


_MOUNTS_NAMESPACE = uuid5(uuid5(NAMESPACE_DNS, "agenta"), "mounts")
_BUCKET = "agenta-test"
_MASTER_KEY = "MASTER-ACCESS"
_MASTER_SECRET = "MASTER-SECRET"


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class _FakeCredentials:
    def __init__(self, access_key, secret_key, session_token):
        self.access_key = access_key
        self.secret_key = secret_key
        self.session_token = session_token
        self._expiration = None


class _FakeStorage:
    """Records the scope it was asked to sign; returns scoped (non-master) creds."""

    def __init__(self):
        self.signed_with: Optional[dict] = None
        self.endpoint_url = "http://seaweedfs:8333"
        self.region = "us-east-1"

    async def sign_temp_credentials(self, *, bucket, prefix, duration_seconds):
        self.signed_with = {
            "bucket": bucket,
            "prefix": prefix,
            "duration_seconds": duration_seconds,
        }
        return _FakeCredentials(
            access_key="SCOPED-ACCESS",
            secret_key="SCOPED-SECRET",
            session_token="SCOPED-TOKEN",
        )


class _UpsertDAO:
    """Keys rows by (project_id, slug), mirroring uq_mounts_project_id_slug."""

    def __init__(self):
        self._by_slug: Dict[tuple, Mount] = {}

    async def upsert_mount(self, *, project_id, user_id, mount_create: MountCreate):
        key = (project_id, mount_create.slug)
        existing = self._by_slug.get(key)
        if existing is not None:
            return existing
        mount = Mount(
            id=uuid4(),
            project_id=project_id,
            slug=mount_create.slug,
            name=mount_create.name,
            session_id=mount_create.session_id,
        )
        self._by_slug[key] = mount
        return mount

    async def fetch_mount(self, *, project_id, mount_id):
        for mount in self._by_slug.values():
            if mount.id == mount_id:
                return mount
        return None


def _make_service():
    dao = _UpsertDAO()
    storage = _FakeStorage()
    service = MountsService(mounts_dao=dao, mount_storage=storage, bucket=_BUCKET)
    return service, dao, storage


# ---------------------------------------------------------------------------
# get_or_create_session_cwd
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestGetOrCreateSessionCwd:
    async def test_mints_deterministic_cwd_slug(self):
        service, _, _ = _make_service()
        pid, uid = uuid4(), uuid4()

        mount = await service.get_or_create_session_cwd(
            project_id=pid, user_id=uid, session_id="sess-1"
        )

        assert mount.slug == mint_session_slug(session_id="sess-1", name="cwd")
        assert mount.name == _SESSION_CWD_NAME
        assert mount.session_id == "sess-1"

    async def test_idempotent_same_session_same_row(self):
        service, _, _ = _make_service()
        pid, uid = uuid4(), uuid4()

        first = await service.get_or_create_session_cwd(
            project_id=pid, user_id=uid, session_id="sess-1"
        )
        second = await service.get_or_create_session_cwd(
            project_id=pid, user_id=uid, session_id="sess-1"
        )

        assert first.id == second.id

    async def test_different_sessions_get_different_rows(self):
        service, _, _ = _make_service()
        pid, uid = uuid4(), uuid4()

        a = await service.get_or_create_session_cwd(
            project_id=pid, user_id=uid, session_id="sess-1"
        )
        b = await service.get_or_create_session_cwd(
            project_id=pid, user_id=uid, session_id="sess-2"
        )

        assert a.id != b.id
        assert a.slug != b.slug


# ---------------------------------------------------------------------------
# sign_mount_credentials
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestSignMountCredentials:
    async def test_scopes_policy_to_mount_prefix(self):
        service, _, storage = _make_service()
        pid, uid = uuid4(), uuid4()
        mount = await service.get_or_create_session_cwd(
            project_id=pid, user_id=uid, session_id="sess-1"
        )

        creds = await service.sign_mount_credentials(project_id=pid, mount_id=mount.id)

        # Prefix is identity-derived: mounts/<project_id>/<mount_id> (slug-independent).
        assert storage.signed_with["prefix"] == f"mounts/{pid}/{mount.id}"
        assert storage.signed_with["bucket"] == _BUCKET
        assert creds.prefix == f"mounts/{pid}/{mount.id}"
        assert creds.bucket == _BUCKET

    async def test_returns_scoped_not_master_credentials(self):
        service, _, _ = _make_service()
        pid, uid = uuid4(), uuid4()
        mount = await service.get_or_create_session_cwd(
            project_id=pid, user_id=uid, session_id="sess-1"
        )

        creds = await service.sign_mount_credentials(project_id=pid, mount_id=mount.id)

        assert creds.access_key == "SCOPED-ACCESS"
        assert creds.secret_key == "SCOPED-SECRET"
        assert creds.session_token == "SCOPED-TOKEN"
        # The master credentials must NOT be what's handed out.
        assert creds.access_key != _MASTER_KEY
        assert creds.secret_key != _MASTER_SECRET

    async def test_short_ttl_by_default(self):
        service, _, storage = _make_service()
        pid, uid = uuid4(), uuid4()
        mount = await service.get_or_create_session_cwd(
            project_id=pid, user_id=uid, session_id="sess-1"
        )

        await service.sign_mount_credentials(project_id=pid, mount_id=mount.id)

        # Minutes, not hours.
        assert 0 < storage.signed_with["duration_seconds"] <= 3600

    async def test_unavailable_without_storage(self):
        dao = _UpsertDAO()
        service = MountsService(mounts_dao=dao, mount_storage=None, bucket=_BUCKET)
        pid, uid = uuid4(), uuid4()
        mount = await dao.upsert_mount(
            project_id=pid,
            user_id=uid,
            mount_create=MountCreate(slug="x"),
        )

        with pytest.raises(MountStorageUnavailable):
            await service.sign_mount_credentials(project_id=pid, mount_id=mount.id)


# ---------------------------------------------------------------------------
# Policy scope string (storage layer)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestStoragePolicyScope:
    async def test_policy_resource_targets_only_the_mount_prefix(self):
        from json import loads

        from oss.src.core.store.storage import ObjectStore

        storage = ObjectStore(
            endpoint_url="http://seaweedfs:8333",
            access_key=_MASTER_KEY,
            secret_key=_MASTER_SECRET,
        )

        pid, mid = uuid4(), uuid4()
        prefix = f"{pid}/{mid}"
        policy = loads(storage._scope_policy(bucket=_BUCKET, prefix=prefix))

        resources = [
            r
            for stmt in policy["Statement"]
            for r in (
                stmt["Resource"]
                if isinstance(stmt["Resource"], list)
                else [stmt["Resource"]]
            )
        ]
        # Object actions scoped to exactly this mount's prefix; nothing broader.
        assert f"arn:aws:s3:::{_BUCKET}/{prefix}/*" in resources
        assert all(
            r in (f"arn:aws:s3:::{_BUCKET}/{prefix}/*", f"arn:aws:s3:::{_BUCKET}")
            for r in resources
        )

    async def test_parses_federation_token_xml(self):
        from oss.src.core.store.storage import _parse_federation_token

        xml = (
            '<?xml version="1.0"?>'
            '<GetFederationTokenResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">'
            "<GetFederationTokenResult><Credentials>"
            "<AccessKeyId>ASIASCOPED</AccessKeyId>"
            "<SecretAccessKey>scoped-secret</SecretAccessKey>"
            "<SessionToken>scoped-token</SessionToken>"
            "<Expiration>2026-06-30T08:00:00Z</Expiration>"
            "</Credentials></GetFederationTokenResult></GetFederationTokenResponse>"
        )
        creds = _parse_federation_token(xml)
        assert creds.access_key == "ASIASCOPED"
        assert creds.secret_key == "scoped-secret"
        assert creds.session_token == "scoped-token"
        # The scoped key is NOT the master key.
        assert creds.access_key != _MASTER_KEY
