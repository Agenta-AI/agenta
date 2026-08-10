"""Unit tests for the channels ingress route.

Deliberately tiny, matching the module it tests: verify, write one row,
answer 202. No DB, no real adapter -- ChannelsService and
ChannelAdapterRegistry are faked here to the shape they declare.
"""

import json
from typing import Dict, Optional
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.channels.ingress import (
    ChannelsIngressRouter,
    _connection_owns_identity,
)
from oss.src.core.channels.dtos import (
    ChannelCapabilities,
    ChannelConnection,
    ChannelEventKind,
    ChannelIdentity,
    ChannelInboundEvent,
    ChannelInboxEventProcessed,
    ChannelKeyGrain,
    ChannelRequestContext,
    ChannelSpaceKind,
)
from oss.src.core.channels.types import ChannelNotSupported, ChannelSignatureInvalid
from oss.src.core.channels.utils import compose_external_key


LOCATOR = {"team": "T1", "channel": "C1"}


def _capabilities_for(field: str) -> ChannelCapabilities:
    return ChannelCapabilities(
        channel="fake",
        identity=ChannelIdentity(keys={ChannelKeyGrain.CONNECTION: [field]}),
    )


class FakeAdapter:
    """A minimal well-behaved adapter -- verifies a fixed header, parses a
    fixed inbound event. Stands in for ChannelAdapterInterface."""

    channel = "slack"

    #: the locator field this adapter's fake installation claim rides on --
    #: distinct from bridge's "source" so both can share one fake connection
    _locator_field = "installation_id"

    def __init__(self, *, installation_id: str = "T1"):
        self.installation_id = installation_id
        self.verify_calls = 0
        self.parse_calls = 0

    async def fetch_capabilities(
        self, *, connection: Optional[ChannelConnection] = None
    ) -> ChannelCapabilities:
        return _capabilities_for(self._locator_field)

    def connection_locator(
        self, *, request: ChannelRequestContext
    ) -> Optional[Dict[str, str]]:
        return {self._locator_field: self.installation_id}

    async def verify_signature(
        self, *, request: ChannelRequestContext, connection: ChannelConnection
    ) -> str:
        self.verify_calls += 1
        if request.headers.get("x-fake-signature") != "valid":
            raise ChannelSignatureInvalid(channel=self.channel)
        return self.installation_id

    async def parse_event(
        self, *, body: bytes, connection: Optional[ChannelConnection] = None
    ) -> Optional[ChannelInboundEvent]:
        self.parse_calls += 1
        if body == b"noop":
            return None
        return ChannelInboundEvent(
            external_id="Ev1",
            kind=ChannelEventKind.MESSAGE,
            space_kind=ChannelSpaceKind.TOPIC,
            external_locator=LOCATOR,
            processed=ChannelInboxEventProcessed(
                content=[{"type": "text", "text": "hi"}],
                sender={"id": "U1"},
            ),
        )


class FakeAdapterRegistry:
    """Stands in for ChannelAdapterRegistry -- same two behaviours: dispatch
    by key, raise ChannelNotSupported on a miss."""

    def __init__(self, adapters: Dict[str, FakeAdapter]):
        self._adapters = adapters

    def get(self, channel: str) -> FakeAdapter:
        if channel not in self._adapters:
            raise ChannelNotSupported(channel=channel)
        return self._adapters[channel]


class FakeChannelsService:
    """Stands in for ChannelsService -- just the ingress-facing methods:
    resolve a connection, fetch it, and append to the log with the dedup
    contract (None on an already-recorded external_id)."""

    def __init__(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        installation_id: str = "T1",
    ):
        self.project_id = project_id
        self.connection_id = connection_id
        self.recorded = []
        self.seen_external_ids = set()
        self.installation_id = installation_id
        # every field name a fake adapter in this module might locate the
        # same fake installation by -- keeps one connection resolvable from
        # both a Slack-shaped and a bridge-shaped fake locator
        self._valid_keys = {
            compose_external_key(
                _capabilities_for(field),
                ChannelKeyGrain.CONNECTION,
                {field: installation_id},
            )
            for field in ("installation_id", "source")
        }
        self.connection = ChannelConnection(
            id=connection_id,
            slug="fake-connection",
            channel="slack",
            external_key=next(iter(self._valid_keys)),
            data={
                "signing_secret": "unused",
                "bot_token": "xoxb-fake",
                "connection_locator": {"installation_id": installation_id},
            },
        )

    async def get_project_and_connection_by_external_key(
        self, *, channel, external_key
    ):
        if external_key not in self._valid_keys:
            return None
        return (self.project_id, self.connection_id)

    async def fetch_connection(self, *, project_id, connection_id):
        if connection_id != self.connection_id:
            return None
        return self.connection

    async def record_inbox_event(self, *, project_id, event):
        key = (project_id, event.connection_id, event.external_id)
        if key in self.seen_external_ids:
            return None
        self.seen_external_ids.add(key)
        self.recorded.append(event)
        return event


def _make_app(
    *, service: FakeChannelsService, registry: FakeAdapterRegistry, dispatch_task=None
):
    app = FastAPI()
    router = ChannelsIngressRouter(
        channels_service=service,
        adapter_registry=registry,
        dispatch_task=dispatch_task,
    )
    app.include_router(router.router, prefix="/channels")
    return app, router


@pytest.fixture
def project_id() -> UUID:
    return uuid4()


@pytest.fixture
def connection_id() -> UUID:
    return uuid4()


@pytest.fixture
def service(project_id, connection_id) -> FakeChannelsService:
    return FakeChannelsService(project_id=project_id, connection_id=connection_id)


@pytest.fixture
def adapter() -> FakeAdapter:
    return FakeAdapter()


@pytest.fixture
def registry(adapter) -> FakeAdapterRegistry:
    return FakeAdapterRegistry({"slack": adapter})


@pytest.fixture
def client(service, registry) -> TestClient:
    app, _ = _make_app(service=service, registry=registry)
    return TestClient(app)


# ---------------------------------------------------------------------------
# The happy path: signed, fresh -> one row, 202.
# ---------------------------------------------------------------------------


def test_signed_request_writes_one_row_and_acks_202(client, service):
    response = client.post(
        "/channels/slack/events/",
        headers={"x-fake-signature": "valid"},
        content=b"{}",
    )

    assert response.status_code == 202, response.text
    assert response.json()["status"] == "accepted"
    assert len(service.recorded) == 1
    assert service.recorded[0].external_id == "Ev1"


def test_bridge_route_is_registered_and_reachable(service):
    bridge_adapter = FakeAdapter()
    bridge_adapter.channel = "bridge"
    registry = FakeAdapterRegistry({"bridge": bridge_adapter})
    app, _ = _make_app(service=service, registry=registry)
    client = TestClient(app)

    response = client.post(
        "/channels/bridge/events/",
        headers={"x-fake-signature": "valid"},
        content=b"{}",
    )

    assert response.status_code == 202, response.text
    assert len(service.recorded) == 1


# ---------------------------------------------------------------------------
# The bridge's credential-vs-source cross-check.
#
# BridgeAdapter itself does not exist yet -- these fake the adapter to the
# shape its verify_signature must have: it reads the envelope's claimed
# sender out of the body, resolves its own identity from the credential, and
# raises ChannelSignatureInvalid on a mismatch. That behaviour is asserted
# through the same route both arms share, exactly like every other adapter
# failure mode in this module.
# ---------------------------------------------------------------------------


class FakeCrossCheckingBridgeAdapter(FakeAdapter):
    """Resolves an installation id from the credential header, then refuses
    if the body's declared `source` disagrees with it."""

    channel = "bridge"
    _locator_field = "source"

    def __init__(self, *, installation_id: str = "acme-wecom"):
        super().__init__(installation_id=installation_id)

    def connection_locator(
        self, *, request: ChannelRequestContext
    ) -> Optional[Dict[str, str]]:
        source = json.loads(request.body).get("source") if request.body else None
        return {"source": source} if source else None

    async def verify_signature(self, *, request, connection):
        if request.headers.get("x-fake-signature") != "valid":
            raise ChannelSignatureInvalid(channel=self.channel)

        body = request.body
        claimed_source = json.loads(body).get("source") if body else None
        if claimed_source is not None and claimed_source != self.installation_id:
            raise ChannelSignatureInvalid(channel=self.channel)

        return self.installation_id


def _bridge_client(service, *, installation_id: str = "acme-wecom"):
    adapter = FakeCrossCheckingBridgeAdapter(installation_id=installation_id)
    registry = FakeAdapterRegistry({"bridge": adapter})
    app, _ = _make_app(service=service, registry=registry)
    return TestClient(app), adapter


def test_bridge_event_resolves_from_the_verified_credential(service):
    client, _ = _bridge_client(service, installation_id="T1")

    response = client.post(
        "/channels/bridge/events/",
        headers={"x-fake-signature": "valid"},
        content=b'{"source": "T1"}',
    )

    assert response.status_code == 202, response.text
    assert len(service.recorded) == 1


def test_bridge_source_credential_mismatch_is_refused(service):
    client, _ = _bridge_client(service, installation_id="T1")

    response = client.post(
        "/channels/bridge/events/",
        headers={"x-fake-signature": "valid"},
        content=b'{"source": "some-other-bridge"}',
    )

    assert response.status_code == 401, response.text
    assert service.recorded == []
    # Same discipline as any other signature failure: no detail on which
    # side -- credential or claimed source -- disagreed.
    body_text = response.text.lower()
    assert "source" not in body_text
    assert "t1" not in body_text
    assert "some-other-bridge" not in body_text


def test_unknown_bridge_credential_is_refused_identically_to_a_bad_signature(
    service,
):
    """An unrecognised credential and a source/credential mismatch must be
    indistinguishable from outside -- both are ChannelSignatureInvalid, both
    401, both silent."""

    client, _ = _bridge_client(service, installation_id="T1")

    response = client.post(
        "/channels/bridge/events/",
        headers={"x-fake-signature": "forged"},
        content=b'{"source": "T1"}',
    )

    assert response.status_code == 401, response.text
    assert service.recorded == []


# ---------------------------------------------------------------------------
# Rejections: no signature, bad signature, stale timestamp (adapter's job,
# exercised through the route).
# ---------------------------------------------------------------------------


def test_unsigned_request_is_rejected_no_row_no_detail_leak(client, service):
    response = client.post("/channels/slack/events/", content=b"{}")

    assert response.status_code == 401, response.text
    assert service.recorded == []
    # ChannelSignatureInvalid carries nothing but the channel -- the body
    # must not repeat which header or byte failed.
    body_text = response.text.lower()
    assert "signature" not in body_text or "invalid" not in body_text
    assert "x-fake-signature" not in body_text


def test_invalid_signature_is_rejected(client, service):
    response = client.post(
        "/channels/slack/events/",
        headers={"x-fake-signature": "forged"},
        content=b"{}",
    )

    assert response.status_code == 401, response.text
    assert service.recorded == []


def test_locator_missing_a_declared_field_is_refused_not_resolved_partially(
    service, registry
):
    """A declaration naming two CONNECTION-grain fields, against a locator
    that supplies only one, must refuse -- composing a key from the partial
    subset would silently resolve into a different installation than the one
    that actually exists."""

    class PartialLocatorAdapter(FakeAdapter):
        async def fetch_capabilities(self, *, connection=None):
            return ChannelCapabilities(
                channel="fake",
                identity=ChannelIdentity(
                    keys={
                        ChannelKeyGrain.CONNECTION: [
                            "installation_id",
                            "workspace_id",
                        ]
                    }
                ),
            )

        def connection_locator(self, *, request):
            # declares two CONNECTION-grain fields but supplies only one
            return {"installation_id": self.installation_id}

    partial = PartialLocatorAdapter()
    app, _ = _make_app(
        service=service, registry=FakeAdapterRegistry({"slack": partial})
    )
    client = TestClient(app)

    response = client.post(
        "/channels/slack/events/",
        headers={"x-fake-signature": "valid"},
        content=b"{}",
    )

    assert response.status_code == 401, response.text
    assert service.recorded == []


def test_stale_timestamp_rejected_even_with_structurally_valid_signature(
    service, registry
):
    """The adapter's own replay guard must still be reachable and honoured
    through the route -- the ingress route does not implement it, only
    calls it."""

    class ReplayGuardedAdapter(FakeAdapter):
        async def verify_signature(self, *, request, connection):
            if request.headers.get("x-fake-timestamp") == "stale":
                raise ChannelSignatureInvalid(channel=self.channel)
            return await super().verify_signature(
                request=request, connection=connection
            )

    guarded = ReplayGuardedAdapter()
    app, _ = _make_app(
        service=service, registry=FakeAdapterRegistry({"slack": guarded})
    )
    client = TestClient(app)

    response = client.post(
        "/channels/slack/events/",
        headers={"x-fake-signature": "valid", "x-fake-timestamp": "stale"},
        content=b"{}",
    )

    assert response.status_code == 401, response.text
    assert service.recorded == []


# ---------------------------------------------------------------------------
# Redelivery: absorbed by the dedup contract, not application logic.
# ---------------------------------------------------------------------------


def test_redelivery_writes_no_second_row_still_202(client, service):
    first = client.post(
        "/channels/slack/events/",
        headers={"x-fake-signature": "valid"},
        content=b"{}",
    )
    second = client.post(
        "/channels/slack/events/",
        headers={"x-fake-signature": "valid"},
        content=b"{}",
    )

    assert first.status_code == 202, first.text
    assert second.status_code == 202, second.text
    assert len(service.recorded) == 1


def test_platform_noise_with_no_addressable_event_acks_without_a_row(client, service):
    """parse_event returning None (ack, bot echo) is a normal outcome, not
    an error -- 202, no row, no branch."""

    response = client.post(
        "/channels/slack/events/",
        headers={"x-fake-signature": "valid"},
        content=b"noop",
    )

    assert response.status_code == 202, response.text
    assert service.recorded == []


# ---------------------------------------------------------------------------
# Unregistered channel: 404 from the route table itself.
# ---------------------------------------------------------------------------


def test_unregistered_channel_404s_from_the_route_table(service):
    """Only slack is registered here; the literal-route convention means an
    unregistered channel path never reaches a handler that has to reject it
    by hand -- registering a channel with no route at all also 404s, but the
    interesting case this test pins is ChannelNotSupported -> 404 when the
    registry itself is asked for a channel it does not have."""

    empty_registry = FakeAdapterRegistry({})
    app, router = _make_app(service=service, registry=empty_registry)

    # Register a literal /telegram/events/ pointing at the same handler body
    # to exercise the ChannelNotSupported -> 404 mapping without a real
    # adapter registered for it (mirrors how a future channel's route would
    # 404 today if wired ahead of its adapter).
    app.router.add_api_route(
        "/channels/telegram/events/",
        router.ingest_slack_event,
        methods=["POST"],
    )
    client = TestClient(app)

    response = client.post(
        "/channels/telegram/events/",
        headers={"x-fake-signature": "valid"},
        content=b"{}",
    )

    assert response.status_code == 404, response.text
    assert service.recorded == []


def test_truly_unregistered_path_404s_without_reaching_a_handler(client):
    """No /channels/telegram/events/ route exists at all in the default
    fixture app -- this is the actual literal-route guarantee: an adapter
    that has not shipped has no path, so FastAPI's router 404s before any
    channels code runs."""

    response = client.post(
        "/channels/telegram/events/",
        headers={"x-fake-signature": "valid"},
        content=b"{}",
    )

    assert response.status_code == 404, response.text


# ---------------------------------------------------------------------------
# No project-scoped auth is read on this path.
# ---------------------------------------------------------------------------


def test_route_reachable_with_no_authorization_header(client):
    """Proves the handler itself expects no Authorization header -- the
    _PUBLIC_ENDPOINTS wiring is proven separately in
    test_channels_ingress_public_endpoints.py."""

    response = client.post(
        "/channels/slack/events/",
        headers={"x-fake-signature": "valid"},
        content=b"{}",
    )

    assert response.status_code == 202
    assert "authorization" not in {h.lower() for h in response.request.headers}


# ---------------------------------------------------------------------------
# Enqueue: best-effort, off the hot path; 202 does not depend on it existing.
# ---------------------------------------------------------------------------


def test_no_dispatch_task_still_acks_202(client):
    response = client.post(
        "/channels/slack/events/",
        headers={"x-fake-signature": "valid"},
        content=b"{}",
    )
    assert response.status_code == 202


def test_dispatch_task_is_enqueued_after_the_row_is_written(service, registry):
    calls = []

    class FakeDispatch:
        async def kiq(self, **kwargs):
            calls.append(kwargs)

    app, _ = _make_app(service=service, registry=registry, dispatch_task=FakeDispatch())
    client = TestClient(app)

    response = client.post(
        "/channels/slack/events/",
        headers={"x-fake-signature": "valid"},
        content=b"{}",
    )

    assert response.status_code == 202, response.text
    assert len(calls) == 1
    assert calls[0]["channel"] == "slack"


def test_dispatch_enqueue_failure_is_503_row_already_written(service, registry):
    class FailingDispatch:
        async def kiq(self, **kwargs):
            raise RuntimeError("queue unavailable")

    app, _ = _make_app(
        service=service, registry=registry, dispatch_task=FailingDispatch()
    )
    client = TestClient(app)

    response = client.post(
        "/channels/slack/events/",
        headers={"x-fake-signature": "valid"},
        content=b"{}",
    )

    assert response.status_code == 503, response.text
    # The row is written before the enqueue is attempted -- a 503 here must
    # not be read as "nothing happened".
    assert len(service.recorded) == 1


# ---------------------------------------------------------------------------
# Scope discipline: this module must not import the inbox worker's logic.
# ---------------------------------------------------------------------------


def test_ingress_module_does_not_import_inbox_worker():
    import oss.src.apis.fastapi.channels.ingress as ingress_module

    with open(ingress_module.__file__, "r", encoding="utf-8") as f:
        source = f.read()

    assert "tasks.asyncio.channels.inbox" not in source
    assert "tasks/asyncio/channels/inbox" not in source


# ---------------------------------------------------------------------------
# The verified identity is checked against the recorded locator, not the
# whole of `data` -- credentials and declarations live there too.
# ---------------------------------------------------------------------------


def _connection_with(data):
    return ChannelConnection(
        id=uuid4(),
        slug="c",
        channel="slack",
        external_key=uuid4(),
        data=data,
    )


def test_an_identity_matching_the_recorded_locator_is_owned():
    connection = _connection_with({"connection_locator": {"team_id": "T1"}})

    assert _connection_owns_identity(connection, "T1") is True


def test_an_identity_matching_only_a_credential_is_not_owned():
    connection = _connection_with(
        {"bot_token": "T1", "connection_locator": {"team_id": "T2"}}
    )

    assert _connection_owns_identity(connection, "T1") is False


def test_a_connection_with_no_recorded_locator_owns_nothing():
    connection = _connection_with({"bot_token": "xoxb"})

    assert _connection_owns_identity(connection, "T1") is False


def test_an_empty_identity_is_never_owned():
    connection = _connection_with(
        {"connection_locator": {"team_id": "", "enterprise_id": "E1"}}
    )

    assert _connection_owns_identity(connection, "") is False
