"""The `fetch_principal` cache: hits and absence are cached; invalidation is a direct
delete by key. The DAO's statement is stubbed; the cache uses the real serializer."""

from uuid import uuid4

import pytest

import oss.src.dbs.postgres.access.dao as dao_module
from oss.src.core.access.dtos import PrincipalKind, PrincipalRecord, PrincipalRef
from oss.src.dbs.postgres.access.dao import PrincipalsDAO, invalidate_principal_cache
from oss.tests.pytest.utils.cache import FakeCache


class _StubDAO(PrincipalsDAO):
    def __init__(self, records):
        super().__init__(engine=None)
        self.records = records
        self.calls = []

    async def _read(self, *, principal):
        self.calls.append(principal)
        return self.records.get(principal)


@pytest.fixture
def fake_cache(monkeypatch):
    return FakeCache().install(monkeypatch, dao_module)


async def test_fetch_principal_caches_hits_and_absence(fake_cache):
    human = PrincipalRef(kind=PrincipalKind.HUMAN, id=uuid4())
    record = PrincipalRecord(principal=human, acting_user_id=human.id, is_active=True)
    dao = _StubDAO({human: record})

    assert await dao.fetch_principal(principal=human) == record
    assert await dao.fetch_principal(principal=human) == record
    assert dao.calls == [human]

    unknown = PrincipalRef(kind=PrincipalKind.API_KEY, id=uuid4())
    assert await dao.fetch_principal(principal=unknown) is None
    assert await dao.fetch_principal(principal=unknown) is None
    assert dao.calls == [human, unknown]


async def test_invalidate_principal_cache_is_a_direct_delete(fake_cache):
    key = PrincipalRef(kind=PrincipalKind.API_KEY, id=uuid4())
    record = PrincipalRecord(
        principal=key, project_id=uuid4(), acting_user_id=uuid4(), is_active=True
    )
    dao = _StubDAO({key: record})
    await dao.fetch_principal(principal=key)

    await invalidate_principal_cache(principal=key)
    assert fake_cache.scans == [] and len(fake_cache.deletes) == 1

    dao.records = {}
    assert await dao.fetch_principal(principal=key) is None
    assert dao.calls == [key, key]


async def test_cache_errors_read_the_dao_every_time(monkeypatch):
    FakeCache(fail=True).install(monkeypatch, dao_module)
    human = PrincipalRef(kind=PrincipalKind.HUMAN, id=uuid4())
    record = PrincipalRecord(principal=human, acting_user_id=human.id, is_active=True)
    dao = _StubDAO({human: record})
    assert await dao.fetch_principal(principal=human) == record
    assert await dao.fetch_principal(principal=human) == record
    assert dao.calls == [human, human]
