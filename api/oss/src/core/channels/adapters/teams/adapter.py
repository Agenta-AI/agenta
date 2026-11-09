import asyncio
import re
from time import monotonic
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote
from uuid import UUID

import httpx

from oss.src.core.channels.adapters.interface import ChannelAdapterInterface
from oss.src.core.channels.adapters.teams import mapping, package
from oss.src.core.channels.adapters.teams.capabilities import (
    fetch_teams_capabilities,
)
from oss.src.core.channels.adapters.teams.signature import (
    BotFrameworkKeys,
    bearer_token,
    verify_token,
)
from oss.src.core.channels.dtos import (
    ChannelCapabilities,
    ChannelConnection,
    ChannelConnectionCreate,
    ChannelInboundEvent,
    ChannelRequestContext,
    ChannelSetupDoc,
    ChannelSetupIdentity,
    ChannelSpaceCandidate,
)
from oss.src.core.channels.types import (
    ChannelConnectionIncomplete,
    ChannelConnectionVerificationFailed,
    ChannelCredentialRevoked,
    ChannelDeliveryUncertain,
    ChannelLocatorIncomplete,
    ChannelsError,
)
from oss.src.utils.env import env

_TOKEN_URL = "https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
_TOKEN_SCOPE = "https://api.botframework.com/.default"
_HTTP_TIMEOUT_SECONDS = 10.0
_TOKEN_REFRESH_MARGIN_SECONDS = 300.0
_TOKEN_LIFETIME_SECONDS = 3600.0
_CACHE_MAX = 1024

# The locator fields a receipt keeps, so a card update and a repost reach the
# same conversation.
_RECEIPT_FIELDS = ("tenant_id", "conversation_id", "thread_id", "service_url")

# Microsoft Entra error codes (AADSTS<code>) that verify_connection names.
_INVALID_CLIENT_SECRET = 7000215
_APPLICATION_NOT_FOUND = 700016
_TENANT_NOT_FOUND = 90002
_AADSTS_CODE = re.compile(r"AADSTS(\d+)")

_SECRET_REJECTED = (
    "Microsoft rejected this client secret. Copy the secret's Value, not its Secret ID."
)
_APPLICATION_UNKNOWN = "Microsoft found no application with this ID in this tenant."
_TENANT_UNKNOWN = "Microsoft found no directory with this tenant ID."
_CHECK_FAILED = "Could not check these values with Microsoft. Try again."


def _data(connection: ChannelConnection | ChannelConnectionCreate) -> Dict[str, Any]:
    return connection.data if isinstance(connection.data, dict) else {}


def _app_id(connection: ChannelConnection | ChannelConnectionCreate) -> str:
    """The bare app id, from a stored connection (under `connection_locator`)
    or from a create or rotate request (flat, as the user typed it)."""

    data = _data(connection)
    locator = data.get("connection_locator")
    value = locator.get("app_id") if isinstance(locator, dict) else None
    value = mapping.bare_app_id(value or data.get("app_id"))
    if not value:
        raise ChannelConnectionIncomplete(channel="teams", field="app_id")
    return value


def _tenant_id(connection: ChannelConnection | ChannelConnectionCreate) -> str:
    value = _data(connection).get("tenant_id")
    if not isinstance(value, str) or not value.strip():
        raise ChannelConnectionIncomplete(channel="teams", field="tenant_id")
    return value.strip().lower()


def _activities_url(locator: Dict[str, Any]) -> str:
    """`{service_url}/v3/conversations/{conversation}/activities`, where a
    channel thread's conversation carries `;messageid=<root id>`. Refused for
    any host but Microsoft's reply hosts, before the token is read."""

    for field in ("service_url", "conversation_id"):
        if not locator.get(field):
            raise ChannelLocatorIncomplete(
                channel="teams", grain="reply", missing=field
            )
    service_url = locator["service_url"]
    if not mapping.reply_host_allowed(service_url):
        raise _ReplyHostRefused(service_url=service_url)
    conversation = mapping.join_conversation_id(
        locator["conversation_id"], locator.get("thread_id") or ""
    )
    return (
        f"{service_url.rstrip('/')}/v3/conversations/"
        f"{quote(conversation, safe='')}/activities"
    )


def _outbound(
    activity: Dict[str, Any], connection: ChannelConnection
) -> Dict[str, Any]:
    # Microsoft can refuse a send without the tenant once the inbound
    # request has ended, which is always the case for the outbox.
    return {**activity, "channelData": {"tenant": {"id": _tenant_id(connection)}}}


def _expires_in(body: Dict[str, Any]) -> float:
    try:
        return float(body.get("expires_in") or _TOKEN_LIFETIME_SECONDS)
    except (TypeError, ValueError):
        return _TOKEN_LIFETIME_SECONDS


class TeamsAdapter(ChannelAdapterInterface):
    """A Teams bot the user registers in their own Microsoft tenant: the
    application (client) id, a client secret and the directory (tenant) id.

    Teams POSTs every activity to the one messaging endpoint with a JWT that
    the Bot Framework signed. Replies go to the activity's `serviceUrl` with
    an access token from Microsoft Entra."""

    channel = "teams"

    def __init__(self, *, http_client: Optional[httpx.AsyncClient] = None) -> None:
        self._client = http_client or httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS)
        self._keys = BotFrameworkKeys(http_client=self._client)
        # connection id -> (access token, monotonic time to stop using it)
        self._tokens: Dict[UUID, Tuple[str, float]] = {}
        self._token_locks: Dict[UUID, asyncio.Lock] = {}

    # --- declaration --- #

    async def fetch_capabilities(
        self, *, connection: Optional[ChannelConnection] = None
    ) -> ChannelCapabilities:
        return fetch_teams_capabilities()

    # --- setup --- #

    async def verify_connection(
        self,
        *,
        connection: ChannelConnectionCreate,
        credentials: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Ask Microsoft for an access token with the three values. A refusal
        stores nothing. Rotation calls this too, with the stored data and only
        the new secret."""

        app_id = _app_id(connection)
        tenant_id = _tenant_id(connection)
        client_secret = (credentials or {}).get("client_secret")
        if not client_secret:
            raise ChannelConnectionIncomplete(
                channel=self.channel, field="client_secret"
            )

        try:
            await self._request_token(
                app_id=app_id, tenant_id=tenant_id, client_secret=client_secret
            )
        except _TokenRequestRefused as e:
            raise ChannelConnectionVerificationFailed(
                channel=self.channel, message=e.user_message
            ) from e
        except httpx.HTTPError as e:
            raise ChannelConnectionVerificationFailed(
                channel=self.channel, message=_CHECK_FAILED
            ) from e

        base_url = (env.agenta.api_url or "").rstrip("/")
        return {
            "app_id": app_id,
            "tenant_id": tenant_id,
            "webhook_url": f"{base_url}/channels/teams/events/",
        }

    async def build_setup_document(
        self,
        *,
        request_url: str,
        identity: Optional[ChannelSetupIdentity] = None,
        locator: Optional[Dict[str, Any]] = None,
    ) -> Optional[ChannelSetupDoc]:
        app_id = mapping.bare_app_id((locator or {}).get("app_id"))
        if not app_id:
            return None
        return package.build_setup_document(app_id=app_id, identity=identity)

    # --- ingress --- #

    def connection_locator(
        self, *, request: ChannelRequestContext
    ) -> Optional[Dict[str, Any]]:
        activity = mapping.parse_body(request.body)
        app_id = mapping.bare_app_id((activity.get("recipient") or {}).get("id"))
        return {"app_id": app_id} if app_id else None

    async def verify_signature(
        self, *, request: ChannelRequestContext, connection: ChannelConnection
    ) -> str:
        app_id = _app_id(connection)
        await verify_token(
            token=bearer_token(request.headers),
            app_id=app_id,
            service_url=mapping.parse_body(request.body).get("serviceUrl"),
            keys=self._keys,
        )
        return app_id

    async def parse_event(
        self,
        *,
        body: bytes,
        connection: Optional[ChannelConnection] = None,
        request: Optional[ChannelRequestContext] = None,
    ) -> Optional[ChannelInboundEvent]:
        """A message or a card click, or None for any other activity and for
        an activity from a tenant other than the connected one."""

        if connection is None:
            return None
        activity = mapping.parse_body(body)
        if mapping.tenant_id(activity) != _tenant_id(connection):
            return None
        return mapping.parse_activity(activity, app_id=_app_id(connection))

    async def detect_deactivation(self, *, body: bytes) -> bool:
        # Teams reports an uninstall per chat and per team, so one removal
        # must not switch the bot off everywhere.
        return False

    # --- egress --- #

    async def post_message(
        self,
        *,
        connection: ChannelConnection,
        locator: Dict[str, Any],
        content: List[Dict[str, Any]],
        idempotency_key: UUID,
    ) -> Dict[str, Any]:
        url = _activities_url(locator)
        activities = mapping.build_activities(
            content, thread_id=locator.get("thread_id") or ""
        )
        receipt: Dict[str, Any] = {}
        for activity in activities:
            try:
                sent = await self._send(
                    connection, "POST", url, _outbound(activity, connection)
                )
            except Exception as exc:
                if receipt:
                    # An earlier part is already in the chat; a retry would
                    # post it twice.
                    raise ChannelDeliveryUncertain(
                        channel=self.channel, detail=str(exc)[:200]
                    ) from exc
                raise
            receipt = {
                **{key: locator[key] for key in _RECEIPT_FIELDS if key in locator},
                "message_id": str(sent.get("id") or ""),
            }
        return receipt

    async def edit_message(
        self,
        *,
        connection: ChannelConnection,
        external_locator: Dict[str, Any],
        content: List[Dict[str, Any]],
        idempotency_key: UUID,
    ) -> Dict[str, Any]:
        # The declaration says controls.update is false, so core never asks.
        raise NotImplementedError("Teams answers are posted, never edited.")

    async def dismiss_choices(
        self,
        *,
        connection: ChannelConnection,
        external_locator: Dict[str, Any],
        content: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        """Replace the card with the same card without its buttons. Teams
        cannot change a card in answer to an `Action.Submit` click."""

        message_id = external_locator.get("message_id")
        if not message_id or not content or not mapping.has_choices(content):
            return
        url = f"{_activities_url(external_locator)}/{quote(message_id, safe='')}"
        activity = {
            "type": "message",
            "id": message_id,
            "attachments": [mapping.card_attachment(content, with_actions=False)],
        }
        await self._send(connection, "PUT", url, _outbound(activity, connection))

    async def signal_activity(
        self, *, connection: ChannelConnection, locator: Dict[str, Any]
    ) -> None:
        await self._send(
            connection,
            "POST",
            _activities_url(locator),
            _outbound({"type": "typing"}, connection),
        )

    # --- discovery and history --- #

    async def discover_spaces(
        self, *, connection: ChannelConnection
    ) -> List[ChannelSpaceCandidate]:
        # Spaces register on their first message.
        return []

    async def fetch_history(
        self, *, connection: ChannelConnection, locator: Dict[str, Any], limit: int
    ) -> List[ChannelInboundEvent]:
        raise NotImplementedError("Teams history is not read; backfill is off.")

    # --- internals --- #

    async def _send(
        self,
        connection: ChannelConnection,
        method: str,
        url: str,
        activity: Dict[str, Any],
    ) -> Dict[str, Any]:
        """One Bot Framework call. A 401 gets a new access token and one
        retry: the cached token may have been revoked before it expired."""

        token = await self._access_token(connection)
        response = await self._client.request(
            method, url, json=activity, headers={"Authorization": f"Bearer {token}"}
        )
        if response.status_code == 401:
            token = await self._access_token(connection, refused=token)
            response = await self._client.request(
                method,
                url,
                json=activity,
                headers={"Authorization": f"Bearer {token}"},
            )
            if response.status_code == 401:
                raise ChannelCredentialRevoked(
                    channel=self.channel, detail=str(_TeamsApiError(response))
                )
        if response.is_error:
            raise _TeamsApiError(response)
        try:
            body = response.json() if response.content else {}
        except ValueError:
            body = {}
        return body if isinstance(body, dict) else {}

    async def _access_token(
        self, connection: ChannelConnection, *, refused: Optional[str] = None
    ) -> str:
        """The connection's cached access token, or a new one when it is
        within 5 minutes of expiry or is the token Microsoft just `refused`.
        One token request at a time per connection."""

        if len(self._token_locks) >= _CACHE_MAX:
            self._token_locks = {
                key: lock for key, lock in self._token_locks.items() if lock.locked()
            }
        lock = self._token_locks.setdefault(connection.id, asyncio.Lock())
        async with lock:
            cached = self._tokens.get(connection.id)
            if cached and cached[0] != refused and monotonic() < cached[1]:
                return cached[0]
            body = await self._connection_token(connection)
            if len(self._tokens) >= _CACHE_MAX:
                self._tokens.clear()
            self._tokens[connection.id] = (
                body["access_token"],
                monotonic() + _expires_in(body) - _TOKEN_REFRESH_MARGIN_SECONDS,
            )
            return body["access_token"]

    async def _connection_token(self, connection: ChannelConnection) -> Dict[str, Any]:
        client_secret = _data(connection).get("client_secret")
        if not client_secret:
            raise ChannelConnectionIncomplete(
                channel=self.channel, field="client_secret"
            )
        try:
            return await self._request_token(
                app_id=_app_id(connection),
                tenant_id=_tenant_id(connection),
                client_secret=client_secret,
            )
        except _TokenRequestRefused as e:
            if e.status_code in (400, 401):
                # Entra refused the values themselves: a wrong or expired
                # secret, or a deleted app or tenant. No retry can pass.
                raise ChannelCredentialRevoked(
                    channel=self.channel, detail=str(e)
                ) from e
            raise _TokenUnavailable(detail=str(e)) from e
        except httpx.HTTPError as e:
            raise _TokenUnavailable(detail=type(e).__name__) from e

    async def _request_token(
        self, *, app_id: str, tenant_id: str, client_secret: str
    ) -> Dict[str, Any]:
        """The client credentials request. Raises _TokenRequestRefused when
        Microsoft answers with an error, httpx.HTTPError when it does not
        answer."""

        response = await self._client.post(
            _TOKEN_URL.format(tenant_id=tenant_id),
            data={
                "grant_type": "client_credentials",
                "client_id": app_id,
                "client_secret": client_secret,
                "scope": _TOKEN_SCOPE,
            },
        )
        try:
            body = response.json()
        except ValueError:
            body = {}
        body = body if isinstance(body, dict) else {}
        if response.status_code < 400 and body.get("access_token"):
            return body
        raise _TokenRequestRefused(status_code=response.status_code, body=body)


class _TokenRequestRefused(Exception):
    """Microsoft refused the client credentials request. Carries Microsoft's
    error code and the message to show the user, never the secret."""

    def __init__(self, *, status_code: int, body: Dict[str, Any]):
        self.status_code = status_code
        self.error = str(body.get("error") or "")
        codes = {
            code for code in body.get("error_codes") or [] if isinstance(code, int)
        }
        codes |= {
            int(code)
            for code in _AADSTS_CODE.findall(str(body.get("error_description") or ""))
        }
        self.codes = codes
        super().__init__(
            f"Microsoft token request refused ({status_code}): "
            f"{self.error or 'unknown error'} {sorted(codes)}"
        )

    @property
    def user_message(self) -> str:
        if _APPLICATION_NOT_FOUND in self.codes:
            return _APPLICATION_UNKNOWN
        if _TENANT_NOT_FOUND in self.codes:
            return _TENANT_UNKNOWN
        if _INVALID_CLIENT_SECRET in self.codes or self.error == "invalid_client":
            return _SECRET_REJECTED
        return _CHECK_FAILED


class _TeamsApiError(Exception):
    """A request the Bot Framework refused. `status_code` is what the outbox
    classifies by: a 4xx other than a 429 is a refusal no retry changes,
    such as 403 `MessageWritesBlocked` after the app was removed from a
    chat."""

    def __init__(self, response: httpx.Response):
        self.status_code = response.status_code
        try:
            body = response.json()
        except ValueError:
            body = {}
        error = (body.get("error") if isinstance(body, dict) else None) or {}
        error = error if isinstance(error, dict) else {}
        self.code = str(error.get("code") or "")
        super().__init__(
            f"Teams API error {self.code or 'unknown'} ({self.status_code}): "
            f"{str(error.get('message') or '')[:300]}"
        )


class _ReplyHostRefused(ChannelsError):
    """The locator names a reply host that is not Microsoft's. The access
    token is never sent there. The locator does not change on a retry, so
    the outbox reads it as a refusal (`status_code` 400)."""

    status_code = 400

    def __init__(self, *, service_url: str):
        super().__init__(f"teams: reply host refused ({service_url[:200]})")


class _TokenUnavailable(ChannelsError):
    """Microsoft did not issue an access token for a passing reason (a 429, a
    5xx, no answer). Nothing was sent, so the outbox retries."""

    def __init__(self, *, detail: str):
        super().__init__(f"teams: no access token ({detail})")
