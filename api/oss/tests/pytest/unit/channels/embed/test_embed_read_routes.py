"""The embed read routes: a visitor sees only the threads in its own space.
`ChannelsService`, the records and attachments services and the live stream
are faked; the router, the adapter and the key checks are real."""

import asyncio
from collections import Counter
from hashlib import sha256
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.channels import ingress as ingress_module
from oss.src.apis.fastapi.channels.ingress import ChannelsIngressRouter
from oss.src.core.channels.adapters.embed.adapter import (
    EmbedAdapter,
    visitor_locator,
)
from oss.src.core.channels.adapters.embed.capabilities import (
    fetch_embed_capabilities,
)
from oss.src.core.channels.dtos import (
    ChannelKeyGrain,
    ChannelPendingChoice,
    ChannelPendingChoiceItem,
    ChannelSpace,
    ChannelSpaceData,
    ChannelSpaceKind,
    ChannelThread,
    ChannelThreadData,
    ChannelThreadFlags,
)
from oss.src.core.channels.utils import compose_external_key
from oss.src.core.sessions.attachments.types import AttachmentNotFound
from oss.src.core.sessions.records.dtos import SessionRecord
from oss.src.utils.throttling import ThrottleResult

from .test_embed_ingress import (
    EMBED_ID,
    KEY,
    OTHER_KEY,
    FakeAdapterRegistry,
    FakeChannelsService,
)

BASE = f"/channels/embed/{EMBED_ID}/conversations"
NOW = datetime(2026, 10, 16, tzinfo=timezone.utc)


def _space_key(key):
    return compose_external_key(
        fetch_embed_capabilities(), ChannelKeyGrain.SPACE, visitor_locator(key)
    )


class FakeReadService(FakeChannelsService):
    """Two visitors' spaces on the one embed connection."""

    def __init__(self):
        super().__init__()
        self.spaces = {}
        self.threads = []
        self.unstarted = {}
        for key in (KEY, OTHER_KEY):
            space = ChannelSpace(
                id=uuid4(),
                connection_id=self.connection_id,
                kind=ChannelSpaceKind.PRIVATE,
                external_key=_space_key(key),
                data=ChannelSpaceData(external_locator=visitor_locator(key)),
            )
            self.spaces[key] = space

    def add_thread(self, key, *, session_id, minutes=0, active=True, choice=None):
        thread = ChannelThread(
            id=uuid4(),
            space_id=self.spaces[key].id,
            agent_id=uuid4(),
            session_id=session_id,
            created_at=NOW + timedelta(minutes=minutes),
            data=ChannelThreadData(pending_choice=choice),
            flags=ChannelThreadFlags(is_active=active),
        )
        self.threads.append(thread)
        return thread

    async def query_spaces(self, *, project_id, space=None, windowing=None):
        assert project_id == self.project_id
        return [
            s
            for s in self.spaces.values()
            # None matches all, as in the DAO: a missing filter must show.
            if space.connection_id in (None, s.connection_id)
            and space.external_key in (None, s.external_key)
        ]

    async def query_threads(self, *, project_id, thread=None, windowing=None):
        assert project_id == self.project_id
        return [t for t in self.threads if t.space_id == thread.space_id]

    async def count_unstarted_turns(self, *, project_id, thread_ids):
        assert project_id == self.project_id
        return sum(self.unstarted.get(thread_id, 0) for thread_id in thread_ids)


class FakeRecords:
    def __init__(self):
        self.calls = []

    async def get_records(self, *, project_id, session_id):
        self.calls.append(session_id)
        return [
            SessionRecord(
                record_id=uuid4(),
                session_id=session_id,
                project_id=project_id,
                sequence=1,
                record_type="message",
                attributes={"role": "user", "text": "hello"},
            )
        ]

    async def get_events_after(self, *, project_id, session_id, after):
        return SimpleNamespace(events=[], watermark=after)


class FakeAttachments:
    def __init__(self):
        self.files = {}

    async def fetch_attachment_content(self, *, project_id, session_id, attachment_id):
        found = self.files.get((session_id, attachment_id))
        if found is None:
            raise AttachmentNotFound(attachment_id=attachment_id)
        return found


@pytest.fixture
def service():
    return FakeReadService()


@pytest.fixture
def records():
    return FakeRecords()


@pytest.fixture
def attachments():
    return FakeAttachments()


@pytest.fixture
def throttle_calls(monkeypatch):
    calls = []

    async def allow(key, **kwargs):
        calls.append((key, kwargs["max_capacity"]))
        return ThrottleResult(
            key="k", allow=True, tokens_remaining=1.0, retry_after_ms=None
        )

    monkeypatch.setattr(ingress_module, "check_throttle", allow)
    return calls


@pytest.fixture
def client(service, records, attachments, throttle_calls):
    router = ChannelsIngressRouter(
        channels_service=service,
        adapter_registry=FakeAdapterRegistry({"embed": EmbedAdapter()}),
        records_service=records,
        attachments_service=attachments,
    )
    app = FastAPI()
    app.include_router(router.router, prefix="/channels")
    return TestClient(app)


def _get(client, url, *, key=KEY):
    headers = {"X-Agenta-Visitor-Key": key} if key is not None else {}
    return client.get(url, headers=headers)


# --- 4.1 list ------------------------------------------------------------- #


def test_list_returns_own_threads_newest_first_one_row_per_session(client, service):
    old = service.add_thread(KEY, session_id="s-old", minutes=0, active=False)
    service.add_thread(KEY, session_id="s-new", minutes=5, active=False)
    reopened = service.add_thread(KEY, session_id="s-new", minutes=9)
    service.add_thread(OTHER_KEY, session_id="s-other", minutes=20)

    response = _get(client, BASE)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["count"] == 2
    assert [c["thread_id"] for c in body["conversations"]] == [
        str(reopened.id),
        str(old.id),
    ]
    assert body["conversations"][0]["is_active"] is True
    assert body["conversations"][1]["is_active"] is False


def test_list_is_empty_before_the_first_message(client, service):
    service.spaces.pop(KEY)

    response = _get(client, BASE)

    assert response.status_code == 200
    assert response.json() == {"count": 0, "conversations": []}


@pytest.mark.parametrize("key", [None, "short-key", "a" * 40])
def test_list_refuses_a_weak_or_missing_key(client, key):
    response = _get(client, BASE, key=key)

    assert response.status_code == 401
    assert response.json() == {"status": "error"}


def test_every_route_refuses_an_inactive_or_archived_embed(client, service):
    thread = service.add_thread(KEY, session_id="s1")
    urls = [
        BASE,
        f"{BASE}/{thread.id}",
        f"{BASE}/{thread.id}/live",
        f"{BASE}/{thread.id}/files/{uuid4()}",
    ]

    service.connection.flags.is_active = False
    assert {_get(client, url).status_code for url in urls} == {401}

    service.connection.flags.is_active = True
    service.archived = True
    assert {_get(client, url).status_code for url in urls} == {401}

    service.archived = False
    unknown = f"/channels/embed/nope/conversations/{thread.id}"
    assert _get(client, unknown).status_code == 401


# --- 4.2 read -------------------------------------------------------------- #


def test_read_returns_records_and_the_pending_choice(client, service, records):
    choice = ChannelPendingChoice(
        choices=[ChannelPendingChoiceItem(label="Approve", token="tok-1")],
        posted_at=NOW,
        interaction_id="int-1",
    )
    thread = service.add_thread(KEY, session_id="s1", choice=choice)

    response = _get(client, f"{BASE}/{thread.id}")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["count"] == 1
    assert body["records"][0]["session_id"] == "s1"
    assert body["pending_choice"]["choices"] == [{"label": "Approve", "token": "tok-1"}]
    assert records.calls == ["s1"]


def test_read_counts_unstarted_turns_over_every_row_of_the_session(
    client, service, records
):
    # A reopen added the newer row; both rows belong to the one session.
    older = service.add_thread(KEY, session_id="s1")
    newer = service.add_thread(KEY, session_id="s1", minutes=5)
    other = service.add_thread(KEY, session_id="s2", minutes=1)
    service.unstarted = {older.id: 1, newer.id: 1, other.id: 4}

    response = _get(client, f"{BASE}/{newer.id}")

    assert response.status_code == 200, response.text
    assert response.json()["unstarted_turns"] == 2


def test_another_visitors_thread_answers_like_an_unknown_one(client, service, records):
    theirs = service.add_thread(OTHER_KEY, session_id="s-other")
    service.add_thread(KEY, session_id="s-mine")

    for suffix in ("", "/live", f"/files/{uuid4()}"):
        other = _get(client, f"{BASE}/{theirs.id}{suffix}")
        unknown = _get(client, f"{BASE}/{uuid4()}{suffix}")
        assert other.status_code == unknown.status_code == 404
        assert other.json() == unknown.json()
    assert records.calls == []


def test_a_visitor_with_no_space_gets_404_for_any_thread(client, service):
    theirs = service.add_thread(OTHER_KEY, session_id="s-other")
    service.spaces.pop(KEY)

    assert _get(client, f"{BASE}/{theirs.id}").status_code == 404


# --- 4.3 live -------------------------------------------------------------- #


@pytest.fixture
def live_calls(monkeypatch):
    calls = []

    async def fake_stream(**kwargs):
        calls.append(kwargs)
        yield "event: ready\ndata: {}\n\n"

    monkeypatch.setattr(ingress_module, "live_event_stream", fake_stream)
    return calls


def test_live_streams_the_threads_session(client, service, live_calls):
    thread = service.add_thread(KEY, session_id="s1")

    response = _get(client, f"{BASE}/{thread.id}/live?after=3")

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["cache-control"] == "no-store"
    assert "event: ready" in response.text
    (call,) = live_calls
    assert call["channel"] == f"events:{service.project_id}:session:s1"
    assert call["after"] == 3


async def test_live_recheck_closes_when_the_embed_is_deactivated_or_archived(
    client, service, live_calls
):
    thread = service.add_thread(KEY, session_id="s1")
    _get(client, f"{BASE}/{thread.id}/live")
    authorized = live_calls[0]["authorization_check"]

    assert await authorized() is True
    service.connection.flags.is_active = False
    assert await authorized() is False
    service.connection.flags.is_active = True
    service.archived = True
    assert await authorized() is False


def test_live_is_404_when_the_shared_reader_is_off(
    client, service, live_calls, monkeypatch
):
    thread = service.add_thread(KEY, session_id="s1")
    monkeypatch.setattr(ingress_module.env.sessions, "shared_reader", False)

    assert _get(client, f"{BASE}/{thread.id}/live").status_code == 404
    assert live_calls == []


def test_live_refuses_past_the_open_stream_cap_and_releases_on_close(
    client, service, live_calls, monkeypatch
):
    thread = service.add_thread(KEY, session_id="s1")
    monkeypatch.setattr(
        ingress_module.env.channels.embed, "max_live_streams_per_embed", 1
    )
    monkeypatch.setattr(ingress_module, "_embed_live_streams", Counter({EMBED_ID: 1}))

    refused = _get(client, f"{BASE}/{thread.id}/live")
    assert refused.status_code == 429
    assert live_calls == []

    ingress_module._embed_live_streams.clear()
    assert _get(client, f"{BASE}/{thread.id}/live").status_code == 200
    assert ingress_module._embed_live_streams[EMBED_ID] == 0


async def test_concurrent_live_requests_cannot_share_one_slot(monkeypatch):
    monkeypatch.setattr(
        ingress_module.env.channels.embed, "max_live_streams_per_embed", 1
    )
    monkeypatch.setattr(ingress_module, "_embed_live_streams", Counter())
    release = asyncio.Event()

    async def held():
        yield "event: ready\ndata: {}\n\n"
        await release.wait()

    statuses = []

    async def send(message):
        if message["type"] == "http.response.start":
            statuses.append(message["status"])

    async def receive():
        await release.wait()
        return {"type": "http.disconnect"}

    scope = {"type": "http", "asgi": {"spec_version": "2.4"}}
    first = asyncio.create_task(
        ingress_module._EmbedLiveResponse(EMBED_ID, held())(scope, receive, send)
    )
    second = asyncio.create_task(
        ingress_module._EmbedLiveResponse(EMBED_ID, held())(scope, receive, send)
    )
    await asyncio.sleep(0.05)
    assert sorted(statuses) == [200, 429]
    release.set()
    await asyncio.gather(first, second)
    assert ingress_module._embed_live_streams[EMBED_ID] == 0


# --- 4.4 files ------------------------------------------------------------- #


def test_file_downloads_an_attachment_of_the_threads_session(
    client, service, attachments
):
    thread = service.add_thread(KEY, session_id="s1")
    file_id = uuid4()
    attachments.files[("s1", file_id)] = SimpleNamespace(
        data=b"%PDF-1",
        attachment=SimpleNamespace(media_type="application/pdf", filename='a"b.pdf'),
    )

    response = _get(client, f"{BASE}/{thread.id}/files/{file_id}")

    assert response.status_code == 200, response.text
    assert response.content == b"%PDF-1"
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["content-disposition"].startswith("attachment;")
    assert '"ab.pdf"' in response.headers["content-disposition"]
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_a_file_of_another_session_is_not_found(client, service, attachments):
    mine = service.add_thread(KEY, session_id="s1")
    theirs = service.add_thread(OTHER_KEY, session_id="s2")
    file_id = uuid4()
    attachments.files[("s2", file_id)] = SimpleNamespace(
        data=b"secret",
        attachment=SimpleNamespace(media_type="text/plain", filename="x.txt"),
    )

    # Through my thread: the lookup is scoped to my session, so not found.
    assert _get(client, f"{BASE}/{mine.id}/files/{file_id}").status_code == 404
    # Through their thread: the thread is not mine, so not found.
    assert _get(client, f"{BASE}/{theirs.id}/files/{file_id}").status_code == 404
    # The owner of the file can read it.
    assert (
        _get(client, f"{BASE}/{theirs.id}/files/{file_id}", key=OTHER_KEY).status_code
        == 200
    )


def test_the_same_key_on_another_embed_is_another_space(client, service):
    # The same visitor key under another connection of the project: same space
    # key, other connection. Its thread must not answer on this embed.
    elsewhere = ChannelSpace(
        id=uuid4(),
        connection_id=uuid4(),
        kind=ChannelSpaceKind.PRIVATE,
        external_key=_space_key(KEY),
        data=ChannelSpaceData(external_locator=visitor_locator(KEY)),
    )
    service.spaces["elsewhere"] = elsewhere
    service.spaces.pop(KEY)
    theirs = service.add_thread("elsewhere", session_id="s-elsewhere")

    assert _get(client, BASE).json() == {"count": 0, "conversations": []}
    assert _get(client, f"{BASE}/{theirs.id}").status_code == 404


# --- read rate limits ------------------------------------------------------ #


def test_reads_use_their_own_buckets_per_embed_then_per_key_hash(
    client, service, throttle_calls, monkeypatch
):
    limits = ingress_module.env.channels.embed
    monkeypatch.setattr(limits, "read_requests_per_minute_per_embed", 6000)
    monkeypatch.setattr(limits, "read_requests_per_minute_per_key", 240)

    assert _get(client, BASE).status_code == 200

    assert throttle_calls == [
        ({"embed_read": EMBED_ID}, 6000),
        ({"embed_read": EMBED_ID, "visitor": sha256(KEY.encode()).hexdigest()}, 240),
    ]


def test_a_burst_of_list_polls_stays_under_the_per_key_default():
    """The widget polls the list about every 300 ms after a first message
    (D12). Ten seconds of that must fit the per-key bucket with room left for
    reads and live reconnects."""

    assert ingress_module.env.channels.embed.read_requests_per_minute_per_key >= 120


def test_a_denied_read_bucket_answers_429_before_any_lookup(
    client, service, records, monkeypatch
):
    thread = service.add_thread(KEY, session_id="s-1")

    async def deny(key, **kwargs):
        return ThrottleResult(
            key="k", allow=False, tokens_remaining=0.0, retry_after_ms=1200
        )

    async def no_lookup(*args, **kwargs):
        raise AssertionError("throttled reads must not reach the database")

    monkeypatch.setattr(ingress_module, "check_throttle", deny)
    monkeypatch.setattr(service, "query_spaces", no_lookup)

    for url in (BASE, f"{BASE}/{thread.id}", f"{BASE}/{thread.id}/files/{uuid4()}"):
        response = _get(client, url)
        assert response.status_code == 429
        assert response.headers["Retry-After"] == "2"
    assert records.calls == []


def test_a_weak_key_is_refused_before_it_reaches_a_bucket(client, throttle_calls):
    assert _get(client, BASE, key="short-key").status_code == 401
    assert throttle_calls == []
