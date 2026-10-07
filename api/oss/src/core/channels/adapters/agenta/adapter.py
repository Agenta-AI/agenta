"""`AgentaAdapter` -- `ChannelAdapterInterface` for the platform that is us.

No signing secret, no bot token, no outbound HTTP call: the credential is an
Agenta API key on the request, verified against our own account store, and
`post_message`/`edit_message` terminate in the same tables the read route
queries rather than calling out anywhere.
"""

import json
from hashlib import sha256
from typing import Any, Awaitable, Callable, Dict, List, Optional
from uuid import UUID

from oss.src.core.channels.adapters.agenta.capabilities import (
    fetch_agenta_capabilities,
)
from oss.src.core.channels.adapters.interface import ChannelAdapterInterface
from oss.src.core.channels.adapters.slack.adapter import ChannelBackfillRefused
from oss.src.core.channels.dtos import (
    ChannelCapabilities,
    ChannelConnection,
    ChannelEventKind,
    ChannelInboundEvent,
    ChannelInboxEventProcessed,
    ChannelRequestContext,
    ChannelSpaceCandidate,
    ChannelSpaceKind,
    ChannelSpaceQuery,
)
from oss.src.core.channels.interfaces import ChannelsDAOInterface
from oss.src.core.channels.types import ChannelSignatureInvalid

# `str -> project_id, or None` -- the only thing verify_signature needs from an
# API key. Kept as an injected function, never a direct DB/service call here,
# so this module carries no dependency on the legacy api-key service.
ResolveProjectFn = Callable[[str], Awaitable[Optional[str]]]

_AUTH_PREFIXES = ("apikey ", "bearer ")


class AgentaAdapter(ChannelAdapterInterface):
    """We are both ends: `discover_spaces` reads our own space rows, and a
    post terminates in the outbox table the read route already queries."""

    channel = "agenta"

    def __init__(
        self,
        *,
        channels_dao: ChannelsDAOInterface,
        resolve_project: ResolveProjectFn,
    ) -> None:
        self._channels_dao = channels_dao
        self._resolve_project = resolve_project

    # --- declaration --- #

    async def fetch_capabilities(
        self, *, connection: Optional[ChannelConnection] = None
    ) -> ChannelCapabilities:
        return fetch_agenta_capabilities()

    # --- ingress --- #

    def connection_locator(
        self, *, request: ChannelRequestContext
    ) -> Optional[Dict[str, Any]]:
        """`project` and `bot` from the JSON body, unverified -- there is no
        path parameter to read them from: the route is the one literal
        `/channels/agenta/events/` every channel shares the shape of. Which
        connection this claims is cross-checked once `verify_signature`
        returns the API key's real, verified project."""

        payload = _parse_json(request.body)
        project = payload.get("project")
        bot = payload.get("bot")
        if not project or not bot:
            return None
        return {"project": str(project), "bot": str(bot)}

    async def verify_signature(
        self, *, request: ChannelRequestContext, connection: ChannelConnection
    ) -> str:
        raw_key = _extract_api_key(request.headers)
        if not raw_key:
            raise ChannelSignatureInvalid(channel=self.channel)

        project_id = await self._resolve_project(raw_key)
        if not project_id:
            raise ChannelSignatureInvalid(channel=self.channel)

        # The caller's own verified project -- the id it speaks for. Whether
        # it is this connection's project is the caller's job (_ingest's
        # _connection_owns_identity), checked against the same field name.
        return project_id

    async def parse_event(
        self, *, body: bytes, connection: Optional[ChannelConnection] = None
    ) -> Optional[ChannelInboundEvent]:
        payload = _parse_json(body)

        sender = payload.get("sender")
        sender = sender if isinstance(sender, dict) else {}
        if sender.get("kind") == "agent":
            # An outbound reply never re-enters through this route on its
            # own; this only guards a caller that replays one back in.
            return None

        user = payload.get("user")
        if not user:
            return None

        user_str = str(user)
        text = payload.get("text") or ""
        content = payload.get("content")
        parts = (
            content
            if isinstance(content, list)
            else ([{"type": "text", "text": text}] if text else [])
        )
        if not parts:
            return None

        external_id = str(payload.get("id") or sha256(body).hexdigest())

        return ChannelInboundEvent(
            external_id=external_id,
            kind=ChannelEventKind.MESSAGE,
            space_kind=ChannelSpaceKind.PRIVATE,
            # one field per grain this declares: SPACE reads "user", THREAD
            # reads "thread" -- the agent, not this locator, tells threads
            # in the same space apart.
            external_locator={"user": user_str, "thread": user_str},
            processed=ChannelInboxEventProcessed(
                content=parts, sender={"id": user_str}
            ),
            addressed=True,
        )

    # --- egress --- #

    async def post_message(
        self,
        *,
        connection: ChannelConnection,
        locator: Dict[str, Any],
        content: List[Dict[str, Any]],
        idempotency_key: UUID,
    ) -> Dict[str, Any]:
        # Nothing to call out to: the outbox worker's own write of `data`
        # after this returns is the store the read route queries.
        return {"agenta_message_id": str(idempotency_key)}

    async def edit_message(
        self,
        *,
        connection: ChannelConnection,
        external_locator: Dict[str, Any],
        content: List[Dict[str, Any]],
        idempotency_key: UUID,
    ) -> Dict[str, Any]:
        # In place means the id does not change; the content update is the
        # generic outbox write that follows this call, not this method's job.
        return dict(external_locator)

    # --- discovery --- #

    async def discover_spaces(
        self, *, connection: ChannelConnection
    ) -> List[ChannelSpaceCandidate]:
        project_id = _connection_project_id(connection)
        if project_id is None or connection.id is None:
            return []

        spaces = await self._channels_dao.query_spaces(
            project_id=project_id,
            space=ChannelSpaceQuery(connection_id=connection.id),
        )

        return [
            ChannelSpaceCandidate(
                kind=space.kind,
                external_locator=space.data.external_locator,
                display_name=(space.data.external_locator or {}).get("user"),
                is_configured=True,
            )
            for space in spaces
        ]

    # --- history --- #

    async def fetch_history(
        self, *, connection: ChannelConnection, locator: Dict[str, Any], limit: int
    ) -> List[ChannelInboundEvent]:
        raise ChannelBackfillRefused(reason="agenta declares no backfill support")


def _parse_json(body: bytes) -> Dict[str, Any]:
    try:
        return json.loads(body) if body else {}
    except ValueError:
        return {}


def _extract_api_key(headers: Dict[str, str]) -> Optional[str]:
    lowered = {k.lower(): v for k, v in headers.items()}
    raw = lowered.get("authorization")
    if not raw:
        return None

    lowered_raw = raw.lower()
    for prefix in _AUTH_PREFIXES:
        if lowered_raw.startswith(prefix):
            return raw[len(prefix) :]
    return raw


def _connection_project_id(connection: ChannelConnection) -> Optional[UUID]:
    data = connection.data if isinstance(connection.data, dict) else {}
    locator = data.get("connection_locator")
    if not isinstance(locator, dict):
        return None

    project = locator.get("project")
    if not project:
        return None

    try:
        return UUID(str(project))
    except ValueError:
        return None
