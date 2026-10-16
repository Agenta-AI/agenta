"""The embed ingress and config routes through the real `_ingest`. Only
`ChannelsService` and the throttle are faked."""

import string
import json
from hashlib import sha256
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.channels import ingress as ingress_module
from oss.src.apis.fastapi.channels.ingress import ChannelsIngressRouter
from oss.src.core.channels.adapters.embed.adapter import EmbedAdapter
from oss.src.core.channels.adapters.embed.capabilities import (
    fetch_embed_capabilities,
)
from oss.src.core.channels.dtos import (
    ChannelConnection,
    ChannelConnectionFlags,
    ChannelKeyGrain,
)
from oss.src.core.channels.types import ChannelNotSupported
from oss.src.core.channels.utils import compose_external_key
from oss.src.utils.throttling import ThrottleResult

KEY = string.ascii_letters[:40]  # a strong key: 40 distinct
OTHER_KEY = string.ascii_letters[10:50]
EMBED_ID = "Ab12_cd34-EF56gh78ij90"
URL = f"/channels/embed/events/{EMBED_ID}/"


class FakeAdapterRegistry:
    def __init__(self, adapters):
        self._adapters = adapters

    def get(self, channel):
        if channel not in self._adapters:
            raise ChannelNotSupported(channel=channel)
        return self._adapters[channel]


class FakeChannelsService:
    """One embed connection. `archived` makes the lookup find nothing, as the
    DAO does for a row with `deleted_at` set."""

    def __init__(self):
        self.project_id = uuid4()
        self.connection_id = uuid4()
        self.recorded = []
        self.seen = set()
        self.archived = False
        self._external_key = compose_external_key(
            fetch_embed_capabilities(),
            ChannelKeyGrain.CONNECTION,
            {"embed": EMBED_ID},
        )
        self.connection = ChannelConnection(
            id=self.connection_id,
            slug="embed-connection",
            channel="embed",
            name="Support widget",
            external_key=self._external_key,
            data={
                "connection_locator": {"embed": EMBED_ID},
                "allowed_origins": "https://tool.example.com\nhttps://x.com; script-src *",
                "appearance": {"greeting": "Hi"},
                "credential_secret_id": str(uuid4()),
            },
            flags=ChannelConnectionFlags(is_active=True, is_verified=True),
        )

    async def get_project_and_connection_by_external_key(
        self, *, channel, external_key
    ):
        if self.archived or external_key != self._external_key:
            return None
        return (self.project_id, self.connection_id)

    async def fetch_connection(self, *, project_id, connection_id):
        return self.connection if connection_id == self.connection_id else None

    async def record_inbox_event(self, *, project_id, event):
        key = (event.connection_id, event.external_id)
        if key in self.seen:
            return None
        self.seen.add(key)
        self.recorded.append(event)
        return event


@pytest.fixture
def service():
    return FakeChannelsService()


@pytest.fixture
def throttle_calls(monkeypatch):
    calls = []

    async def allow(key, **kwargs):
        calls.append(key)
        return ThrottleResult(
            key="k", allow=True, tokens_remaining=1.0, retry_after_ms=None
        )

    monkeypatch.setattr(ingress_module, "check_throttle", allow)
    return calls


@pytest.fixture
def client(service, throttle_calls):
    registry = FakeAdapterRegistry({"embed": EmbedAdapter()})
    router = ChannelsIngressRouter(channels_service=service, adapter_registry=registry)
    app = FastAPI()
    app.include_router(router.router, prefix="/channels")
    return TestClient(app)


def _post(client, payload, *, key=KEY, url=URL):
    headers = {"X-Agenta-Visitor-Key": key} if key is not None else {}
    return client.post(url, headers=headers, content=json.dumps(payload).encode())


def test_a_message_writes_one_row_in_the_visitor_space(client, service):
    response = _post(client, {"text": "hello", "context": {"page": "/a"}})

    assert response.status_code == 202, response.text
    assert len(service.recorded) == 1
    event = service.recorded[0]
    key_hash = sha256(KEY.encode()).hexdigest()
    assert event.data.external_locator["visitor"] == key_hash
    assert event.data.processed.context == {"page": "/a"}
    assert KEY not in event.model_dump_json()


@pytest.mark.parametrize(
    "key",
    [
        None,
        "short-key",
        "user-00000000000000000000000000042",
        string.ascii_letters[:40] + "!",
    ],
)
def test_a_weak_or_missing_key_is_refused_and_writes_nothing(client, service, key):
    response = _post(client, {"text": "hello"}, key=key)

    assert response.status_code == 401
    assert response.json() == {"status": "error"}
    assert service.recorded == []


def test_an_inactive_embed_is_refused(client, service):
    service.connection.flags.is_active = False
    response = _post(client, {"text": "hello"})

    assert response.status_code == 401
    assert service.recorded == []


def test_an_archived_or_unknown_embed_is_refused_like_a_bad_key(client, service):
    service.archived = True
    archived = _post(client, {"text": "hello"})
    service.archived = False
    unknown = _post(client, {"text": "hello"}, url="/channels/embed/events/nope/")
    bad_id = _post(client, {"text": "hello"}, url="/channels/embed/events/a:b/")

    for response in (archived, unknown, bad_id):
        assert response.status_code == 401
        assert response.json() == {"status": "error"}
    assert service.recorded == []


def test_bindings_are_refused(client, service):
    response = _post(client, {"text": "hello", "bindings": {"token": "x"}})

    assert response.status_code == 400
    assert service.recorded == []


def test_the_same_body_from_two_keys_writes_two_rows(client, service):
    assert _post(client, {"text": "hello"}).status_code == 202
    assert _post(client, {"text": "hello"}, key=OTHER_KEY).status_code == 202
    assert _post(client, {"text": "hello"}).status_code == 202

    assert len(service.recorded) == 2
    assert len({e.data.external_locator["visitor"] for e in service.recorded}) == 2


def test_rate_limits_are_per_embed_then_per_key_hash(client, throttle_calls):
    _post(client, {"text": "hello"})

    assert throttle_calls == [
        {"embed": EMBED_ID},
        {"embed": EMBED_ID, "visitor": sha256(KEY.encode()).hexdigest()},
    ]


def test_a_denied_bucket_answers_429_with_retry_after(client, service, monkeypatch):
    async def deny(key, **kwargs):
        return ThrottleResult(
            key="k", allow=False, tokens_remaining=0.0, retry_after_ms=2500
        )

    monkeypatch.setattr(ingress_module, "check_throttle", deny)
    response = _post(client, {"text": "hello"})

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "3"
    assert service.recorded == []


def test_a_message_over_the_limit_is_refused(client, service, monkeypatch):
    monkeypatch.setattr(ingress_module.env.channels.embed, "max_message_chars", 10)

    assert _post(client, {"text": "x" * 11}).status_code == 413
    assert _post(client, {"text": "ok", "context": {"a": "x" * 20}}).status_code == 413
    assert service.recorded == []


def test_files_over_the_limit_are_refused(client, service, monkeypatch):
    monkeypatch.setattr(ingress_module.env.channels.embed, "max_file_bytes", 30)
    data = "QUJD" * 20  # 60 decoded bytes

    response = _post(client, {"text": "hi", "files": [{"data": data}]})

    assert response.status_code == 413
    assert service.recorded == []


def test_a_body_over_the_cap_is_refused_before_parsing(client, service, monkeypatch):
    monkeypatch.setattr(ingress_module, "_EMBED_BODY_OVERHEAD_BYTES", 0)
    monkeypatch.setattr(ingress_module.env.channels.embed, "max_file_bytes", 3)
    monkeypatch.setattr(ingress_module.env.channels.embed, "max_message_chars", 1)

    response = _post(client, {"text": "x", "pad": "y" * 50})

    assert response.status_code == 413
    assert service.recorded == []


def test_config_returns_name_sanitized_origins_and_appearance(client):
    response = client.get(f"/channels/embed/{EMBED_ID}/config")

    assert response.status_code == 200
    assert response.json() == {
        "name": "Support widget",
        "allowed_origins": ["https://tool.example.com"],
        "appearance": {"greeting": "Hi"},
    }


def test_config_is_404_for_a_missing_inactive_or_archived_embed(client, service):
    assert client.get("/channels/embed/nope/config").status_code == 404

    service.connection.flags.is_active = False
    assert client.get(f"/channels/embed/{EMBED_ID}/config").status_code == 404

    service.connection.flags.is_active = True
    service.archived = True
    assert client.get(f"/channels/embed/{EMBED_ID}/config").status_code == 404


def test_too_many_files_are_refused(client, service):
    files = [{"data": "QUJD"} for _ in range(11)]

    assert _post(client, {"text": "hi", "files": files}).status_code == 413
    assert service.recorded == []
