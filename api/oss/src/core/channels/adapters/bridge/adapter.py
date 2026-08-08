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
from oss.src.core.channels.dtos import (
    ChannelCapabilities,
    ChannelConnection,
    ChannelInboundEvent,
    ChannelSpaceCandidate,
)
from oss.src.core.channels.types import ChannelSignatureInvalid

_DELIVER_TIMEOUT_SECONDS = 10.0


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


class BridgeAdapter(ChannelAdapterInterface):
    """ChannelAdapterInterface reached over HTTP instead of a process call.
    Every registration shares this one class -- the specific bridge's
    identity lives on the connection's integration_key, never as a subclass
    or a per-bridge branch here."""

    channel = "bridge"

    def __init__(
        self,
        *,
        capabilities: ChannelCapabilities,
        connection: Optional[ChannelConnection] = None,
        http_client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        # capabilities come from this installation's own bridge.hello, held
        # by the caller that constructed this adapter for one connection --
        # unlike SlackAdapter, there is no single fixed declaration to fetch.
        self._capabilities = capabilities
        self._connection = connection
        self._client = http_client or httpx.AsyncClient()

    # --- declaration --- #

    async def fetch_capabilities(self) -> ChannelCapabilities:
        return self._capabilities

    # --- ingress --- #

    async def verify_signature(
        self,
        *,
        headers: Dict[str, str],
        body: bytes,
        connection: Optional[ChannelConnection] = None,
    ) -> str:
        conn = connection or self._connection
        if conn is None:
            raise ChannelSignatureInvalid(channel=self.channel)

        lowered = {k.lower(): v for k, v in headers.items()}
        verify_bridge_signature(
            headers=lowered,
            body=body,
            secret=_bridge_secret(conn),
            channel=self.channel,
        )

        installation_id = conn.integration_key

        # The credential resolves identity; `source` is a required
        # cross-check on the self-asserted claim in the signed body. A
        # mismatch gets the same refusal as a bad signature -- no detail on
        # which side disagreed, so neither a credential nor a source value
        # can be enumerated by probing this path.
        payload = _parse_json(body)
        claimed_source = payload.get("source")
        if claimed_source is None or not _source_matches(
            claimed_source, installation_id
        ):
            raise ChannelSignatureInvalid(channel=self.channel)

        return installation_id

    async def parse_event(self, *, body: bytes) -> Optional[ChannelInboundEvent]:
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


def _source_matches(claimed_source: str, installation_id: str) -> bool:
    """`source` is `bridge/<name>`; the credential resolves to the bare
    installation id -- normalise the wire prefix before comparing rather
    than requiring bridges to send the bare id."""

    bare = claimed_source.split("/", 1)[1] if "/" in claimed_source else claimed_source
    return bare == installation_id
