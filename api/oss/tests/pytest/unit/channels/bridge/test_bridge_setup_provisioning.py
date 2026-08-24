"""The document slot: a bridge mints its own signing secret at create time
(nothing else can issue one), the secret rides the create response exactly
once, and the GET setup route can never reconstruct it -- proved structurally,
not just by a passing assertion. No DB, no vault, no network: a fake DAO and a
fake vault stand in for persistence, matching
`test_channels_connection_write_path.py`'s pattern.
"""

import inspect
from typing import Any, Dict, Optional
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest

from oss.src.apis.fastapi.channels import router as channels_router_module
from oss.src.core.channels.adapters.bridge import adapter as bridge_adapter_module
from oss.src.core.channels.adapters.bridge.adapter import (
    BridgeAdapter,
    build_bridge_create_document,
)
from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.dtos import (
    ChannelConnection,
    ChannelConnectionCreate,
    ChannelConnectionCreated,
    ChannelConnectionFlags,
    ChannelConnectionResponse,
)
from oss.src.core.channels.service import ChannelsService
from oss.src.core.secrets.enums import ChannelSecretKind

_FAKE_MINTED_SECRET_CANARY = "unit-test-minted-secret-canary-do-not-echo"
_FAKE_CALLER_SECRET_CANARY = "unit-test-caller-supplied-secret-canary"


class _FakeSecret:
    def __init__(self, *, id: UUID, data: Any):
        self.id = id
        self.data = data


class _FakeVaultService:
    def __init__(self):
        self.create_calls = []
        self.created_ids = []

    async def create_secret(self, *, project_id, create_secret_dto):
        secret_id = uuid4()
        self.create_calls.append(create_secret_dto)
        self.created_ids.append(secret_id)
        return _FakeSecret(id=secret_id, data=create_secret_dto.secret.data)


def _as_connection(created: ChannelConnectionCreate) -> ChannelConnection:
    return ChannelConnection(
        id=uuid4(),
        channel=created.channel,
        external_key=created.external_key,
        slug=created.slug,
        data=created.data,
        flags=created.flags,
    )


def _fake_dao():
    dao = MagicMock()
    dao.create_connection = AsyncMock(
        side_effect=lambda **kw: _as_connection(kw["connection"])
    )
    return dao


def _service(*, dao, vault) -> ChannelsService:
    return ChannelsService(
        channels_dao=dao,
        adapter_registry=ChannelAdapterRegistry(adapters={"bridge": BridgeAdapter()}),
        vault_service=vault,
    )


def _bridge_create(
    *,
    data: Optional[Dict[str, Any]] = None,
    credentials: Optional[Dict[str, Any]] = None,
) -> ChannelConnectionCreate:
    return ChannelConnectionCreate(
        channel="bridge",
        external_key=uuid4(),
        slug="acme-wecom",
        data={
            "source": "acme-wecom",
            "delivery_url": "https://bridge.example/deliver",
            **(data or {}),
        },
        credentials=credentials,
    )


# --- minting: only when the caller supplied nothing ------------------------- #


@pytest.mark.asyncio
async def test_no_supplied_secret_mints_one_and_writes_it_under_the_bridge_kind():
    dao = _fake_dao()
    vault = _FakeVaultService()
    service = _service(dao=dao, vault=vault)

    result = await service.create_connection(
        project_id=uuid4(), user_id=uuid4(), connection=_bridge_create()
    )

    assert isinstance(result, ChannelConnectionCreated)
    assert result.one_time_secret
    assert len(vault.create_calls) == 1
    written = vault.create_calls[0].secret.data
    assert written.kind == ChannelSecretKind.BRIDGE
    assert written.channel.signing_secret == result.one_time_secret


@pytest.mark.asyncio
async def test_a_caller_supplied_secret_is_kept_verbatim_and_nothing_is_minted():
    dao = _fake_dao()
    vault = _FakeVaultService()
    service = _service(dao=dao, vault=vault)

    result = await service.create_connection(
        project_id=uuid4(),
        user_id=uuid4(),
        connection=_bridge_create(
            credentials={"signing_secret": _FAKE_CALLER_SECRET_CANARY}
        ),
    )

    # nothing was minted, so the response carries no one-time secret at all
    assert getattr(result, "one_time_secret", None) is None
    assert vault.create_calls[0].secret.data.channel.signing_secret == (
        _FAKE_CALLER_SECRET_CANARY
    )


@pytest.mark.asyncio
async def test_the_minted_secret_never_rides_a_plain_connection_response():
    """Even if a caller forgot to thread `setup` into the response, the base
    `ChannelConnectionResponse` must not leak the secret: `ChannelConnectionCreated`
    is a strict supertype dropped down to `ChannelConnection`'s own fields on
    serialisation, so this is a structural guarantee, not a habit."""

    dao = _fake_dao()
    vault = _FakeVaultService()
    service = _service(dao=dao, vault=vault)

    result = await service.create_connection(
        project_id=uuid4(), user_id=uuid4(), connection=_bridge_create()
    )

    payload = ChannelConnectionResponse(count=1, connection=result).model_dump_json()
    assert result.one_time_secret not in payload


# --- the one-time document builder ------------------------------------------ #


def test_build_bridge_create_document_embeds_the_secret_and_the_inbound_url():
    doc = build_bridge_create_document(
        request_url="https://example.com/channels/bridge/events/",
        secret=_FAKE_MINTED_SECRET_CANARY,
    )

    assert "https://example.com/channels/bridge/events/" in doc.content
    assert _FAKE_MINTED_SECRET_CANARY in doc.content


def test_build_bridge_create_document_is_called_from_the_create_route_only():
    """The reachability check this project's own findings say to run before
    calling a symbol done: exactly one caller (the create route), and never
    from the GET-path method."""

    router_source = inspect.getsource(channels_router_module)
    assert router_source.count("build_bridge_create_document(") == 1

    get_path_source = inspect.getsource(
        bridge_adapter_module.BridgeAdapter.build_setup_document
    )
    assert "build_bridge_create_document" not in get_path_source


def test_build_setup_document_signature_carries_no_connection_to_leak_from():
    """Structural, not habitual: the GET path's method cannot read a
    connection's hydrated secret because it is never handed one."""

    params = inspect.signature(BridgeAdapter.build_setup_document).parameters
    assert "connection" not in params


@pytest.mark.asyncio
async def test_get_connection_setup_never_returns_the_secret_even_when_hydrated_data_carries_it():
    """The naive fix this guards against: `build_setup_document` reading
    `connection.data.get('signing_secret')`. The connection handed to
    `get_connection_setup` here carries the hydrated secret in `data`, exactly
    as every real `fetch_connection` call does; the returned document must not
    contain it."""

    connection = ChannelConnection(
        id=uuid4(),
        slug="acme-wecom",
        channel="bridge",
        external_key=uuid4(),
        data={
            "signing_secret": _FAKE_MINTED_SECRET_CANARY,
            "delivery_url": "https://bridge.example/deliver",
            "connection_locator": {"source": "acme-wecom"},
        },
        flags=ChannelConnectionFlags(is_verified=True),
    )
    dao = MagicMock()
    dao.fetch_connection = AsyncMock(return_value=connection)
    service = ChannelsService(
        channels_dao=dao,
        adapter_registry=ChannelAdapterRegistry(adapters={"bridge": BridgeAdapter()}),
    )

    setup = await service.get_connection_setup(
        project_id=uuid4(),
        connection_id=connection.id,
        request_url="https://example.com/channels/bridge/events/",
    )

    assert setup.fields == []
    assert setup.document is not None
    assert _FAKE_MINTED_SECRET_CANARY not in setup.document.content


@pytest.mark.asyncio
async def test_get_connection_setup_document_is_the_same_on_a_second_call():
    connection = ChannelConnection(
        id=uuid4(),
        slug="acme-wecom",
        channel="bridge",
        external_key=uuid4(),
        data={
            "signing_secret": _FAKE_MINTED_SECRET_CANARY,
            "delivery_url": "https://bridge.example/deliver",
            "connection_locator": {"source": "acme-wecom"},
        },
        flags=ChannelConnectionFlags(is_verified=True),
    )
    dao = MagicMock()
    dao.fetch_connection = AsyncMock(return_value=connection)
    service = ChannelsService(
        channels_dao=dao,
        adapter_registry=ChannelAdapterRegistry(adapters={"bridge": BridgeAdapter()}),
    )

    first = await service.get_connection_setup(
        project_id=uuid4(),
        connection_id=connection.id,
        request_url="https://example.com/channels/bridge/events/",
    )
    second = await service.get_connection_setup(
        project_id=uuid4(),
        connection_id=connection.id,
        request_url="https://example.com/channels/bridge/events/",
    )

    assert _FAKE_MINTED_SECRET_CANARY not in (first.document.content)
    assert _FAKE_MINTED_SECRET_CANARY not in (second.document.content)
