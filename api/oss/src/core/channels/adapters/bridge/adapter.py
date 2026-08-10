import json
from typing import Any, Dict, List, Optional
from uuid import UUID

import httpx

from oss.src.core.channels.adapters.bridge.envelope import (
    build_delivery_command,
    parse_inbound_envelope,
)
from oss.src.core.channels.adapters.bridge.receipt import (
    BridgeDeliveryFailed,
    read_delivery_response,
)
from oss.src.core.channels.adapters.bridge.signature import (
    sign_outbound,
    verify_bridge_signature,
)
from oss.src.core.channels.adapters.interface import ChannelAdapterInterface
from oss.src.core.channels.adapters.normalise import normalise_capabilities
from oss.src.core.channels.dtos import (
    ChannelCapabilities,
    ChannelConnection,
    ChannelIdentity,
    ChannelInboundEvent,
    ChannelKeyGrain,
    ChannelRequestContext,
    ChannelSpaceCandidate,
)
from oss.src.core.channels.types import ChannelSignatureInvalid

_DELIVER_TIMEOUT_SECONDS = 10.0

# The CHANNEL-level declaration: which bridge is connecting cannot decide
# which field identifies it, so CONNECTION-grain identity is fixed here,
# never read off a per-bridge bridge.hello. Also degrades a connection with
# no recorded hello rather than raising.
_DEFAULT_CAPABILITIES = ChannelCapabilities(
    channel="bridge",
    identity=ChannelIdentity(keys={ChannelKeyGrain.CONNECTION: ["source"]}),
)


def _bridge_secret(connection: ChannelConnection) -> str:
    data = connection.data if isinstance(connection.data, dict) else {}
    secret = data.get("secret")
    if not secret:
        raise ChannelSignatureInvalid(channel="bridge")
    return secret


def _bridge_url(connection: ChannelConnection) -> str:
    data = connection.data if isinstance(connection.data, dict) else {}
    url = data.get("delivery_url")
    if not url:
        raise BridgeDeliveryFailed(reason="connection has no delivery_url")
    return url


def _installation_id(connection: ChannelConnection) -> str:
    data = connection.data if isinstance(connection.data, dict) else {}
    return data.get("installation_id") or ""


class BridgeAdapter(ChannelAdapterInterface):
    """ChannelAdapterInterface reached over HTTP instead of a process call.
    Every registration shares this one class -- the specific bridge's
    identity lives on the connection's own data, never as a subclass or a
    per-bridge branch here."""

    channel = "bridge"

    def __init__(self, *, http_client: Optional[httpx.AsyncClient] = None) -> None:
        self._client = http_client or httpx.AsyncClient()

    # --- declaration --- #

    async def fetch_capabilities(
        self, *, connection: Optional[ChannelConnection] = None
    ) -> ChannelCapabilities:
        """No fixed declaration exists -- each bridge is a different
        platform, so this reads the connection's own recorded bridge.hello
        rather than a class-level constant, which is what let two bridges
        share one declaration."""

        data = (
            connection.data if connection and isinstance(connection.data, dict) else {}
        )
        raw = data.get("capabilities")
        if not raw:
            return _DEFAULT_CAPABILITIES

        merged = dict(raw)
        merged.setdefault("channel", "bridge")
        return normalise_capabilities(merged)

    # --- ingress --- #

    def connection_locator(
        self, *, request: ChannelRequestContext
    ) -> Optional[Dict[str, Any]]:
        claimed_source = _parse_json(request.body).get("source")
        return {"source": _bare_source(claimed_source)} if claimed_source else None

    async def verify_signature(
        self, *, request: ChannelRequestContext, connection: ChannelConnection
    ) -> str:
        lowered = {k.lower(): v for k, v in request.headers.items()}
        verify_bridge_signature(
            headers=lowered,
            body=request.body,
            secret=_bridge_secret(connection),
            channel=self.channel,
        )

        installation_id = _installation_id(connection)

        # The credential resolves identity; `source` is a required
        # cross-check on the self-asserted claim in the signed body. A
        # mismatch gets the same refusal as a bad signature -- no detail on
        # which side disagreed, so neither a credential nor a source value
        # can be enumerated by probing this path.
        payload = _parse_json(request.body)
        claimed_source = payload.get("source")
        if claimed_source is None or not _source_matches(
            claimed_source, installation_id
        ):
            raise ChannelSignatureInvalid(channel=self.channel)

        return installation_id

    async def parse_event(
        self, *, body: bytes, connection: Optional[ChannelConnection] = None
    ) -> Optional[ChannelInboundEvent]:
        payload = _parse_json(body)
        return parse_inbound_envelope(payload)

    # --- egress --- #

    async def post_message(
        self,
        *,
        connection: ChannelConnection,
        locator: Dict[str, Any],
        content: List[Dict[str, Any]],
        idempotency_key: UUID,
    ) -> Dict[str, Any]:
        return await self._deliver(
            connection=connection,
            locator=locator,
            content=content,
            idempotency_key=idempotency_key,
            edit=False,
        )

    async def edit_message(
        self,
        *,
        connection: ChannelConnection,
        external_locator: Dict[str, Any],
        content: List[Dict[str, Any]],
        idempotency_key: UUID,
    ) -> Dict[str, Any]:
        return await self._deliver(
            connection=connection,
            locator=external_locator,
            content=content,
            idempotency_key=idempotency_key,
            edit=True,
        )

    # --- discovery --- #

    async def discover_spaces(
        self, *, connection: ChannelConnection
    ) -> List[ChannelSpaceCandidate]:
        # No wire message exists for discovery -- a bridge author configures
        # spaces on their own side, not through a pick-list we cannot fetch.
        return []

    # --- history --- #

    async def fetch_history(
        self, *, connection: ChannelConnection, locator: Dict[str, Any], limit: int
    ) -> List[ChannelInboundEvent]:
        # No wire message exists for backfill either; a bridge declares
        # fill.backfill.supported=False and this is never reached in practice.
        return []

    # --- internals --- #

    async def _deliver(
        self,
        *,
        connection: ChannelConnection,
        locator: Dict[str, Any],
        content: List[Dict[str, Any]],
        idempotency_key: UUID,
        edit: bool,
    ) -> Dict[str, Any]:
        command = build_delivery_command(
            idempotency_key=str(idempotency_key),
            locator=locator,
            content=content,
            edit=edit,
        )
        body = json.dumps(command).encode("utf-8")
        headers = sign_outbound(secret=_bridge_secret(connection), body=body)

        response = await self._client.post(
            _bridge_url(connection),
            content=body,
            headers={**headers, "content-type": "application/json"},
            timeout=_DELIVER_TIMEOUT_SECONDS,
        )
        response.raise_for_status()

        return read_delivery_response(response.json())


def _parse_json(body: bytes) -> Dict[str, Any]:
    try:
        return json.loads(body) if body else {}
    except ValueError:
        return {}


def _bare_source(claimed_source: str) -> str:
    """`source` is `bridge/<name>`; the credential resolves to the bare
    installation id -- normalise the wire prefix rather than requiring
    bridges to send the bare id."""

    return claimed_source.split("/", 1)[1] if "/" in claimed_source else claimed_source


def _source_matches(claimed_source: str, installation_id: str) -> bool:
    return _bare_source(claimed_source) == installation_id
