"""The people picker: who wrote to the bot, the cached workspace list, and a
full-email lookup. The shared cache is an in-memory dict here."""

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from oss.src.core.channels import people
from oss.src.core.channels.dtos import ChannelPerson

pytestmark = pytest.mark.asyncio


class _Cache:
    def __init__(self):
        self.values = {}

    async def get(self, namespace=None, project_id=None, key=None, model=None, **kw):
        value = self.values.get((namespace, project_id, str(key)))
        if value is None:
            return None
        return model.model_validate(value.model_dump()) if model else value

    async def set(
        self, namespace=None, project_id=None, key=None, value=None, nx=False, **kw
    ):
        name = (namespace, project_id, str(key))
        if nx and name in self.values:
            return False
        self.values[name] = value
        return True

    async def invalidate(self, namespace=None, project_id=None, key=None, **kw):
        self.values.pop((namespace, project_id, str(key)), None)
        return True


@pytest.fixture
def cache(monkeypatch):
    cache = _Cache()
    monkeypatch.setattr(people, "get_cache", cache.get)
    monkeypatch.setattr(people, "set_cache", cache.set)
    monkeypatch.setattr(people, "invalidate_cache", cache.invalidate)
    monkeypatch.setattr(
        people,
        "env",
        SimpleNamespace(
            agenta=SimpleNamespace(
                api=SimpleNamespace(caching=SimpleNamespace(enabled=True))
            )
        ),
    )
    return cache


class _Adapter:
    lists_people = True

    def __init__(self, members):
        self.members = members
        self.list_calls = 0
        self.email_calls = []

    async def list_people(self, *, connection):
        self.list_calls += 1
        return self.members

    async def find_person_by_email(self, *, connection, email):
        self.email_calls.append(email)
        return next((m for m in self.members if m.email == email), None)


def _member(i, **extra):
    return ChannelPerson(
        id=f"U{i}",
        name=f"User {i}",
        email=f"user{i}@example.com",
        source="directory",
        **extra,
    )


CONNECTION = SimpleNamespace(id=uuid4())


async def _settle():
    for _ in range(5):
        await asyncio.sleep(0)


def test_people_who_wrote_are_listed_once_newest_first():
    found = people.people_who_wrote(
        [
            {"id": "U2", "name": "Ben"},
            {"id": 42, "name": "Tg", "username": "tg"},
            {"id": "U2", "name": "Ben (old)"},
            {"id": ""},
            {},
        ]
    )
    assert [(p.id, p.name, p.source) for p in found] == [
        ("U2", "Ben", "messaged"),
        ("42", "Tg", "messaged"),
    ]


async def test_the_first_search_starts_one_background_load_then_finds_by_name(cache):
    adapter = _Adapter([_member(1), _member(2), _member(3, is_bot=True)])
    project_id = uuid4()

    found, directory = await people.query_people(
        adapter=adapter,
        connection=CONNECTION,
        project_id=project_id,
        senders=[],
        text="user",
    )
    assert directory.state == "loading"
    assert found == []
    await _settle()
    assert adapter.list_calls == 1

    found, directory = await people.query_people(
        adapter=adapter,
        connection=CONNECTION,
        project_id=project_id,
        senders=[],
        text="user 2",
    )
    assert directory.state == "ready"
    assert [p.id for p in found] == ["U2"]
    assert adapter.list_calls == 1  # cached, no Slack call


async def test_a_person_who_wrote_gets_the_workspace_name_and_email(cache):
    adapter = _Adapter([_member(1)])
    project_id = uuid4()
    await people.query_people(
        adapter=adapter,
        connection=CONNECTION,
        project_id=project_id,
        senders=[],
        text="",
    )
    await _settle()

    found, _ = await people.query_people(
        adapter=adapter,
        connection=CONNECTION,
        project_id=project_id,
        senders=[{"id": "U1"}],
        text="",
    )
    assert [(p.id, p.email, p.source) for p in found] == [
        ("U1", "user1@example.com", "messaged")
    ]


async def test_a_full_email_is_looked_up_when_the_list_does_not_have_it(cache):
    adapter = _Adapter([_member(9)])
    found, _ = await people.query_people(
        adapter=adapter,
        connection=CONNECTION,
        project_id=uuid4(),
        senders=[],
        text="user9@example.com",
    )
    assert adapter.email_calls == ["user9@example.com"]
    assert [p.id for p in found] == ["U9"]


async def test_refresh_reloads_the_list(cache):
    adapter = _Adapter([_member(1)])
    project_id = uuid4()
    await people.query_people(
        adapter=adapter,
        connection=CONNECTION,
        project_id=project_id,
        senders=[],
        text="",
    )
    await _settle()

    directory = await people.refresh_people(
        adapter=adapter, connection=CONNECTION, project_id=project_id
    )
    await _settle()

    assert directory.state == "loading"
    assert adapter.list_calls == 2


async def test_telegram_has_only_the_people_who_wrote(cache):
    adapter = SimpleNamespace(lists_people=False)

    async def _no_email(**kwargs):
        raise AssertionError("Telegram has no email lookup")

    found, directory = await people.query_people(
        adapter=adapter,
        connection=CONNECTION,
        project_id=uuid4(),
        senders=[{"id": 8883745180, "name": "Ana"}],
        text="",
    )
    assert directory.state == "unavailable"
    assert [p.id for p in found] == ["8883745180"]


def test_cached_directory_round_trips():
    cached = people.CachedDirectory(
        updated_at=datetime.now(timezone.utc), people=[_member(1)]
    )
    assert (
        people.CachedDirectory.model_validate(cached.model_dump()).people[0].id == "U1"
    )


async def test_a_refused_load_reports_failed_and_waits_for_refresh(cache):
    class _Refusing(_Adapter):
        async def list_people(self, *, connection):
            self.list_calls += 1
            raise RuntimeError("missing_scope")

    adapter = _Refusing([])
    project_id = uuid4()
    _, first = await people.query_people(
        adapter=adapter,
        connection=CONNECTION,
        project_id=project_id,
        senders=[],
        text="",
    )
    await _settle()
    _, second = await people.query_people(
        adapter=adapter,
        connection=CONNECTION,
        project_id=project_id,
        senders=[],
        text="",
    )
    await _settle()

    assert first.state == "loading"
    assert second.state == "failed"
    assert adapter.list_calls == 1  # not started again by itself

    refreshed = await people.refresh_people(
        adapter=adapter, connection=CONNECTION, project_id=project_id
    )
    await _settle()
    assert refreshed.state == "loading"
    assert adapter.list_calls == 2


async def test_people_on_the_list_come_back_with_their_workspace_state(cache):
    adapter = _Adapter([_member(1), _member(2, is_deleted=True)])
    project_id = uuid4()
    await people.query_people(
        adapter=adapter,
        connection=CONNECTION,
        project_id=project_id,
        senders=[],
        text="",
    )
    await _settle()

    found, _ = await people.query_people(
        adapter=adapter,
        connection=CONNECTION,
        project_id=project_id,
        senders=[],
        text="",
        ids=["U2"],
    )
    assert [(p.id, p.is_deleted) for p in found] == [("U2", True)]
